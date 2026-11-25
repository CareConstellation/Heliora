'use client';

import { useState } from 'react';
import { CalendarPlus, CheckCircle2, Download, Pill, X } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import {
  downloadVisitSummaryPDF,
  formatVisitDuration,
  type VisitSummary,
} from '@/lib/visitSummary';

interface Props {
  summary: VisitSummary;
  onClose: () => void;
  onScheduleFollowUp: () => void;
  /** Overridable for tests; defaults to the browser PDF download. */
  onDownloadPdf?: (summary: VisitSummary) => Promise<void>;
}

/**
 * End-of-visit checkout summary (#271). Shows visit duration, the attending
 * doctor and issued prescriptions, with actions to download a PDF summary and
 * to schedule a follow-up visit.
 *
 * Algorithmic Complexity:
 * - Time: O(P) to render P prescriptions.
 * - Space: O(P) for the rendered list.
 */
export default function PostConsultationSummaryModal({
  summary,
  onClose,
  onScheduleFollowUp,
  onDownloadPdf = downloadVisitSummaryPDF,
}: Props) {
  const modalRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const hasPrescriptions = summary.prescriptions.length > 0;

  async function handleDownload() {
    setIsDownloading(true);
    setDownloadError(null);
    try {
      await onDownloadPdf(summary);
    } catch (err) {
      console.warn('Visit summary PDF generation failed:', err);
      setDownloadError('The PDF could not be created. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-consultation-summary-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-surface-card p-6 shadow-2xl space-y-5 focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-green/10 text-green border border-green/20">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h3 id="post-consultation-summary-title" className="text-base font-bold text-text-1">
                Visit complete
              </h3>
              <p className="text-xs text-text-3 mt-0.5">Here is a summary of your consultation.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close visit summary"
            className="rounded-md p-1 text-text-3 hover:text-text-1 hover:bg-surface-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Visit details */}
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-border p-3">
            <dt className="text-xs text-text-3">Visit duration</dt>
            <dd className="font-semibold text-text-1">{formatVisitDuration(summary.durationMs)}</dd>
          </div>
          <div className="rounded-lg border border-border p-3">
            <dt className="text-xs text-text-3">Attending doctor</dt>
            <dd className="font-semibold text-text-1 truncate">
              {summary.doctorName ? `Dr. ${summary.doctorName}` : 'Not recorded'}
            </dd>
          </div>
        </dl>

        {summary.diagnosis && (
          <p className="text-xs text-text-2">
            <span className="font-semibold text-text-1">Diagnosis: </span>
            {summary.diagnosis}
          </p>
        )}

        {/* Prescriptions */}
        <section aria-labelledby="post-consultation-rx-title" className="space-y-2">
          <h4 id="post-consultation-rx-title" className="flex items-center gap-1.5 text-xs font-semibold text-text-1">
            <Pill className="w-3.5 h-3.5 text-green" /> Prescriptions issued
          </h4>
          {hasPrescriptions ? (
            <ul className="space-y-1 text-sm text-text-1 list-disc pl-5">
              {summary.prescriptions.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-text-3">No prescriptions were issued during this visit.</p>
          )}
        </section>

        {downloadError && (
          <p role="alert" className="text-xs text-red-600">
            {downloadError}
          </p>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onScheduleFollowUp}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-1 hover:bg-surface-hover transition-colors"
          >
            <CalendarPlus className="w-3.5 h-3.5" />
            Schedule follow-up
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={isDownloading}
            className="flex items-center gap-1.5 rounded-md bg-green px-3 py-1.5 text-xs font-semibold text-[#030D09] hover:bg-green-400 disabled:opacity-50 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            {isDownloading ? 'Preparing PDF…' : 'Download PDF summary'}
          </button>
        </div>
      </div>
    </div>
  );
}
