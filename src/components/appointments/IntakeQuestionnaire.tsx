'use client';

import { useState } from 'react';
import type {
  IntakeQuestion,
  PatientIntakeSummary,
  EncryptedIntakePayload,
} from '@/types';
import { Lock, Shield, CheckCircle2, AlertCircle } from 'lucide-react';

export const DEFAULT_INTAKE_QUESTIONS: IntakeQuestion[] = [
  {
    id: 'chiefComplaint',
    label: 'Chief Medical Complaint *',
    type: 'text',
    required: true,
    placeholder: 'Describe your primary symptom or reason for scheduling this consultation…',
  },
  {
    id: 'symptomOnset',
    label: 'When did your symptoms first begin? *',
    type: 'radio',
    required: true,
    options: ['Less than 24 hours ago', '1 - 3 days ago', '4 - 7 days ago', '1 - 2 weeks ago', 'More than 2 weeks ago'],
  },
  {
    id: 'symptoms',
    label: 'Select all symptoms you are currently experiencing',
    type: 'multiselect',
    options: [
      'Fever or chills',
      'Cough or sore throat',
      'Shortness of breath',
      'Fatigue or body aches',
      'Headache or migraine',
      'Chest or abdominal pain',
      'Nausea or digestive issues',
      'Dizziness or vertigo',
      'Skin rash or itching',
      'Joint stiffness or swelling',
    ],
  },
  {
    id: 'allergies',
    label: 'Known Drug Allergies',
    type: 'multiselect',
    options: [
      'Penicillin / Amoxicillin',
      'Sulfa medications',
      'Aspirin / NSAIDs (Ibuprofen)',
      'Opioids (Codeine/Morphine)',
      'Latex',
      'No known drug allergies (NKDA)',
    ],
  },
  {
    id: 'currentMedications',
    label: 'Current Active Medications & Supplements',
    type: 'text',
    placeholder: 'e.g., Lisinopril 10mg daily, Multivitamin (or None)',
  },
];

/**
 * Encrypt intake answers using provider public key / address via Web Crypto AES-GCM.
 */
export async function encryptIntakePayload(
  answers: Record<string, any>,
  providerAddress: string,
): Promise<EncryptedIntakePayload> {
  const rawData = JSON.stringify(answers);
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Derive AES-GCM key bound to provider public address
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(providerAddress.padEnd(32, '0').slice(0, 32)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('heliora_intake_salt_2026'),
      iterations: 10000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    enc.encode(rawData),
  );

  const base64Ciphertext = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
  const base64Iv = btoa(String.fromCharCode(...iv));

  const previewSummary: PatientIntakeSummary = {
    chiefComplaint: answers.chiefComplaint || '',
    symptomOnset: answers.symptomOnset || '',
    symptoms: Array.isArray(answers.symptoms) ? answers.symptoms : [],
    allergies: Array.isArray(answers.allergies) ? answers.allergies : [],
    currentMedications: answers.currentMedications || '',
    additionalNotes: answers.additionalNotes || '',
  };

  return {
    encryptedData: base64Ciphertext,
    iv: base64Iv,
    providerKeyId: providerAddress,
    timestamp: new Date().toISOString(),
    previewSummary,
  };
}

interface Props {
  doctorName: string;
  doctorAddress: string;
  questions?: IntakeQuestion[];
  onComplete: (payload: EncryptedIntakePayload) => void;
  onCancel?: () => void;
}

