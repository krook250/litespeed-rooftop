import Link from 'next/link';
import { Card, cn } from '@/components/ui';
import { onboardingSummary, type Onboarding } from '@/lib/onboarding';

/**
 * The first-run checklist, on the two home screens.
 *
 * Renders `null` once every gating step is done — see the note in
 * `@/lib/onboarding` about why there is no dismiss button. The consequence
 * worth stating: **this component is invisible to almost every dealer almost
 * all the time**, so it has to earn its space on the day it does show.
 *
 * It leads with one step rather than presenting four equal choices. A dealer
 * who has just signed up does not want a menu, they want to be told what to do
 * first, and the ordering in `buildOnboarding` is what makes that answer right.
 * The rest of the list is visible underneath so the shape of the work is clear —
 * a single instruction with no context reads as a nag.
 */
export function OnboardingCard({ o }: { o: Onboarding }) {
  if (o.complete) return null;
  const next = o.next;

  return (
    <Card className="border-emerald-600/30 bg-white">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 border-b border-ink-200 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink-900">{onboardingSummary(o)}</h2>
          {next ? <p className="mt-1 text-sm text-ink-600">{next.help}</p> : null}
        </div>
        {/* A link, styled as the primary button. `Button` renders a real
            <button> and has no asChild, and wrapping a Link in one nests an
            anchor inside a button — invalid, and it breaks middle-click. */}
        {next ? (
          <Link
            href={next.href}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-ink-800"
          >
            {next.cta}
          </Link>
        ) : null}
      </div>

      <ol className="divide-y divide-ink-100">
        {o.steps.map((s) => (
          <li key={s.id} className="flex items-start gap-3 px-5 py-3">
            {/*
              A ring rather than an empty box for the open steps: four empty
              checkboxes on a brand-new account reads as four chores. The done
              ones get the tick and the muted label, so progress is what the eye
              catches first.
            */}
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                s.done ? 'bg-emerald-500 text-white' : 'ring-1 ring-inset ring-ink-300',
              )}
            >
              {s.done ? '✓' : ''}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={cn(
                    'text-sm font-medium',
                    s.done ? 'text-ink-400 line-through' : 'text-ink-900',
                  )}
                >
                  {s.label}
                </span>
                {!s.gating && !s.done ? (
                  <span className="text-[11px] text-ink-400">when you get to it</span>
                ) : null}
              </div>
              {!s.done && s.id !== next?.id ? (
                <p className="mt-0.5 text-xs text-ink-500">{s.help}</p>
              ) : null}
            </div>
            {!s.done && s.id !== next?.id ? (
              <Link
                href={s.href}
                className="shrink-0 text-xs font-medium text-emerald-700 hover:underline"
              >
                {s.cta}
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}
