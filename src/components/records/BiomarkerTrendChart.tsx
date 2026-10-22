'use client';

import { useState, useEffect } from 'react';
import { TrendingUp } from 'lucide-react';
import type { BiomarkerTrendData } from '@/lib/biomarkerExtractor';
import {
  extractMultipleBiomarkers,
  getAvailableBiomarkers,
  type BiomarkerName,
} from '@/lib/biomarkerExtractor';
import type { MedicalRecord } from '@/types';

interface BiomarkerTrendChartProps {
  records: MedicalRecord[];
}

function SimpleLineChart({
  data,
  title,
  unit,
  referenceMin,
  referenceMax,
}: {
  data: Array<{ date: string; value: number; status: string }>;
  title: string;
  unit: string;
  referenceMin?: number | undefined;
  referenceMax?: number | undefined;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded bg-gray-50 dark:bg-gray-800">
        <p className="text-sm text-gray-500 dark:text-gray-400">No data available</p>
      </div>
    );
  }

  const minValue = Math.min(...data.map((d) => d.value)) * 0.9;
  const maxValue = Math.max(...data.map((d) => d.value)) * 1.1;
  const range = maxValue - minValue;

  const width = Math.max(400, data.length * 40);
  const height = 250;
  const padding = 40;

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1 || 1)) * (width - padding * 2);
    const y = height - padding - ((d.value - minValue) / range) * (height - padding * 2);
    return { ...d, x, y };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-gray-900 dark:text-white">{title}</h4>
        <span className="text-sm text-gray-600 dark:text-gray-400">{unit}</span>
      </div>

      <svg width={width} height={height} className="rounded border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        {/* Reference range background */}
        {referenceMin !== undefined && referenceMax !== undefined && (
          <rect
            x={padding}
            y={height - padding - ((referenceMax - minValue) / range) * (height - padding * 2)}
            width={width - padding * 2}
            height={((referenceMax - referenceMin) / range) * (height - padding * 2)}
            fill="rgba(34, 197, 94, 0.1)"
          />
        )}

        {/* Y-axis */}
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="currentColor" strokeWidth="1" />

        {/* X-axis */}
        <line x1={padding} y1={height - padding} x2={width} y2={height - padding} stroke="currentColor" strokeWidth="1" />

        {/* Reference lines */}
        {referenceMin !== undefined && (
          <>
            <line
              x1={padding}
              y1={height - padding - ((referenceMin - minValue) / range) * (height - padding * 2)}
              x2={width}
              y2={height - padding - ((referenceMin - minValue) / range) * (height - padding * 2)}
              stroke="rgba(34, 197, 94, 0.3)"
              strokeWidth="1"
              strokeDasharray="5,5"
            />
          </>
        )}

        {referenceMax !== undefined && (
          <>
            <line
              x1={padding}
              y1={height - padding - ((referenceMax - minValue) / range) * (height - padding * 2)}
              x2={width}
              y2={height - padding - ((referenceMax - minValue) / range) * (height - padding * 2)}
              stroke="rgba(239, 68, 68, 0.3)"
              strokeWidth="1"
              strokeDasharray="5,5"
            />
          </>
        )}

        {/* Line path */}
        <path d={pathD} fill="none" stroke="rgb(59, 130, 246)" strokeWidth="2" />

        {/* Data points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="4"
            fill={p.status === 'normal' ? 'rgb(34, 197, 94)' : p.status === 'abnormal' ? 'rgb(239, 68, 68)' : 'rgb(168, 85, 247)'}
            stroke="white"
            strokeWidth="2"
          />
        ))}

        {/* Labels */}
        {points.map((p, i) => (
          i % Math.max(1, Math.floor(points.length / 5)) === 0 && (
            <text key={`label-${i}`} x={p.x} y={height - 10} textAnchor="middle" fontSize="12" fill="currentColor">
              {new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </text>
          )
        ))}
      </svg>

      <div className="flex gap-4 text-xs text-gray-600 dark:text-gray-400">
        <div className="flex items-center gap-1">
          <div className="h-3 w-3 rounded-full bg-green-500" />
          Normal
        </div>
        <div className="flex items-center gap-1">
          <div className="h-3 w-3 rounded-full bg-red-500" />
          Abnormal
        </div>
        <div className="flex items-center gap-1">
          <div className="h-3 w-3 rounded-full bg-purple-500" />
          Critical
        </div>
      </div>
    </div>
  );
}

export function BiomarkerTrendChart({ records }: BiomarkerTrendChartProps) {
  const [selectedBiomarkers, setSelectedBiomarkers] = useState<string[]>(['HbA1c']);
  const [trends, setTrends] = useState<BiomarkerTrendData[]>([]);
  const [availableBiomarkers] = useState(() => getAvailableBiomarkers());

  useEffect(() => {
    const extracted = extractMultipleBiomarkers(
      records,
      selectedBiomarkers as BiomarkerName[],
    );
    setTrends(extracted);
  }, [records, selectedBiomarkers]);

  const handleToggleBiomarker = (biomarker: string) => {
    setSelectedBiomarkers((prev) =>
      prev.includes(biomarker) ? prev.filter((b) => b !== biomarker) : [...prev, biomarker].slice(0, 2),
    );
  };

  if (records.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <p className="text-gray-600 dark:text-gray-400">No records available to display trends</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Biomarker Trends</h3>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Select biomarkers to display (up to 2)</label>
        <div className="flex flex-wrap gap-2">
          {availableBiomarkers.map((marker) => (
            <button
              key={marker}
              onClick={() => handleToggleBiomarker(marker)}
              className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
                selectedBiomarkers.includes(marker)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300'
              }`}
            >
              {marker}
            </button>
          ))}
        </div>
      </div>

      {trends.length === 0 ? (
        <div className="rounded bg-gray-50 p-6 text-center dark:bg-gray-800">
          <p className="text-sm text-gray-600 dark:text-gray-400">No trend data found for selected biomarkers</p>
        </div>
      ) : (
        <div className="space-y-6">
          {trends.map((trend, idx) => (
            <SimpleLineChart
              key={idx}
              data={trend.observations.map((o) => ({
                date: o.date,
                value: o.value,
                status: o.status,
              }))}
              title={trend.biomarkerName}
              unit={trend.unit}
              referenceMin={trend.observations[0]?.referenceMin}
              referenceMax={trend.observations[0]?.referenceMax}
            />
          ))}
        </div>
      )}
    </div>
  );
}
