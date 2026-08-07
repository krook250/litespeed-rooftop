/**
 * Chart primitives — hand-rolled inline SVG, no chart library.
 *
 * Everything here renders on the server with zero JavaScript: geometry is
 * computed at render time and written straight into the markup. Color always
 * arrives as an explicit hex prop (channel brandHex, the aging ramp, or the
 * neutral ink pair) so an SVG fill never depends on a Tailwind class.
 *
 * Each chart carries a <title> plus role="img" and an aria-label so a screen
 * reader gets the same read a manager gets off the screen.
 */

import { cn } from './ui';

/* ----------------------------------------------------------------- shared */

export const NEUTRAL_INK = '#18202c';
export const NEUTRAL_INK_SOFT = '#4f5c72';
const GRID = '#eceef2';
const AXIS_TEXT = '#8794a8';
const TRACK = '#eceef2';

/** Round a max up to a readable axis top (1, 2, 2.5, 5, 10 × 10^k). */
function niceCeil(v: number) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

const compact = (n: number) =>
  Math.abs(n) >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString('en-US');

/* ---------------------------------------------------------------- BarRow */

/**
 * One horizontal labelled bar. The bar itself is an SVG with no text inside,
 * so it can stretch to any column width without distorting type; the label and
 * the figures stay in HTML where they line up down the page.
 */
