jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  startSpan: (_o: unknown, cb: (s: unknown) => unknown) => cb({ setAttribute: jest.fn() }),
  setUser: jest.fn(),
  setTag: jest.fn(),
  init: jest.fn(),
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EncounterNotes from '@/components/consultation/EncounterNotes';
import { createMemoryKeyProvider } from '@/lib/encryptedLocalStore';
import {
  createAutoSaveScheduler,
  createSoapDraftStore,
  detectNoteConflict,
  EncounterNoteConflictError,
  LOCAL_AUTOSAVE_DELAY_MS,
  parseSoapNote,
  REMOTE_AUTOSAVE_DELAY_MS,
  serializeSoapNote,
  type KeyValueBackend,
  type SoapDraft,
  type SoapDraftStore,
} from '@/lib/soapNotes';
import {
  saveEncounterNoteWithConflictCheck,
  type EncounterNoteApi,
} from '@/services/appointmentMutations';
import type { EncounterNote } from '@/types';

const note = (content: string, updatedAt: string): EncounterNote => ({
  id: 'n1',
  appointmentId: 'appt-1',
  doctorAddress: 'GDOC',
  patientAddress: 'GPAT',
  content,
  createdAt: '2026-11-25T09:00:00.000Z',
  updatedAt,
});

/* ── Structure ──────────────────────────────────────────────────── */

describe('SOAP note structure (#266)', () => {
  const soap = { subjective: 'Cough for 3 days', objective: 'T 38.1°C', assessment: 'Viral URTI', plan: 'Rest, fluids' };

  it('round-trips through the stored markdown', () => {
    expect(parseSoapNote(serializeSoapNote(soap))).toEqual(soap);
  });

  it('keeps legacy unstructured notes in Subjective without losing text', () => {
    expect(parseSoapNote('Free text note\nline two')).toEqual({
      subjective: 'Free text note\nline two',
      objective: '',
      assessment: '',
      plan: '',
    });
  });

  it('parses transcription drafts that use [SECTION]: headers', () => {
    const parsed = parseSoapNote('[SUBJECTIVE]:\nHeadache\n\n[OBJECTIVE]:\nBP 120/80\n[ASSESSMENT]:\nTension\n[PLAN]:\nIbuprofen');
    expect(parsed).toEqual({ subjective: 'Headache', objective: 'BP 120/80', assessment: 'Tension', plan: 'Ibuprofen' });
  });
});

/* ── Debounce timing ────────────────────────────────────────────── */

describe('auto-save scheduler timing (#266)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('uses 3 s for IndexedDB and 30 s for the backend', () => {
    expect(LOCAL_AUTOSAVE_DELAY_MS).toBe(3_000);
    expect(REMOTE_AUTOSAVE_DELAY_MS).toBe(30_000);
  });

  it('saves locally 3 s after the last edit, not before', () => {
    const saveLocal = jest.fn();
    const s = createAutoSaveScheduler({ saveLocal, saveRemote: jest.fn() });
    s.schedule('a');
    jest.advanceTimersByTime(2_000);
    s.schedule('ab'); // resets the local debounce
    jest.advanceTimersByTime(2_999);
    expect(saveLocal).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(saveLocal).toHaveBeenCalledTimes(1);
    expect(saveLocal).toHaveBeenCalledWith('ab');
  });

  it('syncs to the backend 30 s after the first unsynced edit, even while typing continues', () => {
    const saveRemote = jest.fn();
    const s = createAutoSaveScheduler({ saveLocal: jest.fn(), saveRemote });
    for (let t = 0; t < 29_000; t += 1_000) {
      s.schedule(`v${t}`);
      jest.advanceTimersByTime(1_000);
    }
    expect(saveRemote).not.toHaveBeenCalled();
    s.schedule('latest');
    jest.advanceTimersByTime(1_000);
    expect(saveRemote).toHaveBeenCalledTimes(1);
    expect(saveRemote).toHaveBeenCalledWith('latest');
  });

  it('does not sync when nothing changed, and starts a new window after each sync', () => {
    const saveRemote = jest.fn();
    const s = createAutoSaveScheduler({ saveLocal: jest.fn(), saveRemote });
    jest.advanceTimersByTime(60_000);
    expect(saveRemote).not.toHaveBeenCalled();
    s.schedule('x');
    jest.advanceTimersByTime(30_000);
    s.schedule('y');
    jest.advanceTimersByTime(29_999);
    expect(saveRemote).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(saveRemote).toHaveBeenLastCalledWith('y');
  });

  it('flushLocal writes pending edits immediately; cancel drops timers', () => {
    const saveLocal = jest.fn();
    const saveRemote = jest.fn();
    const s = createAutoSaveScheduler({ saveLocal, saveRemote });
    s.schedule('pending');
    s.flushLocal();
    expect(saveLocal).toHaveBeenCalledWith('pending');
    s.cancel();
    jest.advanceTimersByTime(60_000);
    expect(saveLocal).toHaveBeenCalledTimes(1);
    expect(saveRemote).not.toHaveBeenCalled();
  });
});

