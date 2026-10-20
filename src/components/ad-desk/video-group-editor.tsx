'use client';

/**
 * A video group, top to bottom: name, what Facebook should go for, the videos,
 * the words on each ad, budget and radius, then Save / Build. Same order and
 * the same promises as the car groups: the words can change later, and nothing
 * spends until Start on the Ads list.
 */

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, CardHeader, cn } from '@/components/ui';
import { CALL_TO_ACTIONS, COPY_LIMITS } from '@/lib/meta/ad-copy-spec';
import { saveVideoGroup, type VideoGroupInput } from '@/lib/meta/video-group-actions';

export type PickableVideo = {
  id: string;
  kind: 'WALKAROUND' | 'LOT' | 'INTRO';
  label: string;
  poster: string;
  /** Shown, not sent: the server works the link out itself. */
  goesTo: string;
  message: string;
  headline: string;
};

type Ad = { videoId: string; message: string; headline: string; callToAction: string };

type Initial = {
  id: string;
  name: string;
  goal: 'CLICKS' | 'VIEWS';
  dailyBudgetUsd: number;
  radiusMiles: number;
  built: boolean;
  ads: Ad[];
};

const MAX_ADS = 6;

export function VideoGroupEditor({
  rooftopId,
  rooftopName,
  pageName,
  videos,
  initial,
}: {
  rooftopId: string;
  rooftopName: string;
  pageName: string;
  videos: PickableVideo[];
  initial: Initial | null;
}) {
  const router = useRouter();
  const [groupId, setGroupId] = useState(initial?.id ?? null);
  const [name, setName] = useState(initial?.name ?? 'Video');
  const [goal, setGoal] = useState<'CLICKS' | 'VIEWS'>(initial?.goal ?? 'CLICKS');
  const [goalTouched, setGoalTouched] = useState(Boolean(initial));
  const [ads, setAds] = useState<Ad[]>(initial?.ads ?? []);
  const [budget, setBudget] = useState(String(initial?.dailyBudgetUsd ?? 20));
  const [radius, setRadius] = useState(String(initial?.radiusMiles ?? 25));
  const [built, setBuilt] = useState(initial?.built ?? false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const byId = new Map(videos.map((v) => [v.id, v]));
  const walkarounds = videos.filter((v) => v.kind === 'WALKAROUND');
  const own = videos.filter((v) => v.kind !== 'WALKAROUND');

  function toggle(v: PickableVideo) {
    setNote(null);
    setAds((xs) => {
      if (xs.some((a) => a.videoId === v.id)) return xs.filter((a) => a.videoId !== v.id);
      if (xs.length >= MAX_ADS) return xs;
      const next = [...xs, { videoId: v.id, message: v.message, headline: v.headline, callToAction: 'LEARN_MORE' }];
      // The first video picked suggests the goal, until someone picks one on purpose.
      if (!goalTouched && xs.length === 0) setGoal(v.kind === 'WALKAROUND' ? 'CLICKS' : 'VIEWS');
      if (!initial && xs.length === 0 && name === 'Video') setName(v.kind === 'WALKAROUND' ? 'Walkarounds' : v.label);
      return next;
    });
  }

  function patch(videoId: string, p: Partial<Ad>) {
    setNote(null);
    setAds((xs) => xs.map((a) => (a.videoId === videoId ? { ...a, ...p } : a)));
  }

  function save(build: boolean) {
    setError(null);
    setNote(null);
    const input: VideoGroupInput = {
      rooftopId,
      groupId,
      name,
      goal,
      dailyBudgetUsd: Number(budget),
      radiusMiles: Number(radius),
      ads,
    };
    start(async () => {
      const r = await saveVideoGroup(input, build).catch(() => ({ ok: false as const, groupId, error: 'Something went wrong. Try again.' }));
      if (r.groupId && r.groupId !== groupId) {
        setGroupId(r.groupId);
        window.history.replaceState(null, '', `/admin/ad-desk/ads/${rooftopId}/video/${r.groupId}`);
      }
      if (r.ok) {
        setNote(r.message);
        if (build) setBuilt(true);
      } else {
        setError(r.error);
      }
      router.refresh();
    });
  }

  const tile = (v: PickableVideo) => {
    const n = ads.findIndex((a) => a.videoId === v.id);
    return (
      <button
        key={v.id}
        type="button"
        onClick={() => toggle(v)}
        className={cn(
          'relative overflow-hidden rounded-md border-2 text-left',
          n >= 0 ? 'border-ink-900' : 'border-transparent opacity-70 hover:opacity-100',
        )}
      >
        <img src={v.poster} alt="" className="aspect-video w-full bg-black object-contain" />
        <span className="block truncate px-1.5 py-1 text-xs font-medium text-ink-800">{v.label}</span>
        {n >= 0 ? (
          <span className="tnum absolute left-1 top-1 rounded bg-ink-900 px-1.5 text-[11px] font-semibold text-white">Ad {n + 1}</span>
        ) : null}
      </button>
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <Link href="/admin/ad-desk/ads" className="text-xs font-medium text-ink-500 hover:text-ink-900">
        ← Ads
      </Link>
      <div>
        <h1 className="text-lg font-semibold text-ink-900">{initial ? name : 'New video group'}</h1>
        <p className="mt-1 text-sm text-ink-600">
          {rooftopName} · {built ? 'Built on Facebook. Start and stop it from the Ads list.' : 'Not built yet. Nothing is at Facebook.'}
        </p>
      </div>

      <Card>
        <div className="space-y-5 p-5">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink-800">Group name (only you see this)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              className="w-full max-w-sm rounded-md border border-ink-300 px-3 py-2 text-sm"
            />
          </label>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink-800">What should Facebook go for?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['CLICKS', 'Clicks to your website', 'Best for walkarounds — people watch, then tap through to the car.'],
                  ['VIEWS', 'People watching it', 'Cheapest reach. Best for your intro or a lot tour. Fewer clicks.'],
                ] as const
              ).map(([key, title, body]) => (
                <label
                  key={key}
                  className={cn(
                    'flex gap-2 rounded-lg border p-3 text-sm',
                    goal === key ? 'border-ink-900' : 'border-ink-200',
                    built ? 'opacity-60' : 'cursor-pointer',
                  )}
                >
                  <input
                    type="radio"
                    checked={goal === key}
                    disabled={built}
                    onChange={() => {
                      setGoal(key);
                      setGoalTouched(true);
                    }}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium text-ink-900">{title}</span>
                    <span className="block text-xs text-ink-600">{body}</span>
                  </span>
                </label>
              ))}
            </div>
            {built ? <p className="mt-1.5 text-xs text-ink-500">Fixed once built. Make a new group for the other goal.</p> : null}
          </fieldset>
        </div>
      </Card>

      <Card>
        <CardHeader title="Videos" subtitle={`Each one you pick becomes an ad. Up to ${MAX_ADS}.`} />
        <div className="space-y-4 p-5">
          {walkarounds.length ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">Walkarounds</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{walkarounds.map(tile)}</div>
            </div>
          ) : null}
          {own.length ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">Lot videos</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{own.map(tile)}</div>
            </div>
          ) : null}
          {!videos.length ? (
            <p className="text-sm text-ink-600">
              No videos ready yet. Upload a walkaround on a vehicle, or a lot video on{' '}
              <Link href="/admin/website/videos" className="font-medium underline">
                Website → Videos
              </Link>
              .
            </p>
          ) : null}
        </div>
      </Card>

      {ads.length ? (
        <Card>
          <CardHeader title="The ads" subtitle="The words on each one. You can change them later and press Update." />
          <div className="divide-y divide-ink-100">
            {ads.map((a, i) => {
              const v = byId.get(a.videoId);
              const cta = CALL_TO_ACTIONS.find((c) => c.key === a.callToAction)?.label ?? 'Learn more';
              return (
                <div key={a.videoId} className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="space-y-3">
                    <div className="text-sm font-semibold text-ink-900">
                      Ad {i + 1} · {v?.label ?? 'Video'}
                    </div>
                    <p className="text-xs text-ink-500">Clicks go to {v?.goesTo ?? 'your website'}</p>
                    <label className="block">
                      <span className="mb-1 flex justify-between text-sm font-medium text-ink-800">
                        Primary text
                        <span className="tnum text-xs font-normal text-ink-400">
                          {a.message.length}/{COPY_LIMITS.message}
                        </span>
                      </span>
                      <textarea
                        value={a.message}
                        onChange={(e) => patch(a.videoId, { message: e.target.value.slice(0, COPY_LIMITS.message) })}
                        rows={3}
                        className="w-full rounded-md border border-ink-300 px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 flex justify-between text-sm font-medium text-ink-800">
                        Headline
                        <span className="tnum text-xs font-normal text-ink-400">
                          {a.headline.length}/{COPY_LIMITS.headline}
                        </span>
                      </span>
                      <input
                        value={a.headline}
                        onChange={(e) => patch(a.videoId, { headline: e.target.value.slice(0, COPY_LIMITS.headline) })}
                        className="w-full rounded-md border border-ink-300 px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-ink-800">Button</span>
                      <select
                        value={a.callToAction}
                        onChange={(e) => patch(a.videoId, { callToAction: e.target.value })}
                        className="rounded-md border border-ink-300 px-3 py-2 text-sm"
                      >
                        {CALL_TO_ACTIONS.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {/* a plain sketch of the Facebook feed ad — enough to read the words in place */}
                  <div className="self-start overflow-hidden rounded-lg border border-ink-200 bg-white text-[13px]">
                    <div className="px-3 pt-3 font-semibold text-ink-900">{pageName}</div>
                    <div className="text-[11px] text-ink-500 px-3">Sponsored</div>
                    <p className="whitespace-pre-line px-3 py-2 text-ink-800">{a.message || ' '}</p>
                    <div className="relative bg-black">
                      {v ? <img src={v.poster} alt="" className="aspect-video w-full object-contain" /> : null}
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="rounded-full bg-black/60 px-3 py-2 text-white">▶</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-ink-50 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-[11px] uppercase text-ink-500">{v?.goesTo.split('/')[0]}</div>
                        <div className="truncate font-semibold text-ink-900">{a.headline}</div>
                      </div>
                      <span className="shrink-0 rounded-md bg-ink-200 px-2.5 py-1.5 text-xs font-semibold text-ink-900">{cta}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-wrap gap-6 p-5">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink-800">Budget per day</span>
            <span className="flex items-center gap-1 text-sm">
              $
              <input
                type="number"
                min={5}
                max={1000}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="w-24 rounded-md border border-ink-300 px-2 py-1.5"
              />
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink-800">Miles around the lot</span>
            <input
              type="number"
              min={5}
              max={50}
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              className="w-24 rounded-md border border-ink-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>
      </Card>

      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => save(true)} disabled={pending || !ads.length}>
          {pending ? 'Working…' : built ? 'Update on Facebook' : 'Build on Facebook'}
        </Button>
        <Button variant="secondary" onClick={() => save(false)} disabled={pending || !ads.length}>
          Save without building
        </Button>
        {note ? (
          <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
              <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0z" clipRule="evenodd" />
            </svg>
            {note}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-ink-500">Building never spends. It lands stopped; press Start on the Ads list when you&apos;re ready.</p>
    </div>
  );
}
