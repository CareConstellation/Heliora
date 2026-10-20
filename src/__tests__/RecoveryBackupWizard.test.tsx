import { TextDecoder, TextEncoder } from 'node:util';

// jsdom has no TextEncoder/TextDecoder; use Node's implementations.
Object.assign(globalThis, { TextEncoder, TextDecoder });

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import RecoveryBackupWizard from '@/components/recovery/RecoveryBackupWizard';
import { restoreRecoveryKey } from '@/lib/crypto';

const ACCOUNT = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });
}

describe('RecoveryBackupWizard (#26)', () => {
  let downloads: { blob: Blob; name: string }[];

  beforeEach(() => {
    downloads = [];
    let pending: Blob | null = null;
    URL.createObjectURL = jest.fn((blob: Blob) => {
      pending = blob;
      return 'blob:backup';
    });
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ blob: pending!, name: this.download });
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const words = () =>
    screen.getAllByRole('listitem').map((li) => li.textContent!.replace(/^\d+\.\s*/, ''));

  it.each([
    [12, '12 words'],
    [24, '24 words'],
  ])('generates a valid %i-word BIP-39 recovery phrase', (count, label) => {
    render(<RecoveryBackupWizard account={ACCOUNT} />);
    fireEvent.click(screen.getByLabelText(label));
    fireEvent.click(screen.getByRole('button', { name: 'Generate recovery phrase' }));

    expect(words()).toHaveLength(count);
    expect(validateMnemonic(words().join(' '), wordlist)).toBe(true);
  });

  it('refuses to continue when the confirmation words are wrong', () => {
    render(<RecoveryBackupWizard account={ACCOUNT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate recovery phrase' }));
    fireEvent.click(screen.getByRole('button', { name: 'I have written them down' }));

    for (const input of screen.getAllByRole('textbox'))
      fireEvent.change(input, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create & download backup' }));

    expect(screen.getByRole('alert')).toHaveTextContent('do not match');
    expect(downloads).toHaveLength(0);
  });

  it('downloads a .reliora-backup file that restores with the recovery phrase', async () => {
    render(<RecoveryBackupWizard account={ACCOUNT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate recovery phrase' }));
    const phrase = words();
    fireEvent.click(screen.getByRole('button', { name: 'I have written them down' }));

    for (const input of screen.getAllByRole('textbox')) {
      const position = Number(input.closest('label')!.textContent!.match(/#(\d+)/)![1]) - 1;
      fireEvent.change(input, { target: { value: phrase[position] } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Create & download backup' }));

    await waitFor(() => expect(downloads).toHaveLength(1), { timeout: 15_000 });
    expect(downloads[0]!.name).toBe(`heliora-${ACCOUNT.slice(0, 6)}.reliora-backup`);
    const file = await readBlob(downloads[0]!.blob);
    expect(JSON.parse(file)).toMatchObject({
      format: 'reliora-backup',
      account: ACCOUNT,
      kdf: { iterations: 600_000 },
    });
    await expect(restoreRecoveryKey(file, phrase.join(' '))).resolves.toHaveLength(32);
    expect(screen.getByRole('status')).toHaveTextContent('.reliora-backup');
  }, 30_000);
});
