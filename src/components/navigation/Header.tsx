'use client';

import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import { ROLE_DASHBOARD_MAP } from '@/hooks/useRoleRedirect';

/**
 * Global header with navigation links conditionally rendered by role.
 */
export function Header() {
  const { walletAddress, role, clearAuth } = useAuthStore();

  const shortAddress = walletAddress
    ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`
    : null;

  return (
    <header className="border-b border-border bg-surface-raised">
      <nav
        className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8"
        aria-label="Global"
      >
        {/* Brand */}
        <Link href="/" className="text-lg font-bold text-green hover:text-green-600">
          Heliora
        </Link>

        {/* Role-specific nav links */}
        <div className="flex items-center gap-6 text-sm font-medium text-text-1">
          {role === 'PATIENT' && (
            <>
              <Link href="/dashboard/patient" className="hover:text-green">
                My Records
              </Link>
              <Link href="/dashboard/patient" className="hover:text-green">
                Appointments
              </Link>
            </>
          )}

          {role === 'DOCTOR' && (
            <>
              <Link href="/dashboard/doctor" className="hover:text-green">
                Patients
              </Link>
              <Link href="/dashboard/doctor" className="hover:text-green">
                Consultations
              </Link>
            </>
          )}

          {role === 'HOSPITAL' && (
            <>
              <Link href="/dashboard/hospital" className="hover:text-green">
                Staff
              </Link>
              <Link href="/dashboard/hospital" className="hover:text-green">
                Departments
              </Link>
            </>
          )}

          {role === 'ADMIN' && (
            <>
              <Link href="/dashboard/admin" className="hover:text-green">
                Users
              </Link>
              <Link href="/dashboard/admin" className="hover:text-green">
                Settings
              </Link>
            </>
          )}

          {/* Dashboard shortcut for any authenticated user */}
          {role && (
            <Link
              href={ROLE_DASHBOARD_MAP[role]}
              className="rounded-md bg-green-50 px-3 py-1.5 text-green-700 hover:bg-green-100"
            >
              Dashboard
            </Link>
          )}

          {/* Auth actions */}
          {walletAddress ? (
            <button
              onClick={clearAuth}
              className="text-text-3 hover:text-red-600"
              title={walletAddress}
            >
              {shortAddress} · Disconnect
            </button>
          ) : (
            <Link
              href="/login"
              className="rounded-md bg-green px-3.5 py-2 text-[#030D09] hover:bg-green-600"
            >
              Connect Wallet
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
