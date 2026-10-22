import { Keypair } from '@stellar/stellar-sdk';
import {
  activeContacts,
  addContact,
  backupKeyMessage,
  decryptBackup,
  deriveBackupKey,
  emptyAddressBook,
  encryptBackup,
  exportAddressBookJson,
  exportAddressBookVCard,
  importContacts,
  mergeAddressBooks,
  parseAddressBookFile,
  parseAddressBookJson,
  parseVCards,
  removeContact,
  resolveAddressInput,
  setContactVerification,
  updateContact,
  validateContactInput,
} from '@/lib/addressBook';
import { sep53Digest } from '@/lib/stellar';
import type { AddressBook } from '@/types';

jest.mock('@/hooks/useToast', () => ({ useToast: jest.fn() }));

const OWNER = Keypair.random();
const DR_A = Keypair.random().publicKey();
const DR_B = Keypair.random().publicKey();
const T0 = '2026-10-22T10:00:00.000Z';
const T1 = '2026-10-22T11:00:00.000Z';
const T2 = '2026-10-22T12:00:00.000Z';

const bookWith = (...inputs: Array<{ publicKey: string; alias: string; notes?: string }>) =>
  inputs.reduce((book, input) => addContact(book, input, T0).book, emptyAddressBook(T0));

describe('contact editing', () => {
  it('validates keys, names and field lengths', () => {
    expect(validateContactInput({ publicKey: DR_A, alias: 'Dr. A' })).toBeNull();
    expect(validateContactInput({ publicKey: 'GBAD', alias: 'Dr. A' })).toMatch(/public key/);
    expect(validateContactInput({ publicKey: DR_A, alias: '  ' })).toMatch(/name/);
    expect(validateContactInput({ publicKey: DR_A, alias: 'x'.repeat(65) })).toMatch(/at most/);
    expect(validateContactInput({ publicKey: DR_A, alias: 'A', notes: 'n'.repeat(501) })).toMatch(
      /Notes/,
    );
  });

  it('adds contacts unverified and rejects a duplicate address', () => {
    const book = bookWith({ publicKey: ` ${DR_A} `, alias: ' Dr. A ' });
    expect(activeContacts(book)).toEqual([
      expect.objectContaining({ publicKey: DR_A, alias: 'Dr. A', verified: false }),
    ]);
    expect(() => addContact(book, { publicKey: DR_A, alias: 'Again' })).toThrow(
      /already saved as “Dr. A”/,
    );
  });

  it('drops the verified badge when the address of a contact changes', () => {
    let book = bookWith({ publicKey: DR_A, alias: 'Dr. A' });
    const id = book.contacts[0]!.id;
    book = setContactVerification(book, id, 'Dr. Amara Obi', T1);
    expect(book.contacts[0]).toMatchObject({ verified: true, verifiedName: 'Dr. Amara Obi' });

    const renamed = updateContact(book, id, { publicKey: DR_A, alias: 'Amara' }, T2);
    expect(renamed.contacts[0]).toMatchObject({ alias: 'Amara', verified: true });

    const moved = updateContact(book, id, { publicKey: DR_B, alias: 'Dr. A' }, T2);
    expect(moved.contacts[0]).toMatchObject({ publicKey: DR_B, verified: false });
    expect(moved.contacts[0]).not.toHaveProperty('verifiedName');
  });

  it('keeps a tombstone when a contact is removed', () => {
    const book = bookWith({ publicKey: DR_A, alias: 'Dr. A', notes: 'secret' });
    const removed = removeContact(book, book.contacts[0]!.id, T1);
    expect(activeContacts(removed)).toHaveLength(0);
    expect(removed.contacts[0]).toMatchObject({ deletedAt: T1, alias: '' });
    expect(removed.contacts[0]).not.toHaveProperty('notes');
  });

  it('resolves a typed key or an exact contact name to an address', () => {
    const book = bookWith({ publicKey: DR_A, alias: 'Dr. Amara' });
    const contacts = activeContacts(book);
    expect(resolveAddressInput(` ${DR_B} `, contacts)).toBe(DR_B);
    expect(resolveAddressInput('dr. amara', contacts)).toBe(DR_A);
    expect(resolveAddressInput('Dr.', contacts)).toBeNull();
  });
});

describe('mergeAddressBooks', () => {
  it('keeps the newest version of each contact', () => {
    const base = bookWith({ publicKey: DR_A, alias: 'Dr. A' });
    const id = base.contacts[0]!.id;
    const deviceA = updateContact(base, id, { publicKey: DR_A, alias: 'Dr. A (old)' }, T1);
    const deviceB = updateContact(base, id, { publicKey: DR_A, alias: 'Dr. A (new)' }, T2);

    expect(activeContacts(mergeAddressBooks(deviceA, deviceB))[0]?.alias).toBe('Dr. A (new)');
    expect(activeContacts(mergeAddressBooks(deviceB, deviceA))[0]?.alias).toBe('Dr. A (new)');
  });

  it('lets a newer deletion win over an older copy', () => {
    const base = bookWith({ publicKey: DR_A, alias: 'Dr. A' });
    const deleted = removeContact(base, base.contacts[0]!.id, T1);
    expect(activeContacts(mergeAddressBooks(base, deleted))).toHaveLength(0);
  });

  it('collapses the same address added independently on two devices', () => {
    const deviceA = addContact(emptyAddressBook(T0), { publicKey: DR_A, alias: 'From A' }, T1).book;
    const deviceB = addContact(emptyAddressBook(T0), { publicKey: DR_A, alias: 'From B' }, T2).book;

    const merged = mergeAddressBooks(deviceA, deviceB);
    expect(activeContacts(merged).map((c) => c.alias)).toEqual(['From B']);
    // The loser is tombstoned, so merging again with the old copy does not bring it back.
    expect(activeContacts(mergeAddressBooks(merged, deviceA)).map((c) => c.alias)).toEqual([
      'From B',
    ]);
  });
});

