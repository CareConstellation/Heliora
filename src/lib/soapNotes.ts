/**
 * Structured SOAP encounter notes with local-first auto-save (#266).
 *
 * - Notes are edited as four sections and stored on the backend as a single
 *   markdown string, so the existing `EncounterNote.content` API is unchanged
 *   and older unstructured notes still load.
 * - Every edit is written to IndexedDB after 3 s of inactivity (AES-GCM
 *   sealed, since notes are PHI) and synced to the backend at most every 30 s.
 * - Each draft remembers the server version it was based on; if the server
 *   copy has moved on when we sync, the user is warned instead of silently
 *   overwriting another clinician's edits.
 */

import { Buffer } from 'buffer';
import { createStore, del, get, set } from 'idb-keyval';
import { indexedDbKeyProvider, type LocalKeyProvider } from '@/lib/encryptedLocalStore';
import type { EncounterNote } from '@/types';

/* ── Structure ───────────────────────────────────────────────────── */

export const SOAP_SECTIONS = ['subjective', 'objective', 'assessment', 'plan'] as const;
export type SoapSection = (typeof SOAP_SECTIONS)[number];
export type SoapNote = Record<SoapSection, string>;

export const SOAP_LABELS: Record<SoapSection, string> = {
  subjective: 'Subjective',
  objective: 'Objective',
  assessment: 'Assessment',
  plan: 'Plan',
};

export const EMPTY_SOAP_NOTE: SoapNote = { subjective: '', objective: '', assessment: '', plan: '' };

/** `## Subjective` (our format) or `[SUBJECTIVE]:` (transcription drafts). */
const HEADER_RE = /^\s*(?:#{1,6}\s*(subjective|objective|assessment|plan)\s*:?|\[(subjective|objective|assessment|plan)\]\s*:?)\s*$/i;

export function serializeSoapNote(note: SoapNote): string {
  return SOAP_SECTIONS.map((s) => `## ${SOAP_LABELS[s]}\n${note[s].trim()}`).join('\n\n');
}

/**
 * Parses stored content back into sections. Text before the first header
 * (or a legacy note with no headers at all) is kept in Subjective, and
 * unrecognised headings stay inside the section they appear in, so parsing
 * never drops text.
 */
export function parseSoapNote(content: string): SoapNote {
  const out: Record<SoapSection, string[]> = { subjective: [], objective: [], assessment: [], plan: [] };
  let current: SoapSection = 'subjective';
  for (const line of content.split(/\r?\n/)) {
    const m = HEADER_RE.exec(line);
    if (m) {
      current = (m[1] ?? m[2])!.toLowerCase() as SoapSection;
      continue;
    }
    out[current].push(line);
  }
  return {
    subjective: out.subjective.join('\n').trim(),
    objective: out.objective.join('\n').trim(),
    assessment: out.assessment.join('\n').trim(),
    plan: out.plan.join('\n').trim(),
  };
}

export function isSoapNoteEmpty(note: SoapNote): boolean {
  return SOAP_SECTIONS.every((s) => note[s].trim() === '');
}

/* ── Conflict detection ──────────────────────────────────────────── */

/**
 * A conflict exists when the server copy changed since the version our edits
 * were based on *and* it differs from what we are about to write. Identical
 * content (e.g. our own earlier save landing twice) is not a conflict.
 */
export function detectNoteConflict(input: {
  baseUpdatedAt: string | null;
  localContent: string;
  remote: Pick<EncounterNote, 'content' | 'updatedAt'> | null | undefined;
}): boolean {
  const { baseUpdatedAt, localContent, remote } = input;
  if (!remote) return false;
  if (remote.updatedAt === baseUpdatedAt) return false;
  return remote.content.trim() !== localContent.trim();
}

export class EncounterNoteConflictError extends Error {
  constructor(public readonly remote: EncounterNote) {
    super('This note was changed on another device since you started editing.');
    this.name = 'EncounterNoteConflictError';
  }
}

/* ── Encrypted IndexedDB drafts ──────────────────────────────────── */

export interface SoapDraft {
  note: SoapNote;
  /** Server `updatedAt` the edits started from; null for a note not yet on the server. */
  baseUpdatedAt: string | null;
  savedAt: string;
  /** True until the draft has been synced to the backend. */
  dirty: boolean;
}

export interface KeyValueBackend {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

export interface SoapDraftStore {
  load(appointmentId: string): Promise<SoapDraft | null>;
  save(appointmentId: string, draft: SoapDraft): Promise<void>;
  clear(appointmentId: string): Promise<void>;
}

const DRAFT_NAMESPACE = 'heliora-soap-drafts';

function idbBackend(): KeyValueBackend {
  const store = createStore(DRAFT_NAMESPACE, 'drafts');
  return {
    get: (k) => get(k, store),
    set: (k, v) => set(k, v, store),
    del: (k) => del(k, store),
  };
}

/**
 * Draft store sealed with AES-256-GCM. The appointment id is bound as
 * additional authenticated data, so a draft copied to another appointment's
 * key fails to decrypt.
 */
export function createSoapDraftStore(
  options: { keyProvider?: LocalKeyProvider; backend?: KeyValueBackend } = {},
): SoapDraftStore {
  const keyProvider = options.keyProvider ?? indexedDbKeyProvider;
  let backend = options.backend;
  const kv = () => (backend ??= idbBackend());
  const aad = (id: string) => new TextEncoder().encode(`${DRAFT_NAMESPACE}:${id}`);

  return {
    async load(appointmentId) {
      const raw = (await kv().get(appointmentId)) as { iv: string; ct: string } | undefined;
      if (!raw?.iv || !raw.ct) return null;
      try {
        const key = await keyProvider.getKey(DRAFT_NAMESPACE);
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(Buffer.from(raw.iv, 'base64')), additionalData: aad(appointmentId) },
          key,
          new Uint8Array(Buffer.from(raw.ct, 'base64')),
        );
        return JSON.parse(new TextDecoder().decode(plain)) as SoapDraft;
      } catch {
        // Unreadable (key reset, tampering): treat as no draft rather than crash the editor.
        return null;
      }
    },
    async save(appointmentId, draft) {
      const key = await keyProvider.getKey(DRAFT_NAMESPACE);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad(appointmentId) },
        key,
        new TextEncoder().encode(JSON.stringify(draft)),
      );
      await kv().set(appointmentId, {
        iv: Buffer.from(iv).toString('base64'),
        ct: Buffer.from(new Uint8Array(ct)).toString('base64'),
      });
    },
    async clear(appointmentId) {
      await kv().del(appointmentId);
    },
  };
}

