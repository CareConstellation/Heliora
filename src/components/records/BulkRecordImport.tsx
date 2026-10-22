'use client';

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/useToast';
import type {
  BulkImportResponse,
  BiometricMetricCategory,
  BiometricImportSummary,
  HelioraObservation,
} from '@/types';
import {
  parseCSV,
  parseFHIR,
  validateRow,
  validateRowsChunked,
  analyzeErrors,
  executeBatchImportWithRollback,
  PreviewRow,
  streamParseAppleHealthXML,
  parseGoogleFitJSON,
  biometricObservationsToImportRows,
  filterBiometricObservations,
  summarizeBiometricObservations,
} from '@/lib/bulkRecordParser';
import {
  Upload,
  FileText,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  AlertTriangle,
  RotateCcw,
  Check,
  Activity,
  Heart,
  Moon,
  Footprints,
  Calendar,
  Filter,
} from 'lucide-react';

interface Props {
  patientAddress: string;
  onComplete?: (result: BulkImportResponse) => void;
}

const ACCEPTED_FORMATS = '.csv,.json,.xml';
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

  // Biometric Ingestion State (Issue #79)
  const [rawBiometrics, setRawBiometrics] = useState<HelioraObservation[] | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<BiometricMetricCategory[]>([
    'resting_heart_rate',
    'step_count',
    'sleep',
  ]);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [streamingProgress, setStreamingProgress] = useState<{
    processed: number;
    total: number;
    extracted: number;
  } | null>(null);

  const analysis = useMemo(() => {
    if (!preview) return null;
    return analyzeErrors(preview);
  }, [preview]);

  const validCount = preview?.filter((r: PreviewRow) => r._valid).length ?? 0;
  const errorCount = preview ? preview.length - validCount : 0;

  const filteredRows = useMemo(() => {
    if (!preview) return [];
    if (filterMode === 'errors') return preview.filter((r: PreviewRow) => !r._valid);
    if (filterMode === 'valid') return preview.filter((r: PreviewRow) => r._valid);
    return preview;
  }, [preview, filterMode]);

  const totalPages = Math.ceil(filteredRows.length / PAGE_SIZE) || 1;
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, currentPage]);

  const applyBiometricFilter = useCallback(
    async (
      observations: HelioraObservation[],
      categories: BiometricMetricCategory[],
      start: string,
      end: string,
    ) => {
      const filterOptions: {
        categories?: BiometricMetricCategory[] | undefined;
        startDate?: string | undefined;
        endDate?: string | undefined;
      } = { categories };
      if (start) filterOptions.startDate = start;
      if (end) filterOptions.endDate = end;

      const filtered = filterBiometricObservations(observations, filterOptions);

      const rows = biometricObservationsToImportRows(filtered);
      const validated = await validateRowsChunked(rows, 250);
      setPreview(validated);
      setCurrentPage(1);
    },
    [],
  );

  function toggleCategory(category: BiometricMetricCategory) {
    if (!rawBiometrics) return;
    let next: BiometricMetricCategory[];
    if (selectedCategories.includes(category)) {
      if (selectedCategories.length === 1) {
        toast('At least one metric category must remain selected.', 'error');
        return;
      }
      next = selectedCategories.filter((c: BiometricMetricCategory) => c !== category);
    } else {
      next = [...selectedCategories, category];
    }
    setSelectedCategories(next);
    applyBiometricFilter(rawBiometrics, next, startDate, endDate);
  }

  function applyDatePreset(preset: 'all' | '30d' | '90d' | 'ytd') {
    if (!rawBiometrics) return;
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    let start = '';
    let end = todayStr;

    if (preset === '30d') {
      const d = new Date(now.getTime() - 30 * 86400000);
      start = d.toISOString().slice(0, 10);
    } else if (preset === '90d') {
      const d = new Date(now.getTime() - 90 * 86400000);
      start = d.toISOString().slice(0, 10);
    } else if (preset === 'ytd') {
      start = `${now.getFullYear()}-01-01`;
    } else if (preset === 'all') {
      start = '';
      end = '';
    }

    setStartDate(start);
    setEndDate(end);
    applyBiometricFilter(rawBiometrics, selectedCategories, start, end);
  }

  function handleCustomDateChange(newStart: string, newEnd: string) {
    setStartDate(newStart);
    setEndDate(newEnd);
    if (rawBiometrics) {
      applyBiometricFilter(rawBiometrics, selectedCategories, newStart, newEnd);
    }
  }

  const handleFile = useCallback(
    async (file: File) => {
      setFileName(file.name);
      setPreview(null);
      setRawBiometrics(null);
      setValidationProgress({ processed: 0, total: 1 });
      setImportStatus('idle');
      setCurrentPage(1);

      try {
        // 1. Apple Health XML Stream Parsing (Worker-based SAX parser)
        if (file.name.endsWith('.xml')) {
          setValidationProgress(null);
          setStreamingProgress({ processed: 0, total: file.size, extracted: 0 });

          const { observations, summary } = await streamParseAppleHealthXML(
            file,
            undefined,
            (processed, total, extracted) => {
              setStreamingProgress({ processed, total, extracted });
            },
          );
          setStreamingProgress(null);

          if (observations.length === 0) {
            throw new Error('No resting heart rate, step count, or sleep records found in Apple Health XML.');
          }

          setRawBiometrics(observations);
          const initialCategories: BiometricMetricCategory[] = ['resting_heart_rate', 'step_count', 'sleep'];
          setSelectedCategories(initialCategories);
          setStartDate('');
          setEndDate('');

          const rows = biometricObservationsToImportRows(observations);
          const validated = await validateRowsChunked(rows, 250);
          setPreview(validated);
          toast(`Stream-parsed ${observations.length} daily physiological metrics from Apple Health.`, 'success');
          return;
        }

        // 2. Google Fit Takeout JSON or standard FHIR / CSV
        const text = await file.text();
        let rawRows;

        if (file.name.endsWith('.csv')) {
          rawRows = parseCSV(text);
        } else if (file.name.endsWith('.json')) {
          const isGoogleFit =
            text.includes('com.google.') ||
            text.includes('heart_rate') ||
            text.includes('step_count') ||
            text.includes('Data Points') ||
            file.name.toLowerCase().includes('fit');

          if (isGoogleFit) {
            const { observations, summary } = parseGoogleFitJSON(text);
            if (observations.length === 0) {
              throw new Error('No compatible biometric metrics (resting HR, steps, sleep) found in Google Fit JSON.');
            }

            setRawBiometrics(observations);
            const initialCategories: BiometricMetricCategory[] = ['resting_heart_rate', 'step_count', 'sleep'];
            setSelectedCategories(initialCategories);
            setStartDate('');
            setEndDate('');

            const rows = biometricObservationsToImportRows(observations);
            const validated = await validateRowsChunked(rows, 250);
            setPreview(validated);
            setValidationProgress(null);
            toast(`Extracted and normalized ${observations.length} daily metrics from Google Fit.`, 'success');
            return;
          }

          rawRows = parseFHIR(JSON.parse(text));
        } else {
          throw new Error('Unsupported format. Please upload .csv, .json (FHIR or Google Fit), or .xml (Apple Health).');
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
        setStreamingProgress(null);
        setFileName('');
        setRawBiometrics(null);
      }
    },
    [toast],
  );

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function clearPreview() {
    setPreview(null);
    setFileName('');
    setValidationProgress(null);
    setStreamingProgress(null);
    setRawBiometrics(null);
    setSelectedCategories(['resting_heart_rate', 'step_count', 'sleep']);
    setStartDate('');
    setEndDate('');
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
    const targetRow = { ...updated[rowIndex] };
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
      .filter((r: PreviewRow) => r._valid)
      .map(({ _row, _valid, _errors, ...r }: PreviewRow) => r);

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
      queryClient.invalidateQueries({ queryKey: ['encryptedRecords', patientAddress] });
      queryClient.invalidateQueries({ queryKey: ['patient-records', patientAddress] });

      onComplete?.({
        imported: result.totalImported,
        failed: 0,
        errors: [],
        records: preview.filter((r: PreviewRow) => r._valid).map((r: PreviewRow, i: number) => {
          const rec: MedicalRecord = {
            id: (result.recordIds && result.recordIds[i]) ? result.recordIds[i]! : `rec-${i}`,
            date: r.date,
            doctorName: r.doctorName,
            diagnosis: r.diagnosis,
            patientAddress,
          };
          if (r.prescription) rec.prescription = r.prescription;
          if (r.notes) rec.notes = r.notes;
          return rec;
        }),
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
            disabled={!!validationProgress || !!streamingProgress}
            className="w-full rounded-lg border-2 border-dashed border-slate-200 py-10 flex flex-col items-center gap-3 hover:border-green hover:bg-slate-50/50 transition-colors disabled:opacity-50"
          >
            {streamingProgress ? (
              <>
                <Loader2 className="w-8 h-8 animate-spin text-green" />
                <span className="text-sm font-semibold text-slate-800">
                  Stream-parsing Apple Health XML in SAX worker…
                </span>
                <span className="text-xs text-slate-500">
                  {(streamingProgress.processed / (1024 * 1024)).toFixed(1)} MB / {(streamingProgress.total / (1024 * 1024)).toFixed(1)} MB processed ({streamingProgress.extracted} records found)
                </span>
                <div className="w-56 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-green h-1.5 rounded-full transition-all duration-150"
                    style={{
                      width: `${Math.min(
                        100,
                        (streamingProgress.processed / (streamingProgress.total || 1)) * 100,
                      )}%`,
                    }}
                  />
                </div>
              </>
            ) : validationProgress ? (
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
                <div className="flex items-center gap-2 text-slate-400">
                  <FileText className="w-7 h-7" />
                  <Activity className="w-7 h-7 text-green" />
                </div>
                <span className="text-sm font-semibold text-slate-700">
                  Choose CSV, FHIR JSON, Apple Health XML, or Google Takeout JSON
                </span>
                <span className="text-xs text-slate-400 text-center max-w-md">
                  Supports EHR spreadsheets, FHIR bundles, Apple Health <code className="text-slate-600 font-mono">export.xml</code> (SAX stream parsed), and Google Takeout <code className="text-slate-600 font-mono">fit.json</code>
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
              {rawBiometrics && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium text-xs border border-emerald-200">
                  <Activity className="w-3 h-3 text-emerald-600" />
                  Biometric Mode
                </span>
              )}
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

          {/* Biometric Ingestion Controls: Selective Category & Date Interval Filters (Issue #79) */}
          {rawBiometrics && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                  <Filter className="w-4 h-4 text-emerald-600" />
                  <span>Selective Biometric Import Filters</span>
                  <span className="text-2xs font-normal text-slate-500">
                    ({rawBiometrics.length} total raw observations found)
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-slate-500 text-2xs font-medium">Interval Presets:</span>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('all')}
                    className="px-2 py-0.5 rounded text-2xs font-medium bg-white border border-slate-200 hover:bg-slate-100 text-slate-700"
                  >
                    All Time
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('30d')}
                    className="px-2 py-0.5 rounded text-2xs font-medium bg-white border border-slate-200 hover:bg-slate-100 text-slate-700"
                  >
                    30 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('90d')}
                    className="px-2 py-0.5 rounded text-2xs font-medium bg-white border border-slate-200 hover:bg-slate-100 text-slate-700"
                  >
                    90 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('ytd')}
                    className="px-2 py-0.5 rounded text-2xs font-medium bg-white border border-slate-200 hover:bg-slate-100 text-slate-700"
                  >
                    This Year
                  </button>
                </div>
              </div>

              {/* Category Checkbox Pills */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => toggleCategory('resting_heart_rate')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedCategories.includes('resting_heart_rate')
                      ? 'bg-rose-50 border border-rose-300 text-rose-700 shadow-2xs'
                      : 'bg-white border border-slate-200 text-slate-400 hover:border-slate-300'
                  }`}
                >
                  <Heart className={`w-3.5 h-3.5 ${selectedCategories.includes('resting_heart_rate') ? 'text-rose-600' : 'text-slate-400'}`} />
                  <span>Resting Heart Rate (LOINC 40443-4)</span>
                  {selectedCategories.includes('resting_heart_rate') && <Check className="w-3 h-3 text-rose-600" />}
                </button>

                <button
                  type="button"
                  onClick={() => toggleCategory('step_count')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedCategories.includes('step_count')
                      ? 'bg-amber-50 border border-amber-300 text-amber-700 shadow-2xs'
                      : 'bg-white border border-slate-200 text-slate-400 hover:border-slate-300'
                  }`}
                >
                  <Footprints className={`w-3.5 h-3.5 ${selectedCategories.includes('step_count') ? 'text-amber-600' : 'text-slate-400'}`} />
                  <span>Step Count (LOINC 55423-8)</span>
                  {selectedCategories.includes('step_count') && <Check className="w-3 h-3 text-amber-600" />}
                </button>

                <button
                  type="button"
                  onClick={() => toggleCategory('sleep')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedCategories.includes('sleep')
                      ? 'bg-indigo-50 border border-indigo-300 text-indigo-700 shadow-2xs'
                      : 'bg-white border border-slate-200 text-slate-400 hover:border-slate-300'
                  }`}
                >
                  <Moon className={`w-3.5 h-3.5 ${selectedCategories.includes('sleep') ? 'text-indigo-600' : 'text-slate-400'}`} />
                  <span>Sleep Metrics (LOINC 93832-4)</span>
                  {selectedCategories.includes('sleep') && <Check className="w-3 h-3 text-indigo-600" />}
                </button>
              </div>

              {/* Date Interval Inputs */}
              <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-slate-600">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-2xs font-medium text-slate-500">From:</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => handleCustomDateChange(e.target.value, endDate)}
                    className="px-2 py-1 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-green"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-2xs font-medium text-slate-500">To:</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => handleCustomDateChange(startDate, e.target.value)}
                    className="px-2 py-1 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-green"
                  />
                </div>
                {(startDate || endDate) && (
                  <button
                    type="button"
                    onClick={() => handleCustomDateChange('', '')}
                    className="text-2xs text-slate-400 hover:text-slate-600 underline"
                  >
                    Clear dates
                  </button>
                )}
              </div>
            </div>
          )}

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

