'use client';

import { useMemo, useState } from 'react';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import QRCode from 'qrcode';
import {
  RECOVERY_BACKUP_EXTENSION,
  RECOVERY_PBKDF2_ITERATIONS,
  createRecoveryBackup,
  generateRecoveryKey,
} from '@/lib/crypto';

const WORD_OPTIONS = { 12: 128, 24: 256 } as const;
type WordCount = keyof typeof WORD_OPTIONS;
type Step = 'choose' | 'reveal' | 'confirm' | 'paper';

function pickPositions(total: number, count: number): number[] {
  const positions = new Set<number>();
  const random = new Uint32Array(1);
  while (positions.size < count) {
    crypto.getRandomValues(random);
    positions.add(random[0]! % total);
  }
  return [...positions].sort((a, b) => a - b);
}

export default function PaperBackupGenerator({ account }: { account: string }) {
  const [step, setStep] = useState<Step>('choose');
  const [wordCount, setWordCount] = useState<WordCount>(24);
  const [mnemonic, setMnemonic] = useState('');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [backupJson, setBackupJson] = useState('');

  const words = useMemo(() => (mnemonic ? mnemonic.split(' ') : []), [mnemonic]);
  const positions = useMemo(() => (words.length ? pickPositions(words.length, 3) : []), [words]);

  function start() {
    setMnemonic(generateMnemonic(wordlist, WORD_OPTIONS[wordCount]));
    setAnswers({});
    setError('');
    setQrDataUrl('');
    setBackupJson('');
    setStep('reveal');
  }

  async function createPaperBackup() {
    if (positions.some((p) => (answers[p] ?? '').trim().toLowerCase() !== words[p])) {
      setError('Those words do not match your recovery phrase. Check what you wrote down.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const backup = await createRecoveryBackup(generateRecoveryKey(), mnemonic, account);
      const json = JSON.stringify(backup);
      const qr = await QRCode.toDataURL(json, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 320,
        color: { dark: '#111111', light: '#ffffff' },
      });
      setBackupJson(json);
      setQrDataUrl(qr);
      setStep('paper');
    } catch {
      setError('Could not create the paper backup. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function downloadBackup() {
    if (!backupJson) return;
    const url = URL.createObjectURL(
      new Blob([backupJson], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `heliora-${account.slice(0, 6)}${RECOVERY_BACKUP_EXTENSION}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printPaper() {
    window.print();
  }

  return (
    <div className="space-y-4 text-sm text-text-2 print:text-black">
      {step === 'choose' && (
        <>
          <p>
            Generate a BIP-39 recovery phrase and print a high-contrast paper backup QR code.
            The backup stays encrypted; you need both the paper backup and your recovery phrase.
          </p>
          <fieldset className="flex gap-4">
            <legend className="sr-only">Recovery phrase length</legend>
            {([12, 24] as const).map((n) => (
              <label key={n} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="paper-word-count"
                  checked={wordCount === n}
                  onChange={() => setWordCount(n)}
                />
                {n} words
              </label>
            ))}
          </fieldset>
          <button onClick={start} className="btn-primary rounded-[9px] text-xs py-2 px-3.5">
            Generate BIP-39 phrase
          </button>
        </>
      )}

      {step === 'reveal' && (
        <>
          <p>Write these BIP-39 words down in order. Keep them offline.</p>
          <ol className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-xs text-text-1 print:text-black">
            {words.map((w, i) => (
              <li
                key={i}
                className="rounded-md border border-border bg-surface-inset px-2 py-1.5 print:border-black print:bg-white"
              >
                {i + 1}. {w}
              </li>
            ))}
          </ol>
          <button
            onClick={() => setStep('confirm')}
            className="btn-primary rounded-[9px] text-xs py-2 px-3.5"
          >
            I have written them down
          </button>
        </>
      )}

      {step === 'confirm' && (
        <>
          <p>Confirm your recovery phrase before creating the paper backup.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {positions.map((p) => (
              <label key={p} className="text-xs">
                Word #{p + 1}
                <input
                  value={answers[p] ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [p]: e.target.value }))}
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1 w-full rounded-md border border-border bg-surface-inset px-2 py-1.5 font-mono text-text-1"
                />
              </label>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => setStep('reveal')}
              className="btn-secondary rounded-[9px] text-xs py-2 px-3.5"
            >
              Back
            </button>
            <button
              onClick={createPaperBackup}
              disabled={busy}
              className="btn-primary rounded-[9px] text-xs py-2 px-3.5 disabled:opacity-50"
            >
              {busy
                ? `Deriving key (${RECOVERY_PBKDF2_ITERATIONS.toLocaleString()} PBKDF2 iterations)…`
                : 'Create paper backup'}
            </button>
          </div>
        </>
      )}

      {step === 'paper' && qrDataUrl && (
        <div className="space-y-4">
          <p role="status">
            Paper backup ready. Print or download the encrypted backup. Your BIP-39 phrase is still
            required to restore it.
          </p>
          <div className="rounded-xl border border-black/20 bg-white p-4 text-black print:border-black">
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <img
                src={qrDataUrl}
                alt="Encrypted recovery backup QR code"
                className="w-56 h-56 border border-black bg-white"
              />
              <div className="text-xs space-y-2">
                <p className="font-semibold">Heliora Emergency Recovery Backup</p>
                <p className="font-mono break-all">Account: {account}</p>
                <p>File: heliora-{account.slice(0, 6)}{RECOVERY_BACKUP_EXTENSION}</p>
                <p>Keep this paper offline. Anyone with this QR and your BIP-39 phrase can restore the key.</p>
              </div>
            </div>
          </div>
          <div className="flex gap-2 print:hidden">
            <button onClick={printPaper} className="btn-primary rounded-[9px] text-xs py-2 px-3.5">
              Print paper backup
            </button>
            <button onClick={downloadBackup} className="btn-secondary rounded-[9px] text-xs py-2 px-3.5">
              Download backup file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
