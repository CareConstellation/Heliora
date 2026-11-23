import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ScheduleTemplateBuilder, {
  WeeklyScheduleGrid,
} from '@/components/doctor/ScheduleTemplateBuilder';
import {
  fetchAppointments,
  fetchAvailabilityConfig,
  fetchScheduleSettings,
  fetchSlots,
  publishSlotsBulk,
  saveScheduleSettings,
} from '@/services/api.service';
import type { DoctorScheduleSettings, WeeklyHoursBlock } from '@/types';

jest.mock('@/services/api.service', () => {
  const actual = jest.requireActual('@/services/api.service');
  return {
    getSlotConflicts: actual.getSlotConflicts,
    fetchAppointments: jest.fn(),
    fetchAvailabilityConfig: jest.fn(),
    fetchScheduleSettings: jest.fn(),
    fetchSlots: jest.fn(),
    publishSlotsBulk: jest.fn(),
    saveScheduleSettings: jest.fn(),
  };
});
jest.mock('@/lib/sentry', () => ({
  traceUserAction: (_: string, fn: () => unknown) => Promise.resolve().then(fn),
}));
jest.mock('@/store/useWalletStore', () => ({ useWalletStore: () => ({ publicKey: 'GDOC' }) }));
jest.mock('@/components/doctor/SlotBatchPublisher', () => ({
  __esModule: true,
  default: ({ slots }: { slots: unknown[] }) => (
    <div data-testid="onchain-publisher">{slots.length} on-chain</div>
  ),
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const saved: DoctorScheduleSettings = {
  templates: [
    {
      id: 'tpl-clinic',
      name: 'Standard Clinic Week',
      slotMinutes: 30,
      blocks: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        id: `b${day}`,
        day: day as WeeklyHoursBlock['day'],
        startMinute: 9 * 60,
        endMinute: 9 * 60 + 30,
      })),
    },
    { id: 'tpl-vac', name: 'Vacation', slotMinutes: 30, blocks: [] },
  ],
  activeTemplateId: 'tpl-clinic',
  overrides: [],
  version: 3,
};

beforeEach(() => {
  jest.clearAllMocks();
  (fetchScheduleSettings as jest.Mock).mockResolvedValue(saved);
  (fetchAvailabilityConfig as jest.Mock).mockResolvedValue({
    bufferMinutes: 0,
    minNoticeHours: 2,
    emergencySlotsPerDay: 0,
    emergencySlotIds: [],
  });
  (fetchSlots as jest.Mock).mockResolvedValue([]);
  (fetchAppointments as jest.Mock).mockResolvedValue([]);
});

