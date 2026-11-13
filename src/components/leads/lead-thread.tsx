'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, cn } from '@/components/ui';
import { sendLeadTextAction } from '@/lib/messaging/lead-text-actions';

type Msg = {
  id: string;
  out: boolean;
  body: string;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  error: string | null;
  auto: boolean;
  /** "Goes out Sat 8:00 AM their time", for a queued text. */
  due: string | null;
  at: string;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * The thread with a lead, oldest at the top, and the box to text them.
 * Replies arrive by webhook; the page re-reads every 15 seconds while open.
 */
export function LeadThread({
  leadId,
  formMessage,
  formAt,
  messages,
  blocked,
  firstNote,
}: {
  leadId: string;
  formMessage: string;
  formAt: string;
  messages: Msg[];
  /** Why texting is off for this lead, or null when it is on. */
  blocked: string | null;
  /** The confirmation that goes out ahead of the first text, or null once sent. */
  firstNote: string | null;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [router]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const send = () =>
    start(async () => {
      setError(null);
      const r = await sendLeadTextAction(leadId, text);
      if (r.error) setError(r.error);
      else setText('');
      router.refresh();
    });

  return (
    <div>
      <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4">
        <Bubble out={false} label="From the form" at={formAt}>
          {formMessage || <span className="italic text-ink-400">No message, just their details.</span>}
        </Bubble>
        {messages.map((m) =>
          m.status === 'skipped' ? (
            <p key={m.id} className="text-center text-xs text-ink-500">
              {m.auto ? 'Auto-reply' : 'Text'} not sent: {m.error} <span className="text-ink-400">· {when(m.at)}</span>
            </p>
          ) : (
            <Bubble
              key={m.id}
              out={m.out}
              at={m.at}
              label={m.due ?? (m.auto ? 'Auto-reply' : undefined)}
              queued={m.status === 'queued'}
              error={m.status === 'failed' || (m.status === 'sent' && m.error) ? m.error : null}
            >
              {m.body}
            </Bubble>
          ),
        )}
        <div ref={end} />
      </div>

      <div className="border-t border-ink-100 px-5 py-4">
        {blocked ? (
          <p className="text-sm text-ink-500">{blocked}</p>
        ) : (
          <>
            {firstNote ? (
              <p className="mb-2 text-xs text-ink-500">
                Just before your first text, they get this one automatically: &ldquo;{firstNote}&rdquo;
              </p>
            ) : null}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim() && !pending) send();
              }}
              rows={3}
              maxLength={1000}
              placeholder="Text them…"
              className="w-full resize-y rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 focus:border-ink-500 focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-xs text-red-700">{error}</span>
              <Button onClick={send} disabled={pending || !text.trim()}>
                {pending ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Bubble({
  out,
  at,
  label,
  queued,
  error,
  children,
}: {
  out: boolean;
  at: string;
  label?: string;
  queued?: boolean;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col', out ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-sm',
          out ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-900',
          queued && 'border border-dashed border-ink-400 bg-white text-ink-600',
          error && 'bg-red-50 text-red-900 ring-1 ring-red-200',
        )}
      >
        {children}
      </div>
      <span className="mt-0.5 text-[11px] text-ink-400">
        {label ? `${label} · ` : ''}
        {when(at)}
        {error ? <span className="text-red-700"> · Not sent: {error}</span> : null}
      </span>
    </div>
  );
}
