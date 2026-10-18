'use client';

import { useState, useCallback } from 'react';
import {
  calculateResourceSavings,
  estimateBatchRevocationFee,
  formatBatchRevocationSummary,
  type CollaboratorRevocation,
} from '@/lib/sorobanAuth';

interface Clinician {
  id: string;
  address: string;
  name: string;
  records: string[];
}

interface BatchRevokePermissionsProps {
  clinicians: Clinician[];
  contractId: string;
  ownerAddress: string;
  onRevoke?: (revocations: CollaboratorRevocation[]) => Promise<void>;
}

export default function BatchRevokePermissions({
  clinicians,
  contractId,
  ownerAddress,
  onRevoke,
}: BatchRevokePermissionsProps) {
  const [selectedClinicians, setSelectedClinicians] = useState<Set<string>>(new Set());
  const [revokeAll, setRevokeAll] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSelected = revokeAll ? new Set(clinicians.map(c => c.id)) : selectedClinicians;

  const revocations: CollaboratorRevocation[] = Array.from(effectiveSelected).map(id => {
    const clinician = clinicians.find(c => c.id === id)!;
    return {
      collaboratorId: clinician.id,
      collaboratorAddress: clinician.address,
      recordIds: clinician.records,
    };
  });

  const totalRecordCount = revocations.reduce((sum, r) => sum + r.recordIds.length, 0);
  const resourceSavings = calculateResourceSavings(revocations.length);

  const handleToggleClinician = useCallback((clinicianId: string) => {
    setSelectedClinicians(prev => {
      const next = new Set(prev);
      if (next.has(clinicianId)) {
        next.delete(clinicianId);
      } else {
        next.add(clinicianId);
      }
      return next;
    });
    setRevokeAll(false);
  }, []);

  const handleRevokeAll = useCallback(async () => {
    if (!onRevoke || revocations.length === 0) return;

    setIsLoading(true);
    setError(null);

    try {
      await onRevoke(revocations);
      setSelectedClinicians(new Set());
      setRevokeAll(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke permissions');
    } finally {
      setIsLoading(false);
    }
  }, [onRevoke, revocations]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Manage Access Permissions</h3>
      </div>

      {error && (
        <div className="p-3 bg-red-100 border border-red-300 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <label className="flex items-center gap-2 p-3 rounded border border-gray-300 cursor-pointer hover:bg-gray-50">
          <input
            type="checkbox"
            checked={revokeAll}
            onChange={e => {
              setRevokeAll(e.target.checked);
              if (e.target.checked) {
                setSelectedClinicians(new Set());
              }
            }}
            disabled={isLoading}
            className="w-4 h-4"
          />
          <div className="flex-1">
            <div className="font-medium">Revoke All External Access</div>
            <div className="text-sm text-gray-600">
              Remove all clinician and institutional access in one atomic transaction
            </div>
          </div>
        </label>

        {clinicians.length > 0 && !revokeAll && (
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium text-gray-700">Or select specific clinicians:</p>
            {clinicians.map(clinician => (
              <label
                key={clinician.id}
                className="flex items-center gap-2 p-3 rounded border border-gray-200 cursor-pointer hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={selectedClinicians.has(clinician.id)}
                  onChange={() => handleToggleClinician(clinician.id)}
                  disabled={isLoading}
                  className="w-4 h-4"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">{clinician.name}</div>
                  <div className="text-xs text-gray-600">
                    {clinician.records.length} record{clinician.records.length !== 1 ? 's' : ''} shared
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {revocations.length > 0 && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded space-y-2">
          <div className="font-medium text-sm">
            {formatBatchRevocationSummary(revocations.length, resourceSavings)}
          </div>
          <div className="text-xs text-gray-600">
            <div>
              Individual cost: {(resourceSavings.individualCost / 1e7).toFixed(4)} XLM
            </div>
            <div>
              Batch cost: {(resourceSavings.batchCost / 1e7).toFixed(4)} XLM
            </div>
          </div>
        </div>
      )}

      <button
        onClick={handleRevokeAll}
        disabled={revocations.length === 0 || isLoading}
        className="w-full px-4 py-2 bg-red-600 text-white rounded font-medium hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
      >
        {isLoading ? 'Processing...' : `Revoke ${revocations.length} Permission(s)`}
      </button>
    </div>
  );
}
