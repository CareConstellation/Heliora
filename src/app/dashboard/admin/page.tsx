'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import {
  Users,
  ShieldCheck,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  Search,
  ChevronDown,
  MoreHorizontal,
  Ban,
  UserCheck,
  FileText,
  Server,
  Database,
  RefreshCw,
  Eye,
  ArrowUpRight,
} from 'lucide-react';
import { KpiSkeleton } from '@/components/ui/KpiSkeleton';
import { DashboardSkeleton } from '@/components/ui/DashboardSkeleton';
import { AppointmentSkeleton } from '@/components/ui/AppointmentSkeleton';

/* ─── Types ─────────────────────────────────────────────────────── */
type Role = 'PATIENT' | 'DOCTOR' | 'HOSPITAL' | 'ADMIN';
type AccountStatus = 'active' | 'suspended' | 'pending';
type ApprovalStatus = 'pending' | 'approved' | 'rejected';

interface PlatformUser {
  id: string;
  name: string;
  address: string;
  role: Role;
  status: AccountStatus;
  joined: string;
  lastActive: string;
}

interface RoleRequest {
  id: string;
  name: string;
  address: string;
  requestedRole: Role;
  submittedAt: string;
  credentials?: string;
}

interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  target: string;
  timestamp: string;
  type: 'approve' | 'reject' | 'suspend' | 'activate' | 'view';
}

/* ─── Mock data ─────────────────────────────────────────────────── */
const MOCK_USERS: PlatformUser[] = [
  {
    id: '1',
    name: 'John Doe',
    address: 'GAKP...X7QM',
    role: 'PATIENT',
    status: 'active',
    joined: 'Jan 10, 2025',
    lastActive: '2h ago',
  },
  {
    id: '2',
    name: 'Dr. Sarah Smith',
    address: 'GCMR...4BNP',
    role: 'DOCTOR',
    status: 'active',
    joined: 'Dec 3, 2024',
    lastActive: '5m ago',
  },
  {
    id: '3',
    name: 'City Med Lab',
    address: 'GPX2...9KLF',
    role: 'HOSPITAL',
    status: 'active',
    joined: 'Nov 15, 2024',
    lastActive: '1d ago',
  },
  {
    id: '4',
    name: 'Maria Garcia',
    address: 'GAPH...2MQT',
    role: 'PATIENT',
    status: 'active',
    joined: 'Feb 2, 2025',
    lastActive: '30m ago',
  },
  {
    id: '5',
    name: 'Dr. James Wilson',
    address: 'GBVK...3RTQ',
    role: 'DOCTOR',
    status: 'suspended',
    joined: 'Oct 8, 2024',
    lastActive: '14d ago',
  },
  {
    id: '6',
    name: 'Sunrise Clinic',
    address: 'GCTR...7WXP',
    role: 'HOSPITAL',
    status: 'active',
    joined: 'Mar 1, 2025',
    lastActive: '3h ago',
  },
  {
    id: '7',
    name: 'Alice Chen',
    address: 'GFHM...5YZQ',
    role: 'PATIENT',
    status: 'pending',
    joined: 'Jun 25, 2025',
    lastActive: 'never',
  },
  {
    id: '8',
    name: 'Dr. Emily Park',
    address: 'GDNP...8KVL',
    role: 'DOCTOR',
    status: 'active',
    joined: 'Apr 14, 2025',
    lastActive: '1h ago',
  },
];

const MOCK_REQUESTS: RoleRequest[] = [
  {
    id: 'r1',
    name: 'Dr. Robert Lee',
    address: 'GBJQ...1XKM',
    requestedRole: 'DOCTOR',
    submittedAt: 'Jun 28, 2025',
    credentials: 'License #MD-2024-77821',
  },
  {
    id: 'r2',
    name: 'Harbor Hospital',
    address: 'GCXP...6WNT',
    requestedRole: 'HOSPITAL',
    submittedAt: 'Jun 27, 2025',
    credentials: 'Reg #HOS-2025-00143',
  },
  {
    id: 'r3',
    name: 'Dr. Nina Patel',
    address: 'GHZM...3SQR',
    requestedRole: 'DOCTOR',
    submittedAt: 'Jun 26, 2025',
    credentials: 'License #MD-2021-55290',
  },
];

