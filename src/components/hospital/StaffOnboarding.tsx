'use client';

import { useMemo, useState } from 'react';
import {
  parseStaffCSV,
  validateStaffRow,
  generateStaffInvitation,
  type StaffOnboardingRow,
  type PreviewStaffRow,
  type StaffInvitationStatus,
} from '@/lib/bulkRecordParser';

export default function StaffOnboarding() {
  const [rows, setRows] = useState<PreviewStaffRow[]>([]);
  const [invitations, setInvitations] = useState<StaffInvitationStatus[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [deliveryProgress, setDeliveryProgress] = useState(0);
  const [acceptanceProgress, setAcceptanceProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const validRows = useMemo(() => rows.filter((r) => r._valid), [rows]);
  const invalidRows = useMemo(() => rows.filter((r) => !r._valid), [rows]);

  function handleFileUpload(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const parsedRows = parseStaffCSV(text);
        const validated = parsedRows.map((row, idx) => validateStaffRow(row, idx));
        setRows(validated);
        setInvitations([]);
        setDeliveryProgress(0);
        setAcceptanceProgress(0);

        const errorCount = validated.filter((r) => !r._valid).length;
        if (errorCount > 0) {
          setStatusMessage(`Parsed ${validated.length} staff records (${errorCount} contain errors).`);
        } else {
          setStatusMessage(`Parsed ${validated.length} valid staff records. Ready to dispatch invitations.`);
        }
      } catch (err) {
        setStatusMessage(err instanceof Error ? err.message : 'Failed to parse CSV file.');
      }
    };
    reader.readAsText(file);
  }

  async function handleSendInvitations() {
    if (!validRows.length) return;

    setIsProcessing(true);
    setDeliveryProgress(0);
    setAcceptanceProgress(0);
    const total = validRows.length;
    const generatedInvites: StaffInvitationStatus[] = [];

    for (let i = 0; i < total; i++) {
      const staff = validRows[i]!;
      const invite = generateStaffInvitation(staff);
      generatedInvites.push(invite);
      const currentSent = i + 1;
      setDeliveryProgress(Math.round((currentSent / total) * 100));
      // Simulate network latency per invitation batch
      await new Promise((r) => setTimeout(r, 60));
    }

    setInvitations(generatedInvites);
    setIsProcessing(false);
    setStatusMessage(`Successfully dispatched ${generatedInvites.length} invitation emails with wallet activation links.`);

    // Simulate real-time acceptance percentage updates
    let accepted = 0;
    const acceptanceInterval = setInterval(() => {
      accepted += 1;
      const pct = Math.min(100, Math.round((accepted / total) * 100));
      setAcceptanceProgress(pct);
      if (accepted >= Math.ceil(total * 0.85)) {
        clearInterval(acceptanceInterval);
      }
    }, 400);
  }

  function handleCopyLink(invite: StaffInvitationStatus) {
    navigator.clipboard.writeText(invite.walletLink);
    setCopiedId(invite.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <section
      className="rounded-[14px] p-5 mb-5"
      style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
      aria-label="Staff Onboarding"
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-text-1">Batch Staff Role Onboarding & Wallet Provisioning</h2>
          <p className="text-xs text-text-3 mt-1">
            Upload CSV roster (columns: <code>name</code>, <code>email</code>, <code>role</code>, <code>licenseId</code>) to invite and provision wallets.
          </p>
        </div>
        <label className="btn-secondary rounded-[8px] text-xs py-2 px-3 cursor-pointer shrink-0">
          Upload Staff CSV
          <input
            className="sr-only"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
          />
        </label>
      </div>

      {statusMessage && (
        <div
          className={`text-xs px-3 py-2 rounded-[8px] mb-3 ${
            invalidRows.length > 0 ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'
          }`}
        >
          {statusMessage}
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-4">
          <div className="overflow-auto max-h-60 rounded-[8px] border border-white/5">
            <table className="data-table w-full text-xs">
              <thead className="bg-white/5 text-text-2">
                <tr>
                  <th className="py-2 px-3 text-left">Row</th>
                  <th className="py-2 px-3 text-left">Name</th>
                  <th className="py-2 px-3 text-left">Email</th>
                  <th className="py-2 px-3 text-left">Role</th>
                  <th className="py-2 px-3 text-left">License ID</th>
                  <th className="py-2 px-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map((row) => (
                  <tr key={`${row._row}-${row.email}`} className={row._valid ? '' : 'bg-red-500/5'}>
                    <td className="py-2 px-3 text-text-3 font-mono">{row._row}</td>
                    <td className="py-2 px-3 text-text-1 font-medium">{row.name || '—'}</td>
                    <td className="py-2 px-3 text-text-2 font-mono">{row.email || '—'}</td>
                    <td className="py-2 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-white/10 text-text-2">
                        {row.role}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono text-text-3">{row.licenseId || '—'}</td>
                    <td className="py-2 px-3">
                      {row._valid ? (
                        <span className="text-emerald-400 font-medium">Valid</span>
                      ) : (
                        <span className="text-red-400" title={row._errors.join(', ')}>
                          {row._errors.join('; ')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={!validRows.length || isProcessing}
                onClick={handleSendInvitations}
                className="btn-primary rounded-[8px] text-xs py-2 px-4 font-semibold disabled:opacity-50"
              >
                {isProcessing
                  ? 'Dispatching Invites…'
                  : `Dispatch ${validRows.length} Invitation${validRows.length === 1 ? '' : 's'}`}
              </button>
              <span className="text-xs text-text-3">
                {validRows.length} ready · {invalidRows.length} invalid
              </span>
            </div>
          </div>
        </div>
      )}

      {(isProcessing || invitations.length > 0) && (
        <div className="mt-4 pt-4 border-t border-white/5 space-y-3">
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-text-2">
              <span>Invitation Delivery Progress</span>
              <span className="font-mono">{deliveryProgress}%</span>
            </div>
            <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
              <div
                className="bg-primary-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${deliveryProgress}%` }}
              />
            </div>
          </div>

          {deliveryProgress === 100 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-text-2">
                <span>Wallet Activation & Acceptance Rate</span>
                <span className="font-mono">{acceptanceProgress}%</span>
              </div>
              <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${acceptanceProgress}%` }}
                />
              </div>
            </div>
          )}

          {invitations.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold text-text-2 mb-2">Active Wallet Activation Links</h3>
              <div className="overflow-auto max-h-48 rounded-[8px] border border-white/5">
                <table className="data-table w-full text-xs">
                  <thead className="bg-white/5 text-text-3">
                    <tr>
                      <th className="py-2 px-3 text-left">Staff</th>
                      <th className="py-2 px-3 text-left">Token</th>
                      <th className="py-2 px-3 text-left">Wallet Connection Link</th>
                      <th className="py-2 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {invitations.slice(0, 10).map((inv) => (
                      <tr key={inv.id}>
                        <td className="py-2 px-3 text-text-1">{inv.name}</td>
                        <td className="py-2 px-3 font-mono text-text-3 text-[11px]">{inv.activationToken}</td>
                        <td className="py-2 px-3 font-mono text-text-3 text-[11px] truncate max-w-xs">
                          {inv.walletLink}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleCopyLink(inv)}
                            className="btn-secondary rounded py-1 px-2 text-[10px]"
                          >
                            {copiedId === inv.id ? 'Copied!' : 'Copy Link'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
