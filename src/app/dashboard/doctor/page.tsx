'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchDoctorPatientsPaginated } from '@/services/api.service';
import { useWalletStore } from '@/store/useWalletStore';
import {
  Users,
  FileText,
  CheckCircle2,
  Clock,
  ChevronRight,
  TrendingUp,
  PlusCircle,
  AlertCircle,
  Activity,
  Eye,
  Edit3,
  ArrowUpRight,
  Send,
  Search,
  MoreHorizontal,
  Loader2,
} from 'lucide-react';
import { KpiSkeleton } from '@/components/ui/KpiSkeleton';
import { DashboardSkeleton } from '@/components/ui/DashboardSkeleton';
import { AppointmentSkeleton } from '@/components/ui/AppointmentSkeleton';
import AvailabilityConfig from '@/components/doctor/AvailabilityConfig';
import SlotBatchPublisher from '@/components/doctor/SlotBatchPublisher';
import ResidentSupervision from '@/components/doctor/ResidentSupervision';

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
    <svg width={w} height={h} className="overflow-visible" aria-hidden="true">
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

/* ─── Data ──────────────────────────────────────────────────────── */
const kpis = [
  {
    icon: Users,
    label: 'Active Patients',
    value: '18',
    trend: 'up',
    change: '+3',
    sub: 'this week',
    spark: [10, 11, 12, 14, 14, 16, 17, 18],
  },
  {
    icon: FileText,
    label: 'Records Today',
    value: '7',
    trend: null,
    change: null,
    sub: '3 pending',
    spark: [3, 5, 4, 6, 5, 7, 6, 7],
  },
  {
    icon: CheckCircle2,
    label: 'Total Verified',
    value: '142',
    trend: 'up',
    change: '+7',
    sub: 'this month',
    spark: [120, 124, 126, 130, 134, 136, 140, 142],
  },
  {
    icon: Clock,
    label: 'Pending Actions',
    value: '4',
    trend: 'down',
    change: '−2',
    sub: '2 urgent',
    spark: [8, 7, 6, 6, 5, 5, 5, 4],
  },
];

const fallbackPatients = [
  {
    name: 'John Doe',
    initials: 'JD',
    age: 34,
    lastVisit: 'Jun 3, 2025',
    status: 'active',
    records: 24,
    addr: 'GAKP...X7QM',
  },
  {
    name: 'Jane Smith',
    initials: 'JS',
    age: 28,
    lastVisit: 'May 30, 2025',
    status: 'active',
    records: 11,
    addr: 'GCMR...4BNP',
  },
  {
    name: 'Robert Chen',
    initials: 'RC',
    age: 52,
    lastVisit: 'May 22, 2025',
    status: 'inactive',
    records: 37,
    addr: 'GPX2...9KLF',
  },
  {
    name: 'Maria Garcia',
    initials: 'MG',
    age: 41,
    lastVisit: 'May 18, 2025',
    status: 'active',
    records: 19,
    addr: 'GAPH...2MQT',
  },
  {
    name: 'David Lee',
    initials: 'DL',
    age: 67,
    lastVisit: 'May 10, 2025',
    status: 'inactive',
    records: 52,
    addr: 'GTRN...7WKS',
  },
];

const requests = [
  {
    patient: 'Sarah Brown',
    msg: 'Requesting access to 2-year history',
    time: '1h ago',
    urgent: true,
  },
  { patient: 'Tom Williams', msg: 'Lab results need verification', time: '3h ago', urgent: false },
];

const schedule = [
  { time: '9:00 AM', patient: 'John Doe', type: 'Follow-up', done: true },
  { time: '10:30 AM', patient: 'Jane Smith', type: 'Consultation', done: false, current: true },
  { time: '2:00 PM', patient: 'New Patient', type: 'Initial Visit', done: false },
  { time: '4:00 PM', patient: 'Maria G.', type: 'Check-up', done: false },
];

const recentActivity = [
  { action: 'Added Blood Test Results', patient: 'John Doe', time: '2h ago', type: 'write' },
  { action: 'Viewed MRI Report', patient: 'Jane Smith', time: '4h ago', type: 'read' },
  { action: 'Updated Prescription', patient: 'Maria Garcia', time: '1d ago', type: 'update' },
  { action: 'Requested Access', patient: 'Robert Chen', time: '1d ago', type: 'request' },
];

const typeColor: Record<string, string> = {
  write: '#00C896',
  read: '#8E9E99',
  update: '#60A5FA',
  request: '#EAB308',
};

