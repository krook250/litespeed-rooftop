'use client';

/**
 * The Design card: logo, colors, layout — in that order, one question at a time.
 *
 * WHY A SEQUENCE AND NOT A FORM
 * The previous version showed all three at once and led with the layout picker.
 * That asks a dealer to make an aesthetic judgement before anything on screen
 * belongs to them. Leading with "add your logo" works better for two unrelated
 * reasons: it is the one question every dealer can answer without thinking, and
 * the answer is what lets us guess the other two. By the time colors come up we
 * are not asking for a hex value, we are asking them to confirm one.
 *
 * SKIPPING IS A FIRST-CLASS PATH, not an escape hatch. A dealer who does not
 * have a logo, or does not have the file to hand at 4pm on a Tuesday, must be
 * able to get a website up anyway and come back. Every step here can be skipped,
 * and skipping never leaves the storefront in a broken state — it leaves it on
 * Rooftop's own colors, which are a deliberate default rather than a placeholder.
 *
 * NEXT UP (deliberately not built yet): this is the manual path. The AI site
 * builder slots in as a fourth route at step 1 — "describe your dealership" —
 * and produces the same three values this form writes. Keeping the write path
 * in `saveStorefrontDesign` and out of this component is what makes that a new
 * entry point rather than a rewrite.
 */

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Button, cn } from '@/components/ui';
import { LayoutPreview } from '@/components/website/layout-preview';
import { prepareLogo } from '@/components/website/prepare-logo';
import { saveStorefrontDesign, scanSiteForBranding, type ScannedLogo } from '@/lib/branding/actions';
import {
  ROOFTOP_ACCENT,
  ROOFTOP_BRAND,
  STORE_THEMES,
  STORE_THEME_META,
  contrast,
  normalizeHex,
  quantize,
  storeTheme,
  suggestPalette,
  swapPair,
  type StoreTheme,
  type Suggestion,
} from '@/lib/branding/palette';

type LayoutOption = { id: string; name: string; blurb: string; bestFor: string; previewImage?: string };

type Props = {
  storefrontId: string;
  dealerName: string;
  layout: string;
  theme: StoreTheme;
  brandColor: string;
  accentColor: string;
  logoUrl: string | null;
  layouts: LayoutOption[];
  /** True once the dealer has been through this at least once. */
  configured: boolean;
};

type Step = 1 | 2 | 3;
const STEP_LABELS: Record<Step, string> = { 1: 'Your logo', 2: 'Your colors', 3: 'Your layout' };

