'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CloudOff, HardDrive, Loader2 } from 'lucide-react';
import { fetchEncounterNote } from '@/services/api.service';
import {
  useSaveEncounterNoteMutation,
  type EncounterNoteApi,
} from '@/services/appointmentMutations';
import {
  createAutoSaveScheduler,
  createSoapDraftStore,
  EMPTY_SOAP_NOTE,
  EncounterNoteConflictError,
  isSoapNoteEmpty,
  LOCAL_AUTOSAVE_DELAY_MS,
  parseSoapNote,
  REMOTE_AUTOSAVE_DELAY_MS,
  serializeSoapNote,
  SOAP_LABELS,
  SOAP_SECTIONS,
  type AutoSaveScheduler,
  type SoapDraftStore,
  type SoapNote,
  type SoapSection,
} from '@/lib/soapNotes';
import type { EncounterNote } from '@/types';

interface Props {
  appointmentId: string;
  initialDraftContent?: string | undefined;
  /* Injection points for tests. */
  draftStore?: SoapDraftStore;
  noteApi?: EncounterNoteApi;
  localDelayMs?: number;
  remoteDelayMs?: number;
}

export type SaveStatus =
  | 'idle'
  | 'unsaved'
  | 'saved-local'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'conflict';

const PLACEHOLDERS: Record<SoapSection, string> = {
  subjective: 'Chief complaint, history of present illness, symptoms as reported by the patient…',
  objective: 'Vitals, observations, exam findings, results…',
  assessment: 'Diagnosis / differential and clinical reasoning…',
  plan: 'Treatment, prescriptions, referrals, follow-up…',
};

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString() : '');

