/**
 * A lot's IANA timezone, worked out from the address the dealer already typed.
 *
 * `rooftops.timezone` defaults to America/Los_Angeles and nothing in the app
 * ever set it, so every lot outside the Pacific showed "Open now" against the
 * wrong clock — a Florida lot read three hours early. Asking the dealer for a
 * timezone is a field nobody fills in correctly; their state already says it.
 *
 * State gives the right answer for almost every lot. The ZIP overrides cover
 * the split states where a meaningful number of dealers sit on the other side
 * of the line (Florida's panhandle, El Paso, East Tennessee and so on). It is
 * prefix-level, not county-level — close enough to put "closes at 5" on the
 * right hour, which is the only thing this is for.
 *
 * Returns null when the state is blank or unrecognized, so callers keep what
 * the row already has instead of overwriting it with a guess.
 */

const NY = 'America/New_York';
const CHI = 'America/Chicago';
const DEN = 'America/Denver';
const LA = 'America/Los_Angeles';

const BY_STATE: Record<string, string> = {
  AL: CHI, AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: CHI, CA: LA,
  CO: DEN, CT: NY, DE: NY, DC: NY, FL: NY, GA: NY, HI: 'Pacific/Honolulu',
  ID: 'America/Boise', IL: CHI, IN: 'America/Indiana/Indianapolis', IA: CHI,
  KS: CHI, KY: NY, LA: CHI, ME: NY, MD: NY, MA: NY, MI: 'America/Detroit',
  MN: CHI, MS: CHI, MO: CHI, MT: DEN, NE: CHI, NV: LA, NH: NY, NJ: NY,
  NM: DEN, NY: NY, NC: NY, ND: CHI, OH: NY, OK: CHI, OR: LA, PA: NY, RI: NY,
  SC: NY, SD: CHI, TN: CHI, TX: CHI, UT: DEN, VT: NY, VA: NY, WA: LA,
  WV: NY, WI: CHI, WY: DEN, PR: 'America/Puerto_Rico',
};

const NAMES: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
  COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', 'DISTRICT OF COLUMBIA': 'DC',
  FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL',
  INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA',
  MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI',
  MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT',
  NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR',
  PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
  VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI', WYOMING: 'WY', 'PUERTO RICO': 'PR',
};

/** [state, first three ZIP digits, timezone] — the other side of a split state. */
const ZIP3_OVERRIDES: [string, string[], string][] = [
  ['FL', ['324', '325'], CHI], // panhandle west of the Apalachicola
  ['TX', ['798', '799', '885'], DEN], // El Paso
  ['TN', ['373', '374', '376', '377', '378', '379'], NY], // Chattanooga, Knoxville, Tri-Cities
  ['KY', ['420', '421', '422', '423', '424'], CHI], // western Kentucky
  ['IN', ['463', '464', '476', '477'], CHI], // Gary, Evansville
  ['ID', ['838'], LA], // the panhandle
  ['OR', ['979'], 'America/Boise'], // Ontario
  ['SD', ['577'], DEN], // Rapid City
  ['NE', ['690', '691', '692', '693'], DEN], // western Nebraska
];

export function stateCode(state: string): string | null {
  const s = state.trim().toUpperCase().replace(/\./g, '');
  if (BY_STATE[s]) return s;
  return NAMES[s] ?? null;
}

export function timezoneFor(state: string, postalCode = ''): string | null {
  const code = stateCode(state);
  if (!code) return null;
  const zip3 = postalCode.trim().slice(0, 3);
  for (const [st, prefixes, tz] of ZIP3_OVERRIDES) {
    if (st === code && prefixes.includes(zip3)) return tz;
  }
  return BY_STATE[code];
}
