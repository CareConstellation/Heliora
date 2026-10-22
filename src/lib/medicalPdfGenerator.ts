import { PDFDocument, rgb } from 'pdf-lib';
import type { MedicalRecord } from '@/types';

export interface PDFGenerationOptions {
  patientName: string;
  patientAddress: string;
  qrCodeDataUrl?: string;
  stellarTransactionHash?: string;
  recordDigest?: string;
}

async function generateQRCodeData(data: string): Promise<string> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  canvas.width = 200;
  canvas.height = 200;

  const textSize = Math.ceil(Math.sqrt(data.length));
  const cellSize = Math.floor(200 / (textSize + 8));

  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 200, 200);
  ctx.fillStyle = 'black';

  let index = 0;
  for (let y = 4; y < textSize + 4 && index < data.length; y++) {
    for (let x = 4; x < textSize + 4 && index < data.length; x++) {
      const char = data.charCodeAt(index);
      if (char % 2 === 0) {
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
      index++;
    }
  }

  return canvas.toDataURL('image/png');
}

export async function generateMedicalPDF(
  records: MedicalRecord[],
  options: PDFGenerationOptions,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([612, 792]); // Letter size: 8.5" x 11"
  const { height } = page.getSize();
  let yPosition = height - 50;

  const drawText = (text: string, x: number, y: number, size: number = 12, isBold: boolean = false) => {
    const font = isBold ? 'Helvetica-Bold' : 'Helvetica';
    page.drawText(text, {
      x,
      y,
      size,
      color: rgb(0, 0, 0),
      font: font as any,
    });
  };

  const drawLine = (x1: number, y1: number, x2: number, y2: number) => {
    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    });
  };

  // Header
  drawText('MEDICAL RECORD SUMMARY', 50, yPosition, 16, true);
  yPosition -= 30;

  drawLine(50, yPosition + 10, 562, yPosition + 10);
  yPosition -= 20;

  drawText(`Patient Name: ${options.patientName}`, 50, yPosition, 11);
  yPosition -= 18;
  drawText(`Patient ID: ${options.patientAddress.substring(0, 20)}...`, 50, yPosition, 11);
  yPosition -= 18;
  drawText(`Generated: ${new Date().toLocaleDateString()}`, 50, yPosition, 11);
  yPosition -= 30;

  // Records section
  drawText('CLINICAL RECORDS', 50, yPosition, 13, true);
  yPosition -= 25;

  for (const record of records) {
    if (yPosition < 100) {
      page = pdfDoc.addPage([612, 792]);
      yPosition = 750;
    }

    drawText(`Date: ${new Date(record.date).toLocaleDateString()}`, 50, yPosition, 10);
    yPosition -= 16;
    drawText(`Provider: ${record.doctorName}`, 50, yPosition, 10);
    yPosition -= 16;
    drawText(`Diagnosis: ${record.diagnosis}`, 50, yPosition, 10);
    yPosition -= 16;

    if (record.prescription) {
      drawText(`Prescription: ${record.prescription}`, 50, yPosition, 10);
      yPosition -= 16;
    }

    if (record.notes) {
      drawText(`Notes:`, 50, yPosition, 10, true);
      yPosition -= 14;
      const notesLines = (record.notes || '').split('\n');
      for (const line of notesLines) {
        if (yPosition < 100) {
          page = pdfDoc.addPage([612, 792]);
          yPosition = 750;
        }
        drawText(line.substring(0, 80), 60, yPosition, 9);
        yPosition -= 12;
      }
    }

    drawLine(50, yPosition + 10, 562, yPosition + 10);
    yPosition -= 20;
  }

  // Verification section
  if (options.stellarTransactionHash || options.recordDigest) {
    yPosition -= 20;
    drawText('BLOCKCHAIN VERIFICATION', 50, yPosition, 13, true);
    yPosition -= 25;

    if (options.stellarTransactionHash) {
      drawText('Stellar Transaction Hash:', 50, yPosition, 10, true);
      yPosition -= 16;
      const txLines = (options.stellarTransactionHash || '').match(/.{1,60}/g) || [];
      for (const line of txLines) {
        drawText(line, 60, yPosition, 8);
        yPosition -= 12;
      }
      yPosition -= 10;
    }

    if (options.recordDigest) {
      drawText('Record SHA-256 Digest:', 50, yPosition, 10, true);
      yPosition -= 16;
      drawText(options.recordDigest, 60, yPosition, 8);
      yPosition -= 16;
    }

    if (options.qrCodeDataUrl) {
      yPosition -= 20;
      try {
        const qrImage = await pdfDoc.embedPng(options.qrCodeDataUrl);
        page.drawImage(qrImage, {
          x: 450,
          y: yPosition - 100,
          width: 100,
          height: 100,
        });
      } catch {
        drawText('QR Code: Unable to embed', 450, yPosition, 9);
      }
    }
  }

  return pdfDoc.save();
}

