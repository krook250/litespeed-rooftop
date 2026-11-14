'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/components/ui';
import type { Inbox, ThreadView } from '@/lib/messaging/chat';
import { LeadThread } from './lead-thread';

/**
 * Texting with leads from any screen. A round button bottom-right with an
 * unread count; it opens the conversations, and a conversation opens its
 * thread in the same panel. Full screen on a phone, a panel on desktop.
 *
 * Renders nothing until texting is approved for the group.
 */

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return d < 14 ? `${d}d` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export function ChatBubble() {
  const [box, setBox] = useState<Inbox | null>(null);
  const [open, setOpen] = useState(false);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [q, setQ] = useState('');

  // Plain GETs, never server actions: see src/app/api/chat/inbox/route.ts.
  const loadInbox = useCallback(() => {
    fetch('/api/chat/inbox', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<Inbox>) : null))
      .then((d) => d && setBox(d), () => {});
  }, []);
  const loadThread = useCallback(() => {
    if (!leadId) return;
    fetch(`/api/chat/thread?lead=${encodeURIComponent(leadId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<ThreadView>) : null))
      .then((d) => d && setThread(d), () => {});
  }, [leadId]);

  // The badge stays current while the app is open; faster while the panel is.
  useEffect(() => {
    loadInbox();
    const id = setInterval(loadInbox, open ? 15_000 : 30_000);
    return () => clearInterval(id);
  }, [open, loadInbox]);

  useEffect(() => {
    setThread(null);
    loadThread();
  }, [loadThread]);

  if (!box?.enabled) return null;

  const close = () => {
    setOpen(false);
    setLeadId(null);
  };
  const back = () => {
    setLeadId(null);
    loadInbox();
  };
  const needle = q.trim().toLowerCase();
  const digits = needle.replace(/\D/g, '');
  const list = box.conversations.filter(
    (c) => !needle || c.name.toLowerCase().includes(needle) || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits)),
  );

  return (
    <>
      {open ? (
        <div
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden bg-white',
            'inset-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]',
            'sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[600px] sm:max-h-[calc(100vh-8rem)] sm:w-[380px] sm:rounded-2xl sm:p-0 sm:shadow-2xl sm:ring-1 sm:ring-ink-200',
          )}
        >
          {/* header */}
          <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3">
            {leadId ? (
              <button type="button" onClick={back} className="-ml-1 rounded-md px-1.5 py-0.5 text-lg text-ink-600 hover:bg-ink-100" aria-label="Back">
                ←
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              {leadId ? (
                <>
                  <p className="truncate text-sm font-semibold text-ink-900">{thread?.name ?? '…'}</p>
                  <p className="truncate text-xs text-ink-500">
                    {thread?.vehicle ?? thread?.phone ?? ''}
                    {thread ? (
                      <>
                        {' · '}
                        <Link href={`/admin/leads/${leadId}`} onClick={close} className="text-emerald-700 hover:underline">
                          Full lead
                        </Link>
                      </>
                    ) : null}
                  </p>
                </>
              ) : (
                <p className="text-sm font-semibold text-ink-900">Texts with leads</p>
              )}
            </div>
            <button type="button" onClick={close} className="rounded-md px-2 py-0.5 text-lg text-ink-500 hover:bg-ink-100" aria-label="Close">
              ✕
            </button>
          </div>

          {/* body */}
          {leadId ? (
            thread ? (
              <div className="min-h-0 flex-1">
                <LeadThread
                  key={thread.leadId}
                  leadId={thread.leadId}
                  formMessage={thread.formMessage}
                  formAt={thread.createdAt}
                  messages={thread.messages}
                  blocked={thread.blocked}
                  firstNote={thread.firstNote}
                  refresh={loadThread}
                  fill
                />
              </div>
            ) : (
              <p className="px-5 py-6 text-sm text-ink-500">Loading…</p>
            )
          ) : (
            <>
              <div className="border-b border-ink-100 px-4 py-2">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search name or phone"
                  className="w-full rounded-lg border border-ink-200 px-3 py-1.5 text-sm focus:border-ink-500 focus:outline-none"
                />
              </div>
              <ul className="min-h-0 flex-1 divide-y divide-ink-100 overflow-y-auto">
                {list.length === 0 ? (
                  <li className="px-5 py-6 text-sm text-ink-500">
                    {box.conversations.length
                      ? 'Nobody by that name or number.'
                      : 'No one to text yet. Leads who tick the box asking to be texted show up here.'}
                  </li>
                ) : (
                  list.map((c) => (
                    <li key={c.leadId}>
                      <button
                        type="button"
                        onClick={() => setLeadId(c.leadId)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-ink-50"
                      >
                        <span
                          className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', c.unread ? 'bg-emerald-600' : 'bg-transparent')}
                          aria-label={c.unread ? 'Unread' : undefined}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className={cn('truncate text-sm text-ink-900', c.unread ? 'font-bold' : 'font-semibold')}>{c.name}</span>
                            <span className="shrink-0 text-[11px] text-ink-400">{ago(c.at)}</span>
                          </span>
                          {c.vehicle ? <span className="block truncate text-xs text-ink-500">{c.vehicle}</span> : null}
                          <span className={cn('block truncate text-xs', c.unread ? 'text-ink-900' : 'text-ink-500')}>
                            {c.last ? `${c.last.out ? 'You: ' : ''}${c.last.body}` : 'No texts yet'}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </>
          )}
        </div>
      ) : null}

      {/* the bubble; hidden on a phone while the full-screen panel is up */}
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label={open ? 'Close texts' : 'Texts with leads'}
        className={cn(
          'fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-5 z-30 h-14 w-14 items-center justify-center rounded-full bg-ink-900 text-white shadow-lg hover:bg-ink-800 sm:right-6',
          open ? 'hidden sm:flex' : 'flex',
        )}
      >
        {open ? (
          <span className="text-xl" aria-hidden="true">✕</span>
        ) : (
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z" />
          </svg>
        )}
        {box.unread && !open ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white ring-2 ring-white">
            {box.unread > 9 ? '9+' : box.unread}
          </span>
        ) : null}
      </button>
    </>
  );
}