export function BarRow({
  label,
  sublabel,
  value,
  max,
  color,
  valueLabel,
  trailing,
  barHeight = 10,
  className,
}: {
  label: string;
  sublabel?: string;
  value: number;
  max: number;
  color: string;
  valueLabel?: string;
  trailing?: React.ReactNode;
  barHeight?: number;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const readout = valueLabel ?? value.toLocaleString('en-US');
  const a11y = `${label}: ${readout}`;

  return (
    <div className={cn('flex items-center gap-3 py-1.5', className)}>
      <div className="w-44 shrink-0">
        <div className="truncate text-sm font-medium text-ink-800">{label}</div>
        {sublabel ? <div className="truncate text-[11px] text-ink-500">{sublabel}</div> : null}
      </div>

      <div className="min-w-0 flex-1">
        <svg
          width="100%"
          height={barHeight}
          role="img"
          aria-label={a11y}
          style={{ display: 'block' }}
        >
          <title>{a11y}</title>
          <rect x="0" y="0" width="100%" height={barHeight} rx={barHeight / 2} fill={TRACK} />
          {pct > 0 ? (
            <rect
              x="0"
              y="0"
              width={`${pct}%`}
              height={barHeight}
              rx={barHeight / 2}
              fill={color}
            />
          ) : null}
        </svg>
      </div>

      <div className="tnum w-20 shrink-0 text-right text-sm font-semibold text-ink-900">
        {readout}
      </div>
      {trailing}
    </div>
  );
}

/* -------------------------------------------------------------- LineArea */

export type TrendPoint = {
  /** x-axis label, e.g. an ISO date or a short day label */
  label: string;
  /** primary series (line + area fill) */
  value: number;
  /** optional second series, drawn as thin columns off the baseline */
  secondary?: number;
};

/**
 * Trend chart: area + line for the primary series, a subtle horizontal grid
 * with axis labels, and an optional second series as columns along the
 * baseline. `id` must be unique on the page — it namespaces the gradient.
 */
export function LineArea({
  id,
  points,
  title,
  seriesName,
  secondaryName,
  color = NEUTRAL_INK,
  secondaryColor = NEUTRAL_INK_SOFT,
  height = 220,
  gridLines = 4,
  formatX = (label: string) => label,
  className,
}: {
  id: string;
  points: TrendPoint[];
  title: string;
  seriesName: string;
  secondaryName?: string;
  color?: string;
  secondaryColor?: string;
  height?: number;
  gridLines?: number;
  formatX?: (label: string, index: number) => string;
  className?: string;
}) {
  const W = 1080;
  const H = height;
  const padL = 46;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = points.length;

  const topPrimary = niceCeil(Math.max(1, ...points.map((p) => p.value)));
  const topSecondary = Math.max(1, ...points.map((p) => p.secondary ?? 0));
  const hasSecondary = points.some((p) => typeof p.secondary === 'number');

  const x = (i: number) => (n <= 1 ? padL + plotW / 2 : padL + (plotW * i) / (n - 1));
  const y = (v: number) => padT + plotH - (v / topPrimary) * plotH;
  const baseline = padT + plotH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area =
    n > 0
      ? `M${x(0).toFixed(1)},${baseline} ${points
          .map((p, i) => `L${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
          .join(' ')} L${x(n - 1).toFixed(1)},${baseline} Z`
      : '';

  const total = points.reduce((s, p) => s + p.value, 0);
  const secondaryTotal = points.reduce((s, p) => s + (p.secondary ?? 0), 0);
  const a11y = hasSecondary && secondaryName
    ? `${title}. ${seriesName} totals ${total.toLocaleString('en-US')} over ${n} days, peak ${Math.max(0, ...points.map((p) => p.value)).toLocaleString('en-US')} per day. ${secondaryName} totals ${secondaryTotal.toLocaleString('en-US')}.`
    : `${title}. ${seriesName} totals ${total.toLocaleString('en-US')} over ${n} days.`;

  const labelStep = Math.max(1, Math.ceil(n / 6));
  const barW = n > 1 ? Math.max(2, Math.min(10, (plotW / n) * 0.5)) : 10;
  const secondaryZone = plotH * 0.34;

  return (
    <figure className={cn('m-0', className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={a11y}
        className="block h-auto w-full"
      >
        <title>{title}</title>
        <desc>{a11y}</desc>

        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* grid + y axis */}
        {Array.from({ length: gridLines + 1 }, (_, k) => {
          const v = (topPrimary * k) / gridLines;
          const gy = y(v);
          return (
            <g key={k}>
              <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke={GRID} strokeWidth="1" />
              <text
                x={padL - 8}
                y={gy + 3.5}
                textAnchor="end"
                fontSize="10"
                fill={AXIS_TEXT}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {compact(v)}
              </text>
            </g>
          );
        })}

        {/* primary series */}
        {n > 1 ? <path d={area} fill={`url(#${id}-fill)`} /> : null}
        {n > 1 ? (
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {n === 1 ? <circle cx={x(0)} cy={y(points[0]!.value)} r="3" fill={color} /> : null}

        {/* second series as columns off the baseline */}
        {hasSecondary
          ? points.map((p, i) => {
              const s = p.secondary ?? 0;
              if (s <= 0) return null;
              const h = Math.max(1.5, (s / topSecondary) * secondaryZone);
              return (
                <rect
                  key={p.label}
                  x={x(i) - barW / 2}
                  y={baseline - h}
                  width={barW}
                  height={h}
                  fill={secondaryColor}
                  opacity="0.55"
                  rx="1"
                />
              );
            })
          : null}

        {/* x axis */}
        <line x1={padL} y1={baseline} x2={W - padR} y2={baseline} stroke="#d6dae2" strokeWidth="1" />
        {points.map((p, i) =>
          i % labelStep === 0 || i === n - 1 ? (
            <text
              key={`x-${p.label}`}
              x={x(i)}
              y={H - 8}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              fontSize="10"
              fill={AXIS_TEXT}
            >
              {formatX(p.label, i)}
            </text>
          ) : null,
        )}
      </svg>

      <figcaption className="mt-2 flex flex-wrap items-center gap-4 text-xs text-ink-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          {seriesName}
        </span>
        {hasSecondary && secondaryName ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: secondaryColor }} />
            {secondaryName}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

/* ----------------------------------------------------------- ColumnChart */

export type ColumnDatum = {
  label: string;
  value: number;
  /** small line under the axis label — e.g. the gross behind the unit count */
  sublabel?: string;
  /** per-column override, otherwise the chart color */
  color?: string;
};

/** Vertical columns with the value written above each one. */
export function ColumnChart({
  data,
  title,
  color = NEUTRAL_INK,
  height = 200,
  formatValue = (n: number) => n.toLocaleString('en-US'),
  animate = true,
  className,
}: {
  data: ColumnDatum[];
  title: string;
  color?: string;
  height?: number;
  formatValue?: (n: number) => string;
  animate?: boolean;
  className?: string;
}) {
  const n = data.length;
  const W = Math.max(420, n * 132);
  const H = height;
  const padL = 8;
  const padR = 8;
  const padT = 22;
  const padB = data.some((d) => d.sublabel) ? 42 : 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const top = niceCeil(Math.max(1, ...data.map((d) => d.value)));
  const slot = n > 0 ? plotW / n : plotW;
  const barW = Math.min(56, slot * 0.5);
  const baseline = padT + plotH;

  const a11y = `${title}. ${data.map((d) => `${d.label}: ${formatValue(d.value)}`).join('; ')}.`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={a11y}
      style={{ maxWidth: W }}
      className={cn('block h-auto w-full', className)}
    >
      <title>{title}</title>
      <desc>{a11y}</desc>

      <line x1={padL} y1={baseline} x2={W - padR} y2={baseline} stroke="#d6dae2" strokeWidth="1" />

      {data.map((d, i) => {
        const cx = padL + slot * i + slot / 2;
        const h = d.value > 0 ? Math.max(2, (d.value / top) * plotH) : 0;
        return (
          <g key={d.label}>
            {h > 0 ? (
              <rect
                x={cx - barW / 2}
                y={baseline - h}
                width={barW}
                height={h}
                rx="2"
                fill={d.color ?? color}
                className={animate ? 'bar-grow' : undefined}
                style={animate ? { transformBox: 'fill-box', transformOrigin: 'bottom' } : undefined}
              />
            ) : null}
            <text
              x={cx}
              y={baseline - h - 7}
              textAnchor="middle"
              fontSize="12"
              fontWeight="600"
              fill={NEUTRAL_INK}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatValue(d.value)}
            </text>
            <text x={cx} y={baseline + 15} textAnchor="middle" fontSize="11" fill={NEUTRAL_INK_SOFT}>
              {d.label}
            </text>
            {d.sublabel ? (
              <text
                x={cx}
                y={baseline + 29}
                textAnchor="middle"
                fontSize="10"
                fill={AXIS_TEXT}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {d.sublabel}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
