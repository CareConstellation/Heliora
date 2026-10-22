'use client';

import { type Doctor } from '@/types';

interface Props {
  doctor: Doctor;
  onSelect?: (doctor: Doctor) => void;
}

export default function DoctorCard({ doctor, onSelect }: Props) {
  const { resolve } = useContactResolver();
  const contact = resolve(doctor.address);

  const content = (
    <>
      <p className="font-semibold text-text-1">{doctor.name}</p>
      <p className="text-xs text-text-2">{doctor.specialty}</p>
      {contact && (
        <p className="mt-1.5 inline-flex items-center gap-1 text-2xs text-text-2">
          <BookUser className="w-3 h-3" style={{ color: '#00C896' }} />
          In your contacts as {contact.alias}
          {contact.verified && (
            <BadgeCheck
              className="w-3 h-3"
              style={{ color: '#00C896' }}
              aria-label="Verified provider"
            />
          )}
        </p>
      )}
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
