'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';

export default function RoleNotRegisteredPage() {
  const { clearAuth } = useAuthStore();

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] text-center px-4">
      <div className="rounded-full bg-yellow-100 p-4 mb-6">
        <svg
          className="h-10 w-10 text-yellow-600"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          />
        </svg>
      </div>

      <h1 className="text-3xl font-bold text-text-1">Role Not Registered</h1>
      <p className="mt-4 text-base text-text-2 max-w-md">
        Your wallet is connected, but no role has been assigned to it on the Heliora
        platform. Please contact the platform administrator to have your role assigned.
      </p>

      <div className="mt-8 flex flex-col sm:flex-row items-center gap-4">
        <Link
          href="/"
          onClick={clearAuth}
          className="rounded-md bg-green px-4 py-2.5 text-sm font-semibold text-[#030D09] shadow-sm hover:bg-green-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
        >
          Disconnect &amp; Go Home
        </Link>
        <a
          href="mailto:afolabiaderonke1995@gmail.com"
          className="text-sm font-semibold text-text-2 hover:text-text-1"
        >
          Contact Support
        </a>
      </div>
    </div>
  );
}
