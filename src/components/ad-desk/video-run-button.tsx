'use client';

import { useActionState } from 'react';
import { setVideoGroupRunning } from '@/lib/meta/video-group-actions';

/** Start / Stop for a video group, with Facebook's refusal said in place. */
export function VideoRunButton({ groupId, running }: { groupId: string; running: boolean }) {
  const [state, act, pending] = useActionState(setVideoGroupRunning, { error: null });
  return (
    <form action={act} className="flex flex-col items-end gap-1">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="running" value={running ? '0' : '1'} />
      <button
        disabled={pending}
        className={
          running
            ? 'rounded-md border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-800 hover:bg-ink-50 disabled:opacity-50'
            : 'rounded-md bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-50'
        }
      >
        {pending ? (running ? 'Stopping…' : 'Starting…') : running ? 'Stop' : 'Start'}
      </button>
      {state.error ? <span className="max-w-xs text-right text-[11px] text-red-700">{state.error}</span> : null}
    </form>
  );
}
