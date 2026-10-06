'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  Activity,
  LayoutDashboard,
  FileText,
  Shield,
  Calendar,
  Clock,
  Settings,
  LogOut,
  Stethoscope,
  Users,
  Bell,
  ChevronDown,
  Hospital,
  ClipboardList,
  ShieldCheck,
  Menu,
  X,
} from 'lucide-react';
import NotificationBell from '@/components/navigation/NotificationBell';
import { useWalletStore } from '@/store/useWalletStore';
import { useAuthStore } from '@/store/authStore';
import { Avatar } from '@/components/ui/Avatar';

const patientNav = [
  { href: '/dashboard/patient', icon: LayoutDashboard, label: 'Overview' },
  { href: '/dashboard/patient/records', icon: FileText, label: 'Medical Records' },
  { href: '/dashboard/patient/access', icon: Shield, label: 'Access Control' },
  { href: '/dashboard/patient/appointments', icon: Calendar, label: 'Appointments' },
  { href: '/dashboard/patient/activity', icon: Clock, label: 'Activity Log' },
];

const doctorNav = [
  { href: '/dashboard/doctor', icon: LayoutDashboard, label: 'Overview' },
  { href: '/dashboard/doctor/patients', icon: Users, label: 'Patients' },
  { href: '/dashboard/doctor/records', icon: FileText, label: 'Records' },
  { href: '/dashboard/doctor/schedule', icon: Calendar, label: 'Schedule' },
  { href: '/dashboard/doctor/activity', icon: Clock, label: 'Activity' },
];

const hospitalNav = [
  { href: '/dashboard/hospital', icon: LayoutDashboard, label: 'Overview' },
  { href: '/dashboard/hospital/staff', icon: Users, label: 'Staff Management' },
  { href: '/dashboard/hospital/admissions', icon: ClipboardList, label: 'Admissions' },
  { href: '/dashboard/hospital/compliance', icon: ShieldCheck, label: 'Compliance' },
  { href: '/dashboard/hospital/reports', icon: FileText, label: 'Reports' },
];

function portalLabel(path: string) {
  if (path.startsWith('/dashboard/doctor')) return 'Doctor Portal';
  if (path.startsWith('/dashboard/hospital')) return 'Hospital Portal';
  return 'Patient Portal';
}

function portalIcon(path: string) {
  if (path.startsWith('/dashboard/doctor'))
    return <Stethoscope className="w-3.5 h-3.5 shrink-0" style={{ color: '#00C896' }} />;
  if (path.startsWith('/dashboard/hospital'))
    return <Hospital className="w-3.5 h-3.5 shrink-0" style={{ color: '#00C896' }} />;
  return <Activity className="w-3.5 h-3.5 shrink-0" style={{ color: '#00C896' }} />;
}

