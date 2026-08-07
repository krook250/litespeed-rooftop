/**
 * Branding tests.
 *
 * Two things are worth testing here and they are not the same kind of thing.
 *
 * The palette maths is ordinary pure-function testing. The *scanner* is a
 * security boundary — it fetches a URL a dealer typed — so `isPrivateAddress`
 * and `parseSiteUrl` are tested the way a guard should be: with the payloads
 * someone would actually send, not with the cases that make the code look right.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ROOFTOP_ACCENT,
  ROOFTOP_BRAND,
  contrast,
  hexToHsl,
  hueDistance,
  isCandidateColor,
  isDefaultPalette,
  makeUsable,
  normalizeHex,
  quantize,
  readableOn,
  suggestPalette,
} from './palette';

import {
  FetchFailure,
  altWwwHost,
  explain,
  findLogoCandidates,
  findSiteColors,
  isPrivateAddress,
  parseSiteUrl,
} from './site-scan';

/* ---------------------------------------------------------------- colors */

describe('normalizeHex', () => {
  it('accepts the four shapes a person actually types', () => {
    assert.equal(normalizeHex('#3D8BFF'), '#3d8bff');
    assert.equal(normalizeHex('3D8BFF'), '#3d8bff');
    assert.equal(normalizeHex('#abc'), '#aabbcc');
    assert.equal(normalizeHex('  #3d8bff  '), '#3d8bff');
  });

  it('rejects anything else rather than guessing', () => {
    for (const bad of ['', '#12345', 'blue', 'rgb(1,2,3)', '#3d8bffff', '#gggggg']) {
      assert.equal(normalizeHex(bad), null, bad);
    }
  });
});

describe('isCandidateColor', () => {
  it('rejects the three colors every logo is mostly made of', () => {
    assert.equal(isCandidateColor('#ffffff'), false);
    assert.equal(isCandidateColor('#000000'), false);
    assert.equal(isCandidateColor('#8a8a8a'), false); // the grey ramp
  });

  it('keeps a real brand color', () => {
    assert.equal(isCandidateColor(ROOFTOP_BRAND.toLowerCase()), true);
    assert.equal(isCandidateColor('#7a1f1f'), true); // dark but saturated
  });
});

describe('isDefaultPalette', () => {
  it('recognises both the current default and the one that shipped before it', () => {
    assert.equal(isDefaultPalette(ROOFTOP_BRAND, ROOFTOP_ACCENT), true);
    assert.equal(isDefaultPalette('#3D8BFF', '#FFB020'), true, 'case must not matter');
    assert.equal(isDefaultPalette('#1d4ed8', '#f97316'), true, 'pre-migration rows');
  });

  it('treats a half-changed pair as a real choice', () => {
    assert.equal(isDefaultPalette(ROOFTOP_BRAND, '#c8102e'), false);
    assert.equal(isDefaultPalette('#1d4ed8', ROOFTOP_ACCENT), false);
  });
});

describe('makeUsable', () => {
  it('darkens a pale color until white text on it would read', () => {
    const out = makeUsable('#cfe6ff');
    assert.ok(contrast(out, '#ffffff') >= 3, `contrast was ${contrast(out, '#ffffff')}`);
  });

  it('keeps the hue — that is the part that belongs to the dealer', () => {
    const before = hexToHsl('#cfe6ff').h;
    const after = hexToHsl(makeUsable('#cfe6ff')).h;
    assert.ok(hueDistance(before, after) < 2);
  });

  it('leaves a color that already works alone', () => {
    assert.equal(makeUsable('#1f4fd8'), '#1f4fd8');
  });
});

describe('hueDistance', () => {
  it('wraps around the wheel', () => {
    assert.equal(hueDistance(350, 10), 20);
    assert.equal(hueDistance(10, 350), 20);
    assert.equal(hueDistance(0, 180), 180);
  });
});

describe('readableOn', () => {
  it('picks the text color a person would pick', () => {
    assert.equal(readableOn('#0b1b3a'), '#ffffff');
    assert.equal(readableOn('#ffb020'), '#000000');
  });
});