describe('WeeklyScheduleGrid drag and drop', () => {
  it('creates a block when a palette item is dropped on a cell', () => {
    const onChange = jest.fn();
    render(<WeeklyScheduleGrid blocks={[]} onChange={onChange} />);

    fireEvent.dragStart(screen.getByRole('button', { name: /drag a 2 h block/i }));
    fireEvent.dragOver(screen.getByTestId('schedule-cell-2-540'));
    fireEvent.drop(screen.getByTestId('schedule-cell-2-540'));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ day: 2, startMinute: 540, endMinute: 660 }),
    ]);
  });

  it('moves an existing block to another day and time', () => {
    const onChange = jest.fn();
    const blocks: WeeklyHoursBlock[] = [{ id: 'x', day: 0, startMinute: 540, endMinute: 720 }];
    render(<WeeklyScheduleGrid blocks={blocks} onChange={onChange} />);

    fireEvent.dragStart(screen.getByRole('group', { name: /working hours mon 09:00–12:00/i }));
    fireEvent.drop(screen.getByTestId('schedule-cell-4-780'));

    expect(onChange).toHaveBeenCalledWith([{ id: 'x', day: 4, startMinute: 780, endMinute: 960 }]);
  });

  it('supports keyboard moves, resizing and removal as a drag-and-drop alternative', () => {
    const onChange = jest.fn();
    const blocks: WeeklyHoursBlock[] = [{ id: 'x', day: 1, startMinute: 540, endMinute: 600 }];
    render(<WeeklyScheduleGrid blocks={blocks} onChange={onChange} />);
    const group = screen.getByRole('group', { name: /working hours tue/i });

    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'x', day: 2, startMinute: 540, endMinute: 600 },
    ]);
    fireEvent.keyDown(group, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'x', day: 1, startMinute: 570, endMinute: 630 },
    ]);
    fireEvent.click(within(group).getByRole('button', { name: /extend/i }));
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'x', day: 1, startMinute: 540, endMinute: 630 },
    ]);
    fireEvent.keyDown(group, { key: 'Delete' });
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe('ScheduleTemplateBuilder', () => {
  it('loads templates, toggles the active one and saves', async () => {
    (saveScheduleSettings as jest.Mock).mockImplementation((_addr, s) => Promise.resolve(s));
    renderWithClient(<ScheduleTemplateBuilder />);

    const vacationRadio = await screen.findByRole('radio', { name: /use vacation/i });
    expect(screen.getByRole('radio', { name: /use standard clinic week/i })).toBeChecked();
    expect(screen.getByRole('button', { name: /publish 28 slots/i })).toBeEnabled();

    fireEvent.click(vacationRadio);
    expect(await screen.findByRole('button', { name: /publish 0 slots/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /save templates/i }));
    await waitFor(() =>
      expect(saveScheduleSettings).toHaveBeenCalledWith(
        'GDOC',
        expect.objectContaining({ activeTemplateId: 'tpl-vac', version: 3 }),
      ),
    );
  });

  it('falls back to preset templates when none are saved', async () => {
    (fetchScheduleSettings as jest.Mock).mockRejectedValue({ status: 404, message: 'Not found' });
    renderWithClient(<ScheduleTemplateBuilder />);
    expect(await screen.findByText(/starting from the default presets/i)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /use surgery week/i })).toBeInTheDocument();
  });

  it('applies holiday overrides to the slot preview', async () => {
    renderWithClient(<ScheduleTemplateBuilder />);
    await screen.findByRole('button', { name: /publish 28 slots/i });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const key = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: key } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Medical conference' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'conference' } });
    fireEvent.click(screen.getByRole('button', { name: /add override/i }));

    expect(await screen.findByRole('button', { name: /publish 27 slots/i })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /scheduled overrides/i })).toHaveTextContent(
      'Medical conference',
    );
  });

  it('publishes slots in one atomic batch and hands them to on-chain initialization', async () => {
    (publishSlotsBulk as jest.Mock).mockImplementation((_a, slots) =>
      Promise.resolve({ published: slots.length, slots, batchId: 'batch-1' }),
    );
    renderWithClient(<ScheduleTemplateBuilder />);

    fireEvent.click(await screen.findByRole('button', { name: /publish 28 slots/i }));

    expect(await screen.findByText(/published 28 slots \(batch batch-1\)/i)).toBeInTheDocument();
    expect(publishSlotsBulk).toHaveBeenCalledTimes(1);
    const [address, slots, key] = (publishSlotsBulk as jest.Mock).mock.calls[0];
    expect(address).toBe('GDOC');
    expect(slots).toHaveLength(28);
    expect(typeof key).toBe('string');
    expect(screen.getByTestId('onchain-publisher')).toHaveTextContent('28 on-chain');
  });

  it('blocks publishing when the local pre-check finds a conflict with a booked appointment', async () => {
    const tomorrow9 = new Date();
    tomorrow9.setDate(tomorrow9.getDate() + 1);
    tomorrow9.setHours(9, 0, 0, 0);
    (fetchAppointments as jest.Mock).mockResolvedValue([
      { id: 'ap', datetime: tomorrow9.toISOString(), status: 'confirmed' },
      { id: 'cx', datetime: tomorrow9.toISOString(), status: 'cancelled' },
    ]);
    renderWithClient(<ScheduleTemplateBuilder />);

    fireEvent.click(await screen.findByRole('button', { name: /publish 28 slots/i }));

    const alert = await screen.findByText(/nothing was published: 1 slot conflicts/i);
    expect(alert.closest('[role="alert"]')).toHaveTextContent(/overlaps a booked appointment/);
    expect(publishSlotsBulk).not.toHaveBeenCalled();
  });

  it('shows server-side atomic conflicts and reuses the idempotency key on retry', async () => {
    (publishSlotsBulk as jest.Mock)
      .mockRejectedValueOnce({
        message: 'Network Error',
        status: 500,
        code: 'ERR_NETWORK',
        data: null,
      })
      .mockRejectedValueOnce({
        message: 'Conflict',
        status: 409,
        code: 'ERR_BAD_REQUEST',
        data: {
          conflicts: [
            { slotId: 's1', datetime: new Date().toISOString(), reason: 'overlaps_existing_slot' },
          ],
        },
      });
    renderWithClient(<ScheduleTemplateBuilder />);

    fireEvent.click(await screen.findByRole('button', { name: /publish 28 slots/i }));
    expect(
      await screen.findByText(/no slots were published; it is safe to retry/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /publish 28 slots/i }));
    expect(await screen.findByText(/overlaps an existing slot/)).toBeInTheDocument();

    const keys = (publishSlotsBulk as jest.Mock).mock.calls.map((c) => c[2]);
    expect(keys[0]).toBe(keys[1]);
  });
});
