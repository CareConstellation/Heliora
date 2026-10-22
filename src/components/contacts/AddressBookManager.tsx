'use client';

import { useRef, useState } from 'react';
import {
  BadgeCheck,
  BookUser,
  CloudUpload,
  Download,
  Loader2,
  Pencil,
  ShieldQuestion,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAddressBook } from '@/hooks/useAddressBook';
import {
  ALIAS_MAX_LENGTH,
  NOTES_MAX_LENGTH,
  validateContactInput,
  type ContactInput,
} from '@/lib/addressBook';
import type { MessageSigner } from '@/lib/stellar';
import type { TrustedContact } from '@/types';

const EMPTY_FORM: ContactInput = { publicKey: '', alias: '', specialty: '', notes: '' };

const errorText = (err: unknown, fallback: string) =>
  typeof err === 'object' &&
  err &&
  'message' in err &&
  typeof err.message === 'string' &&
  err.message
    ? err.message
    : fallback;

function download(contents: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

const inputStyle = { background: 'var(--bg-inset)', border: '1px solid rgba(255,255,255,0.08)' };
const inputClass = 'w-full rounded-[9px] px-3 py-2 text-xs text-text-1';

/** Patient-facing manager for the trusted clinician address book (#116). */
export default function AddressBookManager({ signMessage }: { signMessage?: MessageSigner }) {
  const book = useAddressBook();
  const [form, setForm] = useState<ContactInput>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function run(label: string, action: () => Promise<string | void>) {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      const done = await action();
      if (done) setMessage(done);
    } catch (err) {
      setError(errorText(err, 'Something went wrong.'));
    } finally {
      setBusy(null);
    }
  }

  function startEdit(contact: TrustedContact) {
    setEditingId(contact.id);
    setForm({
      publicKey: contact.publicKey,
      alias: contact.alias,
      specialty: contact.specialty ?? '',
      notes: contact.notes ?? '',
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  if (!book.owner) {
    return <p className="text-sm text-text-2">Connect your wallet to manage trusted contacts.</p>;
  }

  const card = { background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' };

  return (
    <div className="space-y-4">
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            run('sync', async () => {
              const result = await book.syncWithCloud(signMessage);
              return result.restoredFromCloud
                ? `Synced with your cloud backup (${result.contacts} contacts).`
                : `Cloud backup created (${result.contacts} contacts).`;
            })
          }
          disabled={!!busy}
          className="btn-primary rounded-[9px] text-xs py-2 px-3.5 disabled:opacity-50"
        >
          {busy === 'sync' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CloudUpload className="w-3.5 h-3.5" />
          )}
          Sync with cloud backup
        </button>
        <button
          type="button"
          onClick={() => download(book.exportJson(), 'heliora-contacts.json', 'application/json')}
          disabled={!book.contacts.length}
          className="btn-secondary rounded-[9px] text-xs py-2 px-3.5 disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" /> Export JSON
        </button>
        <button
          type="button"
          onClick={() => download(book.exportVCard(), 'heliora-contacts.vcf', 'text/vcard')}
          disabled={!book.contacts.length}
          className="btn-secondary rounded-[9px] text-xs py-2 px-3.5 disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" /> Export vCard
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={!!busy}
          className="btn-secondary rounded-[9px] text-xs py-2 px-3.5 disabled:opacity-50"
        >
          <Upload className="w-3.5 h-3.5" /> Import
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.vcf,.vcard,application/json,text/vcard"
          className="hidden"
          aria-label="Import address book file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            void run('import', async () => {
              const { added, skipped, invalid } = await book.importFile(
                file.name,
                await file.text(),
              );
              return `Imported ${added} contact(s); ${skipped} already saved, ${invalid} invalid. Imported contacts start unverified.`;
            });
          }}
        />
      </div>

      {message && (
        <p role="status" className="text-xs text-text-2">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
      {book.error && (
        <div role="alert" className="text-xs text-red-400 flex flex-wrap items-center gap-2">
          {book.error}
          <button
            type="button"
            onClick={book.discardStored}
            className="underline text-text-2 hover:text-text-1"
          >
            Start a new address book (you can restore from your cloud backup)
          </button>
        </div>
      )}

      {/* ── Add / edit form ─────────────────────────────────────── */}
      <form
        aria-label={editingId ? 'Edit contact' : 'Add contact'}
        className="rounded-[14px] p-5 space-y-3"
        style={card}
        onSubmit={(e) => {
          e.preventDefault();
          const invalid = validateContactInput(form);
          if (invalid) {
            setError(invalid);
            return;
          }
          void run('save', async () => {
            if (editingId) {
              await book.update(editingId, form);
              resetForm();
              return 'Contact updated.';
            }
            const contact = await book.add(form);
            resetForm();
            return contact.verified
              ? `Saved ${contact.alias} — verified as ${contact.verifiedName}.`
              : `Saved ${contact.alias}. The address is not a registered Heliora provider yet.`;
          });
        }}
      >
        <h2 className="text-sm font-semibold text-text-1">
          {editingId ? 'Edit contact' : 'Add a trusted contact'}
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="contact-alias" className="block text-xs text-text-2 mb-1">
              Name
            </label>
            <input
              id="contact-alias"
              value={form.alias}
              maxLength={ALIAS_MAX_LENGTH}
              onChange={(e) => setForm({ ...form, alias: e.target.value })}
              placeholder="Dr. Amara (cardiology)"
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="contact-specialty" className="block text-xs text-text-2 mb-1">
              Specialty
            </label>
            <input
              id="contact-specialty"
              value={form.specialty ?? ''}
              onChange={(e) => setForm({ ...form, specialty: e.target.value })}
              className={inputClass}
              style={inputStyle}
            />
          </div>
        </div>
        <div>
          <label htmlFor="contact-key" className="block text-xs text-text-2 mb-1">
            Stellar public key
          </label>
          <input
            id="contact-key"
            value={form.publicKey}
            onChange={(e) => setForm({ ...form, publicKey: e.target.value })}
            placeholder="G…"
            spellCheck={false}
            className={`${inputClass} font-mono`}
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor="contact-notes" className="block text-xs text-text-2 mb-1">
            Notes
          </label>
          <textarea
            id="contact-notes"
            value={form.notes ?? ''}
            maxLength={NOTES_MAX_LENGTH}
            rows={2}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className={inputClass}
            style={inputStyle}
          />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!!busy}
            className="btn-primary rounded-[9px] text-xs py-2 px-3.5 disabled:opacity-50"
          >
            {editingId ? 'Save changes' : 'Add contact'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="btn-secondary rounded-[9px] text-xs py-2 px-3.5"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {/* ── Contact list ────────────────────────────────────────── */}
      <section aria-label="Trusted contacts" className="rounded-[14px] p-5" style={card}>
        <div className="flex items-center gap-2 mb-3">
          <BookUser className="w-4 h-4" style={{ color: '#00C896' }} />
          <h2 className="text-sm font-semibold text-text-1">
            Trusted contacts ({book.contacts.length})
          </h2>
        </div>

        {!book.loaded ? (
          <p className="text-xs text-text-3">Loading…</p>
        ) : book.contacts.length === 0 ? (
          <p className="text-xs text-text-2">
            No contacts yet. Add your providers so their addresses show up by name when you share
            records or book appointments.
          </p>
        ) : (
          <ul className="space-y-2">
            {book.contacts.map((contact) => (
              <li
                key={contact.id}
                className="rounded-[10px] p-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-3"
                style={{
                  background: 'var(--bg-inset)',
                  border: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-text-1">
                    {contact.alias}
                    {contact.verified ? (
                      <span className="badge-green inline-flex items-center gap-1">
                        <BadgeCheck className="w-3 h-3" /> verified
                      </span>
                    ) : (
                      <span className="badge-muted">unverified</span>
                    )}
                  </p>
                  {contact.verifiedName && contact.verifiedName !== contact.alias && (
                    <p className="text-2xs text-text-3">Registry name: {contact.verifiedName}</p>
                  )}
                  <p className="text-2xs font-mono text-text-3 break-all mt-0.5">
                    {contact.publicKey}
                  </p>
                  {contact.specialty && (
                    <p className="text-xs text-text-2 mt-1">{contact.specialty}</p>
                  )}
                  {contact.notes && (
                    <p className="text-xs text-text-2 mt-1 whitespace-pre-wrap">{contact.notes}</p>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {!contact.verified && (
                    <button
                      type="button"
                      onClick={() =>
                        run(`verify-${contact.id}`, async () =>
                          (await book.verify(contact.id))
                            ? `${contact.alias} is a registered Heliora provider.`
                            : `${contact.alias} is not a registered Heliora provider.`,
                        )
                      }
                      disabled={!!busy}
                      aria-label={`Verify ${contact.alias}`}
                      className="btn-icon w-7 h-7 rounded-md"
                    >
                      <ShieldQuestion className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => startEdit(contact)}
                    aria-label={`Edit ${contact.alias}`}
                    className="btn-icon w-7 h-7 rounded-md"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      run(`remove-${contact.id}`, async () => {
                        await book.remove(contact.id);
                        if (editingId === contact.id) resetForm();
                        return `Removed ${contact.alias}.`;
                      })
                    }
                    disabled={!!busy}
                    aria-label={`Remove ${contact.alias}`}
                    className="btn-icon w-7 h-7 rounded-md"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-2xs text-text-3 leading-relaxed">
        Contacts are encrypted on this device. The cloud backup is encrypted with a key derived from
        your wallet signature, so Heliora&apos;s servers only store ciphertext and any device with
        your wallet can restore it.
      </p>
    </div>
  );
}
