/**
 * Map-pin parsing tests.
 *
 * Every case here is a string somebody can actually have on their clipboard
 * after following the instruction on the Lots screen. The failure this guards
 * is silent: an unparsed pin clears the field, and a lot without coordinates
 * cannot run on Facebook Marketplace at all — nothing on screen says so.
 *
 * No database, no network. Run with `npm test`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatLatLng, looksTransposed, parseLatLng } from './geo';

/** Malabar Truck and Trade, Palm Bay FL — the lot this was found on. */
const LAT = 27.99356110261136;
const LNG = -80.62027053363042;

const near = (got: { lat: number; lng: number } | null, lat: number, lng: number, tol = 1e-6) => {
  assert.ok(got, 'expected a parse');
  assert.ok(Math.abs(got!.lat - lat) < tol, `lat ${got!.lat} vs ${lat}`);
  assert.ok(Math.abs(got!.lng - lng) < tol, `lng ${got!.lng} vs ${lng}`);
};

describe('parseLatLng — what Google actually copies', () => {
  it('reads the right-click clipboard format verbatim', () => {
    near(parseLatLng('27.99356110261136, -80.62027053363042'), LAT, LNG);
  });

  it('does not care about the space after the comma', () => {
    near(parseLatLng('27.99356110261136,-80.62027053363042'), LAT, LNG);
    near(parseLatLng('27.99356110261136 , -80.62027053363042'), LAT, LNG);
  });

  it('accepts leading and trailing whitespace from a sloppy paste', () => {
    near(parseLatLng('  \n 27.9935611, -80.6202705 \t '), 27.9935611, -80.6202705);
  });

  it('accepts a space or semicolon instead of a comma', () => {
    near(parseLatLng('27.9935611 -80.6202705'), 27.9935611, -80.6202705);
    near(parseLatLng('27.9935611; -80.6202705'), 27.9935611, -80.6202705);
  });
});

describe('parseLatLng — degrees and hemispheres', () => {
  it('reads the DMS form from the Google Maps info panel', () => {
    near(parseLatLng(`27°59'36.7"N 80°37'13.0"W`), 27.99353, -80.62028, 1e-4);
  });

  it('reads decimals with a degree sign and a hemisphere letter', () => {
    near(parseLatLng('27.9935611° N, 80.6202705° W'), 27.9935611, -80.6202705);
  });

  /* "-27.99 S" is somebody being thorough, not somebody meaning north. */
  it('lets an explicit hemisphere letter win over the sign', () => {
    near(parseLatLng('-27.9935611 S, -80.6202705 W'), -27.9935611, -80.6202705);
    near(parseLatLng('27.9935611 S, 80.6202705 E'), -27.9935611, 80.6202705);
  });
});

describe('parseLatLng — pasted URLs', () => {
  /* Dealers paste the address bar at least as often as they use the menu. */
  it('reads the map centre out of a /maps/@ URL', () => {
    near(
      parseLatLng('https://www.google.com/maps/@27.9935611,-80.6202705,17z'),
      27.9935611, -80.6202705,
    );
  });

  /*
   * A place URL carries both the map centre and the place's own coordinate. The
   * centre drifts as you scroll; the place does not, so the place wins.
   */
  it('prefers the place coordinate over the map centre on a place URL', () => {
    const url =
      'https://www.google.com/maps/place/Malabar+Truck+and+Trade/@27.5,-80.9,15z/data=!4m6!3m5!1s0x0:0x0!8m2!3d27.9935611!4d-80.6202705';
    near(parseLatLng(url), 27.9935611, -80.6202705);
  });

  it('reads a ?q= share link', () => {
    near(parseLatLng('https://maps.google.com/?q=27.9935611,-80.6202705'), 27.9935611, -80.6202705);
  });

  /* A URL with no coordinates in it must not fall through to the decimal
     branch and pick digits out of a street name or a zoom level. */
  it('returns null for a maps URL with no coordinates in it', () => {
    assert.equal(parseLatLng('https://www.google.com/maps/place/Malabar+Truck+and+Trade'), null);
    assert.equal(parseLatLng('https://maps.app.goo.gl/AbCdEf123'), null);
  });
});

describe('parseLatLng — refusing to guess', () => {
  it('returns null rather than a partial answer', () => {
    for (const junk of ['', '   ', '27.9935611', 'somewhere near the airport', 'lat/long', ',']) {
      assert.equal(parseLatLng(junk), null, JSON.stringify(junk));
    }
  });

  it('rejects an out-of-range pair rather than clamping it', () => {
    assert.equal(parseLatLng('91, 0'), null);
    assert.equal(parseLatLng('0, 181'), null);
    assert.equal(parseLatLng('-80.6202705, 200'), null);
  });

  /*
   * A transposed pair is usually still IN range — `-80.62, 27.99` is a valid
   * point, it is just in the Southern Ocean. The parser cannot reject it and
   * must not: see `looksTransposed`, which is where that judgement lives.
   */
  it('accepts a transposed pair, because it cannot know', () => {
    near(parseLatLng('-80.6202705, 27.9935611'), -80.6202705, 27.9935611);
  });

  it('accepts the edges of the range', () => {
    near(parseLatLng('90, 180'), 90, 180);
    near(parseLatLng('-90, -180'), -90, -180);
  });
});

describe('formatLatLng', () => {
  it('renders the pair the way Google copies it', () => {
    assert.equal(formatLatLng(LAT, LNG), '27.993561, -80.620271');
  });

  it('trims to six places without leaving trailing zeroes', () => {
    assert.equal(formatLatLng(27.5, -80.25), '27.5, -80.25');
  });

  it('is empty when the lot has no pin, not "null, null"', () => {
    assert.equal(formatLatLng(null, null), '');
    assert.equal(formatLatLng(27.5, null), '');
  });

  /* Round-trips, so what the form shows can be pasted straight back in. */
  it('round-trips through parseLatLng', () => {
    const out = parseLatLng(formatLatLng(LAT, LNG));
    near(out, 27.993561, -80.620271);
  });
});

describe('looksTransposed', () => {
  /* The mistake a single box makes easier: paste order is now the dealer's
     problem in a way two labelled fields did not make it. */
  it('flags a US lot pasted the wrong way round', () => {
    assert.equal(looksTransposed({ lat: LNG, lng: LAT }), true);
    assert.equal(looksTransposed({ lat: -122.6603, lng: 45.6872 }), true);
  });

  it('leaves a correct US pin alone', () => {
    assert.equal(looksTransposed({ lat: LAT, lng: LNG }), false);
    assert.equal(looksTransposed({ lat: 45.6872, lng: -122.6603 }), false, 'Vancouver WA');
    assert.equal(looksTransposed({ lat: 61.2181, lng: -149.9003 }), false, 'Anchorage');
    assert.equal(looksTransposed({ lat: 21.3099, lng: -157.8581 }), false, 'Honolulu');
    assert.equal(looksTransposed({ lat: 18.4655, lng: -66.1057 }), false, 'San Juan');
  });

  /* It is a hint, not a rule. A pin that is odd in both orders stays unflagged
     rather than sending the dealer chasing a swap that fixes nothing. */
  it('does not flag a pin that is outside the US in both orders', () => {
    assert.equal(looksTransposed({ lat: 51.5074, lng: -0.1278 }), false, 'London');
    assert.equal(looksTransposed({ lat: 35.6762, lng: 139.6503 }), false, 'Tokyo');
  });
});