export function DesignCard(props: Props) {
  const { storefrontId, dealerName, layouts } = props;

  /* `null` means "show everything" — the mode a dealer lands in when they come
   * back to change one thing. The wizard is for the first pass only. */
  const [step, setStep] = useState<Step | null>(props.configured ? null : 1);
  const [seen, setSeen] = useState<Set<Step>>(new Set([1]));

  const [state, save, saving] = useActionState(saveStorefrontDesign, null);

  const [layout, setLayout] = useState(props.layout);
  const [theme, setTheme] = useState<StoreTheme>(props.theme);
  const [brand, setBrand] = useState(props.brandColor);
  const [accent, setAccent] = useState(props.accentColor);

  /* ---------------------------------------------------------------- logo */

  const [logoKey, setLogoKey] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(props.logoUrl);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /*
   * The file that actually gets sent, downscaled in the browser first.
   *
   * The <input> deliberately has no `name`: if it did, React would serialise the
   * dealer's original 4MB camera roll PNG into the FormData and Next would throw
   * `Body exceeded ... limit` before `saveStorefrontDesign` ran — a full-page
   * crash instead of a message. The form action below puts *this* file in under
   * the key `logo` instead. See `prepare-logo.ts`.
   */
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  const [siteUrl, setSiteUrl] = useState('');
  const [scan, setScan] = useState<{ host: string; logos: ScannedLogo[]; attempted: number; suggestion: Suggestion } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, startScan] = useTransition();

  /** Palette read out of the logo's own pixels, in the browser. */
  const [logoSuggestion, setLogoSuggestion] = useState<Suggestion | null>(null);

  function runScan() {
    setScanError(null);
    startScan(async () => {
      const fd = new FormData();
      fd.set('storefrontId', storefrontId);
      fd.set('siteUrl', siteUrl);
      const res = await scanSiteForBranding(null, fd);
      if (!res.ok) { setScan(null); setScanError(res.error); return; }
      setScan(res.data!);
      // Only auto-apply colors the dealer has not already touched by hand.
      if (!touchedColors.current) applySuggestion(res.data!.suggestion);
      if (res.data!.logos.length) pickCandidate(res.data!.logos[0]!);
    });
  }

  function pickCandidate(l: ScannedLogo) {
    setRemoveLogo(false);
    setFileName(null);
    setLogoFile(null);
    setLogoError(null);
    if (fileRef.current) fileRef.current.value = '';
    setLogoKey(l.key);
    setLogoPreview(l.url);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setRemoveLogo(false);
    setLogoKey(null);
    setLogoError(null);
    setFileName(f.name);
    setPreparing(true);

    const prepared = await prepareLogo(f);
    setPreparing(false);

    if (!prepared.ok) {
      // Nothing is half-applied: the previously saved logo stays on screen and
      // stays saved, so a bad pick costs the dealer a message and nothing else.
      setLogoFile(null);
      setFileName(null);
      setLogoPreview(props.logoUrl);
      setLogoError(prepared.error);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    setLogoFile(prepared.file);
    // Preview the file we will actually send, not the one they picked — if it
    // was flattened or shrunk, this is where they get to see that.
    setLogoPreview(URL.createObjectURL(prepared.file));
  }

  /*
   * Read the palette out of whatever logo is currently showing.
   *
   * This runs in the browser rather than on the server on purpose: a `blob:` URL
   * from a file the dealer just picked never reaches the server until they save,
   * and doing it here means the suggestion appears the instant they choose an
   * image. Both sources are same-origin (`/api/logo/...` or `blob:`), so the
   * canvas is never tainted and `getImageData` is allowed.
   */
  useEffect(() => {
    if (!logoPreview) { setLogoSuggestion(null); return; }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      try {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        setLogoSuggestion(suggestPalette(quantize(data, 1), 'logo'));
      } catch {
        setLogoSuggestion(null); // tainted canvas or a decode failure — not fatal
      }
    };
    img.onerror = () => { if (!cancelled) setLogoSuggestion(null); };
    img.src = logoPreview;
    return () => { cancelled = true; };
  }, [logoPreview]);

  /* -------------------------------------------------------------- colors */

  const touchedColors = useRef(false);

  function applySuggestion(s: Suggestion) {
    setBrand(s.brand);
    setAccent(s.accent);
  }

  function setColor(which: 'brand' | 'accent', raw: string) {
    touchedColors.current = true;
    const hex = normalizeHex(raw);
    if (which === 'brand') setBrand(hex ?? raw);
    else setAccent(hex ?? raw);
  }

  /** Every pair we can offer, deduped, best first. */
  const suggestions = useMemo(() => {
    const out: { key: string; label: string; s: Suggestion }[] = [];
    if (logoSuggestion) out.push({ key: 'logo', label: 'From your logo', s: logoSuggestion });
    if (scan?.suggestion && scan.suggestion.source !== 'default') {
      out.push({ key: 'site', label: `From ${scan.host}`, s: scan.suggestion });
    }
    out.push({ key: 'rooftop', label: 'Rooftop default', s: { brand: ROOFTOP_BRAND, accent: ROOFTOP_ACCENT, source: 'default' } });
    return out.filter((o, i) => out.findIndex((x) => x.s.brand === o.s.brand && x.s.accent === o.s.accent) === i);
  }, [logoSuggestion, scan]);

  const brandOk = /^#[0-9a-fA-F]{6}$/.test(brand);
  const accentOk = /^#[0-9a-fA-F]{6}$/.test(accent);
  const faint = brandOk && contrast(brand, '#ffffff') < 2;

  /* Every preview below is fed through the same resolver the storefront uses,
   * so what the dealer approves here is what gets rendered. Half-typed hex
   * falls back rather than throwing — this runs on every keystroke. */
  const safeBrand = brandOk ? brand : ROOFTOP_BRAND;
  const safeAccent = accentOk ? accent : ROOFTOP_ACCENT;
  const tokens = storeTheme(theme, safeBrand, safeAccent);

  /* ----------------------------------------------------------------- nav */

  const wizard = step !== null;
  function goto(s: Step) {
    setStep(s);
    setSeen((prev) => new Set(prev).add(s));
  }
  const show = (s: Step) => !wizard || step === s;

  return (
    <form
      action={(fd: FormData) => {
        // The file input carries no name (see `logoFile` above), so this is the
        // only way a logo reaches the action — and it is always the prepared one.
        fd.delete('logo');
        if (logoFile) fd.set('logo', logoFile);
        save(fd);
      }}
      className="space-y-6"
    >
      <input type="hidden" name="storefrontId" value={storefrontId} />
      <input type="hidden" name="layout" value={layout} />
      <input type="hidden" name="theme" value={theme} />
      <input type="hidden" name="brandColor" value={brand} />
      <input type="hidden" name="accentColor" value={accent} />
      {logoKey ? <input type="hidden" name="logoKey" value={logoKey} /> : null}
      {removeLogo ? <input type="hidden" name="removeLogo" value="on" /> : null}

      {/* ------------------------------------------------------- stepper */}
      {wizard ? (
        <ol className="flex flex-wrap items-center gap-1.5 text-xs">
          {([1, 2, 3] as Step[]).map((s, i) => (
            <li key={s} className="flex items-center gap-1.5">
              {i > 0 ? <span className="text-ink-300">›</span> : null}
              <button
                type="button"
                disabled={!seen.has(s)}
                onClick={() => goto(s)}
                className={cn(
                  'rounded-full px-2.5 py-1 font-medium transition',
                  step === s ? 'text-white' : seen.has(s) ? 'bg-ink-100 text-ink-700 hover:bg-ink-200' : 'text-ink-400',
                )}
                style={step === s ? { background: safeBrand, color: storeTheme('LIGHT', safeBrand, safeAccent).onBrand } : undefined}
              >
                {i + 1}. {STEP_LABELS[s]}
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      {/* ---------------------------------------------------------- logo */}
      <section hidden={!show(1)} className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-ink-900">Add your logo</h3>
          <p className="mt-0.5 text-sm text-ink-600">
            It goes at the top of every page of your website and on every listing you share.
            {' '}Give us your website address and we&apos;ll go and get it — or upload the file.
          </p>
        </div>

        {logoPreview && !removeLogo ? (
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-ink-200 bg-ink-50 p-3">
            <img src={logoPreview} alt="Your logo" className="h-12 w-auto max-w-[200px] object-contain" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium text-ink-900">{fileName ?? 'This is the one we\u2019ll use.'}</p>
              <p className="text-xs text-ink-500">Change it any time — it updates everywhere at once.</p>
            </div>
            <Button type="button" variant="ghost" onClick={() => {
              setLogoKey(null); setLogoPreview(null); setFileName(null); setLogoFile(null); setLogoError(null);
              setRemoveLogo(Boolean(props.logoUrl));
              if (fileRef.current) fileRef.current.value = '';
            }}>
              Remove
            </Button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* --- from a website */}
          <div className="rounded-xl border border-ink-200 p-4">
            <p className="text-sm font-semibold text-ink-900">Get it from my website</p>
            <p className="mt-0.5 text-xs text-ink-500">
              The fastest way. We read your site, pull the logo out of the header, and pick up your
              colors while we&apos;re there.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <input
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runScan(); } }}
                placeholder="yourdealership.com"
                className="min-w-0 flex-1 rounded-md border border-ink-300 px-3 py-2 text-sm"
              />
              <Button type="button" onClick={runScan} disabled={scanning || siteUrl.trim().length < 4}>
                {scanning ? 'Looking…' : 'Find my logo'}
              </Button>
            </div>

            {scanError ? (
              <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{scanError}</p>
            ) : null}

            {scan && !scan.logos.length && !scanError ? (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {scan.attempted > 0
                  ? `We found ${scan.attempted === 1 ? 'an image' : scan.attempted + ' images'} on ${scan.host} but couldn't download ${scan.attempted === 1 ? 'it' : 'any of them'} — the host is refusing us. Upload the file instead.`
                  : `We reached ${scan.host} but couldn't find an image we could use. Upload the file instead, or skip this and come back to it.`}
              </p>
            ) : null}

            {scan?.logos.length ? (
              <div className="mt-3">
                <p className="mb-2 text-xs font-medium text-ink-600">
                  {scan.logos.length === 1 ? 'Is this it?' : 'Which one is your logo?'}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {scan.logos.map((l) => (
                    <button
                      key={l.key}
                      type="button"
                      onClick={() => pickCandidate(l)}
                      className={cn(
                        'group rounded-lg border-2 bg-white p-2 text-left transition',
                        logoKey === l.key ? 'border-[var(--pick)]' : 'border-ink-200 hover:border-ink-400',
                      )}
                      style={{ ['--pick' as string]: safeBrand }}
                    >
                      <span className="flex h-10 items-center justify-center">
                        <img src={l.url} alt={l.hint} className="max-h-10 max-w-full object-contain" />
                      </span>
                      <span className="mt-1 block truncate text-[10px] text-ink-500">{l.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* --- from a file */}
          <div className="rounded-xl border border-ink-200 p-4">
            <p className="text-sm font-semibold text-ink-900">Upload the file</p>
            <p className="mt-0.5 text-xs text-ink-500">
              PNG, JPEG or WebP. A PNG with a transparent background looks best — if it&apos;s a big
              file we&apos;ll shrink it for you.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onFile}
              disabled={preparing}
              className="mt-3 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-ink-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-ink-800 disabled:opacity-50"
            />
            {preparing ? <p className="mt-2 text-xs text-ink-500">Getting it ready…</p> : null}
            {logoError ? <p className="mt-2 text-xs text-red-700">{logoError}</p> : null}
            <p className="mt-2 text-xs text-ink-500">
              We can&apos;t accept SVG — an SVG can carry scripts, and it would be running on your own website.
            </p>
          </div>
        </div>

        {wizard ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 pt-4">
            <Button type="button" onClick={() => goto(2)}>Next — colors</Button>
            <button type="button" onClick={() => goto(2)} className="text-sm text-ink-500 underline underline-offset-2 hover:text-ink-800">
              I don&apos;t have one handy — skip for now
            </button>
            <button type="button" onClick={() => goto(3)} className="ml-auto text-sm text-ink-500 hover:text-ink-800">
              Skip to layout →
            </button>
          </div>
        ) : null}
      </section>

      {/* -------------------------------------------------------- colors */}
      <section hidden={!show(2)} className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-ink-900">Your colors</h3>
          <p className="mt-0.5 text-sm text-ink-600">
            The brand color is your header and your links. The accent is the one thing on the page you
            want clicked — the price, the button, the phone number. Then pick how light or dark the
            site sits.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {suggestions.map((o) => {
            const on = o.s.brand.toLowerCase() === brand.toLowerCase() && o.s.accent.toLowerCase() === accent.toLowerCase();
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => applySuggestion(o.s)}
                className={cn(
                  'rounded-xl border-2 p-3 text-left transition',
                  on ? 'border-ink-900 bg-ink-50' : 'border-ink-200 hover:border-ink-400',
                )}
              >
                <span className="flex gap-1.5">
                  <span className="h-8 flex-1 rounded-md" style={{ background: o.s.brand }} />
                  <span className="h-8 w-8 rounded-md" style={{ background: o.s.accent }} />
                </span>
                <span className="mt-2 block text-xs font-semibold text-ink-800">{o.label}</span>
                <span className="mt-0.5 block font-mono text-[10px] text-ink-500">{o.s.brand} · {o.s.accent}</span>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {([['brand', 'Brand color', brand, brandOk], ['accent', 'Accent color', accent, accentOk]] as const).map(
            ([which, label, value, valid]) => (
              <label key={which}>
                <span className="mb-1 block text-sm font-medium text-ink-800">{label}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={valid ? value : '#000000'}
                    onChange={(e) => setColor(which, e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded border border-ink-300"
                  />
                  <input
                    value={value}
                    onChange={(e) => setColor(which, e.target.value)}
                    className={cn('w-32 rounded-md border px-2 py-1.5 font-mono text-sm',
                      valid ? 'border-ink-300' : 'border-red-400 bg-red-50')}
                  />
                </div>
              </label>
            ),
          )}
        </div>

        {/*
          Which of a dealer's two colors is the "brand" one is a frequency count
          off their logo, and a logo that is mostly one color with a small bright
          mark in another gets it backwards about half the time. Cheaper to offer
          the swap than to explain the guess.
        */}
        <button
          type="button"
          onClick={() => { touchedColors.current = true; const p = swapPair({ brand, accent }); setBrand(p.brand); setAccent(p.accent); }}
          className="inline-flex items-center gap-2 rounded-md border border-ink-300 px-3 py-1.5 text-sm font-medium text-ink-700 hover:border-ink-400 hover:bg-ink-50"
        >
          <span aria-hidden>⇄</span> Swap the two colors
        </button>

        {faint ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            That brand color is very light. White text on it will be hard to read — worth going a shade
            or two darker.
          </p>
        ) : null}

        {/* ------------------------------------------------- light or dark */}
        <div className="border-t border-ink-100 pt-4">
          <p className="text-sm font-medium text-ink-800">Light or dark</p>
          <p className="mt-0.5 text-xs text-ink-500">
            This is the whole page, not just the top — background, cards and text all move together.
            Photos never invert, so your inventory looks the same either way.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {STORE_THEMES.map((id) => (
              <label
                key={id}
                className={cn(
                  'cursor-pointer rounded-xl border-2 p-3 transition',
                  theme === id ? 'border-[var(--pick)] bg-ink-50' : 'border-ink-200 hover:border-ink-400',
                )}
                style={{ ['--pick' as string]: safeBrand }}
              >
                <input
                  type="radio"
                  name="themePick"
                  className="sr-only"
                  checked={theme === id}
                  onChange={() => setTheme(id)}
                />
                <LayoutPreview
                  id={layout}
                  theme={id}
                  brand={safeBrand}
                  accent={safeAccent}
                  logoUrl={removeLogo ? null : logoPreview}
                  dealerName={dealerName}
                />
                <p className="mt-2 text-sm font-semibold text-ink-900">{STORE_THEME_META[id].name}</p>
                <p className="mt-0.5 text-xs text-ink-600">{STORE_THEME_META[id].blurb}</p>
              </label>
            ))}
          </div>
        </div>

        {/* the real header, in their colors and their theme, at real size */}
        <div className="overflow-hidden rounded-lg border border-ink-200">
          {tokens.headerRule ? (
            <div className="h-1 w-full" style={{ background: tokens.headerRule }} />
          ) : null}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ background: tokens.headerBg, borderBottom: `1px solid ${tokens.headerBorder}` }}
          >
            <span className="flex items-center gap-2">
              {logoPreview && !removeLogo ? (
                <img src={logoPreview} alt="" className="h-6 w-auto max-w-[120px] object-contain" />
              ) : (
                <span className="text-sm font-bold uppercase tracking-wider" style={{ color: tokens.headerFg }}>
                  {dealerName}
                </span>
              )}
            </span>
            <span className="flex items-center gap-3">
              <span className="tnum text-sm font-semibold" style={{ color: tokens.headerLink }}>
                (360) 555-0142
              </span>
              <span
                className="rounded-full px-3 py-1 text-xs font-bold"
                style={{ background: tokens.accent, color: tokens.onAccent }}
              >
                Check availability
              </span>
            </span>
          </div>
          <div className="px-4 py-3" style={{ background: tokens.page }}>
            <span
              className="inline-block rounded-md border px-3 py-2 text-xs"
              style={{ background: tokens.paper, borderColor: tokens.line, color: tokens.text2 }}
            >
              2021 Ram 1500 Big Horn ·{' '}
              <span className="tnum font-bold" style={{ color: tokens.accentOnPage }}>$34,995</span>
            </span>
          </div>
        </div>

        {wizard ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 pt-4">
            <Button type="button" variant="secondary" onClick={() => goto(1)}>Back</Button>
            <Button type="button" onClick={() => goto(3)}>Next — layout</Button>
          </div>
        ) : null}
      </section>

      {/* --------------------------------------------------------- layout */}
      <section hidden={!show(3)} className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-ink-900">Your layout</h3>
          <p className="mt-0.5 text-sm text-ink-600">
            These differ by how a buyer moves, not by decoration — pick the one that matches how you sell.
            You can change it later without losing anything.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {layouts.map((l) => (
            <label
              key={l.id}
              className={cn(
                'cursor-pointer rounded-xl border-2 p-3 transition',
                layout === l.id ? 'border-[var(--pick)] bg-ink-50' : 'border-ink-200 hover:border-ink-400',
              )}
              style={{ ['--pick' as string]: safeBrand }}
            >
              {/* named so the three read as one group to a screen reader; the value
                  that actually submits is the hidden `layout` input above */}
              <input
                type="radio"
                name="layoutPick"
                className="sr-only"
                checked={layout === l.id}
                onChange={() => setLayout(l.id)}
              />
              <LayoutPreview
                id={l.id}
                theme={theme}
                brand={safeBrand}
                accent={safeAccent}
                logoUrl={removeLogo ? null : logoPreview}
                previewImage={l.previewImage}
                dealerName={dealerName}
              />
              <p className="mt-2 text-sm font-semibold text-ink-900">{l.name}</p>
              <p className="mt-0.5 text-xs text-ink-600">{l.blurb}</p>
              <p className="mt-1 text-[11px] italic text-ink-500">{l.bestFor}</p>
            </label>
          ))}
        </div>

        {wizard ? (
          <div className="border-t border-ink-100 pt-4">
            <Button type="button" variant="secondary" onClick={() => goto(2)}>Back</Button>
          </div>
        ) : null}
      </section>

      {/* ----------------------------------------------------------- save */}
      <div className="flex flex-wrap items-center gap-3 border-t border-ink-200 pt-4">
        <Button type="submit" disabled={saving || preparing || !brandOk || !accentOk}>
          {saving ? 'Saving…' : wizard ? 'Save and publish' : 'Save design'}
        </Button>
        {wizard ? (
          <button type="button" onClick={() => setStep(null)} className="text-sm text-ink-500 hover:text-ink-800">
            Show everything at once
          </button>
        ) : (
          <button type="button" onClick={() => { setStep(1); setSeen(new Set([1])); }} className="text-sm text-ink-500 hover:text-ink-800">
            Walk me through it again
          </button>
        )}
        {state?.ok ? <span className="text-sm text-emerald-700">{state.message}</span> : null}
        {state && !state.ok ? <span className="text-sm text-red-700">{state.error}</span> : null}
      </div>
    </form>
  );
}
