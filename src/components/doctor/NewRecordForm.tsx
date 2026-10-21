'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createRecord } from '@/services/api.service';
import DiagnosisCodeInput from './DiagnosisCodeInput';
import type { DiagnosisCode } from '@/types';
import { useWalletStore } from '@/store/useWalletStore';
import { STELLAR_CONFIG } from '@/lib/stellar';
import { TransactionBuilder, Networks, Operation, Asset, Memo } from '@stellar/stellar-sdk';

interface Props {
  patientAddress: string;
  onSuccess: () => void;
}

export default function NewRecordForm({ patientAddress, onSuccess }: Props) {
  const { publicKey } = useWalletStore();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ diagnosis: '', prescription: '', notes: '' });
  const [dx, setDx] = useState<DiagnosisCode | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const record = await createRecord({
        patientAddress,
        ...form,
        ...(dx ? { diagnosisCode: dx } : {}),
      });

      // Build a minimal Stellar tx as on-chain proof
      if (window.freighter && publicKey) {
        const server = new (await import('@stellar/stellar-sdk')).Horizon.Server(
          STELLAR_CONFIG.horizonUrl,
        );
        const account = await server.loadAccount(publicKey);
        const tx = new TransactionBuilder(account, {
          fee: '100',
          networkPassphrase:
            STELLAR_CONFIG.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET,
        })
          .addOperation(
            Operation.payment({
              destination: patientAddress,
              asset: Asset.native(),
              amount: '0.0000001',
            }),
          )
          .addMemo(Memo.text(`record:${record.id}`))
          .setTimeout(30)
          .build();

        const signed = await window.freighter.signTransaction(tx.toXDR(), {
          networkPassphrase:
            STELLAR_CONFIG.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET,
        });
        const server2 = new (await import('@stellar/stellar-sdk')).Horizon.Server(
          STELLAR_CONFIG.horizonUrl,
        );
        await server2.submitTransaction(
          (await import('@stellar/stellar-sdk')).TransactionBuilder.fromXDR(
            signed,
            STELLAR_CONFIG.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET,
          ),
        );
      }

      return record;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['doctor-appointments'] });
      setForm({ diagnosis: '', prescription: '', notes: '' });
      setDx(null);
      onSuccess();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="space-y-3"
    >
      <div>
        <label className="block text-xs font-medium text-text-2 mb-1">Diagnosis *</label>
        <DiagnosisCodeInput
          value={dx}
          onChange={(next) => {
            setDx(next);
            if (next) setForm((f) => ({ ...f, diagnosis: next.display }));
          }}
        />
        <input
          required
          value={form.diagnosis}
          onChange={(e) => {
            setDx(null); // free-text edits no longer match the picked code
            setForm((f) => ({ ...f, diagnosis: e.target.value }));
          }}
          className="mt-2 w-full rounded-md border border-border px-3 py-2 text-sm bg-surface-inset text-text-1 focus:outline-none focus:ring-2 focus:ring-border-focus"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-text-2 mb-1">Prescription</label>
        <input
          value={form.prescription}
          onChange={(e) => setForm((f) => ({ ...f, prescription: e.target.value }))}
          className="w-full rounded-md border border-border px-3 py-2 text-sm bg-surface-inset text-text-1 focus:outline-none focus:ring-2 focus:ring-border-focus"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-text-2 mb-1">Notes</label>
        <textarea
          rows={3}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          className="w-full rounded-md border border-border px-3 py-2 text-sm bg-surface-inset text-text-1 focus:outline-none focus:ring-2 focus:ring-border-focus"
        />
      </div>

      {mutation.isError && (
        <p className="text-xs text-red-600">Failed to submit record. Please try again.</p>
      )}

      <button
        type="submit"
        disabled={mutation.isPending}
        className="w-full rounded-md bg-green py-2 text-sm font-semibold text-[#030D09] hover:bg-green-600 disabled:opacity-50"
      >
        {mutation.isPending ? 'Submitting…' : 'Submit Record'}
      </button>
    </form>
  );
}
