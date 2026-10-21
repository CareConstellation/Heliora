'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWalletStore } from '@/store/useWalletStore';
import { useAuthStore } from '@/store/authStore';
import { queryOnChainRole, resolveRoleConflict } from '@/lib/sorobanRbac';
import { detectRoleTampering, serializeRoleToken, createRoleToken } from '@/lib/roleTokenSigning';
import type { UserRole } from '@/types';

interface Props {
  requiredRole: UserRole;
  children: React.ReactNode;
}

export default function ProtectedRoute({ requiredRole, children }: Props) {
  const { publicKey, role } = useWalletStore();
  const { roleSignature, setRoleTrustLevel } = useAuthStore();
  const router = useRouter();
  const [verified, setVerified] = useState(false);
  const [resolvedRole, setResolvedRole] = useState<UserRole | null>(null);

  useEffect(() => {
    if (!publicKey) {
      router.replace('/login');
      return;
    }

    let cancelled = false;

    const verifyRole = async () => {
      try {
        // Check for local storage tampering
        if (role && roleSignature) {
          const token = createRoleToken(publicKey, role);
          const serverPublicKey = process.env.NEXT_PUBLIC_ROLE_VERIFICATION_KEY || '';

          const isTampered = await detectRoleTampering(role, token, roleSignature, serverPublicKey);

          if (isTampered) {
            console.error('[SECURITY] Role tampering detected');
            setRoleTrustLevel('tampered');
            router.replace('/login');
            return;
          }
          setRoleTrustLevel('verified');
        }

        const ledgerRole = await queryOnChainRole(publicKey);
        if (cancelled) return;

        const resolved = resolveRoleConflict(role, ledgerRole);
        setResolvedRole(resolved);
        setVerified(true);

        if (resolved !== requiredRole) {
          router.replace('/');
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Role verification error:', err);
        setResolvedRole(role);
        setVerified(true);
        if (role !== requiredRole) {
          router.replace('/');
        }
      }
    };

    verifyRole();

    return () => {
      cancelled = true;
    };
  }, [publicKey, role, roleSignature, requiredRole, router, setRoleTrustLevel]);

  if (!publicKey || !verified) return null;
  if (resolvedRole !== requiredRole) return null;

  return <>{children}</>;
}