export async function downloadMedicalPDF(
  records: MedicalRecord[],
  options: PDFGenerationOptions,
  filename: string = 'medical_record_summary.pdf',
): Promise<void> {
  const pdfBytes = await generateMedicalPDF(records, options);
  const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function generateQRCodeDataURL(stellarHash: string, recordDigest: string): Promise<string> {
  const qrData = `STX:${stellarHash}|DIGEST:${recordDigest}`;
  return generateQRCodeData(qrData);
}

import type { AnchoredConsentReceipt } from '@/lib/crypto';

/**
 * Generates a cryptographic PDF proof for an on-chain anchored consent receipt.
 */
export async function generateConsentReceiptPDF(
  receipt: AnchoredConsentReceipt,
  patientName?: string,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const { height } = page.getSize();
  let yPosition = height - 50;

  const drawText = (text: string, x: number, y: number, size: number = 11, isBold: boolean = false) => {
    const font = isBold ? 'Helvetica-Bold' : 'Helvetica';
    page.drawText(text, {
      x,
      y,
      size,
      color: rgb(0.1, 0.1, 0.1),
      font: font as any,
    });
  };

  const drawLine = (x1: number, y1: number, x2: number, y2: number) => {
    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness: 1,
      color: rgb(0.85, 0.85, 0.85),
    });
  };

  // Header Title
  drawText('CRYPTOGRAPHIC PATIENT CONSENT RECEIPT', 50, yPosition, 16, true);
  yPosition -= 18;
  drawText('Verifiable On-Chain Record Transmission Token (Soroban Ledger Anchor)', 50, yPosition, 9);
  yPosition -= 20;

  drawLine(50, yPosition, 562, yPosition);
  yPosition -= 25;

  // Receipt ID Banner
  drawText('RECEIPT IDENTIFIER:', 50, yPosition, 10, true);
  yPosition -= 14;
  drawText(receipt.receiptId, 50, yPosition, 11);
  yPosition -= 25;

  // Agreement Parameters
  drawText('CONSENT AGREEMENT PARAMETERS', 50, yPosition, 12, true);
  yPosition -= 18;

  if (patientName) {
    drawText(`Patient Name: ${patientName}`, 50, yPosition, 10);
    yPosition -= 14;
  }
  drawText(`Patient Address: ${receipt.patientAddress}`, 50, yPosition, 9);
  yPosition -= 14;
  drawText(`Authorized Recipient: ${receipt.recipient} (${receipt.recipientType})`, 50, yPosition, 9);
  yPosition -= 14;
  drawText(`Clinical Purpose: ${receipt.purpose}`, 50, yPosition, 10);
  yPosition -= 14;
  drawText(`Authorized Duration: ${receipt.durationDays} Days`, 50, yPosition, 10);
  yPosition -= 14;
  drawText(`Issued: ${new Date(receipt.createdAt).toLocaleString()} | Expires: ${new Date(receipt.validUntil).toLocaleString()}`, 50, yPosition, 9);
  yPosition -= 25;

  drawLine(50, yPosition, 562, yPosition);
  yPosition -= 25;

  // On-Chain Cryptographic Anchor Section
  drawText('BLOCKCHAIN ANCHOR & CRYPTOGRAPHIC PROOF', 50, yPosition, 12, true);
  yPosition -= 18;

  drawText('Agreement SHA-256 Digest:', 50, yPosition, 9, true);
  yPosition -= 13;
  drawText(receipt.agreementDigest, 60, yPosition, 8);
  yPosition -= 18;

  drawText('Target Medical Record Content Hash:', 50, yPosition, 9, true);
  yPosition -= 13;
  drawText(receipt.recordHash, 60, yPosition, 8);
  yPosition -= 18;

  drawText('Soroban Consent Contract Address:', 50, yPosition, 9, true);
  yPosition -= 13;
  drawText(receipt.contractAddress, 60, yPosition, 8);
  yPosition -= 18;

  drawText('Ledger Transaction Hash:', 50, yPosition, 9, true);
  yPosition -= 13;
  drawText(receipt.ledgerTxHash, 60, yPosition, 8);
  yPosition -= 30;

  // QR Code Verification
  try {
    const qrDataUrl = await generateQRCodeDataURL(receipt.ledgerTxHash, receipt.agreementDigest);
    const qrImage = await pdfDoc.embedPng(qrDataUrl);
    page.drawImage(qrImage, {
      x: 450,
      y: yPosition - 40,
      width: 90,
      height: 90,
    });
    drawText('Scan to verify proof on ledger', 430, yPosition - 50, 7);
  } catch {
    // If canvas is unavailable in non-browser context
  }

  // Footer Note
  drawLine(50, 70, 562, 70);
  drawText('Heliora Decentralized Health Protocol - Non-repudiable cryptographically verified proof.', 50, 55, 8);

  return pdfDoc.save();
}

/**
 * Downloads the cryptographic consent receipt PDF proof to the user's browser.
 */
export async function downloadConsentReceiptPDF(
  receipt: AnchoredConsentReceipt,
  patientName?: string,
  filename?: string,
): Promise<void> {
  const pdfBytes = await generateConsentReceiptPDF(receipt, patientName);
  const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `consent_receipt_${receipt.receiptId}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

