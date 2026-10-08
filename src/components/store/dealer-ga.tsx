'use client';

import Script from 'next/script';

/**
 * The dealer's own Google Analytics, if they gave us an ID. Separate from
 * `components/ga.tsx`, which is Rooftop's own property and must never load on a
 * dealer's storefront. The ID is re-validated by the caller before it gets here.
 */
export function DealerGoogleAnalytics({ id }: { id: string }) {
  return (
    <>
      <Script id="dealer-ga-loader" strategy="afterInteractive" src={`https://www.googletagmanager.com/gtag/js?id=${id}`} />
      <Script
        id="dealer-ga-config"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');`,
        }}
      />
    </>
  );
}
