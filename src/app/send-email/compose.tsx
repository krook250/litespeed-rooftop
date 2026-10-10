'use client';

import { useActionState, useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { salesInfoText } from '@/lib/sales-email-template';
import { sendSalesEmail, type SendState } from './actions';

const PHONE_KEY = 'rt_sales_phone';

const input =
  'mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white outline-none placeholder:text-ink-600 focus:border-emerald-500';

export function Compose({ from, replyTo, subject }: { from: string; replyTo: string; subject: string }) {
  const [state, action, pending] = useActionState<SendState, FormData>(sendSalesEmail, null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    try {
      setPhone(localStorage.getItem(PHONE_KEY) ?? '');
    } catch {}
  }, []);

  useEffect(() => {
    if (state?.ok) {
      setName('');
      setEmail('');
    }
  }, [state]);

  function savePhone(v: string) {
    setPhone(v);
    try {
      localStorage.setItem(PHONE_KEY, v);
    } catch {}
  }

  return (
    <div className="space-y-5">
      <form action={action} className="rounded-2xl border border-ink-800 bg-ink-900 p-5">
        <div className="grid gap-x-4 sm:grid-cols-2">
          <label className="block text-xs font-medium text-ink-300">
            Their first name
            <input name="name" value={name} onChange={(e) => setName(e.target.value)} required className={input} />
          </label>
          <label className="mt-4 block text-xs font-medium text-ink-300 sm:mt-0">
            Their email
            <input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={input} />
          </label>
        </div>
        <label className="mt-4 block text-xs font-medium text-ink-300">
          Phone in the signature
          <input name="phone" type="tel" value={phone} onChange={(e) => savePhone(e.target.value)} required placeholder="(360) 555-0100" className={input} />
          <span className="mt-1 block text-[11px] font-normal text-ink-500">Remembered on this device.</span>
        </label>

        <div className="mt-5 flex items-center gap-4">
          <button
            disabled={pending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {pending ? 'Sending…' : 'Send email'}
          </button>
          {state && !pending ? (
            state.ok ? (
              <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> {state.message}
              </span>
            ) : (
              <span className="text-sm text-red-300">{state.message}</span>
            )
          ) : null}
        </div>
      </form>

      <div className="rounded-2xl border border-ink-800 bg-white p-5 text-sm text-ink-900">
        <dl className="mb-4 space-y-1 border-b border-ink-100 pb-3 text-xs text-ink-500">
          <div><dt className="inline font-medium">From: </dt><dd className="inline">{from}</dd></div>
          <div><dt className="inline font-medium">Reply-to: </dt><dd className="inline">{replyTo}</dd></div>
          <div><dt className="inline font-medium">To: </dt><dd className="inline">{email || '—'}</dd></div>
          <div><dt className="inline font-medium">Subject: </dt><dd className="inline text-ink-900">{subject}</dd></div>
        </dl>
        <pre className="whitespace-pre-wrap font-sans leading-relaxed">{salesInfoText(name, phone)}</pre>
      </div>
    </div>
  );
}
