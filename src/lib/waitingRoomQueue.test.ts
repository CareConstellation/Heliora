import { WaitingRoomQueue } from './waitingRoomQueue';

describe('WaitingRoomQueue (#257)', () => {
  it('admits in join order and rejects skipping Admitted', () => {
    const queue = new WaitingRoomQueue();
    queue.join('patient-a', 1);
    queue.join('patient-b', 2);

    expect(queue.waiting().map((e) => e.patientAddress)).toEqual(['patient-a', 'patient-b']);

    queue.transition('patient-a', 'Admitted');
    expect(queue.waiting().map((e) => e.patientAddress)).toEqual(['patient-b']);

    expect(() => queue.transition('patient-a', 'Waiting')).toThrow();
    expect(() => queue.transition('patient-b', 'Concluded')).toThrow();
  });
});
