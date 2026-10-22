/**
 * Trusted clinician address book (#116).
 *
 * Patients keep a personal directory of provider Stellar addresses with
 * friendly aliases, notes and a "verified" badge for addresses confirmed
 * against the Heliora provider registry.
 *
 * Storage:
 * - On this device the book lives in an encrypted local slot
 *   (see `encryptedLocalStore`).
 * - For other devices it is backed up to the API as AES-GCM ciphertext. The
 *   backup key is derived (HKDF-SHA256) from the wallet's SEP-53 signature of
 *   a fixed message. Ed25519 signatures are deterministic, so the same wallet
 *   derives the same key on any device, and the server never sees it.
 * - Deletions are tombstones and every entry carries `updatedAt`, so two
 *   copies can be merged entry by entry with "last write wins".
 *
 * Import and export use JSON or vCard 4.0 (RFC 6350). Imported entries are
 * never trusted as verified: the badge only comes from the registry.
 */

import { Buffer } from 'buffer';
import { StrKey } from '@stellar/stellar-sdk';
import type { AddressBook, EncryptedAddressBookBackup, TrustedContact } from '@/types';

export const ALIAS_MAX_LENGTH = 64;
export const NOTES_MAX_LENGTH = 500;
export const SPECIALTY_MAX_LENGTH = 64;
export const MAX_CONTACTS = 1000;
export const MAX_IMPORT_BYTES = 1024 * 1024;

export const ADDRESS_BOOK_JSON_FORMAT = 'heliora-address-book';

export interface ContactInput {
  publicKey: string;
  alias: string;
  notes?: string | undefined;
  specialty?: string | undefined;
}

export class AddressBookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddressBookError';
  }
}

export function emptyAddressBook(now = new Date().toISOString()): AddressBook {
  return { version: 1, updatedAt: now, contacts: [] };
}

/** Contacts that have not been deleted, sorted by alias. */
export function activeContacts(book: AddressBook): TrustedContact[] {
  return book.contacts
    .filter((contact) => !contact.deletedAt)
    .sort((a, b) => a.alias.localeCompare(b.alias));
}

/** Returns why a contact cannot be saved, or `null` when it is valid. */
export function validateContactInput(input: ContactInput): string | null {
  if (!StrKey.isValidEd25519PublicKey(input.publicKey.trim())) {
    return 'Enter a valid Stellar public key (G…).';
  }
  const alias = input.alias.trim();
  if (!alias) return 'Give the contact a name.';
  if (alias.length > ALIAS_MAX_LENGTH)
    return `Names can be at most ${ALIAS_MAX_LENGTH} characters.`;
  if ((input.notes?.length ?? 0) > NOTES_MAX_LENGTH) {
    return `Notes can be at most ${NOTES_MAX_LENGTH} characters.`;
  }
  if ((input.specialty?.trim().length ?? 0) > SPECIALTY_MAX_LENGTH) {
    return `Specialty can be at most ${SPECIALTY_MAX_LENGTH} characters.`;
  }
  return null;
}

function cleanInput(input: ContactInput) {
  const notes = input.notes?.trim();
  const specialty = input.specialty?.trim();
  return {
    publicKey: input.publicKey.trim(),
    alias: input.alias.trim(),
    ...(notes ? { notes } : {}),
    ...(specialty ? { specialty } : {}),
  };
}

function assertValid(input: ContactInput) {
  const invalid = validateContactInput(input);
  if (invalid) throw new AddressBookError(invalid);
}

function findActiveByKey(book: AddressBook, publicKey: string, exceptId?: string) {
  return book.contacts.find(
    (contact) => !contact.deletedAt && contact.publicKey === publicKey && contact.id !== exceptId,
  );
}

/** Adds a contact. Throws when the input is invalid or the address is already in the book. */
export function addContact(
  book: AddressBook,
  input: ContactInput,
  now = new Date().toISOString(),
): { book: AddressBook; contact: TrustedContact } {
  assertValid(input);
  const fields = cleanInput(input);
  const existing = findActiveByKey(book, fields.publicKey);
  if (existing) throw new AddressBookError(`This address is already saved as “${existing.alias}”.`);
  if (activeContacts(book).length >= MAX_CONTACTS) {
    throw new AddressBookError(`An address book can hold at most ${MAX_CONTACTS} contacts.`);
  }

  const contact: TrustedContact = {
    id: crypto.randomUUID(),
    ...fields,
    verified: false,
    createdAt: now,
    updatedAt: now,
  };
  return { book: { ...book, updatedAt: now, contacts: [...book.contacts, contact] }, contact };
}

