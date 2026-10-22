/**
 * In-browser Web Speech API audio transcription, mutual consent management,
 * and clinical SOAP note summarization.
 * (Issue #64)
 */

import type {
  TranscriptSegment,
  TranscriptionConsentState,
  ClinicalDraftNote,
} from '@/types';

// SpeechRecognition type polyfills for browser environments
export interface ISpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: {
    length: number;
    item(index: number): {
      isFinal: boolean;
      length: number;
      item(index: number): { transcript: string; confidence: number };
      [index: number]: { transcript: string; confidence: number };
    };
    [index: number]: {
      isFinal: boolean;
      item(index: number): { transcript: string; confidence: number };
      [index: number]: { transcript: string; confidence: number };
    };
  };
}

export interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: ISpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

export interface SpeechRecognitionConstructor {
  new (): ISpeechRecognition;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/* ── Storage Key Utilities ─────────────────────────────────────────── */

export function getDraftStorageKey(patientAddress: string): string {
  return `heliora_draft_note_patient_${patientAddress}`;
}

export function getDraftStorageKeyByAppointment(appointmentId: string): string {
  return `heliora_draft_note_appt_${appointmentId}`;
}

export function getStoredDraftNote(patientAddress: string): ClinicalDraftNote | null {
  if (typeof window === 'undefined' || !patientAddress) return null;
  try {
    const raw = localStorage.getItem(getDraftStorageKey(patientAddress));
    if (!raw) return null;
    return JSON.parse(raw) as ClinicalDraftNote;
  } catch (err) {
    console.warn('Failed to parse stored draft note:', err);
    return null;
  }
}

export function clearStoredDraftNote(patientAddress: string, appointmentId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (patientAddress) {
      localStorage.removeItem(getDraftStorageKey(patientAddress));
    }
    if (appointmentId) {
      localStorage.removeItem(getDraftStorageKeyByAppointment(appointmentId));
    }
  } catch (err) {
    console.warn('Failed to clear stored draft note:', err);
  }
}

/* ── Clinical Note Summarization Engine ────────────────────────────── */

/**
 * Transforms raw dialogue transcripts into structured SOAP clinical notes.
 *
 * Algorithmic Complexity:
 * - Time: O(N) where N is total words in transcript segments (linear pass).
 * - Space: O(N) storage for normalized text categories and extracted fields.
 */
