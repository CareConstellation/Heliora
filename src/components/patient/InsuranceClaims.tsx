'use client';

import { useState, useEffect, useCallback } from 'react';
import type {
  InsuranceClaimRecord,
  InsurancePolicyRecord,
  ClaimStatus,
} from '@/types';
import {
  queryClaimableBalances,
  claimClaimableBalance,
  type ClaimableBalanceRecord,
} from '@/lib/claimableBalance';
import { freighterSigner } from '@/lib/stellar';
import { useWalletStore } from '@/store/useWalletStore';
import { useToast } from '@/hooks/useToast';

const ACTIVE_POLICY: InsurancePolicyRecord = {
  policyNumber: 'POL-HEL-882193',
  providerName: 'CareConstellation Institutional Health PPO',
  planType: 'Comprehensive Tier 1 Health Plan',
  subscriberId: 'SUB-9402148',
  groupNumber: 'GRP-HEL-042',
  coveragePercent: 80,
  copayAmountUsd: 25,
  deductibleRemainingUsd: 150,
  status: 'ACTIVE',
  smartContractVerifierAddress: 'CPOLICYVERIFIER55CHARS0000000000000000000000000000000000',
};

const INITIAL_CLAIMS: InsuranceClaimRecord[] = [
  {
    claimId: 'CLM-1042',
    appointmentId: 'apt_2026_0901',
    receiptNumber: 'HS-001188',
    serviceDate: '2026-05-15',
    submittedAt: '2026-05-15T14:32:00Z',
    providerName: 'Dr. Sarah Jenkins, MD',
    facilityName: 'Metro General Hospital - Cardiology Wing',
    policyNumber: 'POL-HEL-882193',
    status: 'Disbursed',
    statusTimestamp: '2026-05-16T11:05:22Z',
    totalGrossAmount: 500,
    totalCoveredAmount: 420,
    totalCopayAmount: 80,
    items: [
      {
        code: '99214',
        description: 'Level 4 Outpatient Clinical Consultation',
        grossAmount: 220,
        insuranceCoveredAmount: 185,
        patientCopayAmount: 35,
      },
      {
        code: '93000',
        description: '12-Lead Electrocardiogram (ECG) with interpretation',
        grossAmount: 180,
        insuranceCoveredAmount: 155,
        patientCopayAmount: 25,
      },
      {
        code: '80053',
        description: 'Comprehensive Metabolic Panel (CMP)',
        grossAmount: 100,
        insuranceCoveredAmount: 80,
        patientCopayAmount: 20,
      },
    ],
    reimbursementTx: {
      txHash: 'a7c93e41b269ff0185e7d991b3fa128cd462947a11956f2a890e0c1f304d92bc',
      tokenSymbol: 'USDC',
      amount: 420,
      payoutTimestamp: '2026-05-16T11:05:22Z',
      settledOnChain: true,
    },
  },
  {
    claimId: 'CLM-1043',
    appointmentId: 'apt_2026_0904',
    receiptNumber: 'HS-001205',
    serviceDate: '2026-05-18',
    submittedAt: '2026-05-18T09:15:00Z',
    providerName: 'Dr. Marcus Vance, DO',
    facilityName: 'St. Jude Telehealth Clinic',
    policyNumber: 'POL-HEL-882193',
    status: 'Approved',
    statusTimestamp: '2026-05-19T08:00:00Z',
    totalGrossAmount: 175,
    totalCoveredAmount: 140,
    totalCopayAmount: 35,
    items: [
      {
        code: '99213',
        description: 'Telemedicine Follow-up Clinical Consultation',
        grossAmount: 125,
        insuranceCoveredAmount: 100,
        patientCopayAmount: 25,
      },
      {
        code: '99441',
        description: 'Remote Prescription Medication Reconciliation',
        grossAmount: 50,
        insuranceCoveredAmount: 40,
        patientCopayAmount: 10,
      },
    ],
  },
  {
    claimId: 'CLM-1044',
    appointmentId: 'apt_2026_0911',
    receiptNumber: 'HS-001249',
    serviceDate: '2026-05-20',
    submittedAt: '2026-05-20T16:45:00Z',
    providerName: 'Valley Imaging Center',
    facilityName: 'Diagnostic Radiology Lab',
    policyNumber: 'POL-HEL-882193',
    status: 'In Review',
    statusTimestamp: '2026-05-20T16:45:00Z',
    totalGrossAmount: 350,
    totalCoveredAmount: 280,
    totalCopayAmount: 70,
    items: [
      {
        code: '71046',
        description: 'Chest Radiography Examination (2 Views)',
        grossAmount: 350,
        insuranceCoveredAmount: 280,
        patientCopayAmount: 70,
      },
    ],
  },
];

