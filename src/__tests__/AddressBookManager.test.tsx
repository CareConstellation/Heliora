import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Keypair } from '@stellar/stellar-sdk';
import AddressBookManager from '@/components/contacts/AddressBookManager';
import ContactAddressInput from '@/components/contacts/ContactAddressInput';
import DoctorCard from '@/components/doctor/DoctorCard';
import { clearBackupKeyCache } from '@/hooks/useAddressBook';
import {
  addContact,
  backupKeyMessage,
  decryptBackup,
  deriveBackupKey,
  emptyAddressBook,
  encryptBackup,
} from '@/lib/addressBook';
import { createEncryptedLocalStore, createMemoryKeyProvider } from '@/lib/encryptedLocalStore';
import { sep53Digest } from '@/lib/stellar';
import {
  fetchAddressBookBackup,
  fetchDoctorByAddress,
  uploadAddressBookBackup,
} from '@/services/api.service';
import { useAddressBookStore } from '@/store/addressBookStore';
import { useWalletStore } from '@/store/useWalletStore';
import type { AddressBook, EncryptedAddressBookBackup } from '@/types';

jest.mock('@/hooks/useToast', () => ({ useToast: jest.fn() }));
jest.mock('@/services/api.service', () => ({
  fetchDoctorByAddress: jest.fn(),
  fetchAddressBookBackup: jest.fn(),
  uploadAddressBookBackup: jest.fn(),
}));

const mocked = {
  registry: fetchDoctorByAddress as jest.MockedFunction<typeof fetchDoctorByAddress>,
  download: fetchAddressBookBackup as jest.MockedFunction<typeof fetchAddressBookBackup>,
  upload: uploadAddressBookBackup as jest.MockedFunction<typeof uploadAddressBookBackup>,
};

const OWNER = Keypair.random();
const DR_A = Keypair.random().publicKey();
const DR_B = Keypair.random().publicKey();

/** The patient's wallet, signing SEP-53 messages like Freighter would. */
const signMessage = jest.fn(async (message: string) =>
  OWNER.sign(sep53Digest(message)).toString('base64'),
);

let storage: ReturnType<typeof createEncryptedLocalStore<AddressBook>>;

beforeEach(async () => {
  jest.clearAllMocks();
  window.localStorage.clear();
  clearBackupKeyCache();
  storage = createEncryptedLocalStore<AddressBook>({
    namespace: 'heliora-address-book',
    keyProvider: createMemoryKeyProvider(),
  });
  useAddressBookStore.setState({ storage });
  useAddressBookStore.getState().reset();
  useWalletStore.setState({ publicKey: OWNER.publicKey(), role: 'PATIENT' });
  mocked.registry.mockResolvedValue(null);
  mocked.upload.mockResolvedValue(undefined);
});

function fillAndAdd(alias: string, publicKey: string) {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: alias } });
  fireEvent.change(screen.getByLabelText('Stellar public key'), { target: { value: publicKey } });
  fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
}

describe('AddressBookManager', () => {
  it('adds a contact, verifies it against the registry and stores it encrypted', async () => {
    mocked.registry.mockResolvedValue({
      id: 'd1',
      name: 'Dr. Amara Obi',
      specialty: 'Cardiology',
      address: DR_A,
    });
    render(<AddressBookManager signMessage={signMessage} />);

    fillAndAdd('My cardiologist', DR_A);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved My cardiologist — verified as Dr. Amara Obi.',
    );
    const list = screen.getByRole('region', { name: 'Trusted contacts' });
    expect(within(list).getByText('verified')).toBeInTheDocument();
    expect(within(list).getByText('Registry name: Dr. Amara Obi')).toBeInTheDocument();

    const raw = window.localStorage.getItem(`heliora-address-book:${OWNER.publicKey()}`)!;
    expect(raw).not.toContain('My cardiologist');
    expect(raw).not.toContain(DR_A);
    const stored = await storage.load(OWNER.publicKey());
    expect(stored?.contacts[0]).toMatchObject({ alias: 'My cardiologist', verified: true });
  });

  it('keeps unregistered addresses unverified', async () => {
    render(<AddressBookManager signMessage={signMessage} />);
    fillAndAdd('Clinic front desk', DR_B);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'not a registered Heliora provider',
    );
    expect(screen.getByText('unverified')).toBeInTheDocument();
  });

  it('shows validation errors without saving', async () => {
    render(<AddressBookManager signMessage={signMessage} />);
    fillAndAdd('Dr. A', 'GNOTAKEY');

    expect(await screen.findByRole('alert')).toHaveTextContent('valid Stellar public key');
    expect(mocked.registry).not.toHaveBeenCalled();
  });

  it('imports a vCard file as unverified contacts', async () => {
    render(<AddressBookManager signMessage={signMessage} />);
    const vcf = `BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Dr. Bello\r\nX-STELLAR-ADDRESS:${DR_B}\r\nEND:VCARD\r\n`;
    const file = new File([vcf], 'contacts.vcf', { type: 'text/vcard' });
    // jsdom does not implement Blob#text.
    Object.defineProperty(file, 'text', { value: async () => vcf });

    fireEvent.change(screen.getByLabelText('Import address book file'), {
      target: { files: [file] },
    });

    expect(await screen.findByRole('status')).toHaveTextContent('Imported 1 contact(s)');
    expect(screen.getByText('Dr. Bello')).toBeInTheDocument();
    expect(screen.getByText('unverified')).toBeInTheDocument();
  });

  it('syncs with the cloud backup made on another device', async () => {
    const owner = OWNER.publicKey();
    const key = await deriveBackupKey(await signMessage(backupKeyMessage(owner)), owner);
    const otherDevice = addContact(emptyAddressBook(), {
      publicKey: DR_B,
      alias: 'From phone',
    }).book;
    mocked.download.mockResolvedValue(await encryptBackup(otherDevice, key, owner));

    render(<AddressBookManager signMessage={signMessage} />);
    fillAndAdd('From laptop', DR_A);
    expect(await screen.findByRole('status')).toHaveTextContent('Saved From laptop');

    fireEvent.click(screen.getByRole('button', { name: 'Sync with cloud backup' }));

    expect(
      await screen.findByText('Synced with your cloud backup (2 contacts).'),
    ).toBeInTheDocument();
    expect(screen.getByText('From phone')).toBeInTheDocument();
    expect(signMessage).toHaveBeenCalledWith(backupKeyMessage(owner), owner);

    const uploaded = mocked.upload.mock.calls[0]![1] as EncryptedAddressBookBackup;
    expect(mocked.upload.mock.calls[0]![0]).toBe(owner);
    const restored = await decryptBackup(uploaded, key, owner);
    expect(restored.contacts.map((c) => c.alias).sort()).toEqual(['From laptop', 'From phone']);
  });
});