describe('suggestPalette', () => {
  it('falls back to Rooftop when there is nothing usable', () => {
    const s = suggestPalette([{ hex: '#ffffff', weight: 900 }, { hex: '#111111', weight: 400 }]);
    assert.deepEqual(s, { brand: ROOFTOP_BRAND, accent: ROOFTOP_ACCENT, source: 'default' });
  });

  it('takes the heaviest usable color as the brand, ignoring the white background', () => {
    const s = suggestPalette([
      { hex: '#ffffff', weight: 5000 },
      { hex: '#c8102e', weight: 800 },
      { hex: '#111111', weight: 600 },
    ]);
    assert.equal(hexToHsl(s.brand).h > 340 || hexToHsl(s.brand).h < 15, true);
  });

  it('picks an accent far enough round the wheel to read as a second color', () => {
    const s = suggestPalette([
      { hex: '#1f4fd8', weight: 900 },
      { hex: '#2a55da', weight: 800 }, // a near-miss of the brand — must not be chosen
      { hex: '#f5a623', weight: 300 },
    ]);
    assert.ok(hueDistance(hexToHsl(s.brand).h, hexToHsl(s.accent).h) >= 40);
  });

  it('rotates the brand hue when the source is monochrome, rather than inventing orange', () => {
    const s = suggestPalette([{ hex: '#1f4fd8', weight: 900 }, { hex: '#2a55da', weight: 800 }]);
    assert.notEqual(s.accent.toLowerCase(), ROOFTOP_ACCENT.toLowerCase());
    assert.ok(hueDistance(hexToHsl(s.brand).h, hexToHsl(s.accent).h) >= 40);
  });

  it('reports where it came from, because the UI says so out loud', () => {
    assert.equal(suggestPalette([{ hex: '#1f4fd8', weight: 9 }], 'site').source, 'site');
  });
});

describe('quantize', () => {
  it('ignores transparent pixels, so a transparent PNG is not read as white', () => {
    // two opaque red pixels, two fully transparent white ones
    const px = new Uint8ClampedArray([
      200, 30, 30, 255,
      200, 30, 30, 255,
      255, 255, 255, 0,
      255, 255, 255, 0,
    ]);
    const out = quantize(px, 1);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.weight, 2);
  });
});

/* -------------------------------------------------------------- SSRF guard */

describe('isPrivateAddress', () => {
  it('blocks the ranges an attacker would aim at', () => {
    for (const ip of [
      '127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.255',
      '169.254.169.254', // cloud metadata — the one that matters
      '0.0.0.0', '100.64.0.1', '224.0.0.1',
      '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1',
      '::ffff:127.0.0.1', // v4-mapped loopback
    ]) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
  });

  it('allows ordinary public addresses', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '192.169.1.1', '2606:4700::1111']) {
      assert.equal(isPrivateAddress(ip), false, ip);
    }
  });

  it('treats a non-address as unsafe', () => {
    assert.equal(isPrivateAddress('localhost'), true);
    assert.equal(isPrivateAddress(''), true);
  });
});

describe('parseSiteUrl', () => {
  it('accepts what a dealer types', () => {
    assert.equal(parseSiteUrl('cascademotors.com')?.toString(), 'https://cascademotors.com/');
    assert.equal(parseSiteUrl('www.cascademotors.com/inventory')?.hostname, 'www.cascademotors.com');
    assert.equal(parseSiteUrl('http://cascademotors.com')?.protocol, 'http:');
    assert.equal(parseSiteUrl('  https://cascademotors.com  ')?.hostname, 'cascademotors.com');
  });

  it('rejects everything that is not a website', () => {
    for (const bad of [
      '', '   ',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<script>',
      'localhost',            // no dot — an internal name
      'localhost:3000',
      'http://127.0.0.1',     // an address, not a name
      'http://[::1]/',
      'http://169.254.169.254/latest/meta-data/',
      'https://user:pass@example.com', // credentials in the URL
    ]) {
      assert.equal(parseSiteUrl(bad), null, bad);
    }
  });
});

/* ------------------------------------------------------------ HTML parsing */

const BASE = new URL('https://cascademotors.com/');

