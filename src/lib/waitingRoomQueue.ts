/**
 * Waiting-room state machine for a telemedicine consultation (#257).
 *
 * This is the pure queue/transition logic only; the doctor admittance panel
 * UI and the Web Audio admittance chime are a larger follow-up that wires
 * into these transitions.
 */
export type WaitingRoomStatus = 'Waiting' | 'Admitted' | 'Concluded';

export interface WaitingRoomEntry {
  patientAddress: string;
  status: WaitingRoomStatus;
  joinedAt: number;
}

const ALLOWED_TRANSITIONS: Record<WaitingRoomStatus, WaitingRoomStatus[]> = {
  Waiting: ['Admitted'],
  Admitted: ['Concluded'],
  Concluded: [],
};

export class WaitingRoomQueue {
  private entries = new Map<string, WaitingRoomEntry>();

  join(patientAddress: string, joinedAt = Date.now()): WaitingRoomEntry {
    const entry: WaitingRoomEntry = { patientAddress, status: 'Waiting', joinedAt };
    this.entries.set(patientAddress, entry);
    return entry;
  }

  /** Throws if the transition isn't legal for the entry's current status. */
  transition(patientAddress: string, next: WaitingRoomStatus): WaitingRoomEntry {
    const entry = this.entries.get(patientAddress);
    if (!entry) throw new Error(`${patientAddress} is not in the waiting room`);
    if (!ALLOWED_TRANSITIONS[entry.status].includes(next)) {
      throw new Error(`Cannot move from ${entry.status} to ${next}`);
    }
    entry.status = next;
    return entry;
  }

  waiting(): WaitingRoomEntry[] {
    return [...this.entries.values()]
      .filter((e) => e.status === 'Waiting')
      .sort((a, b) => a.joinedAt - b.joinedAt);
  }
}
