'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  checkContractVersion,
  type ContractVersionInfo,
} from '@/lib/sorobanContractVersioning';

export default function ContractUpgradeBanner() {
  const [versionInfo, setVersionInfo] = useState<ContractVersionInfo | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    checkContractVersion()
      .then((info) => {
        if (!cancelled) setVersionInfo(info);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!versionInfo || versionInfo.isCompatible) return null;

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 text-sm"
      style={{
        background: 'rgba(251, 191, 36, 0.1)',
        borderBottom: '1px solid rgba(251, 191, 36, 0.2)',
        color: 'rgb(251, 191, 36)',
      }}
      role="alert"
    >
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <p>
        A contract upgrade has been detected. Some actions may be temporarily
        unavailable while the system updates. Read-only access is preserved.
      </p>
    </div>
  );
}
