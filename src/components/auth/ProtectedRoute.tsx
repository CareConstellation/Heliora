'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useWalletStore } from '@/store/useWalletStore';
import { useAuthStore } from '@/store/authStore';
import { queryOnChainRole, resolveRoleConflict } from '@/lib/sorobanRbac';
import { detectRoleTampering, createRoleToken } from '@/lib/roleTokenSigning';
import type { UserRole } from '@/types';

interface Props {
  requiredRole?: UserRole | UserRole[] | undefined;
  allowedRoles?: UserRole[] | undefined;
  children: React.ReactNode;
}

export default function ProtectedRoute({ requiredRole, allowedRoles, children }: Props) {
  const { publicKey, role } = useWalletStore();
  const { roleSignature, setRoleTrustLevel } = useAuthStore();
  const router = useRouter();
  const [verified, setVerified] = useState(false);
  const [resolvedRole, setResolvedRole] = useState<UserRole | null>(null);

  const isRoleAllowed = useCallback(
    (target: UserRole | null): boolean => {
      const allowedList = Array.isArray(requiredRole)
        ? requiredRole
        : allowedRoles
          ? allowedRoles
          : requiredRole
            ? [requiredRole]
            : [];
      if (allowedList.length === 0) return true;
      return !!target && allowedList.includes(target);
    },
    [requiredRole, allowedRoles],
  );

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

        if (!isRoleAllowed(resolved)) {
          router.replace('/');
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Role verification error:', err);
        setResolvedRole(role);
        setVerified(true);
        if (!isRoleAllowed(role)) {
          router.replace('/');
        }
      }
    };

    void verifyRole();

    return () => {
      cancelled = true;
    };
  }, [publicKey, role, roleSignature, requiredRole, router, setRoleTrustLevel, isRoleAllowed]);

  if (!publicKey || !verified) return null;
  if (!isRoleAllowed(resolvedRole)) return null;

  return <>{children}</>;
}
