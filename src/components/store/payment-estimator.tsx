'use client';

import { useState } from 'react';
import { monthlyPayment, usd } from '@/lib/domain';

const TERMS = [36, 48, 60, 72, 84];

const inputClass =
  'w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5 text-sm tnum text-[var(--text)] ' +
  'focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20';

export function PaymentEstimator({ price }: { price: number }) {
  const [down, setDown] = useState(() => Math.round((price * 0.1) / 50) * 50);
  const [months, setMonths] = useState(72);
  const [apr, setApr] = useState(8.9);

  const safeDown = Math.min(Math.max(0, down), price);
  const payment = monthlyPayment(price, safeDown, apr, months);

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--paper-2)] p-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          Payment estimator
        </span>
        <span className="tnum text-xs text-[var(--text-3)]">{usd(price - safeDown)} financed</span>
      </div>

      <div className="tnum mt-1 flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-tight text-[var(--text)]">
          {usd(Math.round(payment))}
        </span>
        <span className="text-sm text-[var(--text-2)]">/ mo est.</span>
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="est-down" className="text-xs font-medium text-[var(--text-2)]">
              Cash down
            </label>
            <span className="tnum text-xs font-semibold text-[var(--text)]">{usd(safeDown)}</span>
          </div>
          <input
            id="est-down"
            type="range"
            min={0}
            max={price}
            step={250}
            value={safeDown}
            onChange={(e) => setDown(Number(e.target.value))}
            className="mt-1 w-full accent-[var(--brand)]"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="est-term" className="mb-1 block text-xs font-medium text-[var(--text-2)]">
              Term
            </label>
            <select
              id="est-term"
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className={inputClass}
            >
              {TERMS.map((m) => (
                <option key={m} value={m}>
                  {m} months
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="est-apr" className="mb-1 block text-xs font-medium text-[var(--text-2)]">
              APR
            </label>
            <input
              id="est-apr"
              type="number"
              min={0}
              max={30}
              step={0.1}
              value={apr}
              onChange={(e) => setApr(Number(e.target.value) || 0)}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-snug text-[var(--text-3)]">
        Estimate only — not a credit offer or an approval. Payment excludes tax, title, license and
        dealer fees. Your rate and term depend on lender approval and credit tier.
      </p>
    </div>
  );
}
