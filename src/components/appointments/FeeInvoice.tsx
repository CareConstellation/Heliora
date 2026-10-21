import type { FeeInvoice as Invoice } from '@/lib/feeSubsidy';

export default function FeeInvoice({ invoice }: { invoice: Invoice }) {
  return (
    <dl className="text-xs text-slate-500 space-y-0.5 pt-1 border-t border-slate-200">
      <div className="flex justify-between">
        <dt>Base fee</dt>
        <dd>{invoice.baseFee} XLM</dd>
      </div>
      {invoice.subsidyAmount > 0 && (
        <div className="flex justify-between text-green">
          <dt>
            Subsidy ({invoice.tier}){invoice.grantor ? ` · funded by ${invoice.grantor}` : ''}
          </dt>
          <dd>−{invoice.subsidyAmount} XLM</dd>
        </div>
      )}
      <div className="flex justify-between font-bold text-slate-900 text-sm">
        <dt>You pay</dt>
        <dd>{invoice.patientPays} XLM</dd>
      </div>
    </dl>
  );
}