describe('address book store', () => {
  it('applies a write made while the stored book is still loading on top of it', async () => {
    const owner = OWNER.publicKey();
    await storage.save(owner, addContact(emptyAddressBook(), { publicKey: DR_A, alias: 'A' }).book);

    const store = useAddressBookStore.getState();
    const hydration = store.hydrate(owner);
    await store.commit((book) => addContact(book, { publicKey: DR_B, alias: 'B' }).book);
    await hydration;

    const aliases = (book: AddressBook | null) => book?.contacts.map((c) => c.alias).sort();
    expect(aliases(useAddressBookStore.getState().book)).toEqual(['A', 'B']);
    expect(aliases(await storage.load(owner))).toEqual(['A', 'B']);
  });

  it('refuses writes when the stored book cannot be decrypted', async () => {
    const owner = OWNER.publicKey();
    window.localStorage.setItem(`heliora-address-book:${owner}`, '{"v":1,"iv":"AA==","ct":"AA=="}');

    await useAddressBookStore.getState().hydrate(owner);
    await expect(useAddressBookStore.getState().commit((book) => book)).rejects.toThrow(
      /changes are disabled/,
    );
    expect(window.localStorage.getItem(`heliora-address-book:${owner}`)).not.toBeNull();
  });
});

describe('contact resolution in other inputs', () => {
  async function seed() {
    const { book } = addContact(emptyAddressBook(), { publicKey: DR_A, alias: 'Dr. Amara' });
    await storage.save(OWNER.publicKey(), book);
  }

  it('resolves an entered key or contact name in address inputs', async () => {
    await seed();
    function Harness() {
      const [value, setValue] = require('react').useState('');
      return <ContactAddressInput id="x" label="Provider" value={value} onChange={setValue} />;
    }
    render(<Harness />);
    const input = screen.getByLabelText('Provider');

    fireEvent.change(input, { target: { value: DR_A } });
    expect(await screen.findByText(/unverified contact/)).toHaveTextContent('Dr. Amara');

    fireEvent.change(input, { target: { value: 'dr. amara' } });
    expect(screen.getByText(/unverified contact/)).toHaveTextContent('Dr. Amara');

    fireEvent.change(input, { target: { value: DR_B } });
    expect(screen.getByText(/Not in your trusted contacts/)).toBeInTheDocument();
  });

  it('labels doctors in appointment search with the patient’s name for them', async () => {
    await seed();
    render(
      <DoctorCard
        doctor={{ id: '1', name: 'Amara Obi', specialty: 'Cardiology', address: DR_A }}
      />,
    );
    expect(await screen.findByText('In your contacts as Dr. Amara')).toBeInTheDocument();
  });

  it('clears the loaded book when the wallet disconnects', async () => {
    await seed();
    render(<DoctorCard doctor={{ id: '1', name: 'Amara Obi', specialty: 'GP', address: DR_A }} />);
    await screen.findByText('In your contacts as Dr. Amara');

    act(() => useWalletStore.setState({ publicKey: null }));
    await waitFor(() =>
      expect(screen.queryByText('In your contacts as Dr. Amara')).not.toBeInTheDocument(),
    );
    expect(useAddressBookStore.getState().owner).toBeNull();
  });
});
