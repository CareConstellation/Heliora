'use client';

import { type Doctor } from '@/types';

interface Props {
  doctor: Doctor;
  onSelect?: (doctor: Doctor) => void;
}

export default function DoctorCard({ doctor, onSelect }: Props) {
  const content = (
    <>
      <p className="font-semibold text-text-1">{doctor.name}</p>
      <p className="text-xs text-text-2">{doctor.specialty}</p>
    </>
  );

  if (onSelect) {
    return (
      <button
        onClick={() => onSelect(doctor)}
        className="text-left w-full rounded-xl border border-border bg-surface-card p-4 hover:border-green hover:shadow-card transition-all"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface-card p-4 transition-all">
      {content}
    </div>
  );
}
