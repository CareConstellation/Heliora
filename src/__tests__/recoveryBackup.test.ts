/**
 * @jest-environment node
 */
import {
  RECOVERY_PBKDF2_ITERATIONS,
  createRecoveryBackup,
  generateRecoveryKey,
  restoreRecoveryKey,
  type RecoveryBackup,
} from '@/lib/crypto';

const PASSPHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const ACCOUNT = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';

const reencode = (backup: RecoveryBackup, patch: (b: RecoveryBackup) => void) => {
  const copy = JSON.parse(JSON.stringify(backup)) as RecoveryBackup;
  patch(copy);
  return JSON.stringify(copy);
};

describe('password-derived recovery backup (#26)', () => {
  let key: Uint8Array<ArrayBuffer>;
  let backup: RecoveryBackup;

  beforeAll(async () => {
    key = generateRecoveryKey();
    backup = await createRecoveryBackup(key, PASSPHRASE, ACCOUNT);
  });

  it('generates a 256-bit recovery key', () => {
    expect(key).toHaveLength(32);
    expect(generateRecoveryKey()).not.toEqual(key);
  });

  it('uses PBKDF2-HMAC-SHA256 with the OWASP 600,000-iteration minimum and a 256-bit salt', () => {
    expect(RECOVERY_PBKDF2_ITERATIONS).toBe(600_000);
    expect(backup).toMatchObject({
      format: 'reliora-backup',
      version: 1,
      account: ACCOUNT,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000 },
      cipher: { name: 'AES-GCM' },
    });
    expect(atob(backup.kdf.salt)).toHaveLength(32);
    expect(atob(backup.cipher.iv)).toHaveLength(12);
    expect(atob(backup.ciphertext)).toHaveLength(48); // 32-byte key + 16-byte GCM tag
  });

  it('never stores the recovery key or passphrase in plaintext', () => {
    const file = JSON.stringify(backup);
    expect(file).not.toContain(btoa(String.fromCharCode(...key)));
    expect(file).not.toContain('legal winner');
  });

  it('restores the exact recovery key with the right passphrase', async () => {
    await expect(restoreRecoveryKey(JSON.stringify(backup), PASSPHRASE)).resolves.toEqual(key);
  });

  it('normalises the passphrase with NFKD, as BIP-39 requires', async () => {
    const composed = await createRecoveryBackup(key, 'café recovery phrase', ACCOUNT);
    await expect(
      restoreRecoveryKey(JSON.stringify(composed), 'café recovery phrase'),
    ).resolves.toEqual(key);
  });

  it('rejects a wrong passphrase', async () => {
    await expect(restoreRecoveryKey(JSON.stringify(backup), `${PASSPHRASE} x`)).rejects.toThrow(
      'Incorrect recovery passphrase',
    );
  });

  it('rejects a file whose authenticated header was modified', async () => {
    const otherAccount = reencode(backup, (b) => (b.account = 'GOTHER'));
    const raisedIterations = reencode(backup, (b) => (b.kdf.iterations = 700_000));
    await expect(restoreRecoveryKey(otherAccount, PASSPHRASE)).rejects.toThrow('has been modified');
    await expect(restoreRecoveryKey(raisedIterations, PASSPHRASE)).rejects.toThrow(
      'has been modified',
    );
  });

  it('refuses downgraded or out-of-range KDF parameters before deriving anything', async () => {
    for (const patch of [
      (b: RecoveryBackup) => (b.kdf.iterations = 1000),
      (b: RecoveryBackup) => (b.kdf.iterations = 1e12),
      (b: RecoveryBackup) => ((b.kdf as { hash: string }).hash = 'SHA-1'),
      (b: RecoveryBackup) => ((b as { format: string }).format = 'other'),
    ]) {
      await expect(restoreRecoveryKey(reencode(backup, patch), PASSPHRASE)).rejects.toThrow(
        'not a valid Heliora recovery backup',
      );
    }
  });
});
