import Link from 'next/link';
import {
  ShieldCheck,
  Zap,
  Globe2,
  Lock,
  FileText,
  Users,
  ArrowRight,
  CheckCircle2,
  Activity,
  Stethoscope,
  Hospital,
  User,
  ChevronRight,
  Server,
} from 'lucide-react';

/* ─── Data ─────────────────────────────────────────────────────────── */
const features = [
  {
    icon: ShieldCheck,
    title: 'Sovereign Data Ownership',
    description:
      'Patients fully own their medical data. No third-party can access, sell, or modify records without explicit on-chain consent.',
  },
  {
    icon: Lock,
    title: 'End-to-End Encryption',
    description:
      'Records are cryptographically secured. Only parties holding the correct keys can decrypt and read sensitive health data.',
  },
  {
    icon: Zap,
    title: 'Instant Finality',
    description:
      "Stellar's 3–5 second settlement ensures instant credential verification and real-time access grants across the network.",
  },
  {
    icon: Globe2,
    title: 'Global Interoperability',
    description:
      'Share records across hospitals and specialists worldwide — no fax machines, no manual paperwork, no re-keying data.',
  },
  {
    icon: FileText,
    title: 'Immutable Audit Trail',
    description:
      'Every access event is permanently recorded on-chain. Full transparency into who viewed or modified your data and when.',
  },
  {
    icon: Users,
    title: 'Role-Based Access Control',
    description:
      'Granular permissions for patients, doctors, hospitals, and admins. Time-limited grants revocable at any moment.',
  },
];

const stats = [
  { value: '3–5s', label: 'Transaction Finality', sub: 'On Stellar Network' },
  { value: '100%', label: 'Data Sovereignty', sub: 'Patient-Controlled' },
  { value: '$0.00001', label: 'Cost Per Operation', sub: 'Near-Zero Fees' },
  { value: '99.99%', label: 'Network Uptime', sub: 'Stellar Guarantee' },
];

const steps = [
  {
    n: '01',
    title: 'Connect Your Wallet',
    body: 'Link Freighter, xBull, or LOBSTR to create your sovereign identity. No email, no password.',
  },
  {
    n: '02',
    title: 'Choose Your Role',
    body: 'Register as Patient, Doctor, or Hospital. Your role shapes your dashboard and capabilities.',
  },
  {
    n: '03',
    title: 'Manage Records Securely',
    body: 'Upload, share, and control medical records. Grant time-limited access to any provider.',
  },
  {
    n: '04',
    title: 'Verify Everything On-Chain',
    body: 'Every action is recorded on Stellar. Audit your complete history with cryptographic proof.',
  },
];

const roles = [
  {
    icon: User,
    title: 'Patient',
    description:
      'Own and control your complete medical history. Share records with providers exactly on your terms.',
    items: [
      'View & download records',
      'Grant / revoke access',
      'Track access history',
      'Manage appointments',
    ],
    href: '/login?role=patient',
  },
  {
    icon: Stethoscope,
    title: 'Doctor',
    description:
      'Access authorized patient records securely. Update diagnoses and treatment plans in real-time.',
    items: [
      'View authorized records',
      'Add diagnoses & notes',
      'Request access',
      'Patient scheduling',
    ],
    href: '/login?role=doctor',
  },
  {
    icon: Hospital,
    title: 'Hospital',
    description:
      "Manage your institution's medical data pipeline with enterprise-grade access controls.",
    items: [
      'Department permissions',
      'Staff credentials',
      'Compliance reporting',
      'Bulk management',
    ],
    href: '/login?role=hospital',
  },
];

