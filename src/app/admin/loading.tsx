/**
 * What the console shows the instant a link is clicked.
 *
 * THE COMPLAINT THIS ANSWERS, in a dealer's words: you click something and
 * there is no way to tell whether the click went. Every admin page is
 * `force-dynamic` — most of them read Meta, the feed builder or a live DNS
 * lookup — so a second or two of nothing is the normal case, not the slow one.
 * On a lot with two bars of signal it is longer, and a person who gets no
 * acknowledgement clicks again. That is not impatience; it is the only
 * information the screen gave them.
 *
 * `loading.tsx` is the App Router's answer and it is free: React swaps this in
 * the moment navigation starts, before the server has done anything. The
 * sidebar and the header stay mounted — only the page area changes — so the
 * click reads as "it went" rather than as a page tearing down.
 *
 * Deliberately dumb grey blocks. A skeleton that mimics one particular screen
 * is wrong on all the others, and a spinner in the middle of an empty area
 * reads as slower than it is. Roughly page-shaped is all it has to be.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>

      <div className="space-y-2">
        <div className="h-5 w-44 animate-pulse rounded bg-ink-200" />
        <div className="h-3 w-80 animate-pulse rounded bg-ink-100" />
      </div>

      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl border border-ink-200 bg-white p-5 shadow-sm"
          style={{ animationDelay: `${i * 90}ms` }}
        >
          <div className="h-3.5 w-36 rounded bg-ink-200" />
          <div className="mt-3 h-3 w-full rounded bg-ink-100" />
          <div className="mt-2 h-3 w-2/3 rounded bg-ink-100" />
        </div>
      ))}
    </div>
  );
}