const STATUS_PROGRESSION: ClaimStatus[] = ['Submitted', 'In Review', 'Approved', 'Disbursed'];

export default function InsuranceClaims() {
  const [policy] = useState<InsurancePolicyRecord>(ACTIVE_POLICY);
  const [claims, setClaims] = useState<InsuranceClaimRecord[]>(INITIAL_CLAIMS);
  const [selectedClaim, setSelectedClaim] = useState<InsuranceClaimRecord | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showNewClaimModal, setShowNewClaimModal] = useState(false);

  // New claim form state
  const [newReceiptNumber, setNewReceiptNumber] = useState('');
  const [newAppointmentId, setNewAppointmentId] = useState('');
  const [newProviderName, setNewProviderName] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newServiceDate, setNewServiceDate] = useState('2026-05-21');

  const { publicKey } = useWalletStore();
  const { toast } = useToast();
  const [claimableBalances, setClaimableBalances] = useState<ClaimableBalanceRecord[]>([]);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [claimingBalanceId, setClaimingBalanceId] = useState<string | null>(null);

  const loadClaimableBalances = useCallback(async () => {
    if (!publicKey) return;
    try {
      setIsLoadingBalances(true);
      const balances = await queryClaimableBalances(publicKey);
      setClaimableBalances(balances);
    } catch {
      // Ignored if offline or horizon unreachable
    } finally {
      setIsLoadingBalances(false);
    }
  }, [publicKey]);

  useEffect(() => {
    void loadClaimableBalances();
  }, [loadClaimableBalances]);

  async function handleClaimBalance(balanceId: string) {
    if (!publicKey) {
      toast('Connect wallet to claim insurance balance', 'error');
      return;
    }
    try {
      setClaimingBalanceId(balanceId);
      const res = await claimClaimableBalance(balanceId, publicKey, freighterSigner);
      toast(`Insurance payout claimed successfully! Tx: ${res.txHash.slice(0, 8)}…`, 'success');
      await loadClaimableBalances();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to claim balance';
      toast(msg, 'error');
    } finally {
      setClaimingBalanceId(null);
    }
  }

  function handleRefreshContractEvents() {
    setIsRefreshing(true);
    setTimeout(() => {
      // Simulate on-chain Soroban event listener processing claim transitions
      setClaims((prevClaims) =>
        prevClaims.map((claim) => {
          if (claim.status === 'In Review') {
            return {
              ...claim,
              status: 'Approved' as ClaimStatus,
              statusTimestamp: new Date().toISOString(),
            };
          }
          if (claim.status === 'Approved') {
            return {
              ...claim,
              status: 'Disbursed' as ClaimStatus,
              statusTimestamp: new Date().toISOString(),
              reimbursementTx: {
                txHash: `tx_${Math.random().toString(16).substring(2, 10)}${Date.now().toString(16)}`,
                tokenSymbol: 'USDC',
                amount: claim.totalCoveredAmount,
                payoutTimestamp: new Date().toISOString(),
                settledOnChain: true,
              },
            };
          }
          return claim;
        }),
      );
      setIsRefreshing(false);
    }, 600);
  }

  function handleCreateClaim(e: React.FormEvent) {
    e.preventDefault();
    const gross = Number(newAmount) || 200;
    const covered = Math.round(gross * (policy.coveragePercent / 100));
    const copay = gross - covered;

    const newClaim: InsuranceClaimRecord = {
      claimId: `CLM-${Math.floor(1000 + Math.random() * 9000)}`,
      appointmentId: newAppointmentId || `apt_${Date.now()}`,
      receiptNumber: newReceiptNumber || `HS-${Math.floor(100000 + Math.random() * 900000)}`,
      serviceDate: newServiceDate,
      submittedAt: new Date().toISOString(),
      providerName: newProviderName || 'General Healthcare Provider',
      facilityName: 'Heliora Integrated Clinic',
      policyNumber: policy.policyNumber,
      status: 'Submitted',
      statusTimestamp: new Date().toISOString(),
      totalGrossAmount: gross,
      totalCoveredAmount: covered,
      totalCopayAmount: copay,
      items: [
        {
          code: '99213',
          description: 'Linked Appointment Clinical Services',
          grossAmount: gross,
          insuranceCoveredAmount: covered,
          patientCopayAmount: copay,
        },
      ],
    };

    setClaims([newClaim, ...claims]);
    setShowNewClaimModal(false);
    setNewReceiptNumber('');
    setNewAppointmentId('');
    setNewProviderName('');
    setNewAmount('');
  }

  function getStatusBadge(status: ClaimStatus) {
    switch (status) {
      case 'Submitted':
        return 'bg-blue-500/10 text-blue-300 border-blue-500/20';
      case 'In Review':
        return 'bg-amber-500/10 text-amber-300 border-amber-500/20';
      case 'Approved':
        return 'bg-purple-500/10 text-purple-300 border-purple-500/20';
      case 'Disbursed':
        return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
      default:
        return 'bg-white/10 text-white border-white/20';
    }
  }

  return (
    <section
      className="rounded-[14px] p-5 mb-5"
      style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
      aria-label="Insurance Policy Claims and Auto-Reimbursement"
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-text-1">Institutional Insurance Policy & Auto-Reimbursement</h2>
          <p className="text-xs text-text-3 mt-1">
            Track claims linked to appointment receipts with automated Soroban smart contract disbursements.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNewClaimModal(true)}
            className="btn-secondary rounded-[8px] text-xs py-1.5 px-3 font-medium"
          >
            + Link Receipt to Claim
          </button>
          <button
            type="button"
            disabled={isRefreshing}
            onClick={handleRefreshContractEvents}
            className="btn-primary rounded-[8px] text-xs py-1.5 px-3 font-medium disabled:opacity-50"
          >
            {isRefreshing ? 'Checking Soroban Events…' : 'Sync Contract Events'}
          </button>
        </div>
      </div>

      {/* Connected Policy Card */}
      <div className="rounded-lg p-3.5 mb-4 bg-surface-inset border border-border text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-1">{policy.providerName}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
              {policy.status}
            </span>
          </div>
          <span className="font-mono text-2xs text-text-3">
            Contract Verifier: {policy.smartContractVerifierAddress.slice(0, 16)}…
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-2xs">
          <div>
            <span className="text-text-3 block">Policy #</span>
            <span className="font-mono text-text-1 font-medium">{policy.policyNumber}</span>
          </div>
          <div>
            <span className="text-text-3 block">Plan Type</span>
            <span className="text-text-1 font-medium">{policy.planType}</span>
          </div>
          <div>
            <span className="text-text-3 block">Standard Coverage</span>
            <span className="font-semibold text-emerald-400">{policy.coveragePercent}% covered</span>
          </div>
          <div>
            <span className="text-text-3 block">Base Copay</span>
            <span className="font-medium text-text-1">${policy.copayAmountUsd.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Claimable Horizon Balances Section (#190) */}
      <div className="rounded-lg p-3.5 mb-4 bg-surface-inset border border-border text-xs">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-1">Asynchronous Insurance Payouts (Claimable Balances)</span>
            <span className="text-2xs bg-primary-500/10 text-primary-400 px-2 py-0.5 rounded font-mono">
              Horizon Balances
            </span>
          </div>
          <button
            type="button"
            disabled={isLoadingBalances || !publicKey}
            onClick={() => void loadClaimableBalances()}
            className="text-2xs underline text-text-3 hover:text-text-1 disabled:opacity-50"
          >
            {isLoadingBalances ? 'Querying Horizon…' : 'Refresh Balances'}
          </button>
        </div>

        {claimableBalances.length === 0 ? (
          <p className="text-2xs text-text-3 italic">
            {publicKey ? 'No pending asynchronous insurance payouts found for your wallet.' : 'Connect wallet to view claimable payouts.'}
          </p>
        ) : (
          <div className="space-y-2 mt-2">
            {claimableBalances.map((bal) => (
              <div
                key={bal.id}
                className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-2.5 rounded bg-surface-card border border-border gap-2"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-text-1">
                      {bal.amount} {bal.asset}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        bal.isClaimable
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                      }`}
                    >
                      {bal.isClaimable ? 'Claimable Now' : 'Time-Locked'}
                    </span>
                  </div>
                  <p className="text-2xs font-mono text-text-3 truncate max-w-xs mt-0.5">
                    Balance ID: {bal.id.slice(0, 16)}…{bal.id.slice(-8)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!bal.isClaimable || claimingBalanceId === bal.id}
                  onClick={() => void handleClaimBalance(bal.id)}
                  className="btn-primary text-xs py-1 px-3 rounded font-medium disabled:opacity-50 shrink-0"
                >
                  {claimingBalanceId === bal.id ? 'Claiming…' : 'Claim Payout'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Claims List */}
      <div className="space-y-3">
        {claims.map((claim) => (
          <div
            key={claim.claimId}
            className="rounded-lg p-3.5 bg-surface-inset border border-border transition-colors hover:border-white/10"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-xs text-text-1">{claim.claimId}</span>
                <span className="text-2xs text-text-3 font-mono">Receipt: {claim.receiptNumber}</span>
                <span className="text-2xs text-text-3">· {claim.facilityName}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${getStatusBadge(claim.status)}`}>
                  {claim.status}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedClaim(selectedClaim?.claimId === claim.claimId ? null : claim)}
                  className="text-2xs text-primary-400 hover:text-primary-300 font-medium ml-1"
                >
                  {selectedClaim?.claimId === claim.claimId ? 'Hide Breakdown ▲' : 'View Itemized Bill ▼'}
                </button>
              </div>
            </div>

            {/* Stepper Status Indicators */}
            <div className="flex items-center gap-1 my-3">
              {STATUS_PROGRESSION.map((step, idx) => {
                const currentIdx = STATUS_PROGRESSION.indexOf(claim.status);
                const isPassed = currentIdx >= idx;
                const isCurrent = currentIdx === idx;
                return (
                  <div key={step} className="flex-1 flex flex-col items-center">
                    <div
                      className={`w-full h-1.5 rounded-full mb-1 transition-all ${
                        isPassed ? (step === 'Disbursed' ? 'bg-emerald-500' : 'bg-primary-500') : 'bg-white/10'
                      }`}
                    />
                    <span
                      className={`text-[9px] uppercase tracking-wider font-semibold ${
                        isCurrent ? 'text-primary-300' : isPassed ? 'text-text-2' : 'text-text-3'
                      }`}
                    >
                      {step}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Financial Overview */}
            <div className="grid grid-cols-3 gap-2 text-xs pt-2 border-t border-white/5">
              <div>
                <span className="text-2xs text-text-3 block">Total Gross Billed</span>
                <span className="font-semibold text-text-1 font-mono">${claim.totalGrossAmount.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-2xs text-text-3 block">Insurance Covered</span>
                <span className="font-semibold text-emerald-400 font-mono">${claim.totalCoveredAmount.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-2xs text-text-3 block">Patient Out-of-Pocket Copay</span>
                <span className="font-semibold text-amber-300 font-mono">${claim.totalCopayAmount.toFixed(2)}</span>
              </div>
            </div>

            {/* On-Chain Smart Contract Payout Notification */}
            {claim.reimbursementTx && (
              <div className="mt-3 p-2.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm">⚡</span>
                  <div>
                    <span className="font-semibold">Auto-Reimbursement Disbursed:</span>{' '}
                    <span className="font-mono font-bold text-emerald-300">
                      +{claim.reimbursementTx.amount.toFixed(2)} {claim.reimbursementTx.tokenSymbol}
                    </span>
                  </div>
                </div>
                <span className="font-mono text-2xs text-emerald-400 truncate max-w-xs">
                  Tx: {claim.reimbursementTx.txHash.slice(0, 16)}…
                </span>
              </div>
            )}

            {/* Itemized Copay vs Coverage Breakdown Table */}
            {selectedClaim?.claimId === claim.claimId && (
              <div className="mt-3 pt-3 border-t border-white/5 overflow-auto">
                <h4 className="text-2xs font-semibold text-text-2 uppercase tracking-wider mb-1.5">
                  Itemized Service Expense Breakdown (CPT Encounters)
                </h4>
                <table className="data-table w-full text-xs">
                  <thead className="bg-white/5 text-text-3 text-[11px]">
                    <tr>
                      <th className="py-1.5 px-2 text-left">Code</th>
                      <th className="py-1.5 px-2 text-left">Service Description</th>
                      <th className="py-1.5 px-2 text-right">Gross</th>
                      <th className="py-1.5 px-2 text-right text-emerald-400">Ins. Covered</th>
                      <th className="py-1.5 px-2 text-right text-amber-300">Patient Copay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {claim.items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="py-1.5 px-2 font-mono text-text-2 text-2xs">{item.code}</td>
                        <td className="py-1.5 px-2 text-text-1">{item.description}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-text-2">${item.grossAmount.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-emerald-400 font-medium">
                          ${item.insuranceCoveredAmount.toFixed(2)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-amber-300 font-medium">
                          ${item.patientCopayAmount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* New Claim Modal */}
      {showNewClaimModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-surface-card border border-border p-5 shadow-xl space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-text-1">Link Appointment Receipt to Policy Claim</h3>
              <button
                type="button"
                onClick={() => setShowNewClaimModal(false)}
                className="text-text-3 hover:text-text-1 text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateClaim} className="space-y-3 text-xs">
              <div>
                <label className="block text-text-2 mb-1">Appointment Receipt # *</label>
                <input
                  required
                  value={newReceiptNumber}
                  onChange={(e) => setNewReceiptNumber(e.target.value)}
                  placeholder="e.g. HS-001290"
                  className="w-full input py-1.5 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-text-2 mb-1">Appointment ID (Optional)</label>
                <input
                  value={newAppointmentId}
                  onChange={(e) => setNewAppointmentId(e.target.value)}
                  placeholder="e.g. apt_2026_0920"
                  className="w-full input py-1.5 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-text-2 mb-1">Healthcare Provider / Clinic *</label>
                <input
                  required
                  value={newProviderName}
                  onChange={(e) => setNewProviderName(e.target.value)}
                  placeholder="e.g. Dr. Alex Mercer, Metro Health"
                  className="w-full input py-1.5 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-text-2 mb-1">Total Receipt Amount ($) *</label>
                  <input
                    required
                    type="number"
                    min="1"
                    step="0.01"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    placeholder="250.00"
                    className="w-full input py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-text-2 mb-1">Service Date</label>
                  <input
                    type="date"
                    value={newServiceDate}
                    onChange={(e) => setNewServiceDate(e.target.value)}
                    className="w-full input py-1.5 text-xs"
                  />
                </div>
              </div>

              <div className="p-2.5 rounded bg-surface-inset border border-border text-2xs text-text-3">
                <span>Active Policy: </span>
                <span className="font-semibold text-text-1">{policy.policyNumber}</span>
                <span className="block mt-0.5 text-emerald-400">
                  Estimated auto-reimbursement: {policy.coveragePercent}%
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowNewClaimModal(false)}
                  className="btn-secondary rounded py-1.5 px-3 text-xs"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary rounded py-1.5 px-3 text-xs font-semibold">
                  Submit Claim to Contract
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
