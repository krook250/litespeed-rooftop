'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui';
import { saveGaMeasurementId } from '@/lib/store/actions';

export function GaCard({ storefrontId, current }: { storefrontId: string; current: string | null }) {
  const [state, save, saving] = useActionState(saveGaMeasurementId, null);

  return (
    <form action={save} className="space-y-2">
      <input type="hidden" name="storefrontId" value={storefrontId} />
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-800">Google Analytics (optional)</span>
        <span className="mb-2 block text-xs text-ink-500">
          Only if you or your agency already use Google Analytics. Paste the measurement ID, which starts
          with G-. The numbers on this page don&apos;t need it.
        </span>
        <div className="flex flex-wrap gap-2">
          <input
            name="gaMeasurementId"
            defaultValue={current ?? ''}
            placeholder="G-XXXXXXXXXX"
            spellCheck={false}
            autoComplete="off"
            className="w-56 rounded-md border border-ink-300 px-2.5 py-1.5 font-mono text-sm"
          />
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </label>
      {state?.ok ? <p className="text-sm text-emerald-700">{state.message}</p> : null}
      {state && !state.ok ? <p className="text-sm text-red-700">{state.error}</p> : null}
    </form>
  );
}
