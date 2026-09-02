import { Card, cn } from '@/components/ui';

/**
 * The Lot Walk scoreboard.
 *
 * Lot Walk is the morale view — see `claude/log-vs-social.md`. The four flat
 * tiles it used to share with the activity log were the log's tiles: correct,
 * countable, and completely inert. A store that opens this page every morning
 * because it is *pleasant* needs numbers that say how the lot is doing, not
 * four figures that read zero until somebody sells something.
 *
 * So the six here are operating numbers with a line of context under each —
 * a number alone is a fact, a number against a benchmark is a score. The four
 * money figures are not lost; they moved to `TodaysBoard` in the rail, which
 * is where a sales floor actually looks for them.
 *
 * **The activity log keeps the plain four.** This component is never rendered
 * in log mode. That is the whole split: same events, same query, different
 * presentation.
 */

type Tone = 'good' | 'warn' | 'bad';

const TONE: Record<Tone, string> = {
  good: 'text-emerald-700',
  warn: 'text-age-warn',
  bad: 'text-age-aged',
};

function Tile({
  label,
  value,
  sub,
  tone,
  subTone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  subTone?: Tone;
}) {
  return (
    <div className="min-w-0 border-ink-200 px-3.5 py-3 [&:not(:last-child)]:border-r">
      <div className="truncate text-[10px] font-bold uppercase tracking-wider text-ink-500">
        {label}
      </div>
      <div
        className={cn(
          'tnum mt-1 text-2xl font-bold leading-none tracking-tight',
          tone ? TONE[tone] : 'text-ink-900',
        )}
      >
        {value}
      </div>
      {sub ? (
        <div
          className={cn(
            'mt-1.5 text-[11px] leading-tight',
            subTone ? cn(TONE[subTone], 'font-semibold') : 'text-ink-500',
          )}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}

export type ScoreboardData = {
  liveCount: number;
  sold30: number;
  daysSupply: number | null;
  turnRate: number | null;
  turnBenchmark: number;
  avgDays: number | null;
  freshAir: number;
  atRisk: number;
  aging46to60: number;
  frontLine: number;
  inRecon: number;
  vdpViews7: number;
  leads7: number;
};

export function Scoreboard(d: ScoreboardData) {
  const turnShort = d.turnRate != null && d.turnRate < d.turnBenchmark;
  return (
    <Card className="grid grid-cols-2 divide-y divide-ink-200 sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6">
      <Tile
        label="Days supply"
        value={d.daysSupply == null ? '—' : String(d.daysSupply)}
        sub={`${d.liveCount} units · ${d.sold30} sold / 30d`}
      />
      <Tile
        label="Turn rate"
        value={d.turnRate == null ? '—' : `${d.turnRate}×`}
        sub={
          d.turnRate == null
            ? 'Needs 30 days of sales'
            : `${turnShort ? 'below' : 'above'} ${d.turnBenchmark}×${
                d.avgDays == null ? '' : ` · avg ${d.avgDays}d`
              }`
        }
        subTone={d.turnRate == null ? undefined : turnShort ? 'bad' : 'good'}
      />
      <Tile label="Fresh air" value={String(d.freshAir)} sub="under 15 days" />
      <Tile
        label="At risk"
        value={String(d.atRisk)}
        tone={d.atRisk > 0 ? 'warn' : undefined}
        sub={`30–45 days${d.aging46to60 ? ` · ${d.aging46to60} at 46–60` : ''}`}
      />
      <Tile
        label="Front-line ready"
        value={String(d.frontLine)}
        sub={d.inRecon ? `${d.inRecon} still in recon` : 'nothing in recon'}
      />
      <Tile
        label="VDP views 7d"
        value={d.vdpViews7.toLocaleString('en-US')}
        sub={`${d.leads7} lead${d.leads7 === 1 ? '' : 's'} this week`}
      />
    </Card>
  );
}

/**
 * The money, in the rail.
 *
 * These are the four figures Lot Walk used to run across the top. They are
 * still the four a sales floor argues about, so they get a board of their own
 * rather than being deleted — but they are a *result*, and the scoreboard above
 * is the *work*, so the work goes where the eye lands first.
 */
export function TodaysBoard({
  soldToday,
  soldMtd,
  grossMtd,
  inventoryValue,
}: {
  soldToday: number;
  soldMtd: number;
  grossMtd: string;
  inventoryValue: string;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-ink-100 px-4 py-2.5">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink-700">
          Today&rsquo;s board
        </h2>
      </div>
      <div className="grid grid-cols-2">
        <Cell label="Sold today" value={String(soldToday)} big />
        <Cell label="Sold MTD" value={String(soldMtd)} big border="l" />
        <Cell label="Front gross MTD" value={grossMtd} border="t" />
        <Cell label="Inventory $" value={inventoryValue} border="tl" />
      </div>
    </Card>
  );
}

function Cell({
  label,
  value,
  big,
  border,
}: {
  label: string;
  value: string;
  big?: boolean;
  border?: 'l' | 't' | 'tl';
}) {
  return (
    <div
      className={cn(
        'px-4 py-3',
        border?.includes('l') && 'border-l border-ink-100',
        border?.includes('t') && 'border-t border-ink-100',
      )}
    >
      <div className="truncate text-[10px] font-bold uppercase tracking-wider text-ink-500">
        {label}
      </div>
      <div
        className={cn(
          'tnum mt-1 font-bold tracking-tight text-ink-900',
          big ? 'text-2xl leading-none' : 'text-lg leading-none',
        )}
      >
        {value}
      </div>
    </div>
  );
}
