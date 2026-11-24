'use client';

import PaperBackupGenerator from './PaperBackupGenerator';

/**
 * Recovery backup entry point. Kept for existing dashboard usage and tests.
 * Uses the paper backup flow which includes BIP-39 generation, confirmation quiz,
 * encrypted backup creation, and printable QR export.
 */
export default function RecoveryBackupWizard({ account }: { account: string }) {
  return <PaperBackupGenerator account={account} />;
}
