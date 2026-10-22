'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Activity,
  TrendingUp,
  ShieldCheck,
  ClipboardList,
  Search,
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
  UserCheck,
  UserX,
  RefreshCw,
  MoreHorizontal,
  Eye,
  Edit3,
  Download,
  PlusCircle,
} from 'lucide-react';
import { KpiSkeleton } from '@/components/ui/KpiSkeleton';
import { useWalletStore } from '@/store/useWalletStore';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import NoShowDisputes from '@/components/disputes/NoShowDisputes';
import AuditTrailVerifier from '@/components/audit/AuditTrailVerifier';
import MultisigStaging from '@/components/wallet/MultisigStaging';
import {
  fetchHospitalMetrics,
  fetchStaff,
  fetchAdmissions,
  fetchComplianceReports,
  bulkUpdateStaff,
} from '@/services/api.service';
import type { HospitalMetrics, StaffMember, PatientAdmission, ComplianceReport } from '@/types';

/* ─── Sparkline ─────────────────────────────────────────────────── */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const h = 28;
  const w = 56;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(' ');
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
    </svg>
  );
}

/* ─── Compliance badge ──────────────────────────────────────────── */
function ComplianceBadge({ status }: { status: ComplianceReport['status'] }) {
  if (status === 'compliant') return <span className="badge-green">Compliant</span>;
  if (status === 'review_needed') return <span className="badge-yellow">Review Needed</span>;
  return <span className="badge-red">Non-Compliant</span>;
}

/* ─── Staff role badge ──────────────────────────────────────────── */
function RoleBadge({ role }: { role: StaffMember['role'] }) {
  const map = { DOCTOR: 'badge-green', NURSE: 'badge-muted', ADMIN: 'badge-yellow' } as const;
  return <span className={map[role]}>{role.charAt(0) + role.slice(1).toLowerCase()}</span>;
}

/* ─── Status badge (admissions) ────────────────────────────────── */
function AdmissionBadge({ status }: { status: PatientAdmission['status'] }) {
  if (status === 'admitted') return <span className="badge-green">Admitted</span>;
  if (status === 'discharged') return <span className="badge-muted">Discharged</span>;
  return <span className="badge-yellow">Pending</span>;
}

/* ─── Empty / Error state ───────────────────────────────────────── */
function EmptyState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="py-12 flex flex-col items-center gap-2 text-center">
      <AlertCircle className="w-8 h-8 mb-1" style={{ color: 'var(--text-3)' }} />
      <p className="text-sm text-text-2">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 btn-secondary rounded-[6px] text-2xs py-1 px-2.5 flex items-center gap-1 hover:bg-surface-hover transition-all"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      )}
    </div>
  );
}

/* ─── Loading spinner ───────────────────────────────────────────── */
function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-5 py-3.5 flex items-center gap-4 animate-pulse">
          <div
            className="w-7 h-7 rounded-full shrink-0"
            style={{ background: 'var(--bg-inset)' }}
          />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 rounded w-1/3" style={{ background: 'var(--bg-inset)' }} />
            <div className="h-2.5 rounded w-1/4" style={{ background: 'var(--bg-inset)' }} />
          </div>
          <div className="h-5 w-16 rounded-full" style={{ background: 'var(--bg-inset)' }} />
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Main dashboard
   ═══════════════════════════════════════════════════════════════════ */