/* ── Conflict detection ─────────────────────────────────────────── */

describe('detectNoteConflict (#266)', () => {
  it('no conflict when the server is still at our base version', () => {
    expect(detectNoteConflict({ baseUpdatedAt: 't1', localContent: 'mine', remote: note('theirs', 't1') })).toBe(false);
  });

  it('conflict when the server moved on with different content', () => {
    expect(detectNoteConflict({ baseUpdatedAt: 't1', localContent: 'mine', remote: note('theirs', 't2') })).toBe(true);
  });

  it('conflict when a note was created remotely while we drafted a new one', () => {
    expect(detectNoteConflict({ baseUpdatedAt: null, localContent: 'mine', remote: note('theirs', 't2') })).toBe(true);
  });

  it('no conflict when the remote change is identical to ours', () => {
    expect(detectNoteConflict({ baseUpdatedAt: 't1', localContent: 'same', remote: note('same', 't2') })).toBe(false);
  });

  it('no conflict when there is no remote note', () => {
    expect(detectNoteConflict({ baseUpdatedAt: null, localContent: 'mine', remote: null })).toBe(false);
  });
});

describe('saveEncounterNoteWithConflictCheck (#266)', () => {
  const api = (remote: EncounterNote | null, save?: EncounterNoteApi['save']): EncounterNoteApi & { save: jest.Mock } => ({
    fetch: jest.fn(async () => remote),
    save: jest.fn(save ?? (async (_id, content) => note(content, 't-new'))),
  });

  it('saves with the base version as the expected version', async () => {
    const a = api(note('old', 't1'));
    await expect(saveEncounterNoteWithConflictCheck('appt-1', { content: 'new', baseUpdatedAt: 't1' }, a)).resolves.toMatchObject({
      updatedAt: 't-new',
    });
    expect(a.save).toHaveBeenCalledWith('appt-1', 'new', { expectedUpdatedAt: 't1' });
  });

  it('throws a conflict (and does not write) when the remote changed', async () => {
    const a = api(note('theirs', 't2'));
    const err = await saveEncounterNoteWithConflictCheck('appt-1', { content: 'mine', baseUpdatedAt: 't1' }, a).catch((e) => e);
    expect(err).toBeInstanceOf(EncounterNoteConflictError);
    expect((err as EncounterNoteConflictError).remote.updatedAt).toBe('t2');
    expect(a.save).not.toHaveBeenCalled();
  });

  it('force overwrites against the latest remote version ("Keep mine")', async () => {
    const a = api(note('theirs', 't2'));
    await saveEncounterNoteWithConflictCheck('appt-1', { content: 'mine', baseUpdatedAt: 't1', force: true }, a);
    expect(a.save).toHaveBeenCalledWith('appt-1', 'mine', { expectedUpdatedAt: 't2' });
  });

  it('turns a backend 409 into a conflict with the latest remote copy', async () => {
    const a = api(note('old', 't1'), async () => {
      throw { status: 409, message: 'Conflict' };
    });
    a.fetch = jest.fn().mockResolvedValueOnce(note('old', 't1')).mockResolvedValueOnce(note('raced', 't3'));
    const err = await saveEncounterNoteWithConflictCheck('appt-1', { content: 'mine', baseUpdatedAt: 't1' }, a).catch((e) => e);
    expect(err).toBeInstanceOf(EncounterNoteConflictError);
    expect((err as EncounterNoteConflictError).remote.content).toBe('raced');
  });

  it('passes other errors through', async () => {
    const a = api(null, async () => {
      throw { status: 500, message: 'down' };
    });
    await expect(saveEncounterNoteWithConflictCheck('appt-1', { content: 'x', baseUpdatedAt: null }, a)).rejects.toEqual({
      status: 500,
      message: 'down',
    });
  });
});

