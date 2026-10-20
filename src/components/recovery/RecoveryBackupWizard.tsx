'use client';

import { useMemo, useState } from 'react';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import {
  RECOVERY_BACKUP_EXTENSION,
  RECOVERY_PBKDF2_ITERATIONS,
  createRecoveryBackup,
  generateRecoveryKey,
} from '@/lib/crypto';

/** BIP-39: 128 bits of entropy → 12 words, 256 bits → 24 words. */
const WORD_OPTIONS = { 12: 128, 24: 256 } as const;
type WordCount = keyof typeof WORD_OPTIONS;
const CONFIRM_WORDS = 3;

type Step = 'choose' | 'reveal' | 'confirm' | 'done';

/** Picks `count` distinct word positions to confirm, uniformly at random. */
function pickPositions(total: number, count: number): number[] {
  const positions = new Set<number>();
  const random = new Uint32Array(1);
  while (positions.size < count) {
    crypto.getRandomValues(random);
    positions.add(random[0]! % total);
  }
  return [...positions].sort((a, b) => a - b);
}

function downloadBackup(contents: string, account: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `heliora-${account.slice(0, 6)}${RECOVERY_BACKUP_EXTENSION}`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Optional emergency-recovery setup. It generates a BIP-39 recovery passphrase,
 * has the patient confirm they recorded it, then encrypts a fresh 256-bit
 * recovery key under PBKDF2-HMAC-SHA256 (600,000 iterations) and downloads it
 * as a `.reliora-backup` file. Nothing leaves the browser.
 */
export default function RecoveryBackupWizard({ account }: { account: string }) {
  const [step, setStep] = useState<Step>('choose');
  const [wordCount, setWordCount] = useState<WordCount>(12);
  const [mnemonic, setMnemonic] = useState('');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const words = useMemo(() => (mnemonic ? mnemonic.split(' ') : []), [mnemonic]);
  const positions = useMemo(
    () => (words.length ? pickPositions(words.length, CONFIRM_WORDS) : []),
    [words],
  );

  function start() {
    setMnemonic(generateMnemonic(wordlist, WORD_OPTIONS[wordCount]));
    setAnswers({});
    setError('');
    setStep('reveal');
  }

  async function createBackup() {
    if (positions.some((p) => answers[p]?.trim().toLowerCase() !== words[p])) {
      setError('Those words do not match your recovery phrase. Check what you wrote down.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const backup = await createRecoveryBackup(generateRecoveryKey(), mnemonic, account);
      downloadBackup(JSON.stringify(backup, null, 2), account);
      setMnemonic('');
      setStep('done');
    } catch {
      setError('Could not create the backup. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 text-sm text-text-2">
      {step === 'choose' && (
        <>
          <p>
            Create an encrypted recovery key you can keep offline. It is protected by a recovery
            phrase that only you know, so Heliora cannot restore it for you.
          </p>
          <fieldset className="flex gap-4">
            <legend className="sr-only">Recovery phrase length</legend>
            {([12, 24] as const).map((n) => (
              <label key={n} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="word-count"
                  checked={wordCount === n}
                  onChange={() => setWordCount(n)}
                />
                {n} words
              </label>
            ))}
          </fieldset>
          <button onClick={start} className="btn-primary rounded-[9px] text-xs py-2 px-3.5">
            Generate recovery phrase
          </button>
        </>
      )}

      {step === 'reveal' && (
        <>
          <p>Write these words down in order and store them somewhere safe and offline.</p>
          <ol className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-xs text-text-1">
            {words.map((w, i) => (
              <li key={i} className="rounded-md border border-border bg-surface-inset px-2 py-1.5">
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
          <p>Confirm your recovery phrase.</p>
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
              onClick={createBackup}
              disabled={busy}
              className="btn-primary rounded-[9px] text-xs py-2 px-3.5 disabled:opacity-50"
            >
              {busy
                ? `Deriving key (${RECOVERY_PBKDF2_ITERATIONS.toLocaleString()} PBKDF2 iterations)…`
                : 'Create & download backup'}
            </button>
          </div>
        </>
      )}

      {step === 'done' && (
        <p role="status">
          Your <span className="font-mono">{RECOVERY_BACKUP_EXTENSION}</span> file has been
          downloaded. Keep it offline. You will need both the file and your recovery phrase to
          recover your key.
        </p>
      )}
    </div>
  );
}