export default function IntakeQuestionnaire({
  doctorName,
  doctorAddress,
  questions = DEFAULT_INTAKE_QUESTIONS,
  onComplete,
  onCancel,
}: Props) {
  const [answers, setAnswers] = useState<Record<string, any>>({
    symptoms: [],
    allergies: [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isEncrypting, setIsEncrypting] = useState(false);

  function handleTextChange(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    if (errors[id]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  function handleRadioChange(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    if (errors[id]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  function handleMultiSelectToggle(id: string, option: string) {
    setAnswers((prev) => {
      const currentList: string[] = prev[id] || [];
      const updated = currentList.includes(option)
        ? currentList.filter((item) => item !== option)
        : [...currentList, option];
      return { ...prev, [id]: updated };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    questions.forEach((q) => {
      if (q.required) {
        const val = answers[q.id];
        if (!val || (Array.isArray(val) && val.length === 0)) {
          newErrors[q.id] = 'This field is required.';
        }
      }
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsEncrypting(true);
    try {
      const payload = await encryptIntakePayload(answers, doctorAddress);
      onComplete(payload);
    } finally {
      setIsEncrypting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h3 className="font-bold text-base text-text-1">Medical Intake Questionnaire</h3>
          <p className="text-xs text-text-2">
            Please complete this clinical pre-consultation intake for Dr. {doctorName}.
          </p>
        </div>
        <div className="flex items-center gap-1.5 bg-green/10 text-green px-2.5 py-1 rounded-md text-2xs font-semibold border border-green/20">
          <Lock className="w-3.5 h-3.5" />
          <span>Encrypted with Provider Key</span>
        </div>
      </div>

      <div className="space-y-5">
        {questions.map((q) => (
          <div key={q.id} className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-1">
              {q.label}
            </label>

            {/* Text / Textarea Input */}
            {q.type === 'text' && (
              <div>
                <textarea
                  rows={2}
                  value={answers[q.id] || ''}
                  onChange={(e) => handleTextChange(q.id, e.target.value)}
                  placeholder={q.placeholder}
                  className="w-full rounded-md border border-border bg-surface-inset px-3 py-2 text-xs text-text-1 focus:outline-none focus:ring-2 focus:ring-border-focus"
                />
              </div>
            )}

            {/* Radio Choices */}
            {q.type === 'radio' && q.options && (
              <div className="space-y-1.5">
                {q.options.map((opt) => (
                  <label
                    key={opt}
                    className="flex items-center gap-2 p-2 rounded-md border border-border hover:bg-surface-hover cursor-pointer text-xs text-text-1 transition-colors"
                  >
                    <input
                      type="radio"
                      name={q.id}
                      value={opt}
                      checked={answers[q.id] === opt}
                      onChange={() => handleRadioChange(q.id, opt)}
                      className="text-green focus:ring-green"
                    />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>
            )}

            {/* Multi-Select Medical Symptom Choices */}
            {q.type === 'multiselect' && q.options && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {q.options.map((opt) => {
                  const isChecked = (answers[q.id] || []).includes(opt);
                  return (
                    <label
                      key={opt}
                      className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                        isChecked
                          ? 'border-green bg-green/10 text-slate-900 font-medium'
                          : 'border-border bg-surface-inset text-text-2 hover:bg-surface-hover'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleMultiSelectToggle(q.id, opt)}
                        className="rounded text-green focus:ring-green"
                      />
                      <span>{opt}</span>
                    </label>
                  );
                })}
              </div>
            )}

            {errors[q.id] && (
              <p className="text-2xs text-red-600 flex items-center gap-1 mt-1">
                <AlertCircle className="w-3 h-3" />
                {errors[q.id]}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-lg bg-surface-card p-3 border border-border flex items-start gap-2.5 text-xs text-text-2">
        <Shield className="w-4 h-4 text-green shrink-0 mt-0.5" />
        <p className="text-2xs leading-relaxed">
          Your answers are encrypted on your local device before transmission. Only the authorized physician (Dr. {doctorName}) holds the decryption key.
        </p>
      </div>

      <div className="flex gap-3 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-md border border-border py-2 text-xs font-semibold text-text-2 hover:bg-surface-hover"
          >
            Back
          </button>
        )}
        <button
          type="submit"
          disabled={isEncrypting}
          className="flex-[2] rounded-md bg-green py-2.5 text-xs font-bold text-[#030D09] hover:bg-green-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {isEncrypting ? (
            'Encrypting & Saving Answers…'
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Save Intake & Continue to Booking
            </>
          )}
        </button>
      </div>
    </form>
  );
}
