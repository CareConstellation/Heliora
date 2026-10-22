import {
  summarizeClinicalEncounter,
  getDraftStorageKey,
  getDraftStorageKeyByAppointment,
} from '@/lib/transcription';
import type { TranscriptSegment } from '@/types';

describe('feat(video): audio transcription and clinical notes summarization (#64)', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  const mockTranscripts: TranscriptSegment[] = [
    {
      id: 'seg-1',
      speaker: 'patient',
      text: 'Doctor, I have had a severe sinus headache and congestion for the last three days.',
      timestamp: Date.now() - 60000,
      isFinal: true,
    },
    {
      id: 'seg-2',
      speaker: 'doctor',
      text: 'I understand. Have you taken any medications like ibuprofen or amoxicillin?',
      timestamp: Date.now() - 40000,
      isFinal: true,
    },
    {
      id: 'seg-3',
      speaker: 'patient',
      text: 'I took some ibuprofen yesterday, but the sinus pressure is still there.',
      timestamp: Date.now() - 20000,
      isFinal: true,
    },
  ];

  it('summarizeClinicalEncounter structures dialogues into SOAP format with diagnosis and prescriptions', () => {
    const draft = summarizeClinicalEncounter(
      'appt-123',
      'G_PATIENT_ADDR',
      mockTranscripts,
      'Dr. Sarah',
    );

    expect(draft.appointmentId).toBe('appt-123');
    expect(draft.patientAddress).toBe('G_PATIENT_ADDR');
    expect(draft.diagnosis).toContain('Sinusitis');
    expect(draft.prescription).toContain('Amoxicillin');
    expect(draft.prescription).toContain('Ibuprofen');

    // SOAP Sections
    expect(draft.notes).toContain('[SUBJECTIVE]:');
    expect(draft.notes).toContain('[OBJECTIVE]:');
    expect(draft.notes).toContain('[ASSESSMENT]:');
    expect(draft.notes).toContain('[PLAN]:');
    expect(draft.notes).toContain('sinus headache');

    // Check localStorage persistence
    const storedByPatient = localStorage.getItem(getDraftStorageKey('G_PATIENT_ADDR'));
    expect(storedByPatient).not.toBeNull();
    expect(JSON.parse(storedByPatient!).appointmentId).toBe('appt-123');

    const storedByAppt = localStorage.getItem(getDraftStorageKeyByAppointment('appt-123'));
    expect(storedByAppt).not.toBeNull();
  });

  it('dispatches heliora-draft-note-ready custom event when summary is created', () => {
    const eventHandler = jest.fn();
    window.addEventListener('heliora-draft-note-ready', eventHandler);

    const draft = summarizeClinicalEncounter(
      'appt-456',
      'G_PATIENT_456',
      mockTranscripts,
    );

    expect(draft.appointmentId).toBe('appt-456');
    expect(eventHandler).toHaveBeenCalledTimes(1);
    const eventDetail = (eventHandler.mock.calls[0]![0] as CustomEvent).detail;
    expect(eventDetail.appointmentId).toBe('appt-456');

    window.removeEventListener('heliora-draft-note-ready', eventHandler);
  });
});
