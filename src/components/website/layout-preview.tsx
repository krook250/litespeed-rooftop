/**
 * What the dealer's website looks like, at thumbnail size.
 *
 * WHY THESE ARE DRAWN AND NOT SCREENSHOTTED (yet)
 * A screenshot is better — it is the real thing — but a screenshot cannot show
 * *their* logo and *their* colours, and the whole point of this step is that the
 * dealer sees their own brand before they commit to a layout. So these are
 * drawn: same structure as the real layouts, fed the live values from the form
 * above them, updating as they move the colour picker.
 *
 * WHEN REAL SCREENSHOTS EXIST, they drop in with no code change here: set
 * `previewImage` on the layout's entry in `src/components/store/layouts/index.ts`
 * and this component renders the image instead. That is the whole migration, and
 * it can happen one layout at a time.
 */

import { cn } from '@/components/ui';

export type PreviewProps = {
  id: string;
  brand: string;
  accent: string;
  logoUrl?: string | null;
  /** Falls back to drawn mockups until real screenshots exist. */
  previewImage?: string | null;
  dealerName?: string;
  className?: string;
};

/* Tiny building blocks. Everything is sized in fractions of the frame so the
 * whole preview scales with its container rather than needing a fixed width. */

function Bar({ w, tone = 'bg-ink-200', h = 'h-[3px]' }: { w: string; tone?: string; h?: string }) {
  return <div className={cn('rounded-full', tone, h)} style={{ width: w }} />;
}

function Photo({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-[2px] bg-ink-200', className)}>
      {/* the suggestion of a car, so a grey box reads as a photo */}
      <div className="absolute inset-x-[12%] bottom-[22%] h-[26%] rounded-[2px] bg-ink-300" />
      <div className="absolute inset-x-[26%] bottom-[44%] h-[18%] rounded-t-[2px] bg-ink-300" />
    </div>
  );
}

function Nav({ brand, accent, logoUrl, dealerName, phonePill }: {
  brand: string; accent: string; logoUrl?: string | null; dealerName?: string; phonePill?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-1.5 py-1" style={{ background: brand }}>
      <div className="flex items-center gap-1">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="h-2.5 w-auto max-w-[34px] object-contain" />
        ) : (
          <>
            <div className="h-2 w-2 rounded-[1px] bg-white/85" />
            <span className="max-w-[46px] truncate text-[4px] font-bold uppercase tracking-wider text-white">
              {dealerName ?? 'Your dealership'}
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Bar w="10px" tone="bg-white/45" h="h-[2px]" />
        <Bar w="7px" tone="bg-white/45" h="h-[2px]" />
        {phonePill ? (
          <div className="rounded-full px-1 py-[1px] text-[3.5px] font-bold text-black/80" style={{ background: accent }}>
            (360) 555-0142
          </div>
        ) : (
          <div className="h-[6px] w-[14px] rounded-[2px]" style={{ background: accent }} />
        )}
      </div>
    </div>
  );
}