/* ─── Hero mock dashboard (pure JSX) ──────────────────────────────── */
function MockDashboard() {
  return (
    <div
      className="w-full rounded-xl overflow-hidden text-left shadow-card-lg"
      aria-hidden="true"
      style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: '#FF5F57' }} />
          <div className="w-2 h-2 rounded-full" style={{ background: '#FFBD2E' }} />
          <div className="w-2 h-2 rounded-full" style={{ background: '#28C840' }} />
        </div>
        <div
          className="flex items-center gap-1.5 text-xs font-mono"
          style={{ color: 'var(--text-3)' }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse-dot" />
          Stellar Testnet
        </div>
        <div className="flex gap-1">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="w-5 h-1.5 rounded-full"
              style={{ background: 'var(--bg-inset)' }}
            />
          ))}
        </div>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <div
          className="w-32 shrink-0 py-3 px-2.5 space-y-0.5"
          style={{
            background: 'var(--bg-raised)',
            borderRight: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <div
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md mb-2"
            style={{ background: 'rgba(0,200,150,0.1)', borderLeft: '2px solid #00C896' }}
          >
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: '#00C896' }} />
            <span className="text-[10px] font-semibold" style={{ color: '#00C896' }}>
              Overview
            </span>
          </div>
          {['Records', 'Access', 'Calendar', 'Activity'].map((item) => (
            <div key={item} className="flex items-center gap-1.5 px-2 py-1.5 rounded-md">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--bg-inset)' }} />
              <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                {item}
              </span>
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 p-3">
          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { label: 'Records', val: '24', up: true },
              { label: 'Doctors', val: '3', up: null },
              { label: 'Access', val: '7', up: false },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-lg p-2"
                style={{
                  background: 'var(--bg-raised)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <p className="text-[11px] font-bold text-white">{s.val}</p>
                <p className="text-[9px]" style={{ color: 'var(--text-3)' }}>
                  {s.label}
                </p>
                <div className="mt-1 flex gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <div
                      key={i}
                      className="rounded-sm flex-1"
                      style={{
                        height: `${4 + Math.sin(i * 1.3 + (s.val === '24' ? 0 : 1)) * 3}px`,
                        background:
                          s.up === true
                            ? 'rgba(0,200,150,0.5)'
                            : s.up === false
                              ? 'rgba(239,68,68,0.4)'
                              : 'rgba(255,255,255,0.1)',
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Records list */}
          <div
            className="rounded-lg overflow-hidden"
            style={{ border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div
              className="px-3 py-2 flex items-center justify-between"
              style={{
                background: 'var(--bg-raised)',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <span className="text-[10px] font-semibold text-white">Recent Records</span>
              <div className="badge-green text-[9px] px-1.5 py-0.5">4 verified</div>
            </div>
            {[
              { type: 'Blood Test Results', doc: 'Dr. Smith', status: 'verified' },
              { type: 'MRI Scan Report', doc: 'Dr. Wilson', status: 'verified' },
              { type: 'Prescription', doc: 'Dr. Smith', status: 'pending' },
            ].map((r, i) => (
              <div
                key={i}
                className="px-3 py-2 flex items-center justify-between"
                style={{
                  background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                  borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                }}
              >
                <div>
                  <p className="text-[10px] font-medium text-white">{r.type}</p>
                  <p className="text-[9px]" style={{ color: 'var(--text-3)' }}>
                    {r.doc}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: r.status === 'verified' ? '#00C896' : '#EAB308' }}
                  />
                  <span
                    className="text-[9px]"
                    style={{ color: r.status === 'verified' ? '#00C896' : '#EAB308' }}
                  >
                    {r.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div
        className="px-4 py-2 flex items-center gap-3"
        style={{ background: 'var(--bg-raised)', borderTop: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-3)' }}>
          <Server className="w-2.5 h-2.5" />
          Block #9,482,113
        </div>
        <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
        <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>
          GAKP...X7QM
        </span>
      </div>
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────── */
export default function HomePage() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative pt-28 pb-20 overflow-hidden">
        <div className="absolute inset-0 dot-grid opacity-40 pointer-events-none" />
        <div className="absolute inset-0 hero-gradient pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-5 sm:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left: text */}
            <div>
              <div className="badge-green mb-5 inline-flex items-center gap-1.5">
                <Activity className="w-3 h-3" />
                Powered by Stellar Blockchain
              </div>

              <h1 className="text-[2.75rem] sm:text-5xl lg:text-[3.5rem] font-bold leading-[1.08] tracking-[-0.02em] text-text-1 mb-5">
                Healthcare data
                <br />
                <span style={{ color: '#00C896' }}>owned by you.</span>
              </h1>

              <p className="text-base sm:text-lg text-text-2 leading-relaxed mb-8 max-w-lg">
                A decentralized platform for patients and clinicians to manage medical records with
                complete sovereignty — secured by cryptography on the Stellar network.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 mb-10">
                <Link href="/login" className="btn-primary rounded-[10px] px-6 py-3 text-sm">
                  Get Started Free
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="/#how-it-works"
                  className="btn-ghost rounded-[10px] px-6 py-3 text-sm border"
                  style={{ borderColor: 'rgba(255,255,255,0.08)' }}
                >
                  See How It Works
                </Link>
              </div>

              {/* Trust badges */}
              <div className="flex flex-wrap gap-5">
                {['HIPAA Compliant', 'Non-Custodial', 'Open Source', 'Audited'].map((badge) => (
                  <div key={badge} className="flex items-center gap-1.5 text-sm text-text-2">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: '#00C896' }} />
                    {badge}
                  </div>
                ))}
              </div>
            </div>

            {/* Right: mock dashboard */}
            <div className="relative">
              <div
                className="absolute -inset-8 rounded-full blur-3xl pointer-events-none"
                style={{
                  background: 'radial-gradient(ellipse, rgba(0,200,150,0.08) 0%, transparent 70%)',
                }}
              />
              <div className="relative">
                <MockDashboard />
                {/* Floating badge */}
                <div
                  className="absolute -left-4 bottom-12 rounded-xl px-3 py-2.5 shadow-card-lg hidden sm:block"
                  style={{ background: 'var(--bg-card)', border: '1px solid rgba(0,200,150,0.2)' }}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-6 h-6 rounded-lg flex items-center justify-center"
                      style={{ background: 'rgba(0,200,150,0.12)' }}
                    >
                      <ShieldCheck className="w-3.5 h-3.5" style={{ color: '#00C896' }} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-text-1">Verified On-Chain</p>
                      <p className="text-2xs text-text-3">Block #9,482,113</p>
                    </div>
                  </div>
                </div>
                {/* Floating badge 2 */}
                <div
                  className="absolute -right-4 top-10 rounded-xl px-3 py-2.5 shadow-card-lg hidden sm:block"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-6 h-6 rounded-lg flex items-center justify-center"
                      style={{ background: 'rgba(0,200,150,0.12)' }}
                    >
                      <Zap className="w-3.5 h-3.5" style={{ color: '#00C896' }} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-text-1">3s Settlement</p>
                      <p className="text-2xs text-text-3">Zero downtime</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats ────────────────────────────────────────────────────── */}
      <section
        id="stats"
        className="py-12"
        style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'var(--bg-raised)',
        }}
      >
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          <div
            className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0"
            style={
              {
                '--tw-divide-opacity': '1',
                borderColor: 'rgba(255,255,255,0.06)',
              } as React.CSSProperties
            }
          >
            {stats.map((s, i) => (
              <div key={i} className="px-6 lg:px-10 py-8 text-center">
                <p
                  className="text-3xl sm:text-4xl font-bold tracking-tight mb-1"
                  style={{ color: '#00C896' }}
                >
                  {s.value}
                </p>
                <p className="text-sm font-semibold text-text-1 mb-0.5">{s.label}</p>
                <p className="text-xs text-text-3">{s.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section id="features" className="py-24 px-5 sm:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-2xl mb-16">
            <p className="eyebrow mb-3">Platform</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-text-1 mb-4">
              Built for modern healthcare infrastructure
            </h2>
            <p className="text-text-2 text-base leading-relaxed">
              Every feature is designed around patient sovereignty and clinical efficiency, backed
              by the security guarantees of the Stellar blockchain.
            </p>
          </div>

          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px"
            style={{
              background: 'rgba(255,255,255,0.06)',
              borderRadius: '14px',
              overflow: 'hidden',
            }}
          >
            {features.map((f, i) => (
              <div key={i} className="hover-inset group p-7">
                <div
                  className="w-10 h-10 rounded-[10px] flex items-center justify-center mb-5"
                  style={{
                    background: 'rgba(0,200,150,0.1)',
                    border: '1px solid rgba(0,200,150,0.15)',
                  }}
                >
                  <f.icon className="w-5 h-5" style={{ color: '#00C896' }} />
                </div>
                <h3 className="text-base font-semibold text-text-1 mb-2">{f.title}</h3>
                <p className="text-sm text-text-2 leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section
        id="how-it-works"
        className="py-24 px-5 sm:px-8"
        style={{
          background: 'var(--bg-raised)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-xl mx-auto mb-16">
            <p className="eyebrow mb-3">Get Started</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-text-1 mb-4">
              Up and running in under two minutes
            </h2>
            <p className="text-text-2 text-base">
              No signup forms. No passwords. Your wallet is your identity on the Stellar network.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {steps.map((step, i) => (
              <div
                key={i}
                className="relative p-6 rounded-[14px]"
                style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
              >
                {/* Step connector */}
                {i < steps.length - 1 && (
                  <div
                    className="hidden lg:block absolute top-[52px] left-full w-5 h-px z-10"
                    style={{
                      background: 'linear-gradient(to right, rgba(0,200,150,0.3), transparent)',
                    }}
                  />
                )}
                <div
                  className="text-xs font-bold font-mono mb-4 opacity-50"
                  style={{ color: '#00C896' }}
                >
                  {step.n}
                </div>
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center mb-4"
                  style={{
                    background: 'rgba(0,200,150,0.08)',
                    border: '1px solid rgba(0,200,150,0.12)',
                  }}
                >
                  <div className="w-2 h-2 rounded-full" style={{ background: '#00C896' }} />
                </div>
                <h3 className="text-sm font-semibold text-text-1 mb-2">{step.title}</h3>
                <p className="text-sm text-text-2 leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Roles ────────────────────────────────────────────────────── */}
      <section className="py-24 px-5 sm:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-xl mx-auto mb-16">
            <p className="eyebrow mb-3">Access Levels</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-text-1 mb-4">
              Designed for every stakeholder
            </h2>
            <p className="text-text-2 text-base">
              Whether you are a patient, clinician, or institution, Heliora has role-specific
              tools built for your workflow.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {roles.map((role, i) => (
              <div
                key={i}
                className="flex flex-col rounded-[14px] p-7"
                style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
              >
                <div
                  className="w-11 h-11 rounded-[12px] flex items-center justify-center mb-6"
                  style={{
                    background: 'rgba(0,200,150,0.1)',
                    border: '1px solid rgba(0,200,150,0.15)',
                  }}
                >
                  <role.icon className="w-5 h-5" style={{ color: '#00C896' }} />
                </div>
                <h3 className="text-lg font-bold text-text-1 mb-2">{role.title}</h3>
                <p className="text-sm text-text-2 leading-relaxed mb-6">{role.description}</p>
                <ul className="space-y-2.5 mb-8 flex-1">
                  {role.items.map((item) => (
                    <li key={item} className="flex items-center gap-2.5 text-sm text-text-2">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: '#00C896' }} />
                      {item}
                    </li>
                  ))}
                </ul>
                <Link
                  href={role.href}
                  className="btn-secondary justify-center rounded-[10px] text-sm py-2.5"
                >
                  Get started as {role.title}
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────── */}
      <section
        className="py-20 px-5 sm:px-8"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="max-w-3xl mx-auto text-center">
          <div
            className="relative rounded-2xl p-12 overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '1px solid rgba(0,200,150,0.15)' }}
          >
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(0,200,150,0.07) 0%, transparent 60%)',
              }}
            />
            <div className="relative">
              <p className="eyebrow mb-4">Join the Network</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-text-1 mb-4">
                Take control of your health data today
              </h2>
              <p className="text-text-2 text-base leading-relaxed mb-8 max-w-md mx-auto">
                Connect your Stellar wallet and experience decentralized healthcare — no accounts,
                no passwords, no middlemen.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link
                  href="/login"
                  className="btn-primary rounded-[10px] px-7 py-3 text-sm w-full sm:w-auto"
                >
                  Launch App <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="/docs"
                  className="btn-ghost rounded-[10px] px-7 py-3 text-sm border w-full sm:w-auto"
                  style={{ borderColor: 'rgba(255,255,255,0.08)' }}
                >
                  Read the Docs
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