export default function EncounterNotes({
  appointmentId,
  initialDraftContent,
  draftStore: draftStoreProp,
  noteApi,
  localDelayMs = LOCAL_AUTOSAVE_DELAY_MS,
  remoteDelayMs = REMOTE_AUTOSAVE_DELAY_MS,
}: Props) {
  const draftStore = useMemo(() => draftStoreProp ?? createSoapDraftStore(), [draftStoreProp]);
  const [note, setNote] = useState<SoapNote>(EMPTY_SOAP_NOTE);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [localSavedAt, setLocalSavedAt] = useState<string | null>(null);
  const [remoteSavedAt, setRemoteSavedAt] = useState<string | null>(null);
  const [conflict, setConflict] = useState<EncounterNote | null>(null);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [ready, setReady] = useState(false);

  const noteRef = useRef(note);
  noteRef.current = note;
  /** Server version the current edits are based on. */
  const baseRef = useRef<string | null>(null);
  const conflictRef = useRef<EncounterNote | null>(null);
  conflictRef.current = conflict;
  const schedulerRef = useRef<AutoSaveScheduler | null>(null);

  const { data: existing, isLoading } = useQuery({
    queryKey: ['encounter-note', appointmentId],
    queryFn: () => (noteApi ? noteApi.fetch(appointmentId) : fetchEncounterNote(appointmentId)),
    enabled: !!appointmentId,
    retry: false,
  });

  const saveMutation = useSaveEncounterNoteMutation(appointmentId, noteApi ? { noteApi } : {});
  const mutateRef = useRef(saveMutation.mutateAsync);
  mutateRef.current = saveMutation.mutateAsync;

  const writeLocal = useCallback(
    async (dirty: boolean) => {
      const savedAt = new Date().toISOString();
      try {
        await draftStore.save(appointmentId, {
          note: noteRef.current,
          baseUpdatedAt: baseRef.current,
          savedAt,
          dirty,
        });
        if (dirty) {
          setLocalSavedAt(savedAt);
          setStatus((s) => (s === 'unsaved' ? 'saved-local' : s));
        }
      } catch (err) {
        console.warn('Could not save encounter note draft locally:', err);
      }
    },
    [draftStore, appointmentId],
  );

  const syncRemote = useCallback(
    async (force = false) => {
      if (conflictRef.current && !force) return; // wait for the user to resolve
      const content = serializeSoapNote(noteRef.current);
      setStatus('syncing');
      try {
        const saved = await mutateRef.current({ content, baseUpdatedAt: baseRef.current, force });
        baseRef.current = saved.updatedAt;
        setRemoteSavedAt(saved.updatedAt);
        setConflict(null);
        // Edits made while the request was in flight are still pending.
        const stillPending = schedulerRef.current?.hasPendingRemote() ?? false;
        setStatus(stillPending ? 'unsaved' : 'synced');
        if (!stillPending) await writeLocal(false);
      } catch (err) {
        if (err instanceof EncounterNoteConflictError) {
          setConflict(err.remote);
          setStatus('conflict');
          await writeLocal(true);
        } else {
          setStatus('offline');
          schedulerRef.current?.schedule(content); // retry on the next 30 s window
          console.warn('Encounter note sync failed; kept on this device:', err);
        }
      }
    },
    [writeLocal],
  );

  useEffect(() => {
    const scheduler = createAutoSaveScheduler({
      saveLocal: () => void writeLocal(true),
      saveRemote: () => void syncRemote(),
      localDelayMs,
      remoteDelayMs,
    });
    schedulerRef.current = scheduler;
    return () => {
      scheduler.flushLocal(); // never lose the last keystrokes on unmount
      scheduler.cancel();
      schedulerRef.current = null;
    };
  }, [writeLocal, syncRemote, localDelayMs, remoteDelayMs]);

  // Initial load: reconcile the server copy with any unsynced local draft.
  useEffect(() => {
    if (isLoading || ready) return;
    let cancelled = false;
    void draftStore.load(appointmentId).then((draft) => {
      if (cancelled) return;
      const remote = existing ?? null;
      const remoteVersion = remote?.updatedAt ?? null;
      if (draft?.dirty && !isSoapNoteEmpty(draft.note)) {
        const sameAsRemote = remote && remote.content.trim() === serializeSoapNote(draft.note).trim();
        if (sameAsRemote) {
          setNote(parseSoapNote(remote.content));
          baseRef.current = remoteVersion;
          setRemoteSavedAt(remoteVersion);
          setStatus('synced');
        } else {
          setNote(draft.note);
          baseRef.current = draft.baseUpdatedAt;
          setLocalSavedAt(draft.savedAt);
          setRestoredDraft(true);
          if (remote && draft.baseUpdatedAt !== remoteVersion) {
            setConflict(remote);
            setStatus('conflict');
          } else {
            setStatus('saved-local');
            schedulerRef.current?.schedule(serializeSoapNote(draft.note));
          }
        }
      } else if (remote?.content) {
        setNote(parseSoapNote(remote.content));
        baseRef.current = remoteVersion;
        setRemoteSavedAt(remoteVersion);
        setStatus('synced');
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isLoading, ready, existing, draftStore, appointmentId]);

  // Transcription draft (#64) arrives when the call ends; only fill an empty note.
  useEffect(() => {
    if (!ready || !initialDraftContent || !isSoapNoteEmpty(noteRef.current)) return;
    const parsed = parseSoapNote(initialDraftContent);
    setNote(parsed);
    noteRef.current = parsed;
    setStatus('unsaved');
    schedulerRef.current?.schedule(serializeSoapNote(parsed));
  }, [ready, initialDraftContent]);

  function handleChange(section: SoapSection, value: string) {
    const next = { ...noteRef.current, [section]: value };
    noteRef.current = next;
    setNote(next);
    if (!conflictRef.current) setStatus('unsaved');
    schedulerRef.current?.schedule(serializeSoapNote(next));
  }

  function keepMine() {
    void syncRemote(true);
  }

  function acceptRemote() {
    if (!conflict) return;
    const parsed = parseSoapNote(conflict.content);
    schedulerRef.current?.cancel();
    noteRef.current = parsed;
    baseRef.current = conflict.updatedAt;
    setNote(parsed);
    setRemoteSavedAt(conflict.updatedAt);
    setConflict(null);
    setRestoredDraft(false);
    setStatus('synced');
    void draftStore.clear(appointmentId);
  }

  if (isLoading || !ready) {
    return <div className="animate-pulse h-48 m-4 rounded-lg bg-surface-card" />;
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-1">Encounter Notes · SOAP</h3>
        <SaveStatusIndicator status={status} localSavedAt={localSavedAt} remoteSavedAt={remoteSavedAt} />
      </div>

      {conflict && (
        <div role="alert" className="space-y-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-text-1">
          <p className="flex items-center gap-1.5 font-semibold text-yellow-700">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            This note was changed elsewhere at {fmtTime(conflict.updatedAt)}
          </p>
          <p className="text-text-2">
            Your edits are safe on this device but have not been synced. Choose which version to keep.
          </p>
          <details className="text-text-3">
            <summary className="cursor-pointer">Show the other version</summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface-inset p-2 font-sans">
              {conflict.content}
            </pre>
          </details>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={keepMine}
              className="rounded-md bg-green px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
            >
              Keep my version
            </button>
            <button
              type="button"
              onClick={acceptRemote}
              className="rounded-md border border-border px-3 py-1 text-xs font-medium text-text-1 hover:bg-surface-hover"
            >
              Use other version
            </button>
          </div>
        </div>
      )}

      {restoredDraft && !conflict && (
        <p role="status" className="rounded-md bg-surface-inset px-2 py-1 text-3xs text-text-3">
          Restored unsynced edits saved on this device at {fmtTime(localSavedAt)}.
        </p>
      )}

      {SOAP_SECTIONS.map((section) => (
        <label key={section} className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-text-2">{SOAP_LABELS[section]}</span>
          <textarea
            value={note[section]}
            onChange={(e) => handleChange(section, e.target.value)}
            placeholder={PLACEHOLDERS[section]}
            rows={section === 'subjective' ? 4 : 3}
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-text-1 resize-y focus:outline-none focus:ring-2 focus:ring-border-focus"
          />
        </label>
      ))}
    </div>
  );
}

export function SaveStatusIndicator({
  status,
  localSavedAt,
  remoteSavedAt,
}: {
  status: SaveStatus;
  localSavedAt: string | null;
  remoteSavedAt: string | null;
}) {
  const view: Record<SaveStatus, { icon: React.ReactNode; text: string; tone: string }> = {
    idle: { icon: null, text: 'Not saved', tone: 'text-text-3' },
    unsaved: { icon: null, text: 'Unsaved changes…', tone: 'text-text-3' },
    'saved-local': {
      icon: <HardDrive className="h-3 w-3" aria-hidden="true" />,
      text: `Saved on device ${fmtTime(localSavedAt)}`,
      tone: 'text-text-2',
    },
    syncing: { icon: <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />, text: 'Syncing…', tone: 'text-text-2' },
    synced: {
      icon: <CheckCircle2 className="h-3 w-3" aria-hidden="true" />,
      text: `Synced ${fmtTime(remoteSavedAt)}`,
      tone: 'text-green',
    },
    offline: {
      icon: <CloudOff className="h-3 w-3" aria-hidden="true" />,
      text: 'Sync failed — saved on device, will retry',
      tone: 'text-yellow-700',
    },
    conflict: {
      icon: <AlertTriangle className="h-3 w-3" aria-hidden="true" />,
      text: 'Version conflict',
      tone: 'text-yellow-700',
    },
  };
  const v = view[status];
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="note-save-status"
      data-status={status}
      className={`flex items-center gap-1 text-xs ${v.tone}`}
    >
      {v.icon}
      {v.text}
    </span>
  );
}
