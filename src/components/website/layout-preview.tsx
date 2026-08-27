/**
 * What the dealer's website looks like, at thumbnail size.
 *
 * WHY THESE ARE DRAWN AND NOT SCREENSHOTTED (yet)
 * A screenshot is better — it is the real thing — but a screenshot cannot show
 * *their* logo and *their* colors, and the whole point of this step is that the
 * dealer sees their own brand before they commit to a layout. So these are
 * drawn: same structure as the real layouts, fed the live values from the form
 * above them, updating as they move the color picker.
 *
 * WHEN REAL SCREENSHOTS EXIST, they drop in with no code change here: set
 * `previewImage` on the layout's entry in `src/components/store/layouts/index.ts`
 * and this component renders the image instead. That is the whole migration, and
 * it can happen one layout at a time.
 *
 * ONE CAVEAT ON THAT, added when themes arrived: a `previewImage` is a fixed
 * picture, so it cannot follow the theme the dealer is currently looking at.
 * These same tiles are what the theme picker itself is built from, so a layout
 * with a screenshot set would show three identical thumbnails on that step. Take
 * screenshots per theme, or leave the theme picker on the drawn version.
 */

import { cn } from '@/components/ui';
import { storeTheme, type StoreTheme, type StoreThemeTokens } from '@/lib/branding/palette';

export type PreviewProps = {
  id: string;
  brand: string;
  accent: string;
  theme: StoreTheme;
  logoUrl?: string | null;
  /** Falls back to drawn mockups until real screenshots exist. */
  previewImage?: string | null;
  dealerName?: string;
  className?: string;
};

/* Tiny building blocks. Everything is sized in fractions of the frame so the
 * whole preview scales with its container rather than needing a fixed width. */

/*
 * Every color below comes from `storeTheme()` — the same function the real
 * storefront calls. That is the whole point: the previous version of this file
 * hard-coded a brand-filled header while the storefront rendered a white one, so
 * the thumbnail was showing dealers a site we did not build.
 */

function Bar({ w, tone, h = 'h-[3px]' }: { w: string; tone: string; h?: string }) {
  return <div className={cn('rounded-full', h)} style={{ width: w, background: tone }} />;
}

function Photo({ t, className }: { t: StoreThemeTokens; className?: string }) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-[2px]', className)}
      style={{ background: t.paper2 }}
    >
      {/* the suggestion of a car, so a grey box reads as a photo */}
      <div className="absolute inset-x-[12%] bottom-[22%] h-[26%] rounded-[2px]" style={{ background: t.line }} />
      <div className="absolute inset-x-[26%] bottom-[44%] h-[18%] rounded-t-[2px]" style={{ background: t.line }} />
    </div>
  );
}

function Nav({ t, logoUrl, dealerName, phonePill }: {
  t: StoreThemeTokens; logoUrl?: string | null; dealerName?: string; phonePill?: boolean;
}) {
  return (
    <>
      {t.headerRule ? <div className="h-[2px] w-full" style={{ background: t.headerRule }} /> : null}
      <div
        className="flex items-center justify-between border-b px-1.5 py-1"
        style={{ background: t.headerBg, borderColor: t.headerBorder }}
      >
        <div className="flex items-center gap-1">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-2.5 w-auto max-w-[34px] object-contain" />
          ) : (
            <>
              <div className="h-2 w-2 rounded-[1px]" style={{ background: t.brand }} />
              <span
                className="max-w-[46px] truncate text-[4px] font-bold uppercase tracking-wider"
                style={{ color: t.headerFg }}
              >
                {dealerName ?? 'Your dealership'}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Bar w="10px" tone={t.headerMuted} h="h-[2px]" />
          <Bar w="7px" tone={t.headerMuted} h="h-[2px]" />
          {phonePill ? (
            <div
              className="rounded-full px-1 py-[1px] text-[3.5px] font-bold"
              style={{ background: t.accent, color: t.onAccent }}
            >
              (360) 555-0142
            </div>
          ) : (
            <div className="h-[6px] w-[14px] rounded-[2px]" style={{ background: t.accent }} />
          )}
        </div>
      </div>
    </>
  );
}

