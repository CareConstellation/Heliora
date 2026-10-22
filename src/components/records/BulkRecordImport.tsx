'use client';

import { useState, useRef, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/useToast';
import type { BulkImportResponse } from '@/types';
import {
  parseCSV,
  parseFHIR,
  validateRow,
  validateRowsChunked,
  analyzeErrors,
  executeBatchImportWithRollback,
  type PreviewRow,
} from '@/lib/bulkRecordParser';
import {
  Upload,
  FileText,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,

  AlertTriangle,
  RotateCcw,
  Check,
} from 'lucide-react';

interface Props {
  patientAddress: string;
  onComplete?: (result: BulkImportResponse) => void;
}

const ACCEPTED_FORMATS = '.csv,.json';
const PAGE_SIZE = 25;

export default function BulkRecordImport({ patientAddress, onComplete }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [validationProgress, setValidationProgress] = useState<{ processed: number; total: number } | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'errors' | 'valid'>('all');
  const [currentPage, setCurrentPage] = useState(1);

  // Transactional import state
  const [importStatus, setImportStatus] = useState<
    'idle' | 'importing' | 'aborting' | 'completed' | 'rolled_back' | 'failed'
  >('idle');
  const [importProgress, setImportProgress] = useState<{
    completedChunks: number;
    totalChunks: number;
    importedRecords: number;
  }>({ completedChunks: 0, totalChunks: 0, importedRecords: 0 });
  const [rolledBackCount, setRolledBackCount] = useState<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const analysis = useMemo(() => {
    if (!preview) return null;
    return analyzeErrors(preview);
  }, [preview]);

  const validCount = preview?.filter((r) => r._valid).length ?? 0;
  const errorCount = preview ? preview.length - validCount : 0;

  const filteredRows = useMemo(() => {
    if (!preview) return [];
    if (filterMode === 'errors') return preview.filter((r) => !r._valid);
    if (filterMode === 'valid') return preview.filter((r) => r._valid);
    return preview;
  }, [preview, filterMode]);

  const totalPages = Math.ceil(filteredRows.length / PAGE_SIZE) || 1;
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, currentPage]);

  const handleFile = useCallback(
    async (file: File) => {
      setFileName(file.name);
      setPreview(null);
      setValidationProgress({ processed: 0, total: 1 });
      setImportStatus('idle');
      setCurrentPage(1);

      try {
        const text = await file.text();
        let rawRows;
        if (file.name.endsWith('.csv')) {
          rawRows = parseCSV(text);
        } else if (file.name.endsWith('.json')) {
          rawRows = parseFHIR(JSON.parse(text));
        } else {
          throw new Error('Unsupported file format. Please upload a .csv or .json file.');
        }

        if (rawRows.length === 0) {
          throw new Error('No records found in the uploaded file.');
        }

        if (rawRows.length > 5000) {
          toast(`File contains ${rawRows.length} records. Maximum supported batch is 5,000.`, 'error');
          rawRows = rawRows.slice(0, 5000);
        }

        // Chunked worker-style validation for large datasets
        const validated = await validateRowsChunked(rawRows, 250, (processed, total) => {
          setValidationProgress({ processed, total });
        });

        setPreview(validated);
        setValidationProgress(null);
        toast(`Loaded and validated ${validated.length} records.`, 'info');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to parse file syntax.';
        toast(msg, 'error');
        setValidationProgress(null);
        setFileName('');
      }
    },
    [toast],
  );

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  function clearPreview() {
    setPreview(null);
    setFileName('');
    setValidationProgress(null);
    setImportStatus('idle');
    if (inputRef.current) inputRef.current.value = '';
  }

  // Interactive error resolution: in-browser cell editing
  function updateCell(
    rowIndex: number,
    field: 'date' | 'doctorName' | 'diagnosis' | 'prescription' | 'notes',
    value: string,
  ) {
    if (!preview) return;
    const updated = [...preview];
    const current = updated[rowIndex];
    if (!current) return;
    const targetRow = { ...current };
    targetRow[field] = value;

    // Immediately re-validate the updated row
    const revalidated = validateRow(targetRow, rowIndex);
    updated[rowIndex] = revalidated;
    setPreview(updated);
  }

  // Execute batch import in atomic chunks with full rollback on abort
  async function handleImport() {
    if (!preview) return;
    const validRecords = preview
      .filter((r) => r._valid)
      .map(({ _row, _valid, _errors, ...r }) => r);

    if (validRecords.length === 0) {
      toast('No valid records to import. Please resolve errors in the grid.', 'error');
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setImportStatus('importing');
    setRolledBackCount(0);

    try {
      const result = await executeBatchImportWithRollback(patientAddress, validRecords, {
        chunkSize: 50,
        signal: abortController.signal,
        onChunkProgress: (completedChunks, totalChunks, importedRecords) => {
          setImportProgress({ completedChunks, totalChunks, importedRecords });
        },
        onRollbackProgress: (rolledBack) => {
          setRolledBackCount(rolledBack);
        },
      });

      setImportStatus('completed');
      toast(`Successfully imported all ${result.totalImported} records.`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['encryptedRecords', patientAddress] });
      void queryClient.invalidateQueries({ queryKey: ['patient-records', patientAddress] });

      onComplete?.({
        imported: result.totalImported,
        failed: 0,
        errors: [],
        records: preview.filter((r) => r._valid).map((r, i) => ({
          id: result.recordIds[i] || `rec-${i}`,
          date: r.date,
          doctorName: r.doctorName,
          diagnosis: r.diagnosis,
          ...(r.prescription !== undefined ? { prescription: r.prescription } : {}),
          ...(r.notes !== undefined ? { notes: r.notes } : {}),
          patientAddress,
        })),
      });
    } catch (err: unknown) {
      const isAborted = abortController.signal.aborted;
      if (isAborted) {
        setImportStatus('rolled_back');
        toast(`Session aborted. Full rollback completed: records rolled back.`, 'info');
      } else {
        setImportStatus('failed');
        const msg = err instanceof Error ? err.message : 'Import failed';
        toast(`Import failed and rolled back: ${msg}`, 'error');
      }
    } finally {
      abortControllerRef.current = null;
    }
  }

  function handleAbortSession() {
    if (abortControllerRef.current) {
      setImportStatus('aborting');
      abortControllerRef.current.abort();
    }
  }

  const isImporting = importStatus === 'importing';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'rgba(0,200,150,0.1)', border: '1px solid rgba(0,200,150,0.2)' }}
        >
          <Upload className="w-5 h-5 text-green" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">Bulk EHR Record Parser & Importer</h3>
          <p className="text-xs text-slate-500">
            Validated ingestion of up to 5,000 CSV/FHIR records with pre-flight analysis and transactional rollback
          </p>
        </div>
      </div>

      {!preview && (
        <>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={!!validationProgress}
            className="w-full rounded-lg border-2 border-dashed border-slate-200 py-10 flex flex-col items-center gap-3 hover:border-green hover:bg-slate-50/50 transition-colors disabled:opacity-50"
          >
            {validationProgress ? (
              <>
                <Loader2 className="w-7 h-7 animate-spin text-green" />
                <span className="text-sm font-medium text-slate-700">
                  Worker chunk validation ({validationProgress.processed} / {validationProgress.total} records)…
                </span>
                <div className="w-48 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-green h-1.5 rounded-full transition-all duration-150"
                    style={{
                      width: `${Math.min(
                        100,
                        (validationProgress.processed / (validationProgress.total || 1)) * 100,
                      )}%`,
                    }}
                  />
                </div>
              </>
            ) : (
              <>
                <FileText className="w-8 h-8 text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">Choose CSV or FHIR JSON file</span>
                <span className="text-xs text-slate-400">
                  Pre-flight validation checks dates, required clinical fields, and injection safety
                </span>
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_FORMATS}
            className="hidden"
            onChange={handleFileChange}
          />
        </>
      )}

      {preview && (
        <div className="space-y-4">
          {/* File summary bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-slate-600" />
              <span className="font-semibold text-slate-800">{fileName}</span>
              <span className="text-slate-400">—</span>
              <span className="text-slate-600 font-medium">{preview.length} total rows</span>
              <span className="text-green font-medium">({validCount} valid)</span>
              {errorCount > 0 && <span className="text-red-600 font-medium">({errorCount} invalid)</span>}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={clearPreview}
                disabled={isImporting}
                className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1 rounded border border-slate-200 hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                Change File
              </button>
            </div>
          </div>

          {/* Pre-Flight Error Analysis Banner */}
          {analysis && analysis.errorCount > 0 && (
            <div className="rounded-lg bg-red-50/70 border border-red-200 p-3.5 space-y-2">
              <div className="flex items-center gap-2 text-red-700 font-medium text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                <span>
                  Pre-flight Error Analysis: Found {analysis.errorCount} invalid rows with field issues. Use the interactive grid below to correct values before importing.
                </span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1 text-2xs">
                {Object.entries(analysis.errorsByField).map(([field, count]) => (
                  <span
                    key={field}
                    className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold"
                  >
                    {field}: {count} error{count > 1 ? 's' : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Filter Bar & Interactive Resolution Tabs */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-500 font-medium mr-1">View:</span>
              <button
                onClick={() => {
                  setFilterMode('all');
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  filterMode === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                All ({preview.length})
              </button>
              <button
                onClick={() => {
                  setFilterMode('errors');
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  filterMode === 'errors'
                    ? 'bg-red-600 text-white'
                    : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                }`}
              >
                Errors Only ({errorCount})
              </button>
              <button
                onClick={() => {
                  setFilterMode('valid');
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  filterMode === 'valid'
                    ? 'bg-green text-slate-900 font-semibold'
                    : 'bg-green/10 text-green-700 hover:bg-green/20 border border-green/30'
                }`}
              >
                Valid Only ({validCount})
              </button>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-2 py-0.5 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
                >
                  Prev
                </button>
                <button
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-2 py-0.5 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
                >
                  Next
                </button>
              </div>
            )}
          </div>

          {/* Interactive Error Resolution Grid */}
          <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50 text-slate-600 sticky top-0 border-b border-slate-200 z-10">
                <tr>
                  <th className="px-3 py-2.5 font-semibold w-12 text-center">Row</th>
                  <th className="px-3 py-2.5 font-semibold w-36">Date (YYYY-MM-DD)</th>
                  <th className="px-3 py-2.5 font-semibold w-40">Doctor Name</th>
                  <th className="px-3 py-2.5 font-semibold">Diagnosis</th>
                  <th className="px-3 py-2.5 font-semibold w-36">Prescription</th>
                  <th className="px-3 py-2.5 font-semibold w-36">Notes</th>
                  <th className="px-3 py-2.5 font-semibold w-20 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedRows.map((row) => {
                  const originalIndex = row._row - 1;
                  const hasDateErr = row._errors.some((e) => e.toLowerCase().includes('date'));
                  const hasDocErr = row._errors.some((e) => e.toLowerCase().includes('doctor'));
                  const hasDiagErr = row._errors.some((e) => e.toLowerCase().includes('diagnosis'));

                  return (
                    <tr key={row._row} className={row._valid ? 'hover:bg-slate-50/50' : 'bg-red-50/30'}>
                      <td className="px-3 py-2 text-center font-mono text-slate-400">{row._row}</td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={row.date}
                          onChange={(e) => updateCell(originalIndex, 'date', e.target.value)}
                          placeholder="YYYY-MM-DD"
                          className={`w-full px-2 py-1 rounded border text-xs ${
                            hasDateErr
                              ? 'border-red-400 bg-red-50 text-red-900 focus:ring-1 focus:ring-red-400'
                              : 'border-slate-200 bg-transparent text-slate-800 focus:border-green'
                          }`}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={row.doctorName}
                          onChange={(e) => updateCell(originalIndex, 'doctorName', e.target.value)}
                          placeholder="Doctor name"
                          className={`w-full px-2 py-1 rounded border text-xs ${
                            hasDocErr
                              ? 'border-red-400 bg-red-50 text-red-900 focus:ring-1 focus:ring-red-400'
                              : 'border-slate-200 bg-transparent text-slate-800 focus:border-green'
                          }`}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={row.diagnosis}
                          onChange={(e) => updateCell(originalIndex, 'diagnosis', e.target.value)}
                          placeholder="Diagnosis or clinical condition"
                          className={`w-full px-2 py-1 rounded border text-xs ${
                            hasDiagErr
                              ? 'border-red-400 bg-red-50 text-red-900 focus:ring-1 focus:ring-red-400'
                              : 'border-slate-200 bg-transparent text-slate-800 focus:border-green'
                          }`}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={row.prescription || ''}
                          onChange={(e) => updateCell(originalIndex, 'prescription', e.target.value)}
                          placeholder="Optional"
                          className="w-full px-2 py-1 rounded border border-slate-200 bg-transparent text-slate-800 focus:border-green text-xs"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={row.notes || ''}
                          onChange={(e) => updateCell(originalIndex, 'notes', e.target.value)}
                          placeholder="Optional"
                          className="w-full px-2 py-1 rounded border border-slate-200 bg-transparent text-slate-800 focus:border-green text-xs"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row._valid ? (
                          <div className="flex items-center justify-center text-green" title="Valid">
                            <CheckCircle2 className="w-4 h-4" />
                          </div>
                        ) : (
                          <div
                            className="flex items-center justify-center text-red-500 cursor-help"
                            title={row._errors.join('; ')}
                          >
                            <AlertCircle className="w-4 h-4" />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Atomic chunk import progress & rollback status */}
          {isImporting && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-blue-900">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  Importing Chunk {importProgress.completedChunks + 1} of {importProgress.totalChunks}…
                </span>
                <span>{importProgress.importedRecords} Records Ingested</span>
              </div>
              <div className="w-full bg-blue-100 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-200"
                  style={{
                    width: `${
                      importProgress.totalChunks > 0
                        ? (importProgress.completedChunks / importProgress.totalChunks) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
              <p className="text-2xs text-blue-700">
                Importing in atomic chunks of 50 records. If aborted or on partial failure, all records roll back immediately.
              </p>
            </div>
          )}

          {importStatus === 'rolled_back' && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-center gap-2 text-xs text-amber-800">
              <RotateCcw className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Session aborted by user. Full transactional rollback completed ({rolledBackCount} records revoked).
                Database remains untouched.
              </span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2">
            {isImporting ? (
              <button
                type="button"
                onClick={handleAbortSession}
                className="w-full rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-500 flex items-center justify-center gap-2 transition-colors"
              >
                <X className="w-4 h-4" />
                Abort Session & Rollback
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={clearPreview}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={validCount === 0}
                  className="flex-[2] rounded-lg bg-green py-2.5 text-sm font-bold text-[#030D09] hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors shadow-sm"
                >
                  <Check className="w-4 h-4" />
                  Execute Atomic Import ({validCount} Valid Record{validCount !== 1 ? 's' : ''})
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

