'use client';

import { useState, useEffect } from 'react';
import {
  fetchActiveContractWasmHash,
  compareContractWasmHashes,
  simulateContractUpgrade,
  executeContractUpgrade,
  type BytecodeDiffSummary,
  type ContractUpgradeSimulationResult,
  DEFAULT_CONTRACT_ID,
} from '@/lib/sorobanContractVersioning';
import { freighterSigner } from '@/lib/stellar';
import { useWalletStore } from '@/store/useWalletStore';
import { useToast } from '@/hooks/useToast';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import {
  X,
  RefreshCw,
  GitCompare,
  PlayCircle,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Cpu,
  Layers,
} from 'lucide-react';

export interface ContractUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultContractId?: string;
  adminAddress?: string;
  onSuccess?: (txHash: string) => void;
}

export default function ContractUpgradeModal({
  isOpen,
  onClose,
  defaultContractId = DEFAULT_CONTRACT_ID,
  adminAddress: propAdminAddress,
  onSuccess,
}: ContractUpgradeModalProps) {
  const { publicKey } = useWalletStore();
  const { toast } = useToast();

  const [contractId, setContractId] = useState(defaultContractId);
  const [targetWasmHash, setTargetWasmHash] = useState('');
  const [adminAddress, setAdminAddress] = useState(
    propAdminAddress || publicKey || 'GADMINHELIORA55CHARS0000000000000000000000000000000000000',
  );

  const [activeWasmHash, setActiveWasmHash] = useState<string | null>(null);
  const [diffSummary, setDiffSummary] = useState<BytecodeDiffSummary | null>(null);
  const [simulationResult, setSimulationResult] = useState<ContractUpgradeSimulationResult | null>(null);

  const [isFetching, setIsFetching] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [acknowledgedRisk, setAcknowledgedRisk] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successTxHash, setSuccessTxHash] = useState<string | null>(null);

  const modalRef = useFocusTrap<HTMLDivElement>(isOpen, onClose);

  useEffect(() => {
    if (isOpen) {
      if (defaultContractId) setContractId(defaultContractId);
      if (propAdminAddress || publicKey) {
        setAdminAddress(propAdminAddress || publicKey || '');
      }
      setErrorMessage(null);
      setSuccessTxHash(null);
    }
  }, [isOpen, defaultContractId, propAdminAddress, publicKey]);

  if (!isOpen) return null;

  async function handleFetchAndCompare() {
    if (!contractId.trim()) {
      setErrorMessage('Please enter a valid Soroban Contract ID.');
      return;
    }
    setErrorMessage(null);
    setIsFetching(true);

    try {
      const active = await fetchActiveContractWasmHash(contractId.trim());
      setActiveWasmHash(active);

      const diff = compareContractWasmHashes(active ?? '', targetWasmHash.trim());
      setDiffSummary(diff);

      if (!active) {
        toast('Contract not found on ledger or no executable WASM hash registered.', 'info');
      } else {
        toast('Fetched active contract bytecode hash from ledger.', 'success');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to query active contract WASM hash.';
      setErrorMessage(msg);
      toast(msg, 'error');
    } finally {
      setIsFetching(false);
    }
  }

  async function handleSimulate() {
    if (!contractId.trim() || !targetWasmHash.trim()) {
      setErrorMessage('Contract ID and Target WASM Hash are required for simulation.');
      return;
    }
    if (!adminAddress.trim()) {
      setErrorMessage('Admin signer public address is required for upgrade simulation.');
      return;
    }

    setErrorMessage(null);
    setIsSimulating(true);

    try {
      const result = await simulateContractUpgrade(
        adminAddress.trim(),
        contractId.trim(),
        targetWasmHash.trim(),
      );
      setSimulationResult(result);

      if (result.success) {
        toast('Contract upgrade simulation succeeded.', 'success');
      } else {
        setErrorMessage(result.error || 'Upgrade simulation failed.');
        toast('Contract upgrade simulation failed.', 'error');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error simulating contract upgrade.';
      setErrorMessage(msg);
      toast(msg, 'error');
    } finally {
      setIsSimulating(false);
    }
  }

  async function handleExecuteUpgrade() {
    if (!acknowledgedRisk) {
      setErrorMessage('Please confirm your acknowledgement of contract code modification.');
      return;
    }
    if (!simulationResult?.success) {
      setErrorMessage('A successful upgrade simulation is required prior to execution.');
      return;
    }

    setErrorMessage(null);
    setIsExecuting(true);

    try {
      const { txHash } = await executeContractUpgrade(
        adminAddress.trim(),
        contractId.trim(),
        targetWasmHash.trim(),
        freighterSigner,
      );

      setSuccessTxHash(txHash);
      toast('Contract bytecode upgraded successfully on Stellar ledger.', 'success');
      if (onSuccess) {
        onSuccess(txHash);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Contract upgrade execution failed.';
      setErrorMessage(msg);
      toast(msg, 'error');
    } finally {
      setIsExecuting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="contract-upgrade-title"
      data-testid="contract-upgrade-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0F172A] p-6 shadow-2xl space-y-5 focus:outline-none my-8 text-slate-100"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-primary-500/10 p-2 text-primary-400 border border-primary-500/20">
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <h2 id="contract-upgrade-title" className="text-base font-bold text-white">
                Soroban Contract Upgrade & Migration Helper
              </h2>
              <p className="text-xs text-text-3">DevOps & Contract Lifecycle Management (#195)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            data-testid="close-modal-btn"
            className="rounded-lg p-1.5 text-text-3 hover:bg-white/5 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Success Alert */}
        {successTxHash && (
          <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Upgrade Transaction Executed!</p>
              <p className="font-mono text-2xs break-all mt-1">Transaction Hash: {successTxHash}</p>
            </div>
          </div>
        )}

        {/* Form Inputs */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-2 mb-1">
              Target Soroban Contract ID (56 characters)
            </label>
            <input
              type="text"
              data-testid="contract-id-input"
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              placeholder="e.g. CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
              className="input w-full font-mono text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-2 mb-1">
              Target WASM Bytecode Hash (64 hex characters)
            </label>
            <input
              type="text"
              data-testid="target-wasm-input"
              value={targetWasmHash}
              onChange={(e) => {
                setTargetWasmHash(e.target.value);
                if (activeWasmHash !== null) {
                  setDiffSummary(compareContractWasmHashes(activeWasmHash ?? '', e.target.value));
                }
              }}
              placeholder="e.g. e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
              className="input w-full font-mono text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-2 mb-1">
              Admin Signer Public Key
            </label>
            <input
              type="text"
              data-testid="admin-address-input"
              value={adminAddress}
              onChange={(e) => setAdminAddress(e.target.value)}
              placeholder="G... or C..."
              className="input w-full font-mono text-xs"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              data-testid="fetch-compare-btn"
              onClick={handleFetchAndCompare}
              disabled={isFetching}
              className="btn-secondary flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium"
            >
              {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Fetch Active WASM & Compare
            </button>
          </div>
        </div>

        {/* Bytecode Diff Summary Card */}
        {diffSummary && (
          <div
            data-testid="bytecode-diff-summary"
            className="rounded-xl border border-white/10 bg-surface-inset p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-primary-400" />
                <span className="text-xs font-semibold text-text-1">Bytecode Diff Summary</span>
              </div>
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                  diffSummary.isIdentical
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                }`}
              >
                {diffSummary.isIdentical ? 'Identical (No Migration Needed)' : 'Divergent (Upgrade Required)'}
              </span>
            </div>

            <p className="text-xs text-text-2">{diffSummary.diffSummaryText}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-2xs font-mono">
              <div className="p-2.5 rounded bg-black/40 border border-white/5 space-y-1">
                <span className="text-text-3 font-sans block text-3xs uppercase tracking-wider">Active Deployed Hash</span>
                <span className="text-slate-300 break-all">{diffSummary.activeHash || '(Not deployed / empty)'}</span>
              </div>
              <div className="p-2.5 rounded bg-black/40 border border-white/5 space-y-1">
                <span className="text-text-3 font-sans block text-3xs uppercase tracking-wider">Target Hash</span>
                <span className="text-primary-300 break-all">{diffSummary.targetHash || '(None)'}</span>
              </div>
            </div>

            {diffSummary.commonPrefix && (
              <div className="text-2xs text-text-3">
                Common Prefix Match: <span className="font-mono text-text-2">{diffSummary.commonPrefix.length} chars</span>
              </div>
            )}
          </div>
        )}

        {/* Simulation Section */}
        <div className="space-y-3 pt-1 border-t border-white/10">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-text-1 flex items-center gap-1.5">
              <PlayCircle className="h-4 w-4 text-sky-400" />
              Pre-Flight Upgrade Simulation
            </h3>
            <button
              type="button"
              data-testid="simulate-upgrade-btn"
              onClick={handleSimulate}
              disabled={isSimulating || !targetWasmHash.trim()}
              className="btn-secondary flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium disabled:opacity-50"
            >
              {isSimulating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
              Simulate Upgrade
            </button>
          </div>

          {simulationResult && (
            <div
              data-testid="simulation-result"
              className={`rounded-xl border p-3 text-xs space-y-2 ${
                simulationResult.success
                  ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200'
                  : 'border-red-500/20 bg-red-500/5 text-red-200'
              }`}
            >
              <div className="flex items-center justify-between font-semibold">
                <span className="flex items-center gap-1.5">
                  {simulationResult.success ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                  )}
                  {simulationResult.success ? 'Simulation Succeeded' : 'Simulation Failed'}
                </span>
                {simulationResult.simulatedLedger && (
                  <span className="text-2xs font-mono text-text-3">
                    Ledger #{simulationResult.simulatedLedger}
                  </span>
                )}
              </div>

              {simulationResult.success ? (
                <div className="grid grid-cols-2 gap-2 text-2xs pt-1 font-mono">
                  <div className="bg-black/30 p-2 rounded border border-white/5">
                    <span className="text-text-3 font-sans block text-3xs">Min Resource Fee</span>
                    <span className="text-text-1">{simulationResult.minResourceFee ?? '0'} stroops</span>
                  </div>
                  <div className="bg-black/30 p-2 rounded border border-white/5">
                    <span className="text-text-3 font-sans block text-3xs">Footprint Footprint</span>
                    <span className="text-text-1">
                      RO: {simulationResult.footprint?.readOnlyCount ?? 0} | RW: {simulationResult.footprint?.readWriteCount ?? 0}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-2xs text-red-300 font-mono break-all">{simulationResult.error}</p>
              )}
            </div>
          )}
        </div>

        {/* Confirmation & Execution */}
        <div className="space-y-3 pt-3 border-t border-white/10">
          <label className="flex items-start gap-2.5 text-xs text-text-2 cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledgedRisk}
              onChange={(e) => setAcknowledgedRisk(e.target.checked)}
              className="rounded mt-0.5"
            />
            <span>
              I understand that executing this migration will permanently alter the contract bytecode on the
              Stellar network and can only be executed by authorized administrator accounts.
            </span>
          </label>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary py-2 px-4 rounded-lg text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="confirm-execute-btn"
              onClick={handleExecuteUpgrade}
              disabled={isExecuting || !acknowledgedRisk || !simulationResult?.success}
              className="btn-primary py-2 px-4 rounded-lg text-xs font-semibold flex items-center gap-2 disabled:opacity-40"
            >
              {isExecuting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Broadcasting Upgrade…
                </>
              ) : (
                <>
                  <Layers className="h-4 w-4" />
                  Confirm & Execute Upgrade
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