export function summarizeClinicalEncounter(
  appointmentId: string,
  patientAddress: string,
  transcripts: TranscriptSegment[],
  doctorName = 'Doctor',
): ClinicalDraftNote {
  const patientStatements: string[] = [];
  const doctorStatements: string[] = [];
  const fullDiscussion: string[] = [];

  for (const t of transcripts) {
    const clean = t.text.trim();
    if (!clean) continue;
    fullDiscussion.push(`[${t.speaker.toUpperCase()}]: ${clean}`);
    if (t.speaker === 'patient') {
      patientStatements.push(clean);
    } else {
      doctorStatements.push(clean);
    }
  }

  const allText = fullDiscussion.join(' ');
  const lowerText = allText.toLowerCase();

  // 1. Inferred Subjective (Symptoms & Chief Complaints)
  const symptomKeywords = [
    'pain',
    'fever',
    'cough',
    'headache',
    'nausea',
    'fatigue',
    'dizziness',
    'swelling',
    'sore throat',
    'shortness of breath',
    'rash',
    'ache',
    'congestion',
  ];
  const detectedSymptoms = symptomKeywords.filter((k) => lowerText.includes(k));

  const subjectiveLines: string[] = [];
  if (patientStatements.length > 0) {
    subjectiveLines.push(
      `Patient reported concerns: "${patientStatements.slice(0, 3).join('; ')}".`,
    );
  } else {
    subjectiveLines.push('Patient consultation conducted via telemedicine call.');
  }
  if (detectedSymptoms.length > 0) {
    subjectiveLines.push(`Key symptoms discussed: ${detectedSymptoms.join(', ')}.`);
  }

  // 2. Inferred Objective (Doctor's observations during telemedicine call)
  const objectiveLines: string[] = [];
  objectiveLines.push(
    `Telemedicine video visual evaluation completed by Dr. ${doctorName}.`,
  );
  if (lowerText.includes('throat') || lowerText.includes('cough')) {
    objectiveLines.push('Pharyngeal / respiratory symptoms evaluated.');
  }
  if (lowerText.includes('skin') || lowerText.includes('rash')) {
    objectiveLines.push('Dermatological lesion/rash reviewed via camera.');
  }

  // 3. Inferred Assessment & Diagnosis
  let inferredDiagnosis = 'Clinical Consultation Review';
  if (lowerText.includes('sinus') || (lowerText.includes('congestion') && lowerText.includes('headache'))) {
    inferredDiagnosis = 'Acute Sinusitis / Upper Respiratory Congestion';
  } else if (lowerText.includes('hypertension') || lowerText.includes('blood pressure')) {
    inferredDiagnosis = 'Essential Hypertension Follow-up';
  } else if (lowerText.includes('migraine') || lowerText.includes('headache')) {
    inferredDiagnosis = 'Migraine / Tension Headache';
  } else if (lowerText.includes('bronchitis') || (lowerText.includes('cough') && lowerText.includes('chest'))) {
    inferredDiagnosis = 'Acute Bronchitis';
  } else if (lowerText.includes('allerg')) {
    inferredDiagnosis = 'Allergic Rhinitis / Drug Allergy Evaluation';
  } else if (detectedSymptoms.length > 0) {
    inferredDiagnosis = `Symptomatic Assessment (${detectedSymptoms[0]?.toUpperCase()})`;
  }

  // 4. Inferred Plan & Prescriptions
  const prescriptionMatches: string[] = [];
  const rxKeywords = [
    'amoxicillin',
    'azithromycin',
    'ibuprofen',
    'acetaminophen',
    'paracetamol',
    'lisinopril',
    'metformin',
    'atorvastatin',
    'flonase',
    'albuterol',
    'augmentin',
    'antihistamine',
    'saline',
  ];
  rxKeywords.forEach((drug) => {
    if (lowerText.includes(drug)) {
      prescriptionMatches.push(drug.charAt(0).toUpperCase() + drug.slice(1));
    }
  });

  const planLines: string[] = [];
  if (prescriptionMatches.length > 0) {
    planLines.push(`Medication prescribed: ${prescriptionMatches.join(', ')}.`);
  }
  planLines.push(
    'Hydration and rest recommended. Follow up in 7 days if symptoms persist or worsen.',
  );

  const formattedNotes = [
    '--- CLINICAL ENCOUNTER DRAFT SUMMARY (TRANSCRIBED) ---',
    '',
    '[SUBJECTIVE]:',
    subjectiveLines.join(' '),
    '',
    '[OBJECTIVE]:',
    objectiveLines.join(' '),
    '',
    '[ASSESSMENT]:',
    `Primary Finding: ${inferredDiagnosis}.`,
    '',
    '[PLAN]:',
    planLines.join(' '),
    '',
    '[FULL TRANSCRIPT EXCERPT]:',
    fullDiscussion.slice(0, 10).join('\n'),
    fullDiscussion.length > 10 ? `... (+${fullDiscussion.length - 10} more lines)` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const draft: ClinicalDraftNote = {
    appointmentId,
    patientAddress,
    generatedAt: new Date().toISOString(),
    diagnosis: inferredDiagnosis,
    notes: formattedNotes,
    prescription: prescriptionMatches.join(', '),
    rawTranscripts: transcripts,
  };

  // Persist draft for NewRecordForm
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(getDraftStorageKey(patientAddress), JSON.stringify(draft));
      localStorage.setItem(getDraftStorageKeyByAppointment(appointmentId), JSON.stringify(draft));
      window.dispatchEvent(
        new CustomEvent<ClinicalDraftNote>('heliora-draft-note-ready', { detail: draft }),
      );
    } catch (err) {
      console.warn('Failed to persist draft note to localStorage:', err);
    }
  }

  return draft;
}