export default function DoctorDashboard() {
  const { publicKey } = useWalletStore();

  const {
    data: patientsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: patientsLoading,
  } = useInfiniteQuery({
    queryKey: ['doctor-patients-paginated', publicKey],
    queryFn: ({ pageParam }) => fetchDoctorPatientsPaginated(publicKey!, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!publicKey,
  });

  const patients = patientsData ? patientsData.pages.flatMap((p) => p.data) : fallbackPatients;

  const totalPatients = patientsData?.pages[0]?.total ?? patients.length;

  return (
    <div>
      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8">
        <div>
          <p className="text-xs text-text-3 mb-1">Doctor Dashboard</p>
          <h1 className="text-2xl font-bold tracking-tight text-text-1">Dr. Sarah Smith</h1>
          <div className="flex items-center gap-2 mt-2">
            <span className="badge-green">Verified Doctor</span>
            <span className="badge-muted">General Practitioner</span>
            <span className="text-2xs text-text-3 font-mono hidden sm:block">GDOC...9KRT</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button className="btn-secondary rounded-[9px] text-xs py-2 px-3.5">
            <Send className="w-3.5 h-3.5" />
            Request Access
          </button>
          <button className="btn-primary rounded-[9px] text-xs py-2 px-3.5">
            <PlusCircle className="w-3.5 h-3.5" />
            New Record
          </button>
        </div>
      </div>

      {/* ── Resident supervision / delegated proxy mode (#118) ───── */}
      <div className="mb-6">
        <ResidentSupervision />
      </div>

      {/* ── Urgent alert ─────────────────────────────────────────── */}
      {requests.some((r) => r.urgent) && (
        <div
          className="rounded-[12px] px-4 py-3.5 flex items-center gap-3 mb-6"
          style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}
        >
          <AlertCircle className="w-4 h-4 shrink-0" style={{ color: '#F87171' }} />
          <div className="flex-1">
            <p className="text-sm font-semibold text-text-1">
              Urgent: Access request from Sarah Brown
            </p>
            <p className="text-xs text-text-2 mt-0.5">
              Requesting access to 2-year patient history · 1h ago
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button className="btn-primary rounded-[8px] text-xs py-1.5 px-3">Approve</button>
            <button
              className="btn-ghost rounded-[8px] text-xs py-1.5 px-3 border"
              style={{ borderColor: 'rgba(255,255,255,0.08)' }}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {/* ── KPI cards ────────────────────────────────────────────── */}
      {patientsLoading ? (
        <KpiSkeleton count={4} />
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

      {/* ── Main grid ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-5">
        {/* Patients table */}
        <div
          className="xl:col-span-2 rounded-[14px] overflow-hidden"
          style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div
            className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div>
              <h2 className="text-sm font-semibold text-text-1">My Patients</h2>
              <p className="text-xs text-text-3 mt-0.5">
                {totalPatients} total · {patients.length} loaded
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-text-3 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input placeholder="Search patients…" className="input text-xs py-1.5 pl-8 w-40" />
              </div>
            </div>
          </div>

          {patientsLoading ? (
            <DashboardSkeleton rows={5} />
          ) : (
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th className="hidden sm:table-cell">Age</th>
                  <th className="hidden md:table-cell">Records</th>
                  <th>Last Visit</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((p, i) => (
                  <tr key={i}>
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
                          {p.initials}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-text-1">{p.name}</p>
                          <p className="text-2xs font-mono text-text-3 hidden sm:block">{p.addr}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell text-xs text-text-2">{p.age}</td>
                    <td className="hidden md:table-cell text-xs text-text-2">{p.records}</td>
                    <td className="text-xs text-text-2 whitespace-nowrap">{p.lastVisit}</td>
                    <td>
                      {p.status === 'active' ? (
                        <span className="badge-green">active</span>
                      ) : (
                        <span className="badge-muted">inactive</span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-1 justify-end">
                        <button className="btn-icon w-7 h-7 rounded-md" aria-label="View patient">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button className="btn-icon w-7 h-7 rounded-md" aria-label="Edit patient">
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button className="btn-icon w-7 h-7 rounded-md" aria-label="More options">
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {hasNextPage && (
            <div
              className="px-5 py-3 flex justify-center"
              style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
            >
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="flex items-center gap-2 text-xs font-medium transition-colors hover:text-text-1 disabled:opacity-50"
                style={{ color: '#00C896' }}
              >
                {isFetchingNextPage ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                  </>
                ) : (
                  'Load more patients'
                )}
              </button>
            </div>
          )}

          <div className="px-5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <Link
              href="/dashboard/doctor/patients"
              className="flex items-center gap-1 text-xs font-medium transition-colors hover:text-text-1"
              style={{ color: '#00C896' }}
            >
              View all patients <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Pending requests */}
          <div
            className="rounded-[14px] p-5"
            style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-text-1">Pending Requests</h2>
              <span className="badge-red">{requests.length}</span>
            </div>
            <div className="space-y-2.5">
              {requests.map((req, i) => (
                <div
                  key={i}
                  className="rounded-[10px] p-3.5"
                  style={{
                    background: req.urgent ? 'rgba(239,68,68,0.06)' : 'var(--bg-inset)',
                    border: `1px solid ${req.urgent ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)'}`,
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-text-1">{req.patient}</p>
                    <span className="text-2xs text-text-3">{req.time}</span>
                  </div>
                  <p className="text-2xs text-text-2 mb-2.5 leading-relaxed">{req.msg}</p>
                  <div className="flex gap-2">
                    <button
                      className="text-2xs font-semibold px-2.5 py-1 rounded-md transition-colors"
                      style={{
                        background: 'rgba(0,200,150,0.1)',
                        color: '#00C896',
                        border: '1px solid rgba(0,200,150,0.2)',
                      }}
                    >
                      Approve
                    </button>
                    <button
                      className="text-2xs font-medium px-2.5 py-1 rounded-md transition-colors text-text-3 hover:text-text-1"
                      style={{
                        background: 'var(--bg-card)',
                        border: '1px solid rgba(255,255,255,0.07)',
                      }}
                    >
                      View
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Today's schedule */}
          <div
            className="rounded-[14px] p-5"
            style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-text-1">Today&apos;s Schedule</h2>
              <span className="text-xs text-text-3">Jun 4, 2025</span>
            </div>
            <div className="space-y-2">
              {patientsLoading ? (
                <AppointmentSkeleton rows={3} />
              ) : (
                schedule.map((slot, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-2xs font-mono text-text-3 w-14 shrink-0 text-right">
                      {slot.time}
                    </span>
                    <div
                      className="w-px self-stretch"
                      style={{ background: slot.current ? '#00C896' : 'rgba(255,255,255,0.08)' }}
                    />
                    <div
                      className="flex-1 p-2.5 rounded-[9px]"
                      style={{
                        background: slot.current ? 'rgba(0,200,150,0.08)' : 'var(--bg-inset)',
                        border: `1px solid ${slot.current ? 'rgba(0,200,150,0.2)' : 'rgba(255,255,255,0.05)'}`,
                      }}
                    >
                      <p
                        className="text-xs font-medium"
                        style={{
                          color: slot.done ? 'var(--text-3)' : 'var(--text-1)',
                          textDecoration: slot.done ? 'line-through' : 'none',
                        }}
                      >
                        {slot.patient}
                      </p>
                      <p className="text-2xs text-text-3">{slot.type}</p>
                    </div>
                    {slot.current && <span className="badge-green shrink-0 text-2xs">now</span>}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Availability & Buffer Config (Issue #51) */}
          <AvailabilityConfig />

          {/* Slot Batch Publisher (Issue #20) */}
          <SlotBatchPublisher slots={[]} />
        </div>
      </div>

      {/* ── Recent activity ────────────────────────────────────────── */}
      <div
        className="rounded-[14px] overflow-hidden"
        style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div>
            <h2 className="text-sm font-semibold text-text-1">Recent Activity</h2>
            <p className="text-xs text-text-3 mt-0.5">All actions recorded on Stellar</p>
          </div>
          <div
            className="flex items-center gap-1.5 text-xs font-medium"
            style={{ color: '#00C896' }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse-dot" />
            Live
          </div>
        </div>
        <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          {recentActivity.map((ev, i) => (
            <div
              key={i}
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
                  <Activity className="w-3 h-3" style={{ color: typeColor[ev.type] }} />
                </div>
                <div>
                  <span className="text-sm font-medium text-text-1">{ev.action}</span>
                  <span className="text-sm text-text-2"> · {ev.patient}</span>
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0 ml-4">
                <span className="text-xs text-text-3">{ev.time}</span>
                <button
                  className="btn-icon w-6 h-6 rounded-md"
                  aria-label="View on-chain transaction"
                >
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