function truncateKey(key: string | null) {
  if (!key) return '···';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function NavItem({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
}) {
  return (
    <Link href={href}>
      <span
        className={active ? 'nav-item-active' : 'nav-item'}
        style={active ? { display: 'flex' } : { display: 'flex' }}
      >
        <Icon className="w-4 h-4 shrink-0" />
        {label}
      </span>
    </Link>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { publicKey, disconnect } = useWalletStore();
  const { clearAuth } = useAuthStore();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const isDoctor = pathname.startsWith('/dashboard/doctor');
  const isHospital = pathname.startsWith('/dashboard/hospital');

  const navItems = isDoctor ? doctorNav : isHospital ? hospitalNav : patientNav;

  const initials = publicKey ? publicKey.slice(0, 2).toUpperCase() : '??';

  // Close the mobile drawer on route change
  useEffect(() => {
    setMobileDrawerOpen(false);
  }, [pathname]);

  function handleDisconnect() {
    disconnect();
    clearAuth();
    router.replace('/login');
  }

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* ── Sidebar ────────────────────────────────────────────────── */}
      <aside className="sidebar hidden lg:flex">
        {/* Logo */}
        <div
          className="px-5 py-4 flex items-center justify-between shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', height: '60px' }}
        >
          <Link href="/" className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(0,200,150,0.1)', border: '1px solid rgba(0,200,150,0.2)' }}
            >
              <Activity className="w-3.5 h-3.5" style={{ color: '#00C896' }} />
            </div>
            <span className="text-sm font-bold text-text-1">
              Heli<span style={{ color: '#00C896' }}>ora</span>
            </span>
          </Link>
        </div>

        {/* Role badge */}
        <div
          className="px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-[9px]"
            style={{ background: 'rgba(0,200,150,0.07)', border: '1px solid rgba(0,200,150,0.12)' }}
          >
            {portalIcon(pathname)}
            <span className="text-xs font-semibold" style={{ color: '#00C896' }}>
              {portalLabel(pathname)}
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <p
            className="text-2xs font-bold tracking-widest uppercase px-3 mb-3"
            style={{ color: 'var(--text-3)' }}
          >
            Navigation
          </p>
          {navItems.map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={pathname === item.href}
            />
          ))}

          <div className="pt-5 mt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <p
              className="text-2xs font-bold tracking-widest uppercase px-3 mb-3"
              style={{ color: 'var(--text-3)' }}
            >
              System
            </p>
            <NavItem
              href="/dashboard/settings"
              icon={Settings}
              label="Settings"
              active={pathname === '/dashboard/settings'}
            />
          </div>
        </nav>

        {/* User footer */}
        <div
          className="px-3 py-4 shrink-0"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div
            className="flex items-center gap-3 px-3 py-2.5 rounded-[9px]"
            style={{ background: 'var(--bg-inset)' }}
          >
            <Avatar initials={initials} alt={portalLabel(pathname)} size={28} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-text-1 truncate">
                {portalLabel(pathname).replace(' Portal', '')}
              </p>
              <p className="text-2xs text-text-3 font-mono truncate">{truncateKey(publicKey)}</p>
            </div>
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-text-3" />
          </div>
          <button
            onClick={handleDisconnect}
            className="mt-2 nav-item text-sm w-full"
            style={{ color: 'var(--text-3)' }}
          >
            <LogOut className="w-3.5 h-3.5" />
            Disconnect
          </button>
        </div>
      </aside>

      {/* ── Main content ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 lg:ml-[240px]">
        {/* Top bar */}
        <div
          className="sticky top-0 z-30 px-6 flex items-center justify-between h-[60px] shrink-0"
          style={{
            background: 'rgba(11,14,13,0.85)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div className="flex items-center gap-2">
            {/* Mobile brand */}
            <Link href="/" className="lg:hidden flex items-center gap-2">
              <Activity className="w-4 h-4" style={{ color: '#00C896' }} />
              <span className="text-sm font-bold text-text-1">
                Heli<span style={{ color: '#00C896' }}>ora</span>
              </span>
            </Link>
            {/* Network pill */}
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ml-2"
              style={{
                background: 'rgba(0,200,150,0.08)',
                border: '1px solid rgba(0,200,150,0.14)',
                color: '#00C896',
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse-dot" />
              Testnet
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button className="btn-icon rounded-[9px]" aria-label="Notifications">
              <Bell className="w-4 h-4" />
            </button>
            <Avatar initials={initials} alt={portalLabel(pathname)} size={28} />
            {/* Mobile drawer toggle */}
            <button
              onClick={() => setMobileDrawerOpen(true)}
              className="lg:hidden p-2 rounded-lg text-text-2 hover:text-text-1 hover:bg-surface-inset transition-colors"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Page */}
        <main className="flex-1 p-6 lg:p-8">{children}</main>
      </div>

      {/* ── Mobile navigation drawer ────────────────────────────────── */}
      {mobileDrawerOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          onClick={() => setMobileDrawerOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" />

          {/* Drawer panel */}
          <div
            className="absolute left-0 top-0 bottom-0 w-[280px] flex flex-col overflow-y-auto animate-slide-right"
            style={{
              background: 'var(--bg-base)',
              borderRight: '1px solid rgba(255,255,255,0.06)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer header */}
            <div
              className="px-5 py-4 flex items-center justify-between shrink-0"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', height: '60px' }}
            >
              <Link href="/" className="flex items-center gap-2.5">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{
                    background: 'rgba(0,200,150,0.1)',
                    border: '1px solid rgba(0,200,150,0.2)',
                  }}
                >
                  <Activity className="w-3.5 h-3.5" style={{ color: '#00C896' }} />
                </div>
                <span className="text-sm font-bold text-text-1">
                  Heli<span style={{ color: '#00C896' }}>ora</span>
                </span>
              </Link>
              <button
                onClick={() => setMobileDrawerOpen(false)}
                className="p-1.5 rounded-lg text-text-2 hover:text-text-1 transition-colors"
                aria-label="Close navigation menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Portal indicator */}
            <div
              className="mx-3 mt-3 mb-2 px-3 py-2 rounded-[9px] flex items-center gap-2.5"
              style={{ background: 'var(--bg-inset)' }}
            >
              {portalIcon(pathname)}
              <span className="text-xs font-semibold text-text-1">{portalLabel(pathname)}</span>
            </div>

            {/* Nav items */}
            <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
              {navItems.map((item) => (
                <Link key={item.href} href={item.href} onClick={() => setMobileDrawerOpen(false)}>
                  <span
                    className={pathname === item.href ? 'nav-item-active' : 'nav-item'}
                    style={{ display: 'flex' }}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    {item.label}
                  </span>
                </Link>
              ))}
            </nav>

            {/* Drawer user footer */}
            <div
              className="px-3 py-4 shrink-0"
              style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div
                className="flex items-center gap-3 px-3 py-2.5 rounded-[9px]"
                style={{ background: 'var(--bg-inset)' }}
              >
                <Avatar initials={initials} alt={portalLabel(pathname)} size={28} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-text-1 truncate">
                    {portalLabel(pathname).replace(' Portal', '')}
                  </p>
                  <p className="text-2xs text-text-3 font-mono truncate">
                    {truncateKey(publicKey)}
                  </p>
                </div>
              </div>
              <button
                onClick={handleDisconnect}
                className="mt-2 nav-item text-sm w-full"
                style={{ color: 'var(--text-3)' }}
              >
                <LogOut className="w-3.5 h-3.5" />
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
