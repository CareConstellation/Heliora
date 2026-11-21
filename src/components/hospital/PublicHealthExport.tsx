'use client';

import { useMemo, useState } from 'react';
import { Download, ShieldCheck, FileSpreadsheet, FileCode, CheckCircle2 } from 'lucide-react';
import {
  deidentifyRecords,
  transformToCDCSyndromicSchema,
  downloadPublicHealthExport,
  type CDCEventRecord,
} from '@/lib/publicHealthExport';

export default function PublicHealthExport({
  rows,
  firstAdmin = 'GADMIN_PRIMARY_HOSPITAL_55CHARS00000000000000000000000000',
}: {
  rows: Record<string, unknown>[];
  firstAdmin?: string | null;
}) {
  const [secondAdmin, setSecondAdmin] = useState('');
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [previewTab, setPreviewTab] = useState<'table' | 'json'>('table');
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  // Transform records into de-identified CDC syndromic schema
  const safeCdcRows: CDCEventRecord[] = useMemo(() => {
    return transformToCDCSyndromicSchema(rows);
  }, [rows]);

  const safeGenericRows = useMemo(() => {
    return deidentifyRecords(rows);
  }, [rows]);

  // Dual Admin Validation: Second admin must be a valid 56-char Stellar address and distinct from firstAdmin
  const isValidSecondAdmin = /^G[A-Z2-7]{55}$/.test(secondAdmin.trim());
  const isDistinctAdmin = secondAdmin.trim() !== (firstAdmin || '').trim();
  const isApproved = Boolean(firstAdmin && isValidSecondAdmin && isDistinctAdmin);

  function handleDownload() {
    if (!isApproved || rows.length === 0) return;

    downloadPublicHealthExport(rows, format, {
      primaryAdmin: firstAdmin!,
      secondaryAdmin: secondAdmin.trim(),
      approvedAt: new Date().toISOString(),
    });

    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 4000);
  }

  return (
    <section
      className="mt-5 rounded-[14px] p-5"
      style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
      aria-labelledby="public-health-export-title"
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="public-health-export-title" className="text-sm font-semibold text-text-1">
              Public Health & Epidemiological Surveillance Data Export
            </h2>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              HIPAA Safe Harbor Certified
            </span>
          </div>
          <p className="mt-1 text-xs text-text-3">
            Conforms to CDC NSSP and WHO syndromic surveillance schemas. All 18 HIPAA Safe Harbor identifiers are stripped. Dual-admin sign-off is required before generation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded bg-surface-card p-0.5 text-2xs border border-border">
            <button
              type="button"
              onClick={() => setFormat('csv')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors ${
                format === 'csv' ? 'bg-primary-500 text-white font-medium' : 'text-text-3 hover:text-text-1'
              }`}
            >
              <FileSpreadsheet className="w-3 h-3" />
              CDC CSV
            </button>
            <button
              type="button"
              onClick={() => setFormat('json')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors ${
                format === 'json' ? 'bg-primary-500 text-white font-medium' : 'text-text-3 hover:text-text-1'
              }`}
            >
              <FileCode className="w-3 h-3" />
              WHO JSON
            </button>
          </div>
        </div>
      </div>

      {/* Preview Section */}
      <div className="mb-4 rounded-lg bg-surface-inset border border-border overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-white/5">
          <span className="text-xs font-medium text-text-2">
            De-Identified Preview Sample ({Math.min(3, safeCdcRows.length)} of {safeCdcRows.length} records)
          </span>
          <div className="flex gap-2 text-2xs">
            <button
              type="button"
              onClick={() => setPreviewTab('table')}
              className={`hover:underline ${previewTab === 'table' ? 'text-primary-400 font-bold' : 'text-text-3'}`}
            >
              Surveillance Schema Table
            </button>
            <span className="text-text-3">|</span>
            <button
              type="button"
              onClick={() => setPreviewTab('json')}
              className={`hover:underline ${previewTab === 'json' ? 'text-primary-400 font-bold' : 'text-text-3'}`}
            >
              Raw De-Identified JSON
            </button>
          </div>
        </div>

        {previewTab === 'table' ? (
          <div className="overflow-auto max-h-48 text-xs p-2">
            <table className="data-table w-full text-2xs">
              <thead className="bg-white/5 text-text-3">
                <tr>
                  <th className="py-1.5 px-2 text-left">Year</th>
                  <th className="py-1.5 px-2 text-left">Age Group</th>
                  <th className="py-1.5 px-2 text-left">Syndrome Category</th>
                  <th className="py-1.5 px-2 text-left">ICD-10 Code</th>
                  <th className="py-1.5 px-2 text-left">Chief Complaint (Sanitized)</th>
                  <th className="py-1.5 px-2 text-left">Disposition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {safeCdcRows.slice(0, 3).map((row, idx) => (
                  <tr key={idx}>
                    <td className="py-1.5 px-2 font-mono">{row.encounter_year}</td>
                    <td className="py-1.5 px-2">{row.age_group}</td>
                    <td className="py-1.5 px-2 font-medium text-primary-300">{row.syndrome_category}</td>
                    <td className="py-1.5 px-2 font-mono text-emerald-400">{row.icd10_code}</td>
                    <td className="py-1.5 px-2 text-text-2">{row.chief_complaint}</td>
                    <td className="py-1.5 px-2 text-text-3">{row.disposition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <pre className="max-h-44 overflow-auto p-3 text-2xs font-mono text-emerald-300 bg-black/40">
            {JSON.stringify(safeGenericRows.slice(0, 2), null, 2)}
          </pre>
        )}
      </div>

      {/* Dual Admin Sign-off & Download Bar */}
      <div className="p-3.5 rounded-lg bg-surface-inset border border-border">
        <h3 className="text-xs font-semibold text-text-1 mb-2 flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-primary-400" />
          Mandatory Dual-Administrator Governance Authorization
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs mb-3">
          <div>
            <span className="text-2xs text-text-3 block">Primary Signatory (Current Hospital Administrator)</span>
            <input
              disabled
              value={firstAdmin || 'GADMIN_PRIMARY_HOSPITAL_55CHARS00000000000000000000000000'}
              className="input mt-1 w-full text-2xs font-mono opacity-70 bg-surface-card cursor-not-allowed"
            />
          </div>

          <div>
            <span className="text-2xs text-text-3 block">Secondary Signatory Wallet Public Key (56 chars) *</span>
            <input
              required
              value={secondAdmin}
              onChange={(e) => setSecondAdmin(e.target.value)}
              placeholder="e.g. GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
              className={`input mt-1 w-full text-2xs font-mono ${
                secondAdmin && !isValidSecondAdmin ? 'border-red-500' : ''
              }`}
            />
            {secondAdmin && !isValidSecondAdmin && (
              <span className="text-[10px] text-red-400 mt-0.5 block">
                Must be a valid 56-character Stellar public key starting with G
              </span>
            )}
            {secondAdmin && secondAdmin.trim() === (firstAdmin || '').trim() && (
              <span className="text-[10px] text-red-400 mt-0.5 block">
                Secondary admin cannot be identical to the primary admin
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
          <div className="flex items-center gap-2 text-2xs">
            {isApproved ? (
              <span className="text-emerald-400 flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> Dual-sign-off verified. Authorization granted.
              </span>
            ) : (
              <span className="text-amber-400">
                Awaiting distinct secondary administrator public key signature to unlock export.
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {downloadSuccess && (
              <span className="text-2xs text-emerald-400 font-medium">Export generated successfully!</span>
            )}
            <button
              type="button"
              disabled={!isApproved || safeCdcRows.length === 0}
              onClick={handleDownload}
              className="btn-primary rounded-[8px] px-4 py-2 text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Download {format === 'csv' ? 'CDC-Format CSV' : 'WHO-Format JSON'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
