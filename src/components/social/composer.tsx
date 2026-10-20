'use client';

/**
 * New post. Top to bottom: what it's of, the media, the caption, where it
 * goes, when. One button at the bottom that says exactly what it will do.
 */

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardHeader, cn } from '@/components/ui';
import { prepareForUpload } from '@/components/intake/capture';
import { createPost, uploadSocialPhoto, type ComposeInput } from '@/lib/social/actions';
import { CAPTION_MAX } from '@/lib/social/caption';
import type { Accounts, ComposerUnit, ComposerVideo } from '@/lib/social/screen';

type Tab = 'VEHICLE' | 'WALKAROUND' | 'VIDEO' | 'CUSTOM';

const TABS: { key: Tab; label: string }[] = [
  { key: 'VEHICLE', label: 'Vehicle' },
  { key: 'WALKAROUND', label: 'Walkaround' },
  { key: 'VIDEO', label: 'Lot video' },
  { key: 'CUSTOM', label: 'Write your own' },
];

/** Instagram only takes JPEG; a PNG from the camera roll is redrawn as one. */
async function asJpeg(file: File): Promise<File> {
  const prepared = await prepareForUpload(file);
  if (prepared.type === 'image/jpeg') return prepared;
  const bmp = await createImageBitmap(prepared);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.88));
  if (!blob) throw new Error('convert');
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

