'use client';

import Script from 'next/script';

export const GA_MEASUREMENT_ID = 'G-JPJLFV5STR';

/**
 * Rooftop's OWN Google Analytics tag. Same boundary as `MetaPixel`, and for
 * the same reasons: it measures the acquisition funnel that buys dealers —
 * the static marketing site plus `/signup` and `/welcome` — and nothing else.
 *
 * It must never reach a `/s/[slug]` storefront or the `/admin` console. That
 * traffic is the dealer's shoppers and the dealer's own staff; collecting it
 * here would bury the signup funnel in noise and put shopper behaviour we have
 * no business collecting into our property. A dealer's own analytics on their
 * own storefront is a separate, per-tenant field, still unbuilt.
 *
 * The `_ga` cookie is written at the registrable domain, so a dealer who reads
 * rooftopauto.com and signs up on app.rooftopauto.com an hour later stays one
 * user and one session source. That is why there is one property and one
 * stream, not one per host.
 */
export function GoogleAnalytics({ event }: { event?: 'sign_up' }) {
  // The stub queues into dataLayer, so an event pushed here is drained
  // whenever gtag.js finishes loading — order between the two tags is safe.
  const track = event
    ? `\ngtag('event', ${JSON.stringify(event)}, { method: 'email' });`
    : '';

  return (
    <>
      <Script
        id="ga-loader"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
      />
      <Script
        id="ga-config"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}');${track}
`,
        }}
      />
    </>
  );
}
