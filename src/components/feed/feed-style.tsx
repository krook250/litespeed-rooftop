import { setFeedStyle, setHouseFeedStyle } from '@/lib/feed-actions';
import type { FeedStyle, UserRole } from '@/db/schema';
import { cn } from '@/components/ui';

const LABEL: Record<FeedStyle, string> = { SOCIAL: 'Lot Walk', LOG: 'Activity log' };

const HINT: Record<FeedStyle, string> = {
  SOCIAL: 'Same events, drawn as cards you can react to and comment on.',
  LOG: 'Same events, drawn as a dense log. Nothing is turned off.',
};

/**
 * Lot Walk or the activity log.
 *
 * One event stream, two presentations. This control does not change what is
 * recorded, what is emitted, or what is kept — only how the same rows are
 * drawn. Worth saying in the UI, because a dealer switching to the log needs to
 * know they are not turning anything off, and a dealer switching back needs to
 * find their old comment threads still there.
 *
 * Two levels, deliberately:
 *  - the toggle sets `users.feedStyle` — this user, right now
 *  - "Make this the dealership default" sets `dealer_groups.feedStyle`, and is
 *    owner/manager only, because it is what everyone else opens in the morning
 *
 * The two are kept visibly separate. A user sitting on a personal choice that
 * disagrees with the house is told so and given the one click back, rather than
 * being silently snapped to it — which would be the easier code and the worse
 * behaviour, since it means a setting you chose can change under you.
 */
export function FeedStyleSwitch({
  style,
  houseStyle,
  isOverride,
  role,
}: {
  style: FeedStyle;
  houseStyle: FeedStyle;
  isOverride: boolean;
  role: UserRole;
}) {
  const canSetHouse = role === 'OWNER' || role === 'MANAGER';

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-0.5 rounded-lg bg-ink-100 p-0.5">
        {(['SOCIAL', 'LOG'] as const).map((s) =>
          s === style ? (
            <span
              key={s}
              className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-ink-900 shadow-sm"
            >
              {LABEL[s]}
            </span>
          ) : (
            <form key={s} action={setFeedStyle}>
              <input type="hidden" name="style" value={s} />
              <button
                title={HINT[s]}
                className="rounded-md px-2.5 py-1 text-xs font-medium text-ink-500 hover:text-ink-900"
              >
                {LABEL[s]}
              </button>
            </form>
          ),
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-x-2 text-[11px] text-ink-500">
        {isOverride ? (
          <form action={setFeedStyle} className="flex items-center gap-1">
            <input type="hidden" name="style" value="inherit" />
            <span>Yours only — the dealership uses {LABEL[houseStyle]}.</span>
            <button className={cn('font-semibold text-ink-700 underline hover:text-ink-900')}>
              Use that instead
            </button>
          </form>
        ) : null}

        {canSetHouse && style !== houseStyle ? (
          <form action={setHouseFeedStyle}>
            <input type="hidden" name="style" value={style} />
            <button className="font-semibold text-ink-700 underline hover:text-ink-900">
              Make {LABEL[style]} the dealership default
            </button>
          </form>
        ) : null}

        {!isOverride && style === houseStyle ? (
          <span>Dealership default{canSetHouse ? ' — switch above to change it' : ''}.</span>
        ) : null}
      </div>
    </div>
  );
}