/**
 * Edits a contact. Changing its address drops the verified badge, because the
 * badge vouches for the old address.
 */
export function updateContact(
  book: AddressBook,
  id: string,
  input: ContactInput,
  now = new Date().toISOString(),
): AddressBook {
  assertValid(input);
  const fields = cleanInput(input);
  const current = book.contacts.find((contact) => contact.id === id && !contact.deletedAt);
  if (!current) throw new AddressBookError('That contact no longer exists.');
  const duplicate = findActiveByKey(book, fields.publicKey, id);
  if (duplicate)
    throw new AddressBookError(`This address is already saved as “${duplicate.alias}”.`);

  const addressChanged = fields.publicKey !== current.publicKey;
  const next: TrustedContact = {
    ...withoutKeys(
      current,
      addressChanged
        ? ['notes', 'specialty', 'verifiedName', 'verifiedAt']
        : ['notes', 'specialty'],
    ),
    ...fields,
    ...(addressChanged ? { verified: false } : {}),
    updatedAt: now,
  };
  return {
    ...book,
    updatedAt: now,
    contacts: book.contacts.map((contact) => (contact.id === id ? next : contact)),
  };
}

/** Records the provider registry's answer for a contact's address. */
export function setContactVerification(
  book: AddressBook,
  id: string,
  registryName: string | null,
  now = new Date().toISOString(),
): AddressBook {
  return {
    ...book,
    updatedAt: now,
    contacts: book.contacts.map((contact) => {
      if (contact.id !== id) return contact;
      const rest = withoutKeys(contact, ['verifiedName', 'verifiedAt']);
      return registryName
        ? { ...rest, verified: true, verifiedName: registryName, verifiedAt: now, updatedAt: now }
        : { ...rest, verified: false, updatedAt: now };
    }),
  };
}

/** Deletes a contact, keeping a tombstone so the deletion survives a merge with an older backup. */
export function removeContact(
  book: AddressBook,
  id: string,
  now = new Date().toISOString(),
): AddressBook {
  return {
    ...book,
    updatedAt: now,
    contacts: book.contacts.map((contact) =>
      contact.id === id
        ? {
            id,
            publicKey: contact.publicKey,
            alias: '',
            verified: false,
            createdAt: contact.createdAt,
            updatedAt: now,
            deletedAt: now,
          }
        : contact,
    ),
  };
}