function Card({ accent, tall = false }: { accent: string; tall?: boolean }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[2px] border border-ink-200 bg-white">
      <Photo className={tall ? 'h-[58%]' : 'h-[62%]'} />
      <div className="flex flex-1 flex-col justify-center gap-[2px] p-[3px]">
        <Bar w="80%" tone="bg-ink-300" h="h-[2px]" />
        <Bar w="55%" h="h-[2px]" />
        <div className="mt-[1px] h-[3px] w-[40%] rounded-full" style={{ background: accent }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- the three */

function ClassicMock({ brand, accent, logoUrl, dealerName }: PreviewProps) {
  return (
    <div className="flex h-full flex-col bg-ink-50">
      <Nav brand={brand} accent={accent} logoUrl={logoUrl} dealerName={dealerName} />
      <div className="flex flex-1 gap-1 p-1">
        <div className="flex w-[24%] flex-col gap-[3px] rounded-[2px] bg-white p-[3px]">
          <Bar w="70%" tone="bg-ink-300" h="h-[2px]" />
          {['90%', '75%', '82%', '60%', '70%', '55%'].map((w, i) => <Bar key={i} w={w} />)}
        </div>
        <div className="grid flex-1 grid-cols-3 grid-rows-2 gap-1">
          {Array.from({ length: 6 }).map((_, i) => <Card key={i} accent={accent} />)}
        </div>
      </div>
    </div>
  );
}

function ShowcaseMock({ brand, accent, logoUrl, dealerName }: PreviewProps) {
  return (
    <div className="flex h-full flex-col bg-ink-50">
      <Nav brand={brand} accent={accent} logoUrl={logoUrl} dealerName={dealerName} />
      <div className="relative h-[46%] overflow-hidden">
        <Photo className="h-full w-full rounded-none" />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-1"
             style={{ background: 'linear-gradient(to top, rgba(0,0,0,.55), transparent)' }}>
          <div className="flex flex-col gap-[2px]">
            <Bar w="34px" tone="bg-white/90" h="h-[3px]" />
            <Bar w="22px" tone="bg-white/60" h="h-[2px]" />
          </div>
          <div className="rounded-full px-1 py-[1px] text-[3.5px] font-bold text-black/80" style={{ background: accent }}>
            Featured
          </div>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-1 p-1">
        {Array.from({ length: 2 }).map((_, i) => <Card key={i} accent={accent} tall />)}
      </div>
    </div>
  );
}

function LotListMock({ brand, accent, logoUrl, dealerName }: PreviewProps) {
  return (
    <div className="flex h-full flex-col bg-white">
      <Nav brand={brand} accent={accent} logoUrl={logoUrl} dealerName={dealerName} phonePill />
      <div className="flex items-center gap-1 border-b border-ink-200 px-1.5 py-[3px]">
        <Bar w="16px" tone="bg-ink-400" h="h-[2px]" />
        <Bar w="10px" h="h-[2px]" />
        <Bar w="12px" h="h-[2px]" />
        <div className="flex-1" />
        <Bar w="14px" tone="bg-ink-300" h="h-[2px]" />
      </div>
      <div className="flex-1 divide-y divide-ink-100">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-1.5 px-1.5 py-[3px]">
            <Photo className="h-[7px] w-[11px]" />
            <div className="flex flex-1 flex-col gap-[2px]">
              <Bar w="52%" tone="bg-ink-300" h="h-[2px]" />
              <Bar w="30%" h="h-[2px]" />
            </div>
            <Bar w="9px" h="h-[2px]" />
            <div className="h-[3px] w-[13px] rounded-full" style={{ background: accent }} />
          </div>
        ))}
      </div>
    </div>
  );
}

const MOCKS: Record<string, (p: PreviewProps) => React.ReactNode> = {
  CLASSIC: ClassicMock,
  SHOWCASE: ShowcaseMock,
  LOT_LIST: LotListMock,
};

/** A browser frame, so the thumbnail reads as a website and not a diagram. */
export function LayoutPreview(props: PreviewProps) {
  const Mock = MOCKS[props.id] ?? ClassicMock;
  return (
    <div className={cn('overflow-hidden rounded-md border border-ink-200 bg-white shadow-sm', props.className)}>
      <div className="flex items-center gap-[3px] border-b border-ink-200 bg-ink-100 px-1.5 py-[3px]">
        <span className="h-[3px] w-[3px] rounded-full bg-ink-300" />
        <span className="h-[3px] w-[3px] rounded-full bg-ink-300" />
        <span className="h-[3px] w-[3px] rounded-full bg-ink-300" />
        <span className="ml-1 flex-1 truncate rounded-full bg-white px-1 py-[1px] text-[3.5px] text-ink-400">
          {props.dealerName ? props.dealerName.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com' : 'yourdealership.com'}
        </span>
      </div>
      <div className="aspect-[16/10] overflow-hidden">
        {props.previewImage ? (
          <img src={props.previewImage} alt="" className="h-full w-full object-cover object-top" />
        ) : (
          <Mock {...props} />
        )}
      </div>
    </div>
  );
}