function HospitalDashboardContent() {
  const { publicKey } = useWalletStore();

  /* ── Server state ─────────────────────────────────────────────── */
  const [metrics, setMetrics] = useState<HospitalMetrics | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [admissions, setAdmissions] = useState<PatientAdmission[]>([]);
  const [compliance, setCompliance] = useState<ComplianceReport[]>([]);

  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [loadingAdmissions, setLoadingAdmissions] = useState(true);
  const [loadingCompliance, setLoadingCompliance] = useState(true);

  const [errorMetrics, setErrorMetrics] = useState(false);
  const [errorStaff, setErrorStaff] = useState(false);
  const [errorAdmissions, setErrorAdmissions] = useState(false);
  const [errorCompliance, setErrorCompliance] = useState(false);

  /* ── UI state ─────────────────────────────────────────────────── */
  const [staffSearch, setStaffSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'staff' | 'admissions' | 'compliance' | 'disputes' | 'audit' | 'multisig'
  >('staff');

  // A shared multisig deep link (?xdr=) opens straight on the signing tab.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('xdr')) setActiveTab('multisig');
  }, []);

  // Fetch helpers
  const loadMetrics = useCallback(() => {
    if (!publicKey) return;
    setLoadingMetrics(true);
    setErrorMetrics(false);
    fetchHospitalMetrics(publicKey)
      .then(setMetrics)
      .catch(() => setErrorMetrics(true))
      .finally(() => setLoadingMetrics(false));
  }, [publicKey]);

  const loadStaff = useCallback(() => {
    if (!publicKey) return;
    setLoadingStaff(true);
    setErrorStaff(false);
    fetchStaff(publicKey)
      .then(setStaff)
      .catch(() => setErrorStaff(true))
      .finally(() => setLoadingStaff(false));
  }, [publicKey]);

  const loadAdmissions = useCallback(() => {
    if (!publicKey) return;
    setLoadingAdmissions(true);
    setErrorAdmissions(false);
    fetchAdmissions(publicKey)
      .then(setAdmissions)
      .catch(() => setErrorAdmissions(true))
      .finally(() => setLoadingAdmissions(false));
  }, [publicKey]);

  const loadCompliance = useCallback(() => {
    if (!publicKey) return;
    setLoadingCompliance(true);
    setErrorCompliance(false);
    fetchComplianceReports(publicKey)
      .then(setCompliance)
      .catch(() => setErrorCompliance(true))
      .finally(() => setLoadingCompliance(false));
  }, [publicKey]);

  const loadData = useCallback(() => {
    loadMetrics();
    loadStaff();
    loadAdmissions();
    loadCompliance();
  }, [loadMetrics, loadStaff, loadAdmissions, loadCompliance]);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── KPI cards derived from metrics ──────────────────────────── */
  const kpis = metrics
    ? [
        {
          icon: Users,
          label: 'Total Staff',
          value: metrics.staffCount,
          sub: 'registered members',
          spark: [80, 85, 88, 90, 91, 93, 94, metrics.staffCount],
          trend: 'up',
          change: '+3',
        },
        {
          icon: ClipboardList,
          label: 'Active Admissions',
          value: metrics.activeAdmissions,
          sub: 'patients in-house',
          spark: [12, 14, 11, 13, 15, 14, 16, metrics.activeAdmissions],
          trend: 'up',
          change: '+2',
        },
        {
          icon: Activity,
          label: 'Total Appointments',
          value: metrics.totalAppointments,
          sub: 'this month',
          spark: [40, 45, 50, 48, 52, 55, 57, metrics.totalAppointments],
          trend: 'up',
          change: '+8',
        },
        {
          icon: ShieldCheck,
          label: 'Compliance Score',
          value: `${metrics.complianceScore}%`,
          sub: 'across all areas',
          spark: [88, 89, 90, 91, 90, 92, 93, metrics.complianceScore],
          trend: metrics.complianceScore >= 90 ? 'up' : 'down',
          change: metrics.complianceScore >= 90 ? '+2%' : '−1%',
        },
      ]
    : [];

  /* ── Staff filtering ──────────────────────────────────────────── */
  const filteredStaff = staff.filter(
    (s) =>
      s.name.toLowerCase().includes(staffSearch.toLowerCase()) ||
      s.department.toLowerCase().includes(staffSearch.toLowerCase()),
  );

  /* ── Bulk selection helpers ───────────────────────────────────── */
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filteredStaff.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredStaff.map((s) => s.id)));
    }
  }

  async function handleBulkAction(action: 'activate' | 'deactivate' | 'remove') {
    if (!publicKey || selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      await bulkUpdateStaff(publicKey, Array.from(selectedIds), action);
      setSelectedIds(new Set());
      fetchStaff(publicKey)
        .then(setStaff)
        .catch(() => setErrorStaff(true));
    } catch {
      // error handled gracefully — user can retry
    } finally {
      setBulkLoading(false);
    }
  }

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <div>
      {/* ── Page header ──────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8">
        <div>
          <p className="text-xs text-text-3 mb-1">Hospital Dashboard</p>
          <h1 className="text-2xl font-bold tracking-tight text-text-1">Hospital Admin</h1>
          <div className="flex items-center gap-2 mt-2">
            <span className="badge-green">Verified Institution</span>
            <span className="text-2xs text-text-3 font-mono hidden sm:block">
              {publicKey ? `${publicKey.slice(0, 6)}...${publicKey.slice(-4)}` : '···'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={loadData}
            disabled={loadingMetrics || loadingStaff || loadingAdmissions || loadingCompliance}
            className="btn-secondary rounded-[9px] text-xs py-2 px-3.5 flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingMetrics || loadingStaff || loadingAdmissions || loadingCompliance ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button className="btn-primary rounded-[9px] text-xs py-2 px-3.5 flex items-center gap-1.5">
            <PlusCircle className="w-3.5 h-3.5" />
            Add Staff
          </button>
        </div>
      </div>

      {/* ── Analytics cards ──────────────────────────────────── */}
      {loadingMetrics ? (
        <KpiSkeleton count={4} />
      ) : errorMetrics ? (
        <div className="rounded-[12px] px-4 py-3.5 flex items-center justify-between gap-3 mb-6"
             style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <div className="flex items-center gap-3">
            <AlertCircle className="w-4 h-4 shrink-0" style={{ color: '#F87171' }} />
            <p className="text-sm text-text-1">Unable to load metrics. Check your API configuration.</p>
          </div>
          <button
            onClick={loadMetrics}
            className="btn-secondary rounded-[6px] text-2xs py-1.5 px-3 flex items-center gap-1 hover:bg-surface-hover transition-all"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          {kpis.map((k, i) => (
            <div
              key={i}
              className="rounded-[14px] p-5"
              style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <div className="flex items-start justify-between mb-4">
                <div
                  className="w-8 h-8 rounded-[9px] flex items-center justify-center"
                  style={{
                    background: 'rgba(0,200,150,0.1)',
                    border: '1px solid rgba(0,200,150,0.12)',
                  }}
                >
                  <k.icon className="w-4 h-4" style={{ color: '#00C896' }} />
                </div>
                <Sparkline values={k.spark} color={k.trend === 'down' ? '#F87171' : '#00C896'} />
              </div>
              <p className="text-2xl font-bold tracking-tight text-text-1">{k.value}</p>
              <p className="text-xs text-text-3 mt-0.5">{k.label}</p>
              <div className="flex items-center gap-1 mt-2">
                {k.trend === 'up' && (
                  <TrendingUp className="w-3 h-3" style={{ color: '#00C896' }} />
                )}
                {k.trend === 'down' && (
                  <TrendingUp className="w-3 h-3 rotate-180" style={{ color: '#F87171' }} />
                )}
                {k.change && (
                  <span
                    className="text-2xs font-semibold"
                    style={{ color: k.trend === 'up' ? '#00C896' : '#F87171' }}
                  >
                    {k.change}
                  </span>
                )}
                <span className="text-2xs text-text-3">{k.sub}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tab navigation ───────────────────────────────────── */}
      <div
        className="flex gap-1 mb-5 p-1 rounded-[10px] w-fit"
        style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        {(
          [
            { key: 'staff', label: 'Staff Management' },
            { key: 'admissions', label: 'Admissions' },
            { key: 'compliance', label: 'Compliance' },
            { key: 'disputes', label: 'Disputes' },
            { key: 'audit', label: 'Audit Trail' },
            { key: 'multisig', label: 'Multisig' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="text-xs font-medium px-4 py-1.5 rounded-[8px] transition-all"
            style={{
              background: activeTab === tab.key ? 'rgba(0,200,150,0.12)' : 'transparent',
              color: activeTab === tab.key ? '#00C896' : 'var(--text-3)',
              border:
                activeTab === tab.key ? '1px solid rgba(0,200,150,0.2)' : '1px solid transparent',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════
          Staff Management tab
          ══════════════════════════════════════════════════════════ */}
      {activeTab === 'staff' && (
        <div
          className="rounded-[14px] overflow-hidden"
          style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          {/* Header row */}
          <div
            className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div>
              <h2 className="text-sm font-semibold text-text-1">Staff Members</h2>
              <p className="text-xs text-text-3 mt-0.5">
                {staff.length} registered · doctors, nurses, admin
              </p>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-text-3 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                placeholder="Search by name or department…"
                aria-label="Search by name or department"
                className="input text-xs py-1.5 pl-8 w-52"
                value={staffSearch}
                onChange={(e) => setStaffSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div
              className="px-5 py-2.5 flex items-center gap-3"
              style={{
                background: 'rgba(0,200,150,0.06)',
                borderBottom: '1px solid rgba(0,200,150,0.12)',
              }}
            >
              <span className="text-xs font-medium" style={{ color: '#00C896' }}>
                {selectedIds.size} selected
              </span>
              <div className="flex items-center gap-2 ml-2">
                <button
                  onClick={() => handleBulkAction('activate')}
                  disabled={bulkLoading}
                  className="flex items-center gap-1 text-2xs font-semibold px-2.5 py-1 rounded-md disabled:opacity-50"
                  style={{
                    background: 'rgba(0,200,150,0.1)',
                    color: '#00C896',
                    border: '1px solid rgba(0,200,150,0.2)',
                  }}
                >
                  {bulkLoading ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <UserCheck className="w-3 h-3" />
                  )}
                  Activate
                </button>
                <button
                  onClick={() => handleBulkAction('deactivate')}
                  disabled={bulkLoading}
                  className="flex items-center gap-1 text-2xs font-semibold px-2.5 py-1 rounded-md disabled:opacity-50"
                  style={{
                    background: 'rgba(234,179,8,0.1)',
                    color: '#EAB308',
                    border: '1px solid rgba(234,179,8,0.2)',
                  }}
                >
                  <UserX className="w-3 h-3" />
                  Deactivate
                </button>
                <button
                  onClick={() => handleBulkAction('remove')}
                  disabled={bulkLoading}
                  className="flex items-center gap-1 text-2xs font-semibold px-2.5 py-1 rounded-md disabled:opacity-50"
                  style={{
                    background: 'rgba(239,68,68,0.1)',
                    color: '#F87171',
                    border: '1px solid rgba(239,68,68,0.2)',
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                  Remove
                </button>
              </div>
            </div>
          )}

          {/* Table */}
          {loadingStaff ? (
            <TableSkeleton rows={5} />
          ) : errorStaff ? (
            <EmptyState message="Could not load staff data. The API may be unavailable." onRetry={loadStaff} />
          ) : filteredStaff.length === 0 ? (
            <EmptyState
              message={staffSearch ? 'No staff match your search.' : 'No staff members found.'}
            />
          ) : (
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th className="w-8">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={
                        selectedIds.size === filteredStaff.length && filteredStaff.length > 0
                      }
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th>Staff Member</th>
                  <th className="hidden sm:table-cell">Role</th>
                  <th className="hidden md:table-cell">Department</th>
                  <th className="hidden lg:table-cell">Joined</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStaff.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={selectedIds.has(member.id)}
                        onChange={() => toggleSelect(member.id)}
                      />
                    </td>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-2xs font-bold shrink-0"
                          style={{
                            background: 'rgba(0,200,150,0.12)',
                            color: '#00C896',
                            border: '1px solid rgba(0,200,150,0.15)',
                          }}
                        >
                          {member.name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-text-1">{member.name}</p>
                          <p className="text-2xs font-mono text-text-3 hidden sm:block">
                            {member.address.slice(0, 4)}...{member.address.slice(-4)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell">
                      <RoleBadge role={member.role} />
                    </td>
                    <td className="hidden md:table-cell text-xs text-text-2">
                      {member.department}
                    </td>
                    <td className="hidden lg:table-cell text-xs text-text-2 whitespace-nowrap">
                      {member.joinDate}
                    </td>
                    <td>
                      {member.status === 'active' ? (
                        <span className="badge-green">Active</span>
                      ) : member.status === 'pending' ? (
                        <span className="badge-yellow">Pending</span>
                      ) : (
                        <span className="badge-muted">Inactive</span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-1 justify-end">
                        <button className="btn-icon w-7 h-7 rounded-md">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button className="btn-icon w-7 h-7 rounded-md">
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button className="btn-icon w-7 h-7 rounded-md">
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div
            className="px-5 py-3 flex items-center justify-between"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            <span className="text-xs text-text-3">
              {filteredStaff.length} of {staff.length} shown
            </span>
            <button
              className="flex items-center gap-1 text-xs font-medium transition-colors hover:text-text-1"
              style={{ color: '#00C896' }}
            >
              View all staff <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          Admissions tab
          ══════════════════════════════════════════════════════════ */}
      {activeTab === 'admissions' && (
        <div
          className="rounded-[14px] overflow-hidden"
          style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div
            className="px-5 py-4 flex items-center justify-between"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div>
              <h2 className="text-sm font-semibold text-text-1">Patient Admissions</h2>
              <p className="text-xs text-text-3 mt-0.5">Admission and discharge overview</p>
            </div>
            <button className="btn-primary rounded-[9px] text-xs py-1.5 px-3 flex items-center gap-1.5">
              <PlusCircle className="w-3.5 h-3.5" />
              New Admission
            </button>
          </div>

          {loadingAdmissions ? (
            <TableSkeleton rows={5} />
          ) : errorAdmissions ? (
            <EmptyState message="Could not load admissions data. The API may be unavailable." onRetry={loadAdmissions} />
          ) : admissions.length === 0 ? (
            <EmptyState message="No admissions found." />
          ) : (
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th className="hidden sm:table-cell">Department</th>
                  <th className="hidden md:table-cell">Assigned Doctor</th>
                  <th className="hidden lg:table-cell">Admitted</th>
                  <th className="hidden lg:table-cell">Discharged</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {admissions.map((admission) => (
                  <tr key={admission.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-2xs font-bold shrink-0"
                          style={{
                            background: 'rgba(96,165,250,0.12)',
                            color: '#60A5FA',
                            border: '1px solid rgba(96,165,250,0.15)',
                          }}
                        >
                          {admission.patientName
                            .split(' ')
                            .map((n) => n[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-text-1">{admission.patientName}</p>
                          <p className="text-2xs font-mono text-text-3 hidden sm:block">
                            {admission.patientAddress.slice(0, 4)}...
                            {admission.patientAddress.slice(-4)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell text-xs text-text-2">
                      {admission.department}
                    </td>
                    <td className="hidden md:table-cell text-xs text-text-2">
                      {admission.assignedDoctor}
                    </td>
                    <td className="hidden lg:table-cell text-xs text-text-2 whitespace-nowrap">
                      {admission.admissionDate}
                    </td>
                    <td className="hidden lg:table-cell text-xs text-text-2 whitespace-nowrap">
                      {admission.dischargeDate ?? <span className="text-text-3">—</span>}
                    </td>
                    <td>
                      <AdmissionBadge status={admission.status} />
                    </td>
                    <td>
                      <div className="flex items-center gap-1 justify-end">
                        <button className="btn-icon w-7 h-7 rounded-md">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button className="btn-icon w-7 h-7 rounded-md">
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="px-5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <span className="text-xs text-text-3">
              {admissions.filter((a) => a.status === 'admitted').length} currently admitted ·{' '}
              {admissions.filter((a) => a.status === 'discharged').length} discharged
            </span>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          Compliance tab
          ══════════════════════════════════════════════════════════ */}
      {activeTab === 'compliance' && (
        <div className="space-y-4">
          {/* Summary bar */}
          {!loadingCompliance && !errorCompliance && compliance.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  label: 'Compliant',
                  count: compliance.filter((c) => c.status === 'compliant').length,
                  icon: CheckCircle2,
                  color: '#00C896',
                },
                {
                  label: 'Review Needed',
                  count: compliance.filter((c) => c.status === 'review_needed').length,
                  icon: Clock,
                  color: '#EAB308',
                },
                {
                  label: 'Non-Compliant',
                  count: compliance.filter((c) => c.status === 'non_compliant').length,
                  icon: XCircle,
                  color: '#F87171',
                },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-[12px] p-4 flex items-center gap-3"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid rgba(255,255,255,0.07)',
                  }}
                >
                  <s.icon className="w-5 h-5 shrink-0" style={{ color: s.color }} />
                  <div>
                    <p className="text-xl font-bold text-text-1">{s.count}</p>
                    <p className="text-2xs text-text-3">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Reports table */}
          <div
            className="rounded-[14px] overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div
              className="px-5 py-4 flex items-center justify-between"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div>
                <h2 className="text-sm font-semibold text-text-1">Compliance Reports</h2>
                <p className="text-xs text-text-3 mt-0.5">
                  HIPAA, data privacy, licensing & safety
                </p>
              </div>
              <button className="btn-secondary rounded-[9px] text-xs py-1.5 px-3 flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" />
                Export
              </button>
            </div>

            {loadingCompliance ? (
              <TableSkeleton rows={4} />
            ) : errorCompliance ? (
              <EmptyState message="Could not load compliance reports. The API may be unavailable." onRetry={loadCompliance} />
            ) : compliance.length === 0 ? (
              <EmptyState message="No compliance reports available." />
            ) : (
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th>Report</th>
                    <th className="hidden sm:table-cell">Type</th>
                    <th>Score</th>
                    <th>Status</th>
                    <th className="hidden md:table-cell">Last Audit</th>
                    <th className="hidden lg:table-cell">Next Audit</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {compliance.map((report) => (
                    <tr key={report.id}>
                      <td>
                        <p className="text-xs font-medium text-text-1">{report.title}</p>
                      </td>
                      <td className="hidden sm:table-cell">
                        <span className="badge-muted text-2xs">
                          {report.type.replace('_', ' ')}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-16 h-1.5 rounded-full overflow-hidden"
                            style={{ background: 'var(--bg-inset)' }}
                          >
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${report.score}%`,
                                background:
                                  report.score >= 90
                                    ? '#00C896'
                                    : report.score >= 70
                                      ? '#EAB308'
                                      : '#F87171',
                              }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-text-1">{report.score}%</span>
                        </div>
                      </td>
                      <td>
                        <ComplianceBadge status={report.status} />
                      </td>
                      <td className="hidden md:table-cell text-xs text-text-2 whitespace-nowrap">
                        {report.lastAudit}
                      </td>
                      <td className="hidden lg:table-cell text-xs text-text-2 whitespace-nowrap">
                        {report.nextAudit}
                      </td>
                      <td>
                        <div className="flex items-center gap-1 justify-end">
                          <button className="btn-icon w-7 h-7 rounded-md">
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button className="btn-icon w-7 h-7 rounded-md">
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          Disputes tab — missed telemedicine consultations
          ══════════════════════════════════════════════════════════ */}
      {activeTab === 'disputes' && publicKey && <NoShowDisputes hospitalAddress={publicKey} />}

      {/* ══════════════════════════════════════════════════════════
          Audit Trail tab — Merkle inclusion proofs anchored to Stellar
          ══════════════════════════════════════════════════════════ */}
      {activeTab === 'audit' && publicKey && <AuditTrailVerifier hospitalAddress={publicKey} />}

      {/* ══════════════════════════════════════════════════════════
          Multisig tab — stage, co-sign and broadcast admin transactions
          ══════════════════════════════════════════════════════════ */}
      {activeTab === 'multisig' && publicKey && <MultisigStaging signerAddress={publicKey} />}
    </div>
  );
}

/* ── Page wrapper with ProtectedRoute ───────────────────────────── */
export default function HospitalDashboardPage() {
  return (
    <ProtectedRoute requiredRole="HOSPITAL">
      <HospitalDashboardContent />
    </ProtectedRoute>
  );
}