function withoutKeys<T extends object, K extends keyof T>(value: T, keys: K[]): Omit<T, K> {
  const copy = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

/**
 * Merges two copies of an address book entry by entry: the most recently
 * updated version of each contact wins, tombstones included. If both copies
 * created a contact for the same address, the newer one is kept and the
 * other becomes a tombstone.
 */
export function mergeAddressBooks(a: AddressBook, b: AddressBook): AddressBook {
  const byId = new Map<string, TrustedContact>();
  for (const contact of [...a.contacts, ...b.contacts]) {
    const current = byId.get(contact.id);
    if (!current || contact.updatedAt > current.updatedAt) byId.set(contact.id, contact);
  }

  const newestByKey = new Map<string, TrustedContact>();
  for (const contact of byId.values()) {
    if (contact.deletedAt) continue;
    const current = newestByKey.get(contact.publicKey);
    if (!current || contact.updatedAt > current.updatedAt)
      newestByKey.set(contact.publicKey, contact);
  }

  const contacts = [...byId.values()].map((contact) => {
    if (contact.deletedAt || newestByKey.get(contact.publicKey)?.id === contact.id) return contact;
    const winner = newestByKey.get(contact.publicKey)!;
    return {
      id: contact.id,
      publicKey: contact.publicKey,
      alias: '',
      verified: false,
      createdAt: contact.createdAt,
      updatedAt: winner.updatedAt,
      deletedAt: winner.updatedAt,
    };
  });

  return {
    version: 1,
    updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt,
    contacts,
  };
}

/** Index of active contacts by public key, for resolving addresses to names. */
export function buildContactIndex(contacts: TrustedContact[]): Map<string, TrustedContact> {
  return new Map(contacts.filter((c) => !c.deletedAt).map((c) => [c.publicKey, c]));
}

/**
 * Turns what a user typed into an address: a public key is returned as is, an
 * exact (case-insensitive) contact name resolves to that contact's key.
 */
export function resolveAddressInput(text: string, contacts: TrustedContact[]): string | null {
  const value = text.trim();
  if (StrKey.isValidEd25519PublicKey(value)) return value;
  const lower = value.toLowerCase();
  const matches = contacts.filter((c) => !c.deletedAt && c.alias.toLowerCase() === lower);
  return matches.length === 1 ? matches[0]!.publicKey : null;
}

/** Display name for a contact: the alias, plus the registry name when it differs. */
export function contactDisplayName(contact: TrustedContact): string {
  return contact.verifiedName && contact.verifiedName !== contact.alias
    ? `${contact.alias} (${contact.verifiedName})`
    : contact.alias;
}

/* ── Import / export ─────────────────────────────────────────────── */

export interface ImportResult {
  book: AddressBook;
  added: number;
  skipped: number;
  invalid: number;
}

/**
 * Adds imported entries that are valid and not yet in the book. Existing
 * contacts are never overwritten and nothing imported is marked verified.
 */
export function importContacts(
  book: AddressBook,
  entries: ContactInput[],
  now = new Date().toISOString(),
): ImportResult {
  let next = book;
  let added = 0;
  let skipped = 0;
  let invalid = 0;
  for (const entry of entries) {
    if (validateContactInput(entry)) {
      invalid++;
      continue;
    }
    if (findActiveByKey(next, entry.publicKey.trim())) {
      skipped++;
      continue;
    }
    try {
      next = addContact(next, entry, now).book;
      added++;
    } catch {
      invalid++;
    }
  }
  return { book: next, added, skipped, invalid };
}

export function exportAddressBookJson(
  contacts: TrustedContact[],
  now = new Date().toISOString(),
): string {
  return JSON.stringify(
    {
      format: ADDRESS_BOOK_JSON_FORMAT,
      version: 1,
      exportedAt: now,
      contacts: contacts
        .filter((c) => !c.deletedAt)
        // `JSON.stringify` drops the optional fields that are unset.
        .map(({ publicKey, alias, notes, specialty, verified, verifiedName }) => ({
          publicKey,
          alias,
          notes,
          specialty,
          verified,
          verifiedName,
        })),
    },
    null,
    2,
  );
}

function assertImportSize(text: string) {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    throw new AddressBookError('The file is too large to import.');
  }
}

export function parseAddressBookJson(text: string): ContactInput[] {
  assertImportSize(text);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AddressBookError('The file is not valid JSON.');
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { contacts?: unknown }).contacts)
      ? (data as { contacts: unknown[] }).contacts
      : null;
  if (!list) throw new AddressBookError('The file does not contain an address book.');

  const str = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return list.slice(0, MAX_CONTACTS).map((item) => {
    const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return {
      publicKey: str(entry.publicKey) ?? '',
      alias: str(entry.alias) ?? '',
      notes: str(entry.notes),
      specialty: str(entry.specialty),
    };
  });
}

const escapeVCard = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

const unescapeVCard = (value: string) =>
  value.replace(/\\([\\,;nN])/g, (_, ch: string) => (ch === 'n' || ch === 'N' ? '\n' : ch));

/** Folds a content line to at most 75 octets per physical line (RFC 6350 §3.2). */
function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of Array.from(line)) {
    const size = new TextEncoder().encode(char).length;
    // Continuation lines start with a space, which counts toward their 75 octets.
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const vCardTimestamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d+/, '');

export function exportAddressBookVCard(contacts: TrustedContact[]): string {
  return contacts
    .filter((c) => !c.deletedAt)
    .map((contact) => {
      const lines = [
        'BEGIN:VCARD',
        'VERSION:4.0',
        `UID:urn:uuid:${contact.id}`,
        `FN:${escapeVCard(contact.alias)}`,
        `X-STELLAR-ADDRESS:${contact.publicKey}`,
        `IMPP:stellar:${contact.publicKey}`,
        ...(contact.specialty ? [`TITLE:${escapeVCard(contact.specialty)}`] : []),
        ...(contact.notes ? [`NOTE:${escapeVCard(contact.notes)}`] : []),
        `REV:${vCardTimestamp(contact.updatedAt)}`,
        'END:VCARD',
      ];
      return lines.map(foldLine).join('\r\n');
    })
    .join('\r\n')
    .concat('\r\n');
}

