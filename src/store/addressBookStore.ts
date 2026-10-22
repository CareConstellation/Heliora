import { create } from 'zustand';
import { emptyAddressBook } from '@/lib/addressBook';
import { createEncryptedLocalStore, type EncryptedLocalStore } from '@/lib/encryptedLocalStore';
import type { AddressBook } from '@/types';

interface AddressBookState {
  /** Wallet whose address book is loaded. */
  owner: string | null;
  book: AddressBook;
  loaded: boolean;
  error: string | null;
  /** Pending load of the owner's book; writes wait for it. */
  hydration: Promise<void> | null;
  /** Encrypted local persistence; replaced in tests. */
  storage: EncryptedLocalStore<AddressBook>;
  hydrate: (owner: string) => Promise<void>;
  /**
   * Applies `change` to the current book once it is loaded, then persists the
   * result encrypted. Waiting for the load means a write can never replace
   * contacts that were still being decrypted.
   */
  commit: (change: (book: AddressBook) => AddressBook) => Promise<AddressBook>;
  /** Drops a stored book that cannot be decrypted, so a new one can be started. */
  discardStored: () => void;
  reset: () => void;
}

/**
 * In-memory copy of the signed-in wallet's address book. It is deliberately
 * not persisted by zustand: the only copy at rest is the encrypted one.
 */
export const useAddressBookStore = create<AddressBookState>()((set, get) => ({
  owner: null,
  book: emptyAddressBook(),
  loaded: false,
  error: null,
  hydration: null,
  storage: createEncryptedLocalStore<AddressBook>({ namespace: 'heliora-address-book' }),

  hydrate: (owner) => {
    set({ owner, book: emptyAddressBook(), loaded: false, error: null });
    const hydration = (async () => {
      try {
        const stored = await get().storage.load(owner);
        if (get().owner === owner) set({ book: stored ?? emptyAddressBook(), loaded: true });
      } catch (err) {
        if (get().owner !== owner) return;
        set({
          loaded: true,
          error: err instanceof Error ? err.message : 'Your address book could not be loaded.',
        });
      }
    })();
    set({ hydration });
    return hydration;
  },

  commit: async (change) => {
    const owner = get().owner;
    if (!owner) throw new Error('Connect your wallet to manage trusted contacts.');
    await get().hydration;
    if (get().owner !== owner) throw new Error('The connected wallet changed. Try again.');
    if (get().error) {
      throw new Error('Your saved address book could not be read, so changes are disabled.');
    }
    const next = change(get().book);
    set({ book: next });
    await get().storage.save(owner, next);
    return next;
  },

  discardStored: () => {
    const { owner, storage } = get();
    if (owner) storage.clear(owner);
    set({ book: emptyAddressBook(), loaded: true, error: null });
  },

  reset: () =>
    set({ owner: null, book: emptyAddressBook(), loaded: false, error: null, hydration: null }),
}));
