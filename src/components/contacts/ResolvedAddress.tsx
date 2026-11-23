'use client';

import { useEffect, useState } from 'react';
import { StrKey } from '@stellar/stellar-sdk';
import { BadgeCheck } from 'lucide-react';
import { useContactResolver } from '@/hooks/useAddressBook';
import { contactDisplayName } from '@/lib/addressBook';
import { lookupFederationByAccount } from '@/lib/stellar';

const shorten = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * Shows a Stellar address as the patient's name for it when the address is in
 * their trusted contacts, with a badge when it is registry-verified.
 */
export default function ResolvedAddress({
  address,
  fallback,
  className = '',
}: {
  address: string;
  /** Shown instead of the shortened key for unknown addresses. */
  fallback?: string;
  className?: string;
}) {
  const { resolve } = useContactResolver();
  const contact = resolve(address);
  const [federatedAddress, setFederatedAddress] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setFederatedAddress(null);
    if (!StrKey.isValidEd25519PublicKey(address)) return;
    lookupFederationByAccount(address)
      .then((result) => {
        if (active) setFederatedAddress(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [address]);

  if (!contact) {
    return (
      <span className={`font-mono ${className}`} title={address}>
        {federatedAddress ?? fallback ?? shorten(address)}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`} title={address}>
      <span className="font-medium">{contactDisplayName(contact)}</span>
      {contact.verified && (
        <BadgeCheck
          className="w-3.5 h-3.5 shrink-0"
          style={{ color: '#00C896' }}
          aria-label="Verified provider"
        />
      )}
    </span>
  );
}
