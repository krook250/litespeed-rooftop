/**
 * VIN construction with a valid position-9 check digit.
 * Demo VINs are structurally real — WMI, model-year code, check digit all
 * validate — so anything a dealer pastes into a decoder behaves sensibly.
 */

const TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
};

const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** Model-year codes skip I, O, Q, U, Z and 0. */
const YEAR_CODES: Record<number, string> = {};
{
  const letters = 'ABCDEFGHJKLMNPRSTVWXY'.split('');
  letters.forEach((c, i) => {
    YEAR_CODES[2010 + i] = c;
  });
}

/** Real-world World Manufacturer Identifiers, by make and rough body type. */
const WMI: Record<string, string[]> = {
  Toyota: ['4T1', '5TF', 'JTE', '2T3'],
  Honda: ['1HG', '5FN', '5J6', '2HG'],
  Subaru: ['4S3', '4S4', 'JF2'],
  Ford: ['1FT', '1FM', '1FA'],
  Chevrolet: ['1GC', '1GN', '3GN'],
  GMC: ['1GT', '3GT'],
  Ram: ['1C6'],
  Jeep: ['1C4'],
  Nissan: ['5N1', '1N4', 'JN8'],
  Hyundai: ['5NM', 'KM8', '5NP'],
  Kia: ['5XY', 'KNA'],
  Mazda: ['JM3', 'JM1'],
  Chrysler: ['2C4'],
  Volkswagen: ['3VW'],
};

const SAFE = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function checkDigit(vin17: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const v = TRANSLIT[vin17[i]!];
    if (v === undefined) throw new Error(`bad VIN char ${vin17[i]} at ${i}`);
    sum += v * WEIGHTS[i]!;
  }
  const rem = sum % 11;
  return rem === 10 ? 'X' : String(rem);
}

export function isValidVin(vin: string) {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
  return checkDigit(vin) === vin[8];
}

/** Deterministic, structurally valid VIN for a seeded unit. */
export function buildVin(make: string, year: number, serialSeed: string): string {
  const pool = WMI[make] ?? ['1XX'];
  const h = hash(`${make}|${year}|${serialSeed}`);
  const wmi = pool[h % pool.length]!;

  // positions 4-8: vehicle descriptor section
  let vds = '';
  for (let i = 0; i < 5; i++) {
    vds += SAFE[(h >> (i * 3)) % SAFE.length]!;
  }

  const yearCode = YEAR_CODES[year] ?? 'A';
  const plant = 'ABCDEFGHJKLMNPRSTUVWX'[h % 21]!;
  const serial = String(100000 + (h % 899999));

  const withoutCheck = `${wmi}${vds}0${yearCode}${plant}${serial}`;
  const cd = checkDigit(withoutCheck);
  return `${wmi}${vds}${cd}${yearCode}${plant}${serial}`;
}
