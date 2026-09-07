import type { Vehicle, Rooftop } from '@/db/schema';
import { relativeTime } from '@/lib/domain';
import { SubmitButton } from './submit-button';
import { VehicleIdentityGrid } from './vehicle-identity-grid';
import {
  FIELD, LABEL, Select, Text,
  SOURCE_OPTS, STATUS_OPTS, TITLE_OPTS,
  lines, numOrStr, str, type VehiclePrefill,
} from './vehicle-fields';

/* Re-exported from its old home so callers importing it from here keep working. */
export type { VehiclePrefill };

export function VehicleForm({
  vehicle,
  rooftops,
  action,
  prefill,
}: {
  vehicle?: Vehicle;
  rooftops?: Rooftop[];
  action: (formData: FormData) => void | Promise<void>;
  /** Scan output. Ignored when editing an existing unit. */
  prefill?: VehiclePrefill;
}) {
  const v = vehicle;
  const p: VehiclePrefill = v ? {} : (prefill ?? {});
  const has = (key: string) => p[key] !== undefined && p[key] !== null && p[key] !== '';

  return (
    <form action={action} className="space-y-6 px-5 py-5">
      {v ? <input type="hidden" name="id" value={v.id} /> : null}

      {rooftops ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            name="rooftopId"
            label="Rooftop"
            defaultValue={str(p, 'rooftopId') ?? rooftops[0]?.id}
            options={rooftops.map((r) => [r.id, r.name] as [string, string])}
          />
          <Text name="acquiredDate" label="Date in" type="date" />
        </div>
      ) : null}

      <section>
        <h3 className="mb-3 text-xs font-semibold text-ink-900">Identity</h3>
        {/* The one section whose fields depend on what is selected, so the one
            section that is a client component. See vehicle-identity-grid.tsx. */}
        <VehicleIdentityGrid vehicle={v} prefill={p} />
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold text-ink-900">Money</h3>
        <p className="mb-3 text-[11px] text-ink-500">
          Cost, pack and recon stay inside. Only the asking price leaves this record.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <Text name="price" label="Asking price" defaultValue={v?.price ?? numOrStr(p, 'price')} scanned={has('price')} />
          <Text name="cost" label="Cost" defaultValue={v?.cost ?? numOrStr(p, 'cost')} scanned={has('cost')} />
          <Text name="pack" label="Pack" defaultValue={v?.pack} />
          <Text name="reconCost" label="Recon" defaultValue={v?.reconCost} />
          <Text name="marketValue" label="Market value" defaultValue={v?.marketValue} />
          {/* Off the window sticker. Worth keeping: "$9,400 under original MSRP"
              is a merchandising line that needs the original number to exist. */}
          <Text name="msrp" label="Original MSRP" defaultValue={v?.msrp ?? numOrStr(p, 'msrp')} scanned={has('msrp')} />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold text-ink-900">Lot status</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select name="status" label="Status" defaultValue={v?.status ?? 'ARRIVED'} options={STATUS_OPTS} />
          {/**
            * Title brand is on the form because a scanned title is the single
            * most common intake document and the brand is the one thing on it
            * that carries legal weight. It defaults to CLEAN, which is also what
            * the column defaults to — a brand is only ever set when a brand word
            * was actually read, never inferred from its absence.
            */}
          <Select name="titleStatus" label="Title" defaultValue={v?.titleStatus ?? str(p, 'titleStatus') ?? 'CLEAN'} options={TITLE_OPTS} scanned={has('titleStatus')} />
          {!v ? (
            <Select name="acquisitionSource" label="Source" defaultValue="AUCTION" options={SOURCE_OPTS} />
          ) : null}
          <div className="flex items-end gap-4 pb-1">
            <label className="flex items-center gap-2 text-xs text-ink-700">
              <input type="checkbox" name="carfaxOneOwner" defaultChecked={v?.carfaxOneOwner} className="h-4 w-4" />
              One owner
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-700">
              <input type="checkbox" name="carfaxNoAccidents" defaultChecked={v?.carfaxNoAccidents} className="h-4 w-4" />
              No accidents
            </label>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold text-ink-900">Merchandising</h3>
        <p className="mb-3 text-[11px] text-ink-500">
          This is the copy that goes everywhere unless a channel has its own override.
        </p>
        <label className="block">
          <span className={LABEL}>Description</span>
          <textarea
            name="description"
            rows={4}
            defaultValue={v?.description ?? ''}
            className={FIELD}
            placeholder="Two or three honest sentences. Dealers who write these themselves outsell the ones who paste the window sticker."
          />
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={LABEL}>Callouts (one per line)</span>
            <textarea
              name="callouts"
              rows={4}
              defaultValue={v ? (v.callouts ?? []).join('\n') : (lines(p, 'callouts') ?? '')}
              className={FIELD}
              placeholder={'One owner\nNew tires\nTow package'}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Options (one per line)</span>
            <textarea
              name="options"
              rows={4}
              defaultValue={v ? (v.options ?? []).join('\n') : (lines(p, 'options') ?? '')}
              className={FIELD}
            />
          </label>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-ink-200 pt-4">
        <div className="mr-auto text-[11px] text-ink-500">
          <p>Saving queues the change out to every channel carrying this unit.</p>
          {/* The confirmation. `saveVehicle` revalidates this route, so after a
              save the server re-renders with a new `updatedAt` and this line
              reads "just now" — which is the only thing on the page that visibly
              changes, since every field keeps the value you just typed. */}
          {v ? <p className="mt-0.5 text-ink-400">Last saved {relativeTime(v.updatedAt)}</p> : null}
        </div>
        <SubmitButton pendingLabel={v ? 'Saving…' : 'Adding…'}>
          {v ? 'Save and syndicate' : 'Add vehicle'}
        </SubmitButton>
      </div>
    </form>
  );
}
