'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import AddressBookManager from '@/components/contacts/AddressBookManager';

export default function PatientContactsPage() {
  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-1">
        <Link
          href="/dashboard/patient"
          className="inline-flex items-center gap-1 text-xs font-medium transition-colors hover:text-text-1"
          style={{ color: '#00C896' }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to dashboard
        </Link>
      </div>

      <h1 className="text-2xl font-bold tracking-tight text-text-1">Trusted contacts</h1>
      <p className="text-xs text-text-3 mt-1 mb-6">
        Your personal directory of provider Stellar addresses. Saved names appear wherever you share
        records or book appointments.
      </p>

      <AddressBookManager />
    </div>
  );
}
