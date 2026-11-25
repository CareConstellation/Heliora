import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PostConsultationSummaryModal from '@/components/consultation/PostConsultationSummaryModal';
import {
  buildVisitSummary,
  formatVisitDuration,
  generateVisitSummaryPDF,
  parsePrescriptions,
  visitSummaryFilename,
  type VisitSummary,
} from '@/lib/visitSummary';

const baseSummary: VisitSummary = {
  appointmentId: 'appt-visit',
  doctorName: 'Ada Okafor',
  durationMs: 12 * 60_000 + 4_000,
  endedAt: '2026-11-24T10:00:00.000Z',
  diagnosis: 'Acute Sinusitis / Upper Respiratory Congestion',
  prescriptions: ['Amoxicillin', 'Flonase'],
};

describe('feat(telemedicine): end-of-visit checkout summary modal (#271)', () => {
  describe('visit summary helpers', () => {
    it('splits prescriptions into trimmed, unique names', () => {
      expect(parsePrescriptions(' Amoxicillin, amoxicillin ,, Flonase ')).toEqual([
        'Amoxicillin',
        'Flonase',
      ]);
      expect(parsePrescriptions('')).toEqual([]);
      expect(parsePrescriptions(undefined)).toEqual([]);
    });

    it('formats visit durations for display', () => {
      expect(formatVisitDuration(42_000)).toBe('42 s');
      expect(formatVisitDuration(12 * 60_000 + 4_000)).toBe('12 min 4 s');
      expect(formatVisitDuration(65 * 60_000)).toBe('1 h 5 min');
      expect(formatVisitDuration(0)).toBe('0 s');
      expect(formatVisitDuration(-5_000)).toBe('0 s');
    });

    it('builds a summary from the call duration and clinical draft', () => {
      const summary = buildVisitSummary({
        appointmentId: 'appt-visit',
        doctorName: ' Ada Okafor ',
        durationMs: -1,
        endedAt: '2026-01-01T00:00:00.000Z',
        diagnosis: ' Acute Bronchitis ',
        prescriptionText: 'Amoxicillin, Flonase',
      });

      expect(summary).toEqual({
        appointmentId: 'appt-visit',
        doctorName: 'Ada Okafor',
        durationMs: 0,
        endedAt: '2026-01-01T00:00:00.000Z',
        diagnosis: 'Acute Bronchitis',
        prescriptions: ['Amoxicillin', 'Flonase'],
      });
    });

    it('builds a safe PDF file name from the appointment ID', () => {
      expect(visitSummaryFilename('appt/../x y')).toBe('visit-summary-appt____x_y.pdf');
      expect(visitSummaryFilename('')).toBe('visit-summary-visit.pdf');
    });

    it('renders a PDF document, including summaries with no prescriptions', async () => {
      const withRx = await generateVisitSummaryPDF(baseSummary);
      expect(String.fromCharCode(...withRx.slice(0, 5))).toBe('%PDF-');

      const withoutRx = await generateVisitSummaryPDF({
        ...baseSummary,
        prescriptions: [],
        doctorName: 'Ọlá Adébáyọ̀',
      });
      expect(String.fromCharCode(...withoutRx.slice(0, 5))).toBe('%PDF-');
    });
  });

  describe('PostConsultationSummaryModal', () => {
    it('shows the visit duration, attending doctor and issued prescriptions', () => {
      render(
        <PostConsultationSummaryModal
          summary={baseSummary}
          onClose={jest.fn()}
          onScheduleFollowUp={jest.fn()}
          onDownloadPdf={jest.fn()}
        />,
      );

      expect(screen.getByRole('dialog', { name: 'Visit complete' })).toBeInTheDocument();
      expect(screen.getByText('12 min 4 s')).toBeInTheDocument();
      expect(screen.getByText('Dr. Ada Okafor')).toBeInTheDocument();
      expect(screen.getByText('Amoxicillin')).toBeInTheDocument();
      expect(screen.getByText('Flonase')).toBeInTheDocument();
    });

    it('renders an empty state instead of failing when no prescriptions were issued', () => {
      render(
        <PostConsultationSummaryModal
          summary={{ ...baseSummary, prescriptions: [] }}
          onClose={jest.fn()}
          onScheduleFollowUp={jest.fn()}
          onDownloadPdf={jest.fn()}
        />,
      );

      expect(
        screen.getByText('No prescriptions were issued during this visit.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('downloads the PDF summary with one click', async () => {
      const onDownloadPdf = jest.fn().mockResolvedValue(undefined);
      render(
        <PostConsultationSummaryModal
          summary={baseSummary}
          onClose={jest.fn()}
          onScheduleFollowUp={jest.fn()}
          onDownloadPdf={onDownloadPdf}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Download PDF summary' }));

      await waitFor(() => expect(onDownloadPdf).toHaveBeenCalledTimes(1));
      expect(onDownloadPdf).toHaveBeenCalledWith(baseSummary);
    });

    it('disables the download button while the PDF is being prepared', async () => {
      let finishDownload: () => void = () => {};
      const onDownloadPdf = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finishDownload = resolve;
          }),
      );
      render(
        <PostConsultationSummaryModal
          summary={baseSummary}
          onClose={jest.fn()}
          onScheduleFollowUp={jest.fn()}
          onDownloadPdf={onDownloadPdf}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Download PDF summary' }));

      expect(await screen.findByRole('button', { name: 'Preparing PDF…' })).toBeDisabled();
      finishDownload();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Download PDF summary' })).toBeEnabled(),
      );
    });

    it('explains the failure when the PDF cannot be created', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const onDownloadPdf = jest.fn().mockRejectedValue(new Error('pdf failed'));
      render(
        <PostConsultationSummaryModal
          summary={baseSummary}
          onClose={jest.fn()}
          onScheduleFollowUp={jest.fn()}
          onDownloadPdf={onDownloadPdf}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Download PDF summary' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The PDF could not be created. Please try again.',
      );
      warn.mockRestore();
    });

    it('starts the follow-up scheduling action', () => {
      const onScheduleFollowUp = jest.fn();
      render(
        <PostConsultationSummaryModal
          summary={baseSummary}
          onClose={jest.fn()}
          onScheduleFollowUp={onScheduleFollowUp}
          onDownloadPdf={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Schedule follow-up' }));

      expect(onScheduleFollowUp).toHaveBeenCalledTimes(1);
    });

    it('closes from the close button and from the Escape key', () => {
      const onClose = jest.fn();
      render(
        <PostConsultationSummaryModal
          summary={baseSummary}
          onClose={onClose}
          onScheduleFollowUp={jest.fn()}
          onDownloadPdf={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Close visit summary' }));
      expect(onClose).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });
});
