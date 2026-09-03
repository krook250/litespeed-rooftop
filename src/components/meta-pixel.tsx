'use client';

import Script from 'next/script';

export const META_PIXEL_ID = '2026531694695828';

/**
 * Rooftop's OWN marketing pixel. It measures the ad spend that acquires
 * dealers — nothing else.
 *
 * Mount it only on the signed-out acquisition surfaces (`/signup`, `/welcome`).
 * It must never reach a `/s/[slug]` storefront or the `/admin` console: that
 * traffic is the dealer's customers and the dealer's own staff, and routing it
 * into our dataset would both poison our optimisation signal and put shopper
 * behaviour we have no business collecting into our Business Manager.
 *
 * The dealer's own pixel — the one that belongs on their storefront — is a
 * separate, per-tenant field, still unbuilt (`claude/roles-and-nav.md`).
 */
export function MetaPixel({ event }: { event?: 'CompleteRegistration' }) {
  const track = event ? `\nfbq('track', ${JSON.stringify(event)});` : '';

  return (
    <>
      <Script
        id="meta-pixel"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');${track}
`,
        }}
      />
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          alt=""
          src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
