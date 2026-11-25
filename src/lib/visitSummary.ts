import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * End-of-visit checkout summary shown after a telemedicine call (#271).
 * Built from the call's duration and the clinical draft produced at call end.
 */
export interface VisitSummary {
  appointmentId: string;
  doctorName: string;
  durationMs: number;
  endedAt: string;
  diagnosis: string;
  prescriptions: string[];
}

export interface BuildVisitSummaryInput {
  appointmentId: string;
  doctorName: string;
  durationMs: number;
  endedAt?: string | undefined;
  diagnosis?: string | undefined;
  /** Comma-separated medication names, as produced by the call-transcript summarizer. */
  prescriptionText?: string | undefined;
}

const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;
const PDF_MARGIN_X = 50;
const PDF_MIN_Y = 60;

/**
 * Splits a comma-separated prescription string into unique, trimmed medication
 * names. Duplicates are matched case-insensitively and the first spelling wins.
 *
 * Time: O(n) over characters. Space: O(k) for k unique names.
 */
export function parsePrescriptions(raw: string | null | undefined): string[] {
  if (!raw) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of raw.split(',')) {
    const name = part.trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    names.push(name);
  }

  return names;
}

/**
 * Formats a call duration for display, e.g. "42 s", "12 min 4 s", "1 h 5 min".
 *
 * Time: O(1). Space: O(1).
 */
export function formatVisitDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds} s`;
  return `${seconds} s`;
}

export function buildVisitSummary(input: BuildVisitSummaryInput): VisitSummary {
  return {
    appointmentId: input.appointmentId,
    doctorName: input.doctorName.trim(),
    durationMs: Math.max(0, input.durationMs),
    endedAt: input.endedAt ?? new Date().toISOString(),
    diagnosis: input.diagnosis?.trim() ?? '',
    prescriptions: parsePrescriptions(input.prescriptionText),
  };
}

/** Builds a safe download name from the appointment ID. */
export function visitSummaryFilename(appointmentId: string): string {
  const safeId = appointmentId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'visit';
  return `visit-summary-${safeId}.pdf`;
}

/**
 * Standard PDF fonts only cover WinAnsi characters. Replace anything else so
 * drawing a name or diagnosis cannot throw.
 */
function toPdfSafeText(text: string): string {
  return text.replace(/[^\x20-\x7E]/g, '?');
}

/**
 * Renders the visit summary as a one-page PDF. Prescriptions that do not fit
 * are summarized as a final line.
 */
export async function generateVisitSummaryPDF(summary: VisitSummary): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = page.getSize().height - 60;

  const drawLine = (text: string, size = 11, font = regular) => {
    page.drawText(toPdfSafeText(text), {
      x: PDF_MARGIN_X,
      y,
      size,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= size + 8;
  };

  drawLine('VISIT SUMMARY', 16, bold);
  drawLine(`Appointment: ${summary.appointmentId}`);
  drawLine(`Attending doctor: ${summary.doctorName ? `Dr. ${summary.doctorName}` : 'Not recorded'}`);
  drawLine(`Visit duration: ${formatVisitDuration(summary.durationMs)}`);
  drawLine(`Ended: ${summary.endedAt}`);
  y -= 10;

  drawLine('Diagnosis', 12, bold);
  drawLine(summary.diagnosis || 'No diagnosis recorded');
  y -= 10;

  drawLine('Prescriptions', 12, bold);
  if (summary.prescriptions.length === 0) {
    drawLine('No prescriptions were issued during this visit.');
  } else {
    for (const [index, name] of summary.prescriptions.entries()) {
      if (y < PDF_MIN_Y) {
        drawLine(`... and ${summary.prescriptions.length - index} more`);
        break;
      }
      drawLine(`- ${name}`);
    }
  }

  return pdfDoc.save();
}

/** One-click download of the visit summary PDF. */
export async function downloadVisitSummaryPDF(summary: VisitSummary): Promise<void> {
  const pdfBytes = await generateVisitSummaryPDF(summary);
  const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = visitSummaryFilename(summary.appointmentId);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