/* ── Encrypted IndexedDB drafts ─────────────────────────────────── */

describe('createSoapDraftStore (#266)', () => {
  const memoryBackend = (): KeyValueBackend & { data: Map<string, unknown> } => {
    const data = new Map<string, unknown>();
    return {
      data,
      get: async (k) => data.get(k),
      set: async (k, v) => void data.set(k, v),
      del: async (k) => void data.delete(k),
    };
  };
  const draft: SoapDraft = {
    note: { subjective: 'Chest pain', objective: '', assessment: '', plan: '' },
    baseUpdatedAt: 't1',
    savedAt: '2026-11-25T10:00:00.000Z',
    dirty: true,
  };

  it('encrypts drafts at rest and decrypts them for the same appointment', async () => {
    const backend = memoryBackend();
    const store = createSoapDraftStore({ keyProvider: createMemoryKeyProvider(), backend });
    await store.save('appt-1', draft);
    expect(JSON.stringify(backend.data.get('appt-1'))).not.toContain('Chest pain');
    await expect(store.load('appt-1')).resolves.toEqual(draft);
    await store.clear('appt-1');
    await expect(store.load('appt-1')).resolves.toBeNull();
  });

  it('a draft copied to another appointment does not decrypt', async () => {
    const backend = memoryBackend();
    const store = createSoapDraftStore({ keyProvider: createMemoryKeyProvider(), backend });
    await store.save('appt-1', draft);
    backend.data.set('appt-2', backend.data.get('appt-1'));
    await expect(store.load('appt-2')).resolves.toBeNull();
  });
});

/* ── Component ──────────────────────────────────────────────────── */

