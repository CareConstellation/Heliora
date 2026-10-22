'use client';

import { useCallback, useEffect, useMemo } from 'react';
import {
  activeContacts,
  addContact,
  backupKeyMessage,
  buildContactIndex,
  decryptBackup,
  deriveBackupKey,
  encryptBackup,
  exportAddressBookJson,
  exportAddressBookVCard,
  importContacts,
  mergeAddressBooks,
  parseAddressBookFile,
  removeContact,
  setContactVerification,
  updateContact,
  type ContactInput,
  type ImportResult,
} from '@/lib/addressBook';
import { freighterMessageSigner, type MessageSigner } from '@/lib/stellar';
import {
  fetchAddressBookBackup,
  fetchDoctorByAddress,
  uploadAddressBookBackup,
} from '@/services/api.service';
import { useAddressBookStore } from '@/store/addressBookStore';
import { useWalletStore } from '@/store/useWalletStore';
import type { TrustedContact } from '@/types';

// Derived once per wallet per page load, so a sync only prompts for one signature.
const backupKeys = new Map<string, Promise<CryptoKey>>();

function backupKeyFor(owner: string, signMessage: MessageSigner): Promise<CryptoKey> {
  let key = backupKeys.get(owner);
  if (!key) {
    key = signMessage(backupKeyMessage(owner), owner).then((sig) => deriveBackupKey(sig, owner));
    key.catch(() => backupKeys.delete(owner));
    backupKeys.set(owner, key);
  }
  return key;
}

/** Forgets cached backup keys (e.g. on disconnect). */
export function clearBackupKeyCache() {
  backupKeys.clear();
}

/** Loads the connected wallet's address book and resolves addresses to contacts. */
export function useContactResolver() {
  const publicKey = useWalletStore((s) => s.publicKey);
  const book = useAddressBookStore((s) => s.book);
  const loaded = useAddressBookStore((s) => s.loaded);
  const error = useAddressBookStore((s) => s.error);

  useEffect(() => {
    const store = useAddressBookStore.getState();
    if (publicKey && store.owner !== publicKey) void store.hydrate(publicKey);
    if (!publicKey && store.owner) store.reset();
  }, [publicKey]);

  const contacts = useMemo(() => activeContacts(book), [book]);
  const index = useMemo(() => buildContactIndex(contacts), [contacts]);
  const resolve = useCallback(
    (address: string | null | undefined): TrustedContact | undefined =>
      address ? index.get(address) : undefined,
    [index],
  );

  return { owner: publicKey, contacts, loaded, error, resolve };
}

/** Address book with every management action. */
export function useAddressBook() {
  const resolver = useContactResolver();
  const { commit, discardStored } = useAddressBookStore();
  const current = () => useAddressBookStore.getState().book;

  /** Checks a contact's address against the provider registry and records the result. */
  const verify = useCallback(
    async (id: string) => {
      await useAddressBookStore.getState().hydration;
      const contact = current().contacts.find((c) => c.id === id && !c.deletedAt);
      if (!contact) return false;
      const doctor = await fetchDoctorByAddress(contact.publicKey);
      await commit((book) => {
        // Ignore the answer if the address was edited while the registry was queried.
        const latest = book.contacts.find((c) => c.id === id);
        return latest?.publicKey === contact.publicKey
          ? setContactVerification(book, id, doctor?.name ?? null)
          : book;
      });
      return doctor !== null;
    },
    [commit],
  );

  const add = useCallback(
    async (input: ContactInput) => {
      let added: TrustedContact | undefined;
      await commit((book) => {
        const result = addContact(book, input);
        added = result.contact;
        return result.book;
      });
      const contact = added!;
      // Best effort: the contact is saved even if the registry cannot be reached.
      await verify(contact.id).catch(() => false);
      return current().contacts.find((c) => c.id === contact.id) ?? contact;
    },
    [commit, verify],
  );

  const update = useCallback(
    async (id: string, input: ContactInput) => {
      let addressChanged = false;
      await commit((book) => {
        addressChanged =
          book.contacts.find((c) => c.id === id)?.publicKey !== input.publicKey.trim();
        return updateContact(book, id, input);
      });
      if (addressChanged) await verify(id).catch(() => false);
    },
    [commit, verify],
  );

  const remove = useCallback((id: string) => commit((book) => removeContact(book, id)), [commit]);

  const importFile = useCallback(
    async (fileName: string, text: string): Promise<Omit<ImportResult, 'book'>> => {
      const entries = parseAddressBookFile(fileName, text);
      let counts: Omit<ImportResult, 'book'> = { added: 0, skipped: 0, invalid: 0 };
      await commit((book) => {
        const { book: next, ...result } = importContacts(book, entries);
        counts = result;
        return next;
      });
      return counts;
    },
    [commit],
  );

  const exportJson = useCallback(
    () => exportAddressBookJson(resolver.contacts),
    [resolver.contacts],
  );
  const exportVCard = useCallback(
    () => exportAddressBookVCard(resolver.contacts),
    [resolver.contacts],
  );

  /**
   * Two-way sync with the encrypted cloud backup: downloads it, merges it into
   * the local book, saves the result locally and uploads it again.
   */
  const syncWithCloud = useCallback(
    async (signMessage: MessageSigner = freighterMessageSigner) => {
      const owner = useAddressBookStore.getState().owner;
      if (!owner) throw new Error('Connect your wallet to sync your address book.');
      const key = await backupKeyFor(owner, signMessage);
      const remote = await fetchAddressBookBackup(owner);
      const remoteBook = remote ? await decryptBackup(remote, key, owner) : null;
      const merged = await commit((book) =>
        remoteBook ? mergeAddressBooks(book, remoteBook) : book,
      );
      await uploadAddressBookBackup(owner, await encryptBackup(merged, key, owner));
      return { restoredFromCloud: remote !== null, contacts: activeContacts(merged).length };
    },
    [commit],
  );

  return {
    ...resolver,
    add,
    update,
    remove,
    verify,
    importFile,
    exportJson,
    exportVCard,
    syncWithCloud,
    discardStored,
  };
}