describe('findLogoCandidates', () => {
  it('puts the header logo first and resolves it against the page', () => {
    const html = `
      <link rel="icon" href="/favicon.png">
      <meta property="og:image" content="https://cdn.example.com/social.jpg">
      <img src="/img/hero.jpg" alt="a truck">
      <img class="site-logo" src="../assets/logo.png" alt="Cascade Motors">
    `;
    const out = findLogoCandidates(html, new URL('https://cascademotors.com/pages/home'));
    assert.equal(out[0]!.url, 'https://cascademotors.com/assets/logo.png');
    assert.ok(out.every((c) => !c.url.includes('hero.jpg')));
  });

  it('never offers an SVG, because upload rejects them', () => {
    const out = findLogoCandidates('<img class="logo" src="/logo.svg">', BASE);
    assert.equal(out.length, 0);
  });

  it('deduplicates the same file found two ways', () => {
    const html = '<img class="logo" src="/logo.png"><link rel="apple-touch-icon" href="/logo.png">';
    assert.equal(findLogoCandidates(html, BASE).length, 1);
  });

  it('ranks the touch icon above the social image', () => {
    const html = `
      <meta property="og:image" content="/social.png">
      <link rel="apple-touch-icon" href="/touch.png">
    `;
    const out = findLogoCandidates(html, BASE);
    assert.equal(out[0]!.url, 'https://cascademotors.com/touch.png');
  });

  it('ignores an off-protocol source', () => {
    assert.equal(findLogoCandidates('<img class="logo" src="javascript:0">', BASE).length, 0);
  });
});

describe('findSiteColors', () => {
  it('lets a declared theme-color beat frequency', () => {
    const css = '.a{color:#123456}.b{color:#123456}.c{color:#123456}';
    const out = findSiteColors([css], '#c8102e');
    assert.equal(out[0]!.hex, '#c8102e');
  });

  it('counts hex and rgb() alike', () => {
    const out = findSiteColors(['.a{color:rgb(200, 16, 46)}.b{color:#c8102e}'], null);
    assert.equal(out[0]!.hex, '#c8102e');
    assert.equal(out[0]!.weight, 2);
  });

  it('expands three-digit hex so #fff and #ffffff are one color', () => {
    const out = findSiteColors(['.a{color:#fff}.b{color:#ffffff}'], null);
    assert.equal(out[0]!.hex, '#ffffff');
    assert.equal(out[0]!.weight, 2);
  });

  it('drops an out-of-range rgb() rather than wrapping it', () => {
    const out = findSiteColors(['.a{color:rgb(300, 16, 46)}'], null);
    assert.equal(out.length, 0);
  });
});

/* -------------------------------------------------------- failure reporting */

describe('altWwwHost', () => {
  it('flips between the apex and www, keeping everything else', () => {
    assert.equal(altWwwHost(new URL('https://malabartruckandtrade.com/x'))?.toString(),
      'https://www.malabartruckandtrade.com/x');
    assert.equal(altWwwHost(new URL('https://www.malabartruckandtrade.com/'))?.hostname,
      'malabartruckandtrade.com');
  });

  it('refuses to strip www off something that would stop being a domain', () => {
    assert.equal(altWwwHost(new URL('https://www.com/')), null);
  });
});

describe('explain', () => {
  it('only blames the address when the address is actually the suspect', () => {
    const dns = explain(new FetchFailure('dns', ''), 'malabartruckandtrade.com');
    assert.match(dns, /Check the spelling/);

    // A WAF refusal is the case that sent a dealer to re-read a correct URL.
    const blocked = explain(new FetchFailure('blocked', '', 403), 'malabartruckandtrade.com');
    assert.doesNotMatch(blocked, /Check the/);
    assert.match(blocked, /blocking automated visits/);
  });

  it('always leaves the dealer somewhere to go', () => {
    for (const kind of ['dns', 'network', 'timeout', 'blocked', 'status', 'too-big', 'redirect'] as const) {
      assert.match(explain(new FetchFailure(kind, '', 500), 'example.com'), /upload your logo file/i, kind);
    }
  });

  it('names the host, so the message is about their site and not ours', () => {
    assert.match(explain(new FetchFailure('timeout', ''), 'malabartruckandtrade.com'), /malabartruckandtrade\.com/);
  });
});
