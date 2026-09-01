'use client';

/**
 * The dealer's credit application, framed.
 *
 * VERIFIED AGAINST THE REAL THING, 1 Sep 2026. Malabar's live CarsForSale site
 * frames `dwssecuredforms.dealercenter.net` at `width="100%" height="1300"` with
 * no sandbox and no resize messaging — the height is simply generous. Loading
 * that same URL inside the sandbox attribute below rendered the complete form,
 * reCAPTCHA Enterprise included, so the token set here is tested rather than
 * guessed.
 *
 * WHY SANDBOX AT ALL, when the reference implementation does not: without it a
 * framed page can navigate the top window. The provider is allowlisted and is
 * the dealer's own F&I vendor, so this is not about distrusting them — it is
 * that a credit application is the single highest-value page on the site to
 * hijack, and `allow-top-navigation` being absent costs nothing.
 *
 * `allow-same-origin` next to `allow-scripts` is safe here and would not be if
 * the frame were same-origin: it grants the framed document *its own* origin,
 * not ours. Without it the provider cannot reach its own cookies or storage and
 * the form breaks on submit.
 *
 * NO ANALYTICS ON THIS PAGE, EVER. The fields include date of birth and social
 * security number. Anything that records interactions — session replay, form
 * analytics, a heatmap — would put us inside GLBA Safeguards scope for data we
 * have gone out of our way never to touch.
 */

import { useEffect, useRef, useState } from 'react';

const SANDBOX = [
  'allow-scripts',
  'allow-forms',
  'allow-same-origin',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-storage-access-by-user-activation',
].join(' ');

/** Tall enough that the inner frame rarely needs its own scrollbar. */
const MIN_HEIGHT = 1400;
const MAX_HEIGHT = 6000;

export function CreditAppFrame({ src, provider }: { src: string; provider: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(MIN_HEIGHT);

  /*
   * A nested scrollbar inside a page is miserable on a phone, so the frame is
   * given a generous fixed height and the page scrolls instead.
   *
   * If the provider ever posts its content height — several embed scripts do,
   * which is what the `frameId` parameter in their URLs is for — take it.
   * Nothing was observed in four seconds of listening on the live page, so this
   * is opportunistic rather than relied upon: the fixed height has to be right
   * on its own.
   */
  useEffect(() => {
    let origin: string;
    try {
      origin = new URL(src).origin;
    } catch {
      return;
    }
    function onMessage(e: MessageEvent) {
      if (e.origin !== origin) return;
      const raw =
        typeof e.data === 'number'
          ? e.data
          : typeof e.data === 'object' && e.data
            ? (e.data as Record<string, unknown>).height ?? (e.data as Record<string, unknown>).frameHeight
            : Number(String(e.data).match(/\d{3,5}/)?.[0]);
      const n = Number(raw);
      if (Number.isFinite(n) && n >= MIN_HEIGHT && n <= MAX_HEIGHT) setHeight(Math.ceil(n));
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [src]);

  return (
    <iframe
      ref={ref}
      src={src}
      title={`Credit application — secured by ${provider}`}
      sandbox={SANDBOX}
      referrerPolicy="strict-origin-when-cross-origin"
      loading="lazy"
      className="w-full rounded-lg border bg-white"
      style={{ height, borderColor: 'var(--line)' }}
    />
  );
}
