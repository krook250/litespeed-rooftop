'use client';

/**
 * The dealer's Meta pixel, on the dealer's storefront.
 *
 * TWO PIECES, AND THE SECOND ONE IS THE WHOLE POINT.
 *
 * `MetaPixelBase` is the ordinary base code. `MetaPixelViewContent` fires
 * `ViewContent` with the vehicle's id — and that id is `vehicles.id`, the same
 * value the feed writes into its `vehicle_id` column (`feed-spec.ts`). If those
 * two ever drift, retargeting silently degrades to "somebody visited a page":
 * Meta can still build an audience but can no longer put the specific truck a
 * shopper looked at back in front of them, which is the entire product claim.
 * Any change to the feed's id column has to change this file in the same commit.
 *
 * `content_type: 'vehicle'` rather than `'product'`, because the catalog is a
 * vehicles-vertical catalog. A product-typed event against a vehicle catalog
 * matches nothing and reports no error anywhere.
 *
 * Loaded `afterInteractive`: a tag that blocks a dealer's inventory page from
 * painting costs more in bounced shoppers than it returns in matched events.
 */

import Script from 'next/script';
import { useEffect } from 'react';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

export function MetaPixelBase({ pixelIds }: { pixelIds: string[] }) {
  if (!pixelIds.length) return null;

  return (
    <>
      <Script id="meta-pixel-base" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
${pixelIds.map((id) => `fbq('init','${id}');`).join('\n')}
fbq('track','PageView');`}
      </Script>
      {/*
        The noscript beacon, one per pixel. Cheap, and it is the only thing that
        records a visit from a browser with JavaScript off — which on a used-car
        storefront is a small but real slice of traffic.
      */}
      <noscript>
        {pixelIds.map((id) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={id}
            height="1"
            width="1"
            style={{ display: 'none' }}
            alt=""
            src={`https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1`}
          />
        ))}
      </noscript>
    </>
  );
}

export function MetaPixelViewContent({
  vehicleId,
  price,
}: {
  /** `vehicles.id` — must equal the feed's `vehicle_id`. See the note above. */
  vehicleId: string;
  price: number;
}) {
  useEffect(() => {
    /*
     * Deliberately tolerant. The base tag loads `afterInteractive` and a blocker
     * may stop it entirely, so `fbq` is often absent and that is a normal state,
     * not an error worth logging on a dealer's public site.
     */
    if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
    window.fbq('track', 'ViewContent', {
      content_type: 'vehicle',
      content_ids: [vehicleId],
      value: price,
      currency: 'USD',
    });
  }, [vehicleId, price]);

  return null;
}
