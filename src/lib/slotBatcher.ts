import {
  BASE_FEE,
  Contract,
  nativeToScVal,
  TransactionBuilder,
  rpc,
} from '@stellar/stellar-sdk';
import {
  STELLAR_CONFIG,
  invokeSorobanContract,
  type TransactionSigner,
} from './stellar';
import type { TimeSlot } from '@/types';

const SLOT_CONTRACT_ID = process.env.NEXT_PUBLIC_SLOT_CONTRACT_ID ?? '';
const MAX_BATCH_SIZE = 100;
const MAX_CONCURRENT = 3;
const RETRY_LIMIT = 3;
const RETRY_BASE_DELAY_MS = 1000;

export type SlotStatus = 'pending' | 'submitting' | 'confirmed' | 'failed';

export interface SlotBatchItem {
  slot: TimeSlot;
  status: SlotStatus;
  txHash?: string;
  error?: string;
  attempts: number;
}

export interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  items: SlotBatchItem[];
}

export type BatchProgressCallback = (progress: BatchProgress) => void;

/**
 * Batches up to 100 slot definitions into sequential Soroban transactions.
 * Each slot requires its own transaction since Soroban allows only one
 * InvokeHostFunctionOp per transaction envelope.
 *
 * Submits in groups of MAX_CONCURRENT with exponential-backoff retry.
 *
 * Time:  O(n) where n = number of slots
 * Space: O(n) for tracking batch item state
 */
export async function batchInitializeSlots(
  slots: TimeSlot[],
  sourceAddress: string,
  signer: TransactionSigner,
  onProgress: BatchProgressCallback,
  signal?: AbortSignal,
): Promise<BatchProgress> {
  if (slots.length > MAX_BATCH_SIZE) {
    throw new Error(
      `Batch size ${slots.length} exceeds maximum of ${MAX_BATCH_SIZE}`,
    );
  }

  const items: SlotBatchItem[] = slots.map((slot) => ({
    slot,
    status: 'pending' as SlotStatus,
    attempts: 0,
  }));

  const progress: BatchProgress = {
    total: items.length,
    completed: 0,
    failed: 0,
    pending: items.length,
    items,
  };

  onProgress({ ...progress, items: [...items] });

  for (let i = 0; i < items.length; i += MAX_CONCURRENT) {
    if (signal?.aborted) break;

    const chunk = items.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.allSettled(
      chunk.map((item) =>
        submitSlotWithRetry(item, sourceAddress, signer, signal),
      ),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const item = chunk[j];
      if (!result || !item) continue;
      if (result.status === 'fulfilled' && result.value) {
        item.status = 'confirmed';
        item.txHash = result.value;
        progress.completed++;
      } else {
        item.status = 'failed';
        item.error = result.status === 'rejected' ? String(result.reason) : 'Unknown error';
        progress.failed++;
      }
      progress.pending--;
    }

    onProgress({ ...progress, items: [...items] });
  }

  return progress;
}

async function submitSlotWithRetry(
  item: SlotBatchItem,
  source: string,
  signer: TransactionSigner,
  signal?: AbortSignal,
): Promise<string> {
  const contract = new Contract(SLOT_CONTRACT_ID);

  for (let attempt = 0; attempt < RETRY_LIMIT; attempt++) {
    if (signal?.aborted) throw new Error('Batch cancelled');

    item.status = 'submitting';
    item.attempts = attempt + 1;

    try {
      const operation = contract.call(
        'initialize_slot',
        nativeToScVal(item.slot.id, { type: 'string' }),
        nativeToScVal(item.slot.datetime, { type: 'string' }),
        nativeToScVal(item.slot.slotType ?? 'regular', { type: 'string' }),
      );
      return await invokeSorobanContract(source, operation, signer);
    } catch (err) {
      if (attempt < RETRY_LIMIT - 1) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Retry limit exceeded');
}

/**
 * Reconciles submitted slots against on-chain ledger state.
 * Verifies each slot exists by simulating a read-only get_slot call.
 *
 * Time:  O(n) — one simulation per slot
 * Space: O(n) for the result map
 */
export async function reconcileSlots(
  slots: TimeSlot[],
  sourceAddress: string,
): Promise<Map<string, boolean>> {
  if (!SLOT_CONTRACT_ID || !STELLAR_CONFIG.sorobanRpcUrl) {
    return new Map();
  }

  const server = new rpc.Server(STELLAR_CONFIG.sorobanRpcUrl);
  const results = new Map<string, boolean>();

  for (const slot of slots) {
    try {
      const contract = new Contract(SLOT_CONTRACT_ID);
      const operation = contract.call(
        'get_slot',
        nativeToScVal(slot.id, { type: 'string' }),
      );

      const account = await server.getAccount(sourceAddress);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_CONFIG.passphrase,
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const simulation = await server.simulateTransaction(tx);
      results.set(slot.id, !('error' in simulation));
    } catch {
      results.set(slot.id, false);
    }
  }

  return results;
}