/** Parses vCards (3.0 or 4.0). Cards without a Stellar address are returned with an empty key. */
export function parseVCards(text: string): ContactInput[] {
  assertImportSize(text);
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const cards: ContactInput[] = [];
  let card: Record<string, string> | null = null;

  for (const raw of lines) {
    const separator = raw.indexOf(':');
    if (separator < 0) continue;
    const name = raw
      .slice(0, separator)
      .split(';')[0]!
      .trim()
      .toUpperCase()
      .replace(/^ITEM\d+\./, '');
    const value = raw.slice(separator + 1);

    if (name === 'BEGIN' && value.trim().toUpperCase() === 'VCARD') {
      card = {};
    } else if (name === 'END' && value.trim().toUpperCase() === 'VCARD') {
      if (card) {
        cards.push({
          publicKey: card['X-STELLAR-ADDRESS'] ?? card['IMPP'] ?? '',
          alias: card['FN'] ?? '',
          notes: card['NOTE'],
          specialty: card['TITLE'],
        });
      }
      card = null;
      if (cards.length >= MAX_CONTACTS) break;
    } else if (card) {
      if (name === 'IMPP') {
        const match = /^stellar:(G[A-Z2-7]{55})$/i.exec(value.trim());
        if (match && !card['IMPP']) card['IMPP'] = match[1]!.toUpperCase();
      } else if (!(name in card)) {
        card[name] = name === 'X-STELLAR-ADDRESS' ? value.trim() : unescapeVCard(value);
      }
    }
  }

  if (cards.length === 0) throw new AddressBookError('The file does not contain any vCards.');
  return cards;
}

/** Picks the parser from the file name or content. */
export function parseAddressBookFile(fileName: string, text: string): ContactInput[] {
  return /\.(vcf|vcard)$/i.test(fileName) || /^\s*BEGIN:VCARD/i.test(text)
    ? parseVCards(text)
    : parseAddressBookJson(text);
}

/* ── Cloud backup ────────────────────────────────────────────────── */

/** Message the wallet signs (SEP-53) to derive the backup key. Must never change. */
export function backupKeyMessage(owner: string): string {
  return `heliora-address-book-backup-key:v1\n${owner}\nSigning this lets Heliora decrypt your address book backup. Only sign it on the official Heliora site.`;
}

/** Derives the AES-256-GCM backup key from the wallet's base64 signature of {@link backupKeyMessage}. */
export async function deriveBackupKey(signature: string, owner: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(Buffer.from(signature, 'base64')),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('heliora-address-book-backup'),
      info: new TextEncoder().encode(owner),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBackup(
  book: AddressBook,
  key: CryptoKey,
  owner: string,
): Promise<EncryptedAddressBookBackup> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(owner) },
    key,
    new TextEncoder().encode(JSON.stringify(book)),
  );
  return {
    version: 1,
    iv: Buffer.from(iv).toString('base64'),
    ciphertext: Buffer.from(new Uint8Array(ciphertext)).toString('base64'),
    updatedAt: book.updatedAt,
  };
}

export async function decryptBackup(
  backup: EncryptedAddressBookBackup,
  key: CryptoKey,
  owner: string,
): Promise<AddressBook> {
  if (backup.version !== 1) throw new AddressBookError('Unsupported backup version.');
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(Buffer.from(backup.iv, 'base64')),
        additionalData: new TextEncoder().encode(owner),
      },
      key,
      new Uint8Array(Buffer.from(backup.ciphertext, 'base64')),
    );
  } catch {
    throw new AddressBookError(
      'The cloud backup could not be decrypted. It belongs to another wallet or was modified.',
    );
  }
  const book = JSON.parse(new TextDecoder().decode(plaintext)) as AddressBook;
  if (book.version !== 1 || !Array.isArray(book.contacts)) {
    throw new AddressBookError('The cloud backup is not a valid address book.');
  }
  return book;
}
