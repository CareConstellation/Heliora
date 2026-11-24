import { TextDecoder, TextEncoder } from 'node:util';

Object.assign(globalThis, { TextEncoder, TextDecoder });

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import RecoveryBackupWizard from '@/components/recovery/RecoveryBackupWizard';
import { restoreRecoveryKey } from '@/lib/crypto';

jest.mock('qrcode', () => ({
  toDataURL: jest.fn(async () => 'data:image/png;base64,ZmFrZS1xcg=='),
}));

const ACCOUNT = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });
}

describe('RecoveryBackupWizard / PaperBackupGenerator (#26/#247)', () => {
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

  it('generates a valid 24-word BIP-39 recovery phrase by default', () => {
    render(<RecoveryBackupWizard account={ACCOUNT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate BIP-39 phrase' }));
    expect(words()).toHaveLength(24);
    expect(validateMnemonic(words().join(' '), wordlist)).toBe(true);
  });

  it('supports 12-word BIP-39 phrase', () => {
    render(<RecoveryBackupWizard account={ACCOUNT} />);
    fireEvent.click(screen.getByLabelText('12 words'));
    fireEvent.click(screen.getByRole('button', { name: 'Generate BIP-39 phrase' }));
    expect(words()).toHaveLength(12);
    expect(validateMnemonic(words().join(' '), wordlist)).toBe(true);
  });

  it('refuses to continue when confirmation words are wrong', () => {
    render(<RecoveryBackupWizard account={ACCOUNT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate BIP-39 phrase' }));
    fireEvent.click(screen.getByRole('button', { name: 'I have written them down' }));
    for (const input of screen.getAllByRole('textbox')) {
      fireEvent.change(input, { target: { value: 'wrong' } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Create paper backup' }));
    expect(screen.getByRole('alert')).toHaveTextContent('do not match');
  });

  it('creates printable QR paper backup and downloadable encrypted backup', async () => {
    render(<RecoveryBackupWizard account={ACCOUNT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate BIP-39 phrase' }));
    const phrase = words();
    fireEvent.click(screen.getByRole('button', { name: 'I have written them down' }));

    for (const input of screen.getAllByRole('textbox')) {
      const position = Number(input.closest('label')!.textContent!.match(/#(\d+)/)![1]) - 1;
      fireEvent.change(input, { target: { value: phrase[position] } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Create paper backup' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Paper backup ready'));
    expect(screen.getByAltText('Encrypted recovery backup QR code')).toHaveAttribute(
      'src',
      'data:image/png;base64,ZmFrZS1xcg==',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Download backup file' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    const file = await readBlob(downloads[0]!.blob);
    expect(JSON.parse(file)).toMatchObject({
      format: 'reliora-backup',
      account: ACCOUNT,
      kdf: { iterations: 600_000 },
    });
    await expect(restoreRecoveryKey(file, phrase.join(' '))).resolves.toHaveLength(32);
  }, 30_000);
});