/** `datetime-local` wants local time without a zone. */
function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function Composer({
  lotId,
  accounts,
  units,
  videos,
}: {
  lotId: string;
  accounts: Accounts;
  units: ComposerUnit[];
  videos: ComposerVideo[];
}) {
  const router = useRouter();
  const walkUnits = useMemo(() => units.filter((u) => u.walkaround), [units]);

  const [tab, setTab] = useState<Tab>('VEHICLE');
  const [unitId, setUnitId] = useState<string>(units[0]?.id ?? '');
  const [walkUnitId, setWalkUnitId] = useState<string>(walkUnits[0]?.id ?? '');
  const [videoId, setVideoId] = useState<string>(videos[0]?.id ?? '');
  const [picked, setPicked] = useState<string[]>(units[0]?.photos.slice(0, 10).map((p) => p.url) ?? []);
  const [custom, setCustom] = useState<string[]>([]);
  const [caption, setCaption] = useState<string>(units[0]?.caption ?? '');
  const [facebook, setFacebook] = useState(true);
  const [instagram, setInstagram] = useState(true);
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState(() => localInput(new Date(Date.now() + 3600_000)));
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const ready = accounts.state === 'ready';
  const unit = units.find((u) => u.id === unitId) ?? null;
  const walkUnit = walkUnits.find((u) => u.id === walkUnitId) ?? null;

  const hasMedia =
    tab === 'VEHICLE' ? picked.length > 0 : tab === 'CUSTOM' ? custom.length > 0 : tab === 'WALKAROUND' ? Boolean(walkUnit) : Boolean(videoId);
  const igLinked = ready && Boolean(accounts.igUsername) && accounts.instagramAllowed;
  const igPossible = igLinked && hasMedia;
  const nonJpeg =
    tab === 'VEHICLE' && unit ? unit.photos.filter((p) => picked.includes(p.url) && !p.igOk).length : 0;

  function pickTab(next: Tab) {
    setTab(next);
    setError(null);
    setDone(null);
    if (next === 'VEHICLE') setCaption(unit?.caption ?? '');
    if (next === 'WALKAROUND') setCaption(walkUnit?.walkaround?.caption ?? '');
    if (next === 'VIDEO' || next === 'CUSTOM') setCaption('');
  }

  function pickUnit(id: string) {
    const u = units.find((x) => x.id === id);
    setUnitId(id);
    setPicked(u?.photos.slice(0, 10).map((p) => p.url) ?? []);
    setCaption(u?.caption ?? '');
  }

  function togglePhoto(url: string) {
    setPicked((xs) => (xs.includes(url) ? xs.filter((x) => x !== url) : xs.length >= 10 ? xs : [...xs, url]));
  }

  async function addPhotos(files: File[]) {
    setError(null);
    setUploading(true);
    for (const f of files.slice(0, 10 - custom.length)) {
      try {
        const jpg = await asJpeg(f);
        const fd = new FormData();
        fd.set('file', jpg);
        const r = await uploadSocialPhoto(fd);
        if ('error' in r) setError(r.error);
        else setCustom((xs) => [...xs, r.url]);
      } catch {
        setError(`Couldn’t read ${f.name}.`);
      }
    }
    setUploading(false);
  }

  function submit() {
    setError(null);
    setDone(null);
    const input: ComposeInput = {
      rooftopId: lotId,
      kind: tab,
      vehicleId: tab === 'VEHICLE' ? unitId : tab === 'WALKAROUND' ? walkUnitId : null,
      videoId: tab === 'WALKAROUND' ? (walkUnit?.walkaround?.videoId ?? null) : tab === 'VIDEO' ? videoId : null,
      photoUrls: tab === 'VEHICLE' ? picked : tab === 'CUSTOM' ? custom : [],
      caption,
      facebook,
      instagram: instagram && igPossible,
      scheduledFor: later ? new Date(when).toISOString() : null,
    };
    start(async () => {
      const r = await createPost(input).catch(() => ({ error: 'Something went wrong. Try again.' }));
      if ('error' in r) {
        setError(r.error);
        return;
      }
      const failed = r.post.targets.filter((x) => x.status === 'FAILED');
      if (failed.length) {
        setError(failed.map((x) => `${x.platform === 'FACEBOOK' ? 'Facebook' : 'Instagram'}: ${x.error}`).join(' '));
      } else {
        setDone(later ? 'Scheduled' : r.post.targets.some((x) => x.status !== 'POSTED') ? 'Posting — Instagram takes a minute' : 'Posted');
        if (tab === 'CUSTOM') setCustom([]);
        if (tab === 'CUSTOM' || tab === 'VIDEO') setCaption('');
      }
      router.refresh();
    });
  }

  const canSubmit = ready && (facebook || (instagram && igPossible)) && (hasMedia || (tab === 'CUSTOM' && caption.trim())) && !uploading;
  const label = later ? 'Schedule' : facebook && instagram && igPossible ? 'Post to Facebook and Instagram' : facebook ? 'Post to Facebook' : 'Post to Instagram';

  return (
    <Card>
      <CardHeader title="New post" subtitle="Goes on your Page and Instagram as a normal post. Not an ad — nothing is spent." />
      <div className="space-y-5 p-5">
        {/* what it's of */}
        <div className="flex flex-wrap gap-2">
          {TABS.map((x) => (
            <button
              key={x.key}
              type="button"
              onClick={() => pickTab(x.key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-inset',
                tab === x.key ? 'bg-ink-900 text-white ring-ink-900' : 'bg-white text-ink-700 ring-ink-300 hover:bg-ink-50',
              )}
            >
              {x.label}
            </button>
          ))}
        </div>

        {/* media */}
        {tab === 'VEHICLE' ? (
          units.length ? (
            <div className="space-y-3">
              <select
                value={unitId}
                onChange={(e) => pickUnit(e.target.value)}
                className="w-full max-w-lg rounded-md border border-ink-300 px-3 py-2 text-sm"
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.title} — {u.line}
                  </option>
                ))}
              </select>
              {unit && unit.photos.length ? (
                <>
                  <p className="text-xs text-ink-500">
                    {picked.length} of {unit.photos.length} photos picked. Tap to add or drop; the numbers are the order. Ten at most.
                  </p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {unit.photos.map((p) => {
                      const n = picked.indexOf(p.url);
                      return (
                        <button
                          key={p.url}
                          type="button"
                          onClick={() => togglePhoto(p.url)}
                          className={cn(
                            'relative overflow-hidden rounded-md border-2',
                            n >= 0 ? 'border-ink-900' : 'border-transparent opacity-50',
                          )}
                        >
                          <img src={p.url} alt="" className="aspect-[3/2] w-full object-cover" />
                          {n >= 0 ? (
                            <span className="tnum absolute left-1 top-1 rounded bg-ink-900 px-1.5 text-[11px] font-semibold text-white">
                              {n + 1}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="text-sm text-ink-600">This one has no photos yet. Add them on the vehicle first.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-ink-600">Nothing on this lot is public yet.</p>
          )
        ) : null}

        {tab === 'WALKAROUND' ? (
          walkUnits.length ? (
            <div className="space-y-3">
              <select
                value={walkUnitId}
                onChange={(e) => {
                  setWalkUnitId(e.target.value);
                  setCaption(walkUnits.find((u) => u.id === e.target.value)?.walkaround?.caption ?? '');
                }}
                className="w-full max-w-lg rounded-md border border-ink-300 px-3 py-2 text-sm"
              >
                {walkUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.title} — {u.line}
                  </option>
                ))}
              </select>
              {walkUnit?.walkaround ? (
                <img src={walkUnit.walkaround.poster} alt="" className="w-48 rounded-md bg-black" />
              ) : null}
              <p className="text-xs text-ink-500">Goes out as a video on Facebook and a Reel on Instagram.</p>
            </div>
          ) : (
            <p className="text-sm text-ink-600">
              No walkarounds yet. Upload one from a vehicle&apos;s page in Inventory and it shows up here.
            </p>
          )
        ) : null}

        {tab === 'VIDEO' ? (
          videos.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {videos.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVideoId(v.id)}
                  className={cn(
                    'overflow-hidden rounded-md border-2 text-left',
                    videoId === v.id ? 'border-ink-900' : 'border-transparent opacity-70 hover:opacity-100',
                  )}
                >
                  <img src={v.poster} alt="" className="aspect-video w-full bg-black object-contain" />
                  <span className="block truncate px-1.5 py-1 text-xs font-medium text-ink-800">{v.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-600">
              No lot videos yet. Add them on <a href="/admin/website/videos" className="font-medium underline">Website → Videos</a>.
            </p>
          )
        ) : null}

        {tab === 'CUSTOM' ? (
          <div className="space-y-2">
            {custom.length ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {custom.map((u, i) => (
                  <div key={u} className="relative overflow-hidden rounded-md border border-ink-200">
                    <img src={u} alt="" className="aspect-square w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setCustom((xs) => xs.filter((x) => x !== u))}
                      className="absolute right-1 top-1 rounded bg-white/90 px-1.5 text-xs font-semibold text-ink-800"
                      aria-label={`Remove photo ${i + 1}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                void addPhotos(files);
              }}
            />
            <Button variant="secondary" size="sm" disabled={uploading || custom.length >= 10} onClick={() => fileRef.current?.click()}>
              {uploading ? 'Adding…' : custom.length ? 'Add more photos' : 'Add photos (optional)'}
            </Button>
          </div>
        ) : null}

        {/* caption */}
        <label className="block">
          <span className="mb-1 flex items-baseline justify-between text-sm font-medium text-ink-800">
            Caption
            <span className="tnum text-xs font-normal text-ink-400">
              {caption.length} / {CAPTION_MAX}
            </span>
          </span>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, CAPTION_MAX))}
            rows={6}
            className="w-full rounded-md border border-ink-300 px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-ink-500">Links work on Facebook. Instagram shows them as plain text.</span>
        </label>

        {/* where */}
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink-800">Post to</span>
          <label className="flex items-center gap-2 text-sm text-ink-800">
            <input type="checkbox" checked={facebook} onChange={(e) => setFacebook(e.target.checked)} />
            Facebook{ready ? ` — ${accounts.pageName}` : ''}
          </label>
          <label className={cn('flex items-center gap-2 text-sm', igPossible ? 'text-ink-800' : 'text-ink-400')}>
            <input type="checkbox" checked={instagram && igPossible} disabled={!igPossible} onChange={(e) => setInstagram(e.target.checked)} />
            Instagram
            {ready && accounts.igUsername ? ` — @${accounts.igUsername}` : ''}
            {!ready ? null : !accounts.igUsername ? (
              <span className="text-xs">(no Instagram linked to this Page)</span>
            ) : !accounts.instagramAllowed ? (
              <span className="text-xs">(click Connect again on the Ad Desk to allow Instagram)</span>
            ) : !hasMedia ? (
              <span className="text-xs">(needs a photo or video)</span>
            ) : null}
          </label>
          {igPossible && instagram && nonJpeg ? (
            <p className="text-xs text-amber-700">Instagram will skip {nonJpeg} of these photos — it only takes JPEG.</p>
          ) : null}
        </div>

        {/* when */}
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink-800">When</span>
          <div className="flex flex-wrap items-center gap-4 text-sm text-ink-800">
            <label className="flex items-center gap-2">
              <input type="radio" checked={!later} onChange={() => setLater(false)} /> Now
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={later} onChange={() => setLater(true)} /> Later
            </label>
            {later ? (
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="rounded-md border border-ink-300 px-2 py-1.5 text-sm"
              />
            ) : null}
          </div>
        </div>

        {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={!canSubmit || pending}>
            {pending ? (later ? 'Scheduling…' : 'Posting…') : label}
          </Button>
          {done ? (
            <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
                <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0z" clipRule="evenodd" />
              </svg>
              {done}
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
