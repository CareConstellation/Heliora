'use client';

import { useState } from 'react';
import ContractUpgradeModal from '@/components/admin/ContractUpgradeModal';
import {
  CURRENT_PROTOCOL_PARAMETERS,
  assembleAdminConfigEnvelope,
  type ProtocolParameters,
} from '@/lib/stellar';

export default function ProtocolConsole() {
  const [currentParams] = useState<ProtocolParameters>(CURRENT_PROTOCOL_PARAMETERS);
  const [feePercent, setFeePercent] = useState(String(currentParams.platformFeePercent));
  const [settlementAsset, setSettlementAsset] = useState(currentParams.settlementAsset);
  const [oracleAddress, setOracleAddress] = useState(currentParams.oracleAddress);
  const [maxDailyClaimPayout, setMaxDailyClaimPayout] = useState(currentParams.maxDailyClaimPayout);
  const [emergencyPause, setEmergencyPause] = useState(currentParams.emergencyPause);
  const [contractId, setContractId] = useState('CHELIORAPROTOCOLPARAMS110CONTRACTID55CHARS00000000000000');

  const [errorMessage, setErrorMessage] = useState('');
  const [proposalEnvelope, setProposalEnvelope] = useState<{ xdr: string; hashPreview: string } | null>(null);
  const [isAssembling, setIsAssembling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);

  // Proposed parameters object for live comparison
  const proposedFee = Number(feePercent);
  const proposedParams: ProtocolParameters = {
    platformFeePercent: Number.isFinite(proposedFee) ? proposedFee : currentParams.platformFeePercent,
    platformFeeBps: Number.isFinite(proposedFee) ? Math.round(proposedFee * 100) : currentParams.platformFeeBps,
    settlementAsset,
    oracleAddress,
    maxDailyClaimPayout,
    emergencyPause,
    requiredMultisigSigners: 2,
  };

  async function handleAssemble(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage('');
    setProposalEnvelope(null);

    // Strict numerical validation
    const parsedFee = Number(feePercent);
    if (!Number.isFinite(parsedFee) || parsedFee < 0 || parsedFee > 100) {
      setErrorMessage('Platform fee must be a valid percentage between 0.00% and 100.00%.');
      return;
    }

    const trimmedOracle = oracleAddress.trim();
    if (!trimmedOracle || !/^([CG][A-Z2-7]{55})$/.test(trimmedOracle)) {
      setErrorMessage('Oracle address must be a valid 56-character Stellar address (starts with G or C).');
      return;
    }

    try {
      setIsAssembling(true);
      const res = await assembleAdminConfigEnvelope(
        'GADMINHELIORA55CHARS0000000000000000000000000000000000000',
        contractId,
        proposedParams,
      );
      setProposalEnvelope(res);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to assemble Soroban admin transaction.');
    } finally {
      setIsAssembling(false);
    }
  }

  function handleCopyXdr() {
    if (proposalEnvelope) {
      void navigator.clipboard.writeText(proposalEnvelope.xdr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <section
      className="rounded-[14px] p-5 mb-5"
      style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
      aria-label="Protocol Parameters and Fee Adjustment Console"
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-text-1">Platform Smart Contract Parameters & Fee Adjustment</h2>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
              Multi-sig Protected (2-of-3)
            </span>
          </div>
          <p className="text-xs text-text-3 mt-1">
            Configure Soroban platform protocol parameters, fee schedules, asset trustlines, and oracle endpoints.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsUpgradeModalOpen(true)}
          className="btn-secondary rounded-lg text-xs py-1.5 px-3 font-semibold shrink-0"
        >
          Contract Upgrade Migration
        </button>
      </div>

      {errorMessage && (
        <div className="text-xs px-3 py-2 rounded-[8px] mb-4 bg-red-500/10 border border-red-500/20 text-red-300">
          ⚠️ {errorMessage}
        </div>
      )}

      {/* Side-by-Side Current vs Proposed Comparison Table */}
      <div className="mb-5 overflow-auto rounded-[8px] border border-white/5">
        <table className="data-table w-full text-xs">
          <thead className="bg-white/5 text-text-2">
            <tr>
              <th className="py-2.5 px-3 text-left">Protocol Variable</th>
              <th className="py-2.5 px-3 text-left">Current On-Chain Value</th>
              <th className="py-2.5 px-3 text-left">Proposed Value</th>
              <th className="py-2.5 px-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            <tr>
              <td className="py-2 px-3 font-medium text-text-1">Platform Fee</td>
              <td className="py-2 px-3 font-mono text-text-2">{currentParams.platformFeePercent}% ({currentParams.platformFeeBps} bps)</td>
              <td className="py-2 px-3 font-mono text-primary-400 font-semibold">
                {proposedParams.platformFeePercent}% ({proposedParams.platformFeeBps} bps)
              </td>
              <td className="py-2 px-3">
                {currentParams.platformFeePercent === proposedParams.platformFeePercent ? (
                  <span className="text-text-3">Unchanged</span>
                ) : (
                  <span className="text-amber-400 font-medium">Modified</span>
                )}
              </td>
            </tr>
            <tr>
              <td className="py-2 px-3 font-medium text-text-1">Settlement Asset</td>
              <td className="py-2 px-3 font-mono text-text-2">{currentParams.settlementAsset}</td>
              <td className="py-2 px-3 font-mono text-primary-400 font-semibold">{proposedParams.settlementAsset}</td>
              <td className="py-2 px-3">
                {currentParams.settlementAsset === proposedParams.settlementAsset ? (
                  <span className="text-text-3">Unchanged</span>
                ) : (
                  <span className="text-amber-400 font-medium">Modified</span>
                )}
              </td>
            </tr>
            <tr>
              <td className="py-2 px-3 font-medium text-text-1">Price Oracle Address</td>
              <td className="py-2 px-3 font-mono text-text-2 text-[11px] truncate max-w-xs">{currentParams.oracleAddress}</td>
              <td className="py-2 px-3 font-mono text-primary-400 font-semibold text-[11px] truncate max-w-xs">{proposedParams.oracleAddress}</td>
              <td className="py-2 px-3">
                {currentParams.oracleAddress === proposedParams.oracleAddress ? (
                  <span className="text-text-3">Unchanged</span>
                ) : (
                  <span className="text-amber-400 font-medium">Modified</span>
                )}
              </td>
            </tr>
            <tr>
              <td className="py-2 px-3 font-medium text-text-1">Max Daily Claim Limit</td>
              <td className="py-2 px-3 font-mono text-text-2">{currentParams.maxDailyClaimPayout}</td>
              <td className="py-2 px-3 font-mono text-primary-400 font-semibold">{proposedParams.maxDailyClaimPayout}</td>
              <td className="py-2 px-3">
                {currentParams.maxDailyClaimPayout === proposedParams.maxDailyClaimPayout ? (
                  <span className="text-text-3">Unchanged</span>
                ) : (
                  <span className="text-amber-400 font-medium">Modified</span>
                )}
              </td>
            </tr>
            <tr>
              <td className="py-2 px-3 font-medium text-text-1">Emergency Protocol Pause</td>
              <td className="py-2 px-3 text-text-2">{currentParams.emergencyPause ? 'PAUSED' : 'ACTIVE'}</td>
              <td className="py-2 px-3 font-semibold text-primary-400">{proposedParams.emergencyPause ? 'PAUSED' : 'ACTIVE'}</td>
              <td className="py-2 px-3">
                {currentParams.emergencyPause === proposedParams.emergencyPause ? (
                  <span className="text-text-3">Unchanged</span>
                ) : (
                  <span className="text-red-400 font-bold">STATE CHANGE</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Parameter Configuration Form */}
      <form onSubmit={handleAssemble} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs text-text-2">
            Target Soroban Contract ID
            <input
              required
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              className="input mt-1 w-full text-xs font-mono"
            />
          </label>

          <label className="text-xs text-text-2">
            Platform Protocol Fee (%)
            <input
              required
              value={feePercent}
              onChange={(e) => setFeePercent(e.target.value)}
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="e.g. 2.50"
              className="input mt-1 w-full text-xs font-mono"
            />
            <span className="text-2xs text-text-3 mt-0.5 block">Permitted range: 0.00% – 100.00%</span>
          </label>

          <label className="text-xs text-text-2">
            Settlement Asset / Trustline
            <select
              value={settlementAsset}
              onChange={(e) => setSettlementAsset(e.target.value)}
              className="input mt-1 w-full text-xs"
            >
              <option value="native (XLM)">Native Stellar Lumens (XLM)</option>
              <option value="USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5">Circle USD Coin (USDC)</option>
              <option value="CUSTOM_ASSET:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5">Custom Trustline Asset</option>
            </select>
          </label>

          <label className="text-xs text-text-2 md:col-span-2">
            Price Oracle Contract / Account Address (56 chars)
            <input
              required
              value={oracleAddress}
              onChange={(e) => setOracleAddress(e.target.value)}
              placeholder="C... or G..."
              className="input mt-1 w-full text-xs font-mono"
            />
          </label>

          <label className="text-xs text-text-2">
            Max Daily Auto-Reimbursement
            <input
              required
              value={maxDailyClaimPayout}
              onChange={(e) => setMaxDailyClaimPayout(e.target.value)}
              placeholder="e.g. 50000 XLM"
              className="input mt-1 w-full text-xs"
            />
          </label>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <label className="flex items-center gap-2 text-xs text-text-2 cursor-pointer">
            <input
              type="checkbox"
              checked={emergencyPause}
              onChange={(e) => setEmergencyPause(e.target.checked)}
              className="rounded"
            />
            <span className="font-semibold text-red-400">Emergency Protocol Pause Switch</span>
          </label>
        </div>

        <button
          type="submit"
          disabled={isAssembling}
          className="btn-primary rounded-[8px] text-xs py-2 px-4 font-semibold disabled:opacity-50"
        >
          {isAssembling ? 'Assembling Envelope…' : 'Assemble Multi-Sig Configuration Envelope'}
        </button>
      </form>

      {/* Assembled Proposal Preview */}
      {proposalEnvelope && (
        <div className="mt-4 pt-4 border-t border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-text-1">Assembled Soroban Transaction Envelope</h3>
            <button
              type="button"
              onClick={handleCopyXdr}
              className="btn-secondary rounded py-1 px-2.5 text-xs font-medium"
            >
              {copied ? 'Copied XDR!' : 'Copy Envelope XDR'}
            </button>
          </div>

          <div className="p-3 rounded-lg bg-surface-inset border border-border text-2xs font-mono space-y-2">
            <div className="text-text-3">
              <span className="font-semibold text-text-2">Transaction Hash Preview:</span> {proposalEnvelope.hashPreview}
            </div>
            <div className="text-text-3">
              <span className="font-semibold text-text-2">Target Method:</span> <code>update_protocol_parameters</code>
            </div>
            <div className="text-text-3">
              <span className="font-semibold text-text-2">Threshold:</span> 2 signatures required from authorized admin keys.
            </div>
            <pre className="overflow-auto max-h-32 text-primary-300 whitespace-pre-wrap break-all mt-2 bg-black/30 p-2 rounded">
              {proposalEnvelope.xdr}
            </pre>
          </div>
        </div>
      )}

      <ContractUpgradeModal
        isOpen={isUpgradeModalOpen}
        onClose={() => setIsUpgradeModalOpen(false)}
        defaultContractId={contractId}
      />
    </section>
  );
}