describe('EncounterNotes auto-save (#266)', () => {
  function memoryDraftStore(initial: SoapDraft | null = null): SoapDraftStore & { current: SoapDraft | null; save: jest.Mock } {
    const store = {
      current: initial,
      load: jest.fn(async () => store.current),
      save: jest.fn(async (_id: string, d: SoapDraft) => {
        store.current = d;
      }),
      clear: jest.fn(async () => {
        store.current = null;
      }),
    };
    return store;
  }

  function renderNotes(opts: { remote: EncounterNote | null; draft?: SoapDraft | null; save?: EncounterNoteApi['save'] }) {
    let remote = opts.remote;
    const noteApi = {
      fetch: jest.fn(async () => remote),
      save: jest.fn(
        opts.save ??
          (async (_id: string, content: string) => {
            remote = note(content, `t-${Date.now()}`);
            return remote;
          }),
      ),
      setRemote: (n: EncounterNote) => {
        remote = n;
      },
    };
    const draftStore = memoryDraftStore(opts.draft ?? null);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <EncounterNotes appointmentId="appt-1" draftStore={draftStore} noteApi={noteApi} />
      </QueryClientProvider>,
    );
    return { noteApi, draftStore };
  }

  const status = () => screen.getByTestId('note-save-status');

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('renders the four SOAP sections populated from the server note', async () => {
    renderNotes({ remote: note(serializeSoapNote({ subjective: 'S', objective: 'O', assessment: 'A', plan: 'P' }), 't1') });
    expect(await screen.findByLabelText('Subjective')).toHaveValue('S');
    expect(screen.getByLabelText('Objective')).toHaveValue('O');
    expect(screen.getByLabelText('Assessment')).toHaveValue('A');
    expect(screen.getByLabelText('Plan')).toHaveValue('P');
    expect(status()).toHaveAttribute('data-status', 'synced');
  });

  it('saves to IndexedDB after 3 s and to the backend after 30 s', async () => {
    const { noteApi, draftStore } = renderNotes({ remote: note('## Subjective\nold', 't1') });
    const field = await screen.findByLabelText('Plan');

    fireEvent.change(field, { target: { value: 'Start antibiotics' } });
    expect(status()).toHaveAttribute('data-status', 'unsaved');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_999);
    });
    expect(draftStore.save).not.toHaveBeenCalled();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(draftStore.save).toHaveBeenCalledTimes(1);
    expect(draftStore.current).toMatchObject({ dirty: true, baseUpdatedAt: 't1' });
    expect(draftStore.current!.note.plan).toBe('Start antibiotics');
    expect(status()).toHaveAttribute('data-status', 'saved-local');
    expect(noteApi.save).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(27_000);
    });
    await waitFor(() => expect(noteApi.save).toHaveBeenCalledTimes(1));
    expect(noteApi.save.mock.calls[0]![1]).toContain('Start antibiotics');
    expect(noteApi.save.mock.calls[0]![2]).toEqual({ expectedUpdatedAt: 't1' });
    await waitFor(() => expect(status()).toHaveAttribute('data-status', 'synced'));
    expect(draftStore.current).toMatchObject({ dirty: false });
  });

  it('warns on a remote version conflict and keeps local edits', async () => {
    const { noteApi } = renderNotes({ remote: note('## Subjective\nold', 't1') });
    const field = await screen.findByLabelText('Assessment');
    fireEvent.change(field, { target: { value: 'My assessment' } });

    noteApi.setRemote(note('## Assessment\nColleague assessment', 't2'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(REMOTE_AUTOSAVE_DELAY_MS);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed elsewhere/i);
    expect(status()).toHaveAttribute('data-status', 'conflict');
    expect(noteApi.save).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Assessment')).toHaveValue('My assessment');
  });

  it('"Keep my version" overwrites against the latest remote version', async () => {
    const { noteApi } = renderNotes({ remote: note('## Subjective\nold', 't1') });
    fireEvent.change(await screen.findByLabelText('Assessment'), { target: { value: 'Mine' } });
    noteApi.setRemote(note('## Assessment\nTheirs', 't2'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(REMOTE_AUTOSAVE_DELAY_MS);
    });
    fireEvent.click(await screen.findByRole('button', { name: /keep my version/i }));
    await waitFor(() => expect(noteApi.save).toHaveBeenCalledTimes(1));
    expect(noteApi.save.mock.calls[0]![2]).toEqual({ expectedUpdatedAt: 't2' });
    await waitFor(() => expect(status()).toHaveAttribute('data-status', 'synced'));
  });

  it('"Use other version" replaces local edits with the remote copy', async () => {
    const { noteApi, draftStore } = renderNotes({ remote: note('## Subjective\nold', 't1') });
    fireEvent.change(await screen.findByLabelText('Assessment'), { target: { value: 'Mine' } });
    noteApi.setRemote(note('## Assessment\nTheirs', 't2'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(REMOTE_AUTOSAVE_DELAY_MS);
    });
    fireEvent.click(await screen.findByRole('button', { name: /use other version/i }));
    expect(screen.getByLabelText('Assessment')).toHaveValue('Theirs');
    expect(draftStore.clear).toHaveBeenCalled();
    expect(noteApi.save).not.toHaveBeenCalled();
  });

  it('restores an unsynced local draft and flags a conflict if the server moved on', async () => {
    renderNotes({
      remote: note('## Plan\nServer plan', 't2'),
      draft: {
        note: { subjective: '', objective: '', assessment: '', plan: 'Offline plan' },
        baseUpdatedAt: 't1',
        savedAt: '2026-11-25T10:00:00.000Z',
        dirty: true,
      },
    });
    expect(await screen.findByLabelText('Plan')).toHaveValue('Offline plan');
    expect(screen.getByRole('alert')).toHaveTextContent(/changed elsewhere/i);
  });

  it('keeps edits on the device and shows the offline state when sync fails', async () => {
    const { draftStore } = renderNotes({
      remote: null,
      save: async () => {
        throw { status: 503, code: 'ERR_NETWORK', message: 'offline' };
      },
    });
    fireEvent.change(await screen.findByLabelText('Subjective'), { target: { value: 'Typed offline' } });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(REMOTE_AUTOSAVE_DELAY_MS);
    });
    await waitFor(() => expect(status()).toHaveAttribute('data-status', 'offline'));
    expect(draftStore.current?.note.subjective).toBe('Typed offline');
  });
});