/* ── Auto-save scheduling ────────────────────────────────────────── */

export const LOCAL_AUTOSAVE_DELAY_MS = 3_000;
export const REMOTE_AUTOSAVE_DELAY_MS = 30_000;

export interface AutoSaveScheduler {
  /** Record a new value; (re)arms both timers. */
  schedule(value: string): void;
  /** Write the pending value locally now (e.g. on unmount / tab hide). */
  flushLocal(): void;
  /** Sync the pending value to the backend now. */
  flushRemote(): void;
  hasPendingRemote(): boolean;
  cancel(): void;
}

/**
 * Two independent timers:
 * - local: trailing debounce — fires 3 s after the *last* keystroke;
 * - remote: fires 30 s after the *first* unsynced keystroke and is not pushed
 *   back by further typing, so a clinician typing continuously still syncs
 *   every 30 s instead of never.
 */
export function createAutoSaveScheduler(options: {
  saveLocal: (value: string) => void;
  saveRemote: (value: string) => void;
  localDelayMs?: number;
  remoteDelayMs?: number;
}): AutoSaveScheduler {
  const localDelay = options.localDelayMs ?? LOCAL_AUTOSAVE_DELAY_MS;
  const remoteDelay = options.remoteDelayMs ?? REMOTE_AUTOSAVE_DELAY_MS;
  let latest: string | null = null;
  let localTimer: ReturnType<typeof setTimeout> | undefined;
  let remoteTimer: ReturnType<typeof setTimeout> | undefined;
  let localPending = false;
  let remotePending = false;

  const runLocal = () => {
    clearTimeout(localTimer);
    localTimer = undefined;
    if (!localPending || latest === null) return;
    localPending = false;
    options.saveLocal(latest);
  };
  const runRemote = () => {
    clearTimeout(remoteTimer);
    remoteTimer = undefined;
    if (!remotePending || latest === null) return;
    remotePending = false;
    options.saveRemote(latest);
  };

  return {
    schedule(value) {
      latest = value;
      localPending = true;
      remotePending = true;
      clearTimeout(localTimer);
      localTimer = setTimeout(runLocal, localDelay);
      remoteTimer ??= setTimeout(runRemote, remoteDelay);
    },
    flushLocal: runLocal,
    flushRemote: runRemote,
    hasPendingRemote: () => remotePending,
    cancel() {
      clearTimeout(localTimer);
      clearTimeout(remoteTimer);
      localTimer = remoteTimer = undefined;
      localPending = remotePending = false;
    },
  };
}