describe('JSON import and export', () => {
  it('round-trips contacts, but never imports the verified badge', () => {
    let book = bookWith({ publicKey: DR_A, alias: 'Dr. A', notes: 'Cardiology, Lagos' });
    book = setContactVerification(book, book.contacts[0]!.id, 'Dr. Amara', T1);

    const json = exportAddressBookJson(activeContacts(book), T2);
    expect(JSON.parse(json)).toMatchObject({ format: 'heliora-address-book', version: 1 });

    const result = importContacts(emptyAddressBook(), parseAddressBookJson(json));
    expect(result).toMatchObject({ added: 1, skipped: 0, invalid: 0 });
    expect(activeContacts(result.book)[0]).toMatchObject({
      publicKey: DR_A,
      notes: 'Cardiology, Lagos',
      verified: false,
    });
  });

  it('skips duplicates and invalid entries without overwriting existing contacts', () => {
    const book = bookWith({ publicKey: DR_A, alias: 'Mine' });
    const result = importContacts(book, [
      { publicKey: DR_A, alias: 'Theirs' },
      { publicKey: 'not-a-key', alias: 'Broken' },
      { publicKey: DR_B, alias: 'Dr. B' },
    ]);
    expect(result).toMatchObject({ added: 1, skipped: 1, invalid: 1 });
    expect(activeContacts(result.book).map((c) => c.alias)).toEqual(['Dr. B', 'Mine']);
  });

  it('rejects files that are not address books', () => {
    expect(() => parseAddressBookJson('{nope')).toThrow(/not valid JSON/);
    expect(() => parseAddressBookJson('{"foo": 1}')).toThrow(/does not contain an address book/);
  });
});

describe('vCard import and export', () => {
  it('round-trips escaped, folded and non-ASCII values', () => {
    const notes = `Line one; with, punctuation\\ and ünïcødé ${'é'.repeat(60)}\nLine two`;
    const book = bookWith({ publicKey: DR_A, alias: 'Dr. Ngozi, MD', notes });

    const vcf = exportAddressBookVCard(activeContacts(book));
    expect(vcf).toContain('BEGIN:VCARD\r\nVERSION:4.0');
    expect(vcf).toContain(`X-STELLAR-ADDRESS:${DR_A}`);
    for (const line of vcf.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }

    expect(parseVCards(vcf)).toEqual([
      { publicKey: DR_A, alias: 'Dr. Ngozi, MD', notes, specialty: undefined },
    ]);
  });

  it('reads vCard 3.0 files that carry the address as an IMPP stellar URI', () => {
    const vcf = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Dr. Bello',
      'TITLE:Pediatrics',
      `item1.IMPP;TYPE=work:stellar:${DR_B}`,
      'END:VCARD',
    ].join('\n');

    expect(parseAddressBookFile('contacts.vcf', vcf)).toEqual([
      { publicKey: DR_B, alias: 'Dr. Bello', specialty: 'Pediatrics', notes: undefined },
    ]);
  });

  it('rejects a file without vCards', () => {
    expect(() => parseVCards('hello')).toThrow(/does not contain any vCards/);
  });
});

describe('cloud backup encryption', () => {
  const sign = (owner: Keypair) =>
    owner.sign(sep53Digest(backupKeyMessage(owner.publicKey()))).toString('base64');

  it('derives the same key from the same wallet on any device', async () => {
    const book: AddressBook = bookWith({ publicKey: DR_A, alias: 'Dr. A' });
    const owner = OWNER.publicKey();

    const deviceAKey = await deriveBackupKey(sign(OWNER), owner);
    const backup = await encryptBackup(book, deviceAKey, owner);
    expect(backup.ciphertext).not.toContain('Dr. A');

    // Ed25519 is deterministic: a second device signing the same message gets the same key.
    const deviceBKey = await deriveBackupKey(sign(OWNER), owner);
    await expect(decryptBackup(backup, deviceBKey, owner)).resolves.toEqual(book);
  });

  it('cannot be decrypted by another wallet or under another owner', async () => {
    const book = bookWith({ publicKey: DR_A, alias: 'Dr. A' });
    const owner = OWNER.publicKey();
    const backup = await encryptBackup(book, await deriveBackupKey(sign(OWNER), owner), owner);

    const other = Keypair.random();
    await expect(
      decryptBackup(backup, await deriveBackupKey(sign(other), owner), owner),
    ).rejects.toThrow(/could not be decrypted/);
    await expect(
      decryptBackup(
        backup,
        await deriveBackupKey(sign(OWNER), other.publicKey()),
        other.publicKey(),
      ),
    ).rejects.toThrow(/could not be decrypted/);
  });
});
