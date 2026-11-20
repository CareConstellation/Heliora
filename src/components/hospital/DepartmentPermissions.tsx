'use client';

import { useEffect, useState } from 'react';
import type { StaffMember } from '@/types';

type Permission = { canPrescribe: boolean; canAdmit: boolean; canDischarge: boolean };
type Policy = Record<string, Permission>;
const initial: Policy = { Cardiology: { canPrescribe: true, canAdmit: true, canDischarge: false }, Radiology: { canPrescribe: false, canAdmit: false, canDischarge: false }, Oncology: { canPrescribe: true, canAdmit: true, canDischarge: true } };

export default function DepartmentPermissions({ staff }: { staff: StaffMember[] }) {
  const [policy, setPolicy] = useState<Policy>(() => {
    if (typeof window === 'undefined') return initial;
    try { return JSON.parse(localStorage.getItem('heliora-department-policy') ?? 'null') ?? initial; } catch { return initial; }
  });
  const update = (department: string, key: keyof Permission, value: boolean) => setPolicy((current) => ({ ...current, [department]: { ...current[department], [key]: value } }));
  useEffect(() => { localStorage.setItem('heliora-department-policy', JSON.stringify(policy)); }, [policy]);
  return <div className="rounded-[14px] p-5" style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,.07)' }}><h2 className="text-sm font-semibold text-text-1">Department permissions</h2><p className="text-xs text-text-3 mt-1">Assign staff and stage granular department policies. Changes are recorded locally until the policy API is enabled.</p><div className="grid lg:grid-cols-3 gap-3 mt-4">{Object.entries(policy).map(([department, permissions]) => <div key={department} className="rounded-[10px] p-3" style={{ background: 'var(--bg-inset)' }}><h3 className="text-xs font-semibold text-text-1">{department}</h3><p className="text-2xs text-text-3 mt-1">{staff.filter((member) => member.department === department).length} staff assigned</p>{(['canPrescribe', 'canAdmit', 'canDischarge'] as const).map((key) => <label key={key} className="flex items-center justify-between text-xs text-text-2 mt-3"><span>{key.replace('can', 'Can ')}</span><input type="checkbox" checked={permissions[key]} onChange={(e) => update(department, key, e.target.checked)} /></label>)}</div>)}</div></div>;
}