const MOCK_AUDIT: AuditEntry[] = [
  {
    id: 'a1',
    action: 'Role approved',
    actor: 'Admin',
    target: 'Dr. Sarah Smith',
    timestamp: '1h ago',
    type: 'approve',
  },
  {
    id: 'a2',
    action: 'Account suspended',
    actor: 'Admin',
    target: 'Dr. James Wilson',
    timestamp: '3h ago',
    type: 'suspend',
  },
  {
    id: 'a3',
    action: 'Role rejected',
    actor: 'Admin',
    target: 'Harbor Clinic',
    timestamp: '6h ago',
    type: 'reject',
  },
  {
    id: 'a4',
    action: 'User viewed',
    actor: 'Admin',
    target: 'City Med Lab',
    timestamp: '12h ago',
    type: 'view',
  },
  {
    id: 'a5',
    action: 'Account activated',
    actor: 'Admin',
    target: 'Alice Chen',
    timestamp: '1d ago',
    type: 'activate',
  },
];

/* ─── Helpers ────────────────────────────────────────────────────── */
const roleColors: Record<Role, string> = {
  PATIENT: 'rgba(0,200,150,0.12)',
  DOCTOR: 'rgba(59,130,246,0.12)',
  HOSPITAL: 'rgba(168,85,247,0.12)',
  ADMIN: 'rgba(245,158,11,0.12)',
};
const roleTextColors: Record<Role, string> = {
  PATIENT: '#00C896',
  DOCTOR: '#60A5FA',
  HOSPITAL: '#C084FC',
  ADMIN: '#FCD34D',
};
const auditIconColor: Record<AuditEntry['type'], string> = {
  approve: '#00C896',
  reject: '#F87171',
  suspend: '#FCD34D',
  activate: '#60A5FA',
  view: '#8E9E99',
};

/* ─── Sub-components ─────────────────────────────────────────────── */
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = '#00C896',
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub: string;
  accent?: string;
}) {
  return (
    <div
      className="rounded-[14px] p-5"
      style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="flex items-start justify-between mb-4">
        <div
          className="w-8 h-8 rounded-[9px] flex items-center justify-center"
          style={{ background: `${accent}1A`, border: `1px solid ${accent}30` }}
        >
          <Icon className="w-4 h-4" style={{ color: accent }} />
        </div>
        <TrendingUp className="w-3.5 h-3.5 text-text-3" />
      </div>
      <p className="text-2xl font-bold tracking-tight text-text-1">{value}</p>
      <p className="text-xs text-text-3 mt-0.5">{label}</p>
      <p className="text-2xs text-text-3 mt-2">{sub}</p>
    </div>
  );
}

function HealthPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2.5 rounded-[9px]"
      style={{ background: 'var(--bg-inset)', border: '1px solid rgba(255,255,255,0.05)' }}
    >
      <span className="text-xs text-text-2">{label}</span>
      <div className="flex items-center gap-1.5">
        <span
          className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-500 animate-pulse-dot' : 'bg-red-500'}`}
        />
        <span className="text-2xs font-medium" style={{ color: ok ? '#00C896' : '#F87171' }}>
          {ok ? 'Operational' : 'Degraded'}
        </span>
      </div>
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────── */
function AdminDashboardContent() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [requests, setRequests] = useState<RoleRequest[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | 'ALL'>('ALL');
  const [activeTab, setActiveTab] = useState<'users' | 'approvals' | 'audit'>('users');

  const loadData = useCallback(() => {
    setLoading(true);
    setError(false);
    const timer = setTimeout(() => {
      if (Math.random() < 0.15) {
        setError(true);
        setLoading(false);
      } else {
        setUsers(MOCK_USERS);
        setRequests(MOCK_REQUESTS);
        setAudit(MOCK_AUDIT);
        setError(false);
        setLoading(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totalUsers    = users.length;
  const pendingCount  = requests.length;
  const activeCount   = users.filter(u => u.status === 'active').length;
  const suspendedCount= users.filter(u => u.status === 'suspended').length;

  const filtered = users.filter((u) => {
    const matchSearch =
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.address.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === 'ALL' || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  function toggleStatus(id: string) {
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== id) return u;
        const next: AccountStatus = u.status === 'active' ? 'suspended' : 'active';
        const action = next === 'suspended' ? 'Account suspended' : 'Account activated';
        setAudit((a) => [
          {
            id: `a${Date.now()}`,
            action,
            actor: 'Admin',
            target: u.name,
            timestamp: 'just now',
            type: next === 'suspended' ? 'suspend' : 'activate',
          },
          ...a,
        ]);
        return { ...u, status: next };
      }),
    );
  }

  function handleApproval(req: RoleRequest, decision: ApprovalStatus) {
    setRequests((prev) => prev.filter((r) => r.id !== req.id));
    const action = decision === 'approved' ? 'Role approved' : 'Role rejected';
    setAudit((prev) => [
      {
        id: `a${Date.now()}`,
        action,
        actor: 'Admin',
        target: req.name,
        timestamp: 'just now',
        type: decision === 'approved' ? 'approve' : 'reject',
      },
      ...prev,
    ]);
    if (decision === 'approved') {
      setUsers((prev) => [
        ...prev,
        {
          id: `u${Date.now()}`,
          name: req.name,
          address: req.address,
          role: req.requestedRole,
          status: 'active',
          joined: new Date().toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }),
          lastActive: 'just now',
        },
      ]);
    }
  }

  const tabs = [
    { id: 'users' as const, label: 'User Management', count: totalUsers },
    { id: 'approvals' as const, label: 'Pending Approvals', count: pendingCount },
    { id: 'audit' as const, label: 'Audit Log', count: null },
  ];

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8">
        <div>
          <p className="text-xs text-text-3 mb-1">System administration</p>
          <h1 className="text-2xl font-bold tracking-tight text-text-1">Admin Dashboard</h1>
          <div className="flex items-center gap-2 mt-2">
            <span className="badge-green">Admin</span>
            <span className="text-2xs text-text-3">Full platform access</span>
          </div>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-1.5 btn-secondary rounded-[9px] text-xs py-2 px-3.5 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ── KPI cards ────────────────────────────────────────────── */}
      {loading ? (
        <KpiSkeleton count={4} />
      ) : error ? (
        <div className="rounded-[12px] px-4 py-3.5 flex items-center justify-between gap-3 mb-6"
             style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: '#F87171' }} />
            <p className="text-sm text-text-1">Unable to load dashboard metrics. Check your network connection.</p>
          </div>
          <button
            onClick={loadData}
            className="btn-secondary rounded-[6px] text-2xs py-1.5 px-3 flex items-center gap-1 hover:bg-surface-hover transition-all"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-7">
          <StatCard
            icon={Users}
            label="Total Users"
            value={totalUsers}
            sub={`${activeCount} active`}
          />
          <StatCard
            icon={Clock}
            label="Pending Approvals"
            value={pendingCount}
            sub="Awaiting review"
            accent="#FCD34D"
          />
          <StatCard
            icon={ShieldCheck}
            label="Active Sessions"
            value={38}
            sub="Across all roles"
            accent="#60A5FA"
          />
          <StatCard
            icon={AlertTriangle}
            label="Suspended Accounts"
            value={suspendedCount}
            sub="Flagged or inactive"
            accent="#F87171"
          />
        </div>
      )}

      {/* ── Main grid ────────────────────────────────────────────── */}
      {error ? (
        <div className="py-12 flex flex-col items-center gap-2 text-center rounded-[14px]"
             style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <AlertTriangle className="w-8 h-8 mb-1" style={{ color: 'var(--text-3)' }} />
          <p className="text-sm text-text-2">Could not load admin data. The server may be unresponsive.</p>
          <button
            onClick={loadData}
            className="mt-2 btn-secondary rounded-[6px] text-2xs py-1 px-2.5 flex items-center gap-1 hover:bg-surface-hover transition-all"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-5">

        {/* Left: tabs + table */}
        <div
          className="xl:col-span-2 rounded-[14px] overflow-hidden"
          style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          {/* Tab bar */}
          <div
            className="flex items-center gap-1 px-4 pt-3 pb-0"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors relative"
                style={{
                  color: activeTab === t.id ? 'var(--text-1)' : 'var(--text-3)',
                  borderBottom: activeTab === t.id ? '2px solid #00C896' : '2px solid transparent',
                  marginBottom: '-1px',
                }}
              >
                {t.label}
                {t.count !== null && (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-2xs font-bold"
                    style={{
                      background: activeTab === t.id ? 'rgba(0,200,150,0.15)' : 'var(--bg-inset)',
                      color: activeTab === t.id ? '#00C896' : 'var(--text-3)',
                    }}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── User Management ── */}
          {activeTab === 'users' && (
            <>
              <div
                className="p-4 flex flex-col sm:flex-row gap-3"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-3" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search users..."
                    aria-label="Search users"
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-[9px] outline-none"
                    style={{
                      background: 'var(--bg-inset)',
                      border: '1px solid rgba(255,255,255,0.07)',
                      color: 'var(--text-1)',
                    }}
                  />
                </div>
                <div className="relative">
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value as Role | 'ALL')}
                    className="appearance-none pl-3 pr-8 py-2 text-xs rounded-[9px] outline-none"
                    style={{
                      background: 'var(--bg-inset)',
                      border: '1px solid rgba(255,255,255,0.07)',
                      color: 'var(--text-2)',
                    }}
                  >
                    <option value="ALL">All roles</option>
                    <option value="PATIENT">Patient</option>
                    <option value="DOCTOR">Doctor</option>
                    <option value="HOSPITAL">Hospital</option>
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-3 pointer-events-none" />
                </div>
              </div>

              {loading ? (
                <DashboardSkeleton rows={5} />
              ) : (
                <table className="data-table w-full">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th className="hidden sm:table-cell">Role</th>
                      <th className="hidden md:table-cell">Last Active</th>
                      <th>Status</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <div
                              className="w-7 h-7 rounded-full flex items-center justify-center text-2xs font-bold shrink-0"
                              style={{
                                background: roleColors[u.role],
                                color: roleTextColors[u.role],
                              }}
                            >
                              {u.name
                                .split(' ')
                                .map((n) => n[0])
                                .join('')
                                .slice(0, 2)}
                            </div>
                            <div>
                              <p className="text-xs font-medium text-text-1">{u.name}</p>
                              <p className="text-2xs font-mono text-text-3">{u.address}</p>
                            </div>
                          </div>
                        </td>
                        <td className="hidden sm:table-cell">
                          <span
                            className="text-2xs font-semibold px-2 py-0.5 rounded-full"
                            style={{
                              background: roleColors[u.role],
                              color: roleTextColors[u.role],
                            }}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="hidden md:table-cell text-xs text-text-3">{u.lastActive}</td>
                        <td>
                          {u.status === 'active' && <span className="badge-green">active</span>}
                          {u.status === 'suspended' && (
                            <span className="badge-yellow">suspended</span>
                          )}
                          {u.status === 'pending' && (
                            <span className="text-2xs text-text-3 font-medium">pending</span>
                          )}
                        </td>
                        <td>
                          <div className="flex items-center gap-1 justify-end">
                            <button className="btn-icon rounded-md w-7 h-7" title="View profile">
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => toggleStatus(u.id)}
                              className="btn-icon rounded-md w-7 h-7"
                              title={u.status === 'active' ? 'Suspend account' : 'Activate account'}
                              style={{ color: u.status === 'active' ? '#F87171' : '#00C896' }}
                            >
                              {u.status === 'active' ? (
                                <Ban className="w-3.5 h-3.5" />
                              ) : (
                                <UserCheck className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-xs text-text-3">
                          No users match your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </>
          )}

          {/* ── Pending Approvals ── */}
          {activeTab === 'approvals' &&
            (loading ? (
              <AppointmentSkeleton rows={3} />
            ) : (
              <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                {requests.length === 0 && (
                  <div className="px-5 py-10 text-center">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2" style={{ color: '#00C896' }} />
                    <p className="text-sm font-medium text-text-1">All caught up</p>
                    <p className="text-xs text-text-3 mt-1">No pending role registrations.</p>
                  </div>
                )}
                {requests.map((req) => (
                  <div
                    key={req.id}
                    className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-9 h-9 rounded-[9px] flex items-center justify-center shrink-0 mt-0.5"
                        style={{
                          background: roleColors[req.requestedRole],
                          border: `1px solid ${roleTextColors[req.requestedRole]}30`,
                        }}
                      >
                        <Users
                          className="w-4 h-4"
                          style={{ color: roleTextColors[req.requestedRole] }}
                        />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-text-1">{req.name}</p>
                        <p className="text-2xs font-mono text-text-3 mt-0.5">{req.address}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span
                            className="text-2xs font-semibold px-2 py-0.5 rounded-full"
                            style={{
                              background: roleColors[req.requestedRole],
                              color: roleTextColors[req.requestedRole],
                            }}
                          >
                            {req.requestedRole}
                          </span>
                          {req.credentials && (
                            <span className="text-2xs text-text-3">{req.credentials}</span>
                          )}
                          <span className="text-2xs text-text-3">· {req.submittedAt}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleApproval(req, 'rejected')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors"
                        style={{
                          background: 'rgba(248,113,113,0.1)',
                          color: '#F87171',
                          border: '1px solid rgba(248,113,113,0.2)',
                        }}
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Reject
                      </button>
                      <button
                        onClick={() => handleApproval(req, 'approved')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors"
                        style={{
                          background: 'rgba(0,200,150,0.1)',
                          color: '#00C896',
                          border: '1px solid rgba(0,200,150,0.2)',
                        }}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Approve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}

          {/* ── Audit Log ── */}
          {activeTab === 'audit' && (
            <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              {audit.map((entry) => (
                <div
                  key={entry.id}
                  className="px-5 py-3.5 flex items-center justify-between hover:bg-surface-hover transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        background: 'var(--bg-inset)',
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}
                    >
                      <Activity className="w-3 h-3" style={{ color: auditIconColor[entry.type] }} />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-text-1">{entry.action}</span>
                      <span className="text-sm text-text-2"> · {entry.target}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <span className="text-xs text-text-3">{entry.timestamp}</span>
                    <button className="btn-icon w-6 h-6 rounded-md">
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* System health */}
          <div
            className="rounded-[14px] p-5"
            style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-text-1">System Health</h2>
                <p className="text-xs text-text-3 mt-0.5">All services monitored</p>
              </div>
              <div
                className="flex items-center gap-1.5 text-xs font-medium"
                style={{ color: '#00C896' }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse-dot" />
                Live
              </div>
            </div>
            <div className="space-y-2">
              <HealthPill label="Stellar Network" ok={true} />
              <HealthPill label="API Gateway" ok={true} />
              <HealthPill label="Database Cluster" ok={true} />
              <HealthPill label="Auth Service" ok={true} />
              <HealthPill label="IPFS Storage" ok={false} />
            </div>

            {/* Metrics */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              {[
                { icon: Server, label: 'API Uptime', value: '99.97%' },
                { icon: Database, label: 'DB Queries', value: '12.4k/s' },
                { icon: FileText, label: 'Tx / hour', value: '847' },
                { icon: Activity, label: 'Avg Latency', value: '38ms' },
              ].map((m) => (
                <div
                  key={m.label}
                  className="rounded-[9px] p-2.5"
                  style={{
                    background: 'var(--bg-inset)',
                    border: '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  <m.icon className="w-3 h-3 text-text-3 mb-1" />
                  <p className="text-xs font-bold text-text-1">{m.value}</p>
                  <p className="text-2xs text-text-3">{m.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Role distribution */}
          <div
            className="rounded-[14px] p-5"
            style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <h2 className="text-sm font-semibold text-text-1 mb-4">Role Distribution</h2>
            {(['PATIENT', 'DOCTOR', 'HOSPITAL'] as Role[]).map((role) => {
              const count = users.filter((u) => u.role === role).length;
              const pct = Math.round((count / totalUsers) * 100);
              return (
                <div key={role} className="mb-3 last:mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-text-2">{role}</span>
                    <span className="text-xs font-semibold text-text-1">
                      {count} <span className="text-text-3 font-normal">({pct}%)</span>
                    </span>
                  </div>
                  <div
                    className="h-1.5 rounded-full overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.06)' }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: roleTextColors[role] }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick actions */}
          <div
            className="rounded-[14px] p-5"
            style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <h2 className="text-sm font-semibold text-text-1 mb-3">Quick Actions</h2>
            <div className="space-y-2">
              {[
                { icon: FileText, label: 'Export user report' },
                { icon: ShieldCheck, label: 'Run compliance check' },
                { icon: MoreHorizontal, label: 'Manage permissions' },
              ].map((a) => (
                <button
                  key={a.label}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[9px] text-xs font-medium text-text-2 transition-colors hover:text-text-1"
                  style={{
                    background: 'var(--bg-inset)',
                    border: '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  <a.icon className="w-3.5 h-3.5 text-text-3" />
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

export default function AdminDashboardPage() {
  return (
    <ProtectedRoute requiredRole="ADMIN">
      <AdminDashboardContent />
    </ProtectedRoute>
  );
}
