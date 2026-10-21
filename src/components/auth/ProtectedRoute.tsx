'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWalletStore } from '@/store/useWalletStore';
import { queryOnChainRole, resolveRoleConflict } from '@/lib/sorobanRbac';
import type { UserRole } from '@/types';

interface Props {
  requiredRole: UserRole;
  children: React.ReactNode;
}

export default function ProtectedRoute({ requiredRole, children }: Props) {
  const { publicKey, role } = useWalletStore();
  const router = useRouter();
  const [verified, setVerified] = useState(false);
  const [resolvedRole, setResolvedRole] = useState<UserRole | null>(null);

  useEffect(() => {
    if (!publicKey) {
      router.replace('/login');
      return;
    }

    let cancelled = false;

    queryOnChainRole(publicKey)
      .then((ledgerRole) => {
        if (cancelled) return;
        const resolved = resolveRoleConflict(role, ledgerRole);
        setResolvedRole(resolved);
        setVerified(true);

        if (resolved !== requiredRole) {
          router.replace('/');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setResolvedRole(role);
        setVerified(true);
        if (role !== requiredRole) {
          router.replace('/');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [publicKey, role, requiredRole, router]);

  if (!publicKey || !verified) return null;
  if (resolvedRole !== requiredRole) return null;

  return <>{children}</>;
}