function Card({ t, tall = false }: { t: StoreThemeTokens; tall?: boolean }) {
  return (
    <div
      className="flex flex-col overflow-hidden rounded-[2px] border"
      style={{ background: t.paper, borderColor: t.line }}
    >
      <Photo t={t} className={tall ? 'h-[58%]' : 'h-[62%]'} />
      <div className="flex flex-1 flex-col justify-center gap-[2px] p-[3px]">
        <Bar w="80%" tone={t.text2} h="h-[2px]" />
        <Bar w="55%" tone={t.text3} h="h-[2px]" />
        <div className="mt-[1px] h-[3px] w-[40%] rounded-full" style={{ background: t.accentOnPage }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- the three */

function ClassicMock({ t, logoUrl, dealerName }: MockProps) {
  return (
    <div className="flex h-full flex-col" style={{ background: t.page }}>
      <Nav t={t} logoUrl={logoUrl} dealerName={dealerName} />
      <div className="flex flex-1 gap-1 p-1">
        <div className="flex w-[24%] flex-col gap-[3px] rounded-[2px] p-[3px]" style={{ background: t.paper }}>
          <Bar w="70%" tone={t.text2} h="h-[2px]" />
          {['90%', '75%', '82%', '60%', '70%', '55%'].map((w, i) => <Bar key={i} w={w} tone={t.line} />)}
        </div>
        <div className="grid flex-1 grid-cols-3 grid-rows-2 gap-1">
          {Array.from({ length: 6 }).map((_, i) => <Card key={i} t={t} />)}
        </div>
      </div>
    </div>
  );
}

function ShowcaseMock({ t, logoUrl, dealerName }: MockProps) {
  return (
    <div className="flex h-full flex-col" style={{ background: t.page }}>
      <Nav t={t} logoUrl={logoUrl} dealerName={dealerName} />
      <div className="relative h-[46%] overflow-hidden">
        <Photo t={t} className="h-full w-full rounded-none" />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-1"
             style={{ background: 'linear-gradient(to top, rgba(0,0,0,.55), transparent)' }}>
          <div className="flex flex-col gap-[2px]">
            <Bar w="34px" tone="rgba(255,255,255,.9)" h="h-[3px]" />
            <Bar w="22px" tone="rgba(255,255,255,.6)" h="h-[2px]" />
          </div>
          <div
            className="rounded-full px-1 py-[1px] text-[3.5px] font-bold"
            style={{ background: t.accent, color: t.onAccent }}
          >
            Featured
          </div>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-1 p-1">
        {Array.from({ length: 2 }).map((_, i) => <Card key={i} t={t} tall />)}
      </div>
    </div>
  );
}

function LotListMock({ t, logoUrl, dealerName }: MockProps) {
  return (
    <div className="flex h-full flex-col" style={{ background: t.paper }}>
      <Nav t={t} logoUrl={logoUrl} dealerName={dealerName} phonePill />
      {/* the sticky call bar — the one thing this layout is for */}
      <div
        className="flex items-center justify-between px-1.5 py-[3px]"
        style={{ background: t.brand, color: t.onBrand }}
      >
        <Bar w="26px" tone={t.onBrand} h="h-[2px]" />
        <span className="text-[3.5px] font-black" style={{ color: t.onBrand }}>(360) 555-0142</span>
      </div>
      <div className="flex items-center gap-1 border-b px-1.5 py-[3px]" style={{ borderColor: t.line }}>
        <Bar w="16px" tone={t.text2} h="h-[2px]" />
        <Bar w="10px" tone={t.line} h="h-[2px]" />
        <Bar w="12px" tone={t.line} h="h-[2px]" />
        <div className="flex-1" />
        <Bar w="14px" tone={t.line} h="h-[2px]" />
      </div>
      <div className="flex-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 border-b px-1.5 py-[3px] last:border-b-0"
            style={{ borderColor: t.line }}
          >
            <Photo t={t} className="h-[7px] w-[11px]" />
            <div className="flex flex-1 flex-col gap-[2px]">
              <Bar w="52%" tone={t.text2} h="h-[2px]" />
              <Bar w="30%" tone={t.line} h="h-[2px]" />
            </div>
            <Bar w="9px" tone={t.line} h="h-[2px]" />
            <div className="h-[3px] w-[13px] rounded-full" style={{ background: t.accentOnPage }} />
          </div>
        ))}
      </div>
    </div>
  );
}

type MockProps = {
  t: StoreThemeTokens;
  logoUrl?: string | null;
  dealerName?: string;
};

const MOCKS: Record<string, (p: MockProps) => React.ReactNode> = {
  CLASSIC: ClassicMock,
  SHOWCASE: ShowcaseMock,
  LOT_LIST: LotListMock,
};

/** A browser frame, so the thumbnail reads as a website and not a diagram. */
export function LayoutPreview(props: PreviewProps) {
  const Mock = MOCKS[props.id] ?? ClassicMock;
  const t = storeTheme(props.theme, props.brand, props.accent);
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
          <Mock t={t} logoUrl={props.logoUrl} dealerName={props.dealerName} />
        )}
      </div>
    </div>
  );
}
