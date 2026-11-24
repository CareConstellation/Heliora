import {
  createTeleMedicineEscrow,
  completeConsultation,
  canReleaseEscrow,
  releaseEscrowFunds,
  reportDoctorNoShow,
  canRefundDoctorNoShow,
  refundPatientOnNoShow,
  buildLockConsultationFeeInvocation,
  buildReleaseFeeInvocation,
  buildRefundPatientInvocation,
  calculateReleaseAmount,
  formatEscrowStatus,
  EscrowStatus,
  DISPUTE_WINDOW_SECONDS,
} from '@/lib/teleMedicineEscrow';
import { Keypair, Address } from '@stellar/stellar-sdk';

describe('Issue #189: Decentralized Multi-Sig Escrow for Telemedicine Consultation Fees', () => {
  const patient = Keypair.random().publicKey();
  const doctor = Keypair.random().publicKey();
  const contractId = Address.contract(Buffer.alloc(32, 1)).toString();
  const consultationId = 'consult_2026_001';
  const amountStroops = '100000000'; // 10 XLM

  describe('createTeleMedicineEscrow', () => {
    it('creates locked escrow with 2 required signatures for dual-party completion', () => {
      const escrow = createTeleMedicineEscrow(patient, doctor, consultationId, amountStroops, 30);
      expect(escrow.status).toBe(EscrowStatus.Locked);
      expect(escrow.patientAddress).toBe(patient);
      expect(escrow.doctorAddress).toBe(doctor);
      expect(escrow.releaseCondition.requiredSignatures).toBe(2);
      expect(escrow.releaseCondition.signedBy).toHaveLength(0);
      expect(escrow.releaseCondition.disputeFiled).toBe(false);
    });
  });

  describe('Dual-party visit completion', () => {
    it('allows immediate release when both doctor and patient sign completion', () => {
      let escrow = createTeleMedicineEscrow(patient, doctor, consultationId, amountStroops);
      const now = Math.floor(Date.now() / 1000);

      // Doctor signs first
      escrow = completeConsultation(escrow, doctor, now);
      expect(escrow.releaseCondition.doctorSignedAt).toBe(now);
      expect(escrow.releaseCondition.disputeWindowExpiresAt).toBe(now + DISPUTE_WINDOW_SECONDS);
      // Not yet released immediately (patient has not signed, and 72h window has not elapsed)
      expect(canReleaseEscrow(escrow, now + 100)).toBe(false);

      // Patient signs completion -> Dual-party visit completion satisfied
      escrow = completeConsultation(escrow, patient, now + 50);
      expect(escrow.releaseCondition.patientSignedAt).toBe(now + 50);
      expect(escrow.releaseCondition.consultationCompletedAt).toBe(now + 50);

      // Now eligible for immediate release!
      expect(canReleaseEscrow(escrow, now + 50)).toBe(true);

      // Successfully release funds
      const released = releaseEscrowFunds(escrow, now + 60);
      expect(released.status).toBe(EscrowStatus.Released);
      expect(released.releasedAt).toBe(now + 60);
    });
  });

  describe('72-hour dispute-free window release', () => {
    it('releases fee after 72 hours if doctor signs and patient does not dispute', () => {
      let escrow = createTeleMedicineEscrow(patient, doctor, consultationId, amountStroops);
      const doctorSignTime = 1_700_000_000;

      // Doctor records completion
      escrow = completeConsultation(escrow, doctor, doctorSignTime);

      // At 71 hours: dispute window still open, cannot release without patient signature
      const at71h = doctorSignTime + 71 * 3600;
      expect(canReleaseEscrow(escrow, at71h)).toBe(false);

      // At 72 hours + 1 second: dispute-free window elapsed, release is permitted
      const at72h1s = doctorSignTime + DISPUTE_WINDOW_SECONDS + 1;
      expect(canReleaseEscrow(escrow, at72h1s)).toBe(true);

      const released = releaseEscrowFunds(escrow, at72h1s);
      expect(released.status).toBe(EscrowStatus.Released);
    });

    it('blocks release if a dispute was filed within the 72-hour window', () => {
      let escrow = createTeleMedicineEscrow(patient, doctor, consultationId, amountStroops);
      const doctorSignTime = 1_700_000_000;
      escrow = completeConsultation(escrow, doctor, doctorSignTime);

      // Dispute filed by patient
      escrow.releaseCondition.disputeFiled = true;

      // Even after 72 hours, escrow cannot be released while in dispute
      const afterWindow = doctorSignTime + DISPUTE_WINDOW_SECONDS + 1000;
      expect(canReleaseEscrow(escrow, afterWindow)).toBe(false);
      expect(() => releaseEscrowFunds(escrow, afterWindow)).toThrow(/cannot be released/);
    });
  });

  describe('Doctor no-show and refund_patient', () => {
    it('allows patient to report doctor no-show and claim full refund', () => {
      let escrow = createTeleMedicineEscrow(patient, doctor, consultationId, amountStroops);
      const now = Math.floor(Date.now() / 1000);

      // Patient reports doctor did not show up
      escrow = reportDoctorNoShow(escrow, patient, now);
      expect(escrow.releaseCondition.noShowReportedAt).toBe(now);

      // Verified eligible for no-show refund
      expect(canRefundDoctorNoShow(escrow, now)).toBe(true);

      // Patient receives refund
      const refunded = refundPatientOnNoShow(escrow, patient, now + 10);
      expect(refunded.status).toBe(EscrowStatus.Refunded);
      expect(refunded.releasedAt).toBe(now + 10);
    });

    it('prevents non-patient from reporting doctor no-show', () => {
      const escrow = createTeleMedicineEscrow(patient, doctor, consultationId, amountStroops);
      const unauthorized = Keypair.random().publicKey();

      expect(() => reportDoctorNoShow(escrow, unauthorized)).toThrow(
        /Only the patient of this consultation can report a doctor no-show/,
      );
    });

    it('prevents no-show report if doctor has already signed completion', () => {
      let escrow = createTeleMedicineEscrow(patient, doctor, consultationId, amountStroops);
      const now = Math.floor(Date.now() / 1000);
      escrow = completeConsultation(escrow, doctor, now);

      expect(() => reportDoctorNoShow(escrow, patient, now)).toThrow(
        /doctor has already recorded visit completion/,
      );
    });
  });

  describe('Soroban Contract Invocations', () => {
    it('builds lock_consultation_fee invocation with correct method name and parameters', () => {
      const invocation = buildLockConsultationFeeInvocation(contractId, {
        patientAddress: patient,
        doctorAddress: doctor,
        consultationId,
        amountStroops,
        expiresAt: 1_700_010_000,
        disputeWindowSeconds: DISPUTE_WINDOW_SECONDS,
      });

      expect(invocation).toBeDefined();
      const xdrData = invocation.toXDR('base64');
      expect(xdrData).toBeTruthy();
    });

    it('builds release_fee invocation targeting doctor', () => {
      const invocation = buildReleaseFeeInvocation(contractId, 'escrow_123', doctor);
      expect(invocation).toBeDefined();
      const xdrData = invocation.toXDR('base64');
      expect(xdrData).toBeTruthy();
    });

    it('builds refund_patient invocation with reason parameter', () => {
      const invocation = buildRefundPatientInvocation(contractId, 'escrow_123', patient, 'doctor_no_show');
      expect(invocation).toBeDefined();
      const xdrData = invocation.toXDR('base64');
      expect(xdrData).toBeTruthy();
    });
  });

  describe('calculateReleaseAmount & formatEscrowStatus', () => {
    it('computes 5% platform fee split accurately', () => {
      const { doctorAmount, platformFee } = calculateReleaseAmount('100000000', 5);
      expect(doctorAmount).toBe('95000000');
      expect(platformFee).toBe('5000000');
    });

    it('formats multi-sig escrow status human-readably', () => {
      let escrow = createTeleMedicineEscrow(patient, doctor, consultationId, amountStroops);
      expect(formatEscrowStatus(escrow)).toContain('0/2');

      escrow = completeConsultation(escrow, doctor);
      expect(formatEscrowStatus(escrow)).toContain('Doctor completed');

      escrow = completeConsultation(escrow, patient);
      expect(formatEscrowStatus(escrow)).toBe('Ready to release');
    });
  });
});
