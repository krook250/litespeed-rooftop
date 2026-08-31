/**
 * The two things a buyer on a phone actually wants: call, and take me there.
 *
 * WHY IT IS FIXED TO THE BOTTOM, AND ONLY ON PHONES
 * The header already carries the phone number, and on a desktop it stays in view
 * as you scroll. On a phone the header scrolls away the moment somebody starts
 * looking at cars, and the sale is a tap on a number they can no longer see. A
 * used-car buyer converts by phone far more often than by form, so this is the
 * highest-value 56 pixels on the site — and it is `sm:hidden`, because on a
 * desktop it would be a floating bar covering content for no gain.
 *
 * `pb-[env(safe-area-inset-bottom)]` is not decoration: without it the buttons
 * sit under the iPhone home indicator and the bottom third of the tap target is
 * dead. The matching spacer at the end of the page keeps the footer's last line
 * from hiding behind the bar.
 *
 * Both are plain `<a>` elements with real `tel:` and maps hrefs — no click
 * handler, no JavaScript. They work on a page that has not hydrated, which on a
 * mid-range Android over LTE is the first several seconds of every visit.
 */

import { directionsUrl, telHref, type SeoRooftop } from '@/lib/store/seo';

export function MobileCallBar({
  phone,
  rooftop,
}: {
  phone: string;
  /** The lot to navigate to. Null on a multi-lot storefront — see below. */
  rooftop: SeoRooftop | null;
}) {
  return (
    <>
      {/* Clears the fixed bar so nothing is permanently hidden behind it. */}
      <div aria-hidden className="h-16 sm:hidden" />
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-[var(--paper)] pb-[env(safe-area-inset-bottom)] sm:hidden"
           style={{ borderColor: 'var(--line)' }}>
        <div className="flex items-stretch gap-2 p-2">
          <a
            href={telHref(phone)}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm font-bold"
            style={{ background: 'var(--brand)', color: 'var(--on-brand)' }}
          >
            <PhoneIcon />
            Call {phone}
          </a>
          {rooftop ? (
            <a
              href={directionsUrl(rooftop)}
              target="_blank"
              rel="noopener"
              aria-label={`Directions to ${rooftop.name}`}
              className="flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold"
              style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
            >
              <PinIcon />
              Directions
            </a>
          ) : null}
        </div>
      </div>
    </>
  );
}

/* Inline SVG rather than an icon package: two icons is not worth a dependency,
   and these are on the critical path of every mobile page. */

function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
