'use client';

import { useState } from 'react';
import { Download, Loader } from 'lucide-react';
import type { MedicalRecord } from '@/types';
import { downloadMedicalPDF, generateQRCodeDataURL } from '@/lib/medicalPdfGenerator';

interface MedicalPDFExporterProps {
  records: MedicalRecord[];
  patientName: string;
  patientAddress: string;
  stellarTransactionHash?: string;
  recordDigest?: string;
}

export function MedicalPDFExporter({
  records,
  patientName,
  patientAddress,
  stellarTransactionHash,
  recordDigest,
}: MedicalPDFExporterProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGeneratePDF = async () => {
    if (records.length === 0) {
      setError('No records to export');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      let qrCodeDataUrl: string | undefined;

      if (stellarTransactionHash && recordDigest) {
        qrCodeDataUrl = await generateQRCodeDataURL(stellarTransactionHash, recordDigest);
      }

      await downloadMedicalPDF(
        records,
        {
          patientName,
          patientAddress,
          ...(qrCodeDataUrl ? { qrCodeDataUrl } : {}),
          ...(stellarTransactionHash ? { stellarTransactionHash } : {}),
          ...(recordDigest ? { recordDigest } : {}),
        },
        `medical_summary_${new Date().getTime()}.pdf`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate PDF';
      setError(message);
      console.error('PDF generation error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Export Medical Summary PDF</h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Generate a printable clinical summary with embedded blockchain verification
        </p>
      </div>

      {stellarTransactionHash && (
        <div className="mb-3 rounded bg-blue-50 p-3 text-sm dark:bg-blue-900/20">
          <p className="font-medium text-blue-900 dark:text-blue-100">✓ Blockchain verification enabled</p>
          <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">QR code will include Stellar transaction proof</p>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      <button
        onClick={handleGeneratePDF}
        disabled={isGenerating || records.length === 0}
        className="inline-flex items-center gap-2 rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:bg-gray-400"
      >
        {isGenerating ? (
          <>
            <Loader className="h-4 w-4 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Download className="h-4 w-4" />
            Download PDF Summary
          </>
        )}
      </button>

      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        {records.length} record{records.length !== 1 ? 's' : ''} will be included in the summary
      </p>
    </div>
  );
}
