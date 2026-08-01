// Rooftop Auto — demo seed generator
// Produces deterministic, realistic used-car inventory for a 2-rooftop independent group.
// VINs are structurally real: valid WMI for the make, correct year code, correct check digit.

const fs = require('fs');

// ---------- deterministic PRNG ----------
let _s = 0x2f6e2b1;
function rnd() {
  _s ^= _s << 13; _s >>>= 0;
  _s ^= _s >> 17;
  _s ^= _s << 5;  _s >>>= 0;
  return _s / 4294967296;
}
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

// ---------- VIN ----------
const TRANSLIT = { A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9 };
const WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
const YEAR_CODE = { 2010:'A',2011:'B',2012:'C',2013:'D',2014:'E',2015:'F',2016:'G',2017:'H',2018:'J',
                    2019:'K',2020:'L',2021:'M',2022:'N',2023:'P',2024:'R',2025:'S',2026:'T' };
const VIN_ALPHA = 'ABCDEFGHJKLMNPRSTUVWXYZ'; // no I, O, Q

function checkDigit(vin) {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    const v = /[0-9]/.test(c) ? Number(c) : TRANSLIT[c];
    sum += v * WEIGHTS[i];
  }
  const r = sum % 11;
  return r === 10 ? 'X' : String(r);
}

function buildVin(wmi, vds5, year, plant) {
  const serial = String(ri(100000, 999999));
  let vin = wmi + vds5 + '0' + YEAR_CODE[year] + plant + serial; // pos 9 placeholder
  vin = vin.slice(0, 8) + checkDigit(vin) + vin.slice(9);
  return vin;
}
const vds = () => Array.from({ length: 5 }, () => (rnd() < 0.45 ? String(ri(0, 9)) : VIN_ALPHA[ri(0, 22)])).join('');

// ---------- catalog (PNW independent-lot mix: trucks, AWD SUVs, a few commuters) ----------
// `anchor` = approximate 2026 retail asking price for a 2023 example with ~40,000 miles.
// Everything else is adjusted off that anchor, which keeps the numbers inside reality.
const CATALOG = [
  { make:'Ford',      model:'F-150',        trims:['STX','XLT','Lariat','King Ranch'], body:'Pickup',  wmi:'1FT', plant:'F', dt:['4WD','RWD'],  eng:'3.5L V6 EcoBoost',  anchor:38500, yr:[2017,2023] },
  { make:'Ram',       model:'1500',         trims:['Tradesman','Big Horn','Laramie'],  body:'Pickup',  wmi:'1C6', plant:'S', dt:['4WD'],        eng:'5.7L HEMI V8',      anchor:36500, yr:[2016,2022] },
  { make:'Chevrolet', model:'Silverado 1500', trims:['Custom','LT','RST'],             body:'Pickup',  wmi:'1GC', plant:'G', dt:['4WD'],        eng:'5.3L V8',           anchor:36000, yr:[2016,2022] },
  { make:'GMC',       model:'Sierra 1500',  trims:['SLE','Elevation'],                 body:'Pickup',  wmi:'1GT', plant:'G', dt:['4WD'],        eng:'5.3L V8',           anchor:38000, yr:[2017,2022] },
  { make:'Toyota',    model:'Tacoma',       trims:['SR5','TRD Sport','TRD Off-Road'],  body:'Pickup',  wmi:'3TM', plant:'M', dt:['4WD'],        eng:'3.5L V6',           anchor:34500, yr:[2017,2023] },
  { make:'Toyota',    model:'Tundra',       trims:['SR5','Limited'],                   body:'Pickup',  wmi:'5TF', plant:'Y', dt:['4WD'],        eng:'5.7L V8',           anchor:38000, yr:[2016,2021] },
  { make:'Subaru',    model:'Outback',      trims:['Premium','Limited','Touring'],     body:'Wagon',   wmi:'4S4', plant:'B', dt:['AWD'],        eng:'2.5L Boxer 4',      anchor:26500, yr:[2017,2023] },
  { make:'Subaru',    model:'Forester',     trims:['Premium','Sport','Limited'],       body:'SUV',     wmi:'JF2', plant:'H', dt:['AWD'],        eng:'2.5L Boxer 4',      anchor:25000, yr:[2017,2022] },
  { make:'Subaru',    model:'Crosstrek',    trims:['Premium','Limited'],               body:'SUV',     wmi:'JF2', plant:'H', dt:['AWD'],        eng:'2.0L Boxer 4',      anchor:23000, yr:[2018,2023] },
  { make:'Honda',     model:'CR-V',         trims:['EX','EX-L','Touring'],             body:'SUV',     wmi:'5J6', plant:'H', dt:['AWD','FWD'],  eng:'1.5L Turbo 4',      anchor:26500, yr:[2017,2022] },
  { make:'Honda',     model:'Accord',       trims:['Sport','EX-L','Touring'],          body:'Sedan',   wmi:'1HG', plant:'A', dt:['FWD'],        eng:'1.5L Turbo 4',      anchor:24000, yr:[2017,2022] },
  { make:'Honda',     model:'Pilot',        trims:['EX-L','Touring'],                  body:'SUV',     wmi:'5FN', plant:'L', dt:['AWD'],        eng:'3.5L V6',           anchor:30000, yr:[2016,2021] },
  { make:'Toyota',    model:'RAV4',         trims:['XLE','Adventure','Limited'],       body:'SUV',     wmi:'2T3', plant:'W', dt:['AWD'],        eng:'2.5L 4-Cyl',        anchor:27500, yr:[2018,2023] },
  { make:'Toyota',    model:'4Runner',      trims:['SR5','TRD Off-Road','Limited'],    body:'SUV',     wmi:'JTE', plant:'U', dt:['4WD'],        eng:'4.0L V6',           anchor:38500, yr:[2016,2022] },
  { make:'Toyota',    model:'Camry',        trims:['LE','SE','XSE'],                   body:'Sedan',   wmi:'4T1', plant:'K', dt:['FWD'],        eng:'2.5L 4-Cyl',        anchor:22500, yr:[2017,2022] },
  { make:'Jeep',      model:'Grand Cherokee', trims:['Laredo','Limited','Trailhawk'],  body:'SUV',     wmi:'1C4', plant:'C', dt:['4WD'],        eng:'3.6L V6',           anchor:28000, yr:[2016,2022] },
  { make:'Jeep',      model:'Wrangler Unlimited', trims:['Sport S','Sahara','Rubicon'],body:'SUV',     wmi:'1C4', plant:'W', dt:['4WD'],        eng:'3.6L V6',           anchor:32500, yr:[2017,2022] },
  { make:'Nissan',    model:'Rogue',        trims:['SV','SL'],                         body:'SUV',     wmi:'5N1', plant:'C', dt:['AWD','FWD'],  eng:'2.5L 4-Cyl',        anchor:21500, yr:[2017,2022] },
  { make:'Nissan',    model:'Frontier',     trims:['SV','PRO-4X'],                     body:'Pickup',  wmi:'1N6', plant:'N', dt:['4WD'],        eng:'3.8L V6',           anchor:28500, yr:[2017,2022] },
  { make:'Hyundai',   model:'Santa Fe',     trims:['SEL','Limited'],                   body:'SUV',     wmi:'5NM', plant:'H', dt:['AWD','FWD'],  eng:'2.4L 4-Cyl',        anchor:22500, yr:[2018,2022] },
  { make:'Kia',       model:'Telluride',    trims:['S','EX','SX'],                     body:'SUV',     wmi:'5XY', plant:'G', dt:['AWD'],        eng:'3.8L V6',           anchor:34500, yr:[2020,2023] },
  { make:'Ford',      model:'Explorer',     trims:['XLT','Limited','ST'],              body:'SUV',     wmi:'1FM', plant:'C', dt:['4WD','RWD'],  eng:'2.3L EcoBoost',     anchor:28000, yr:[2017,2022] },
  { make:'Ford',      model:'Escape',       trims:['SE','SEL','Titanium'],             body:'SUV',     wmi:'1FM', plant:'U', dt:['AWD','FWD'],  eng:'1.5L EcoBoost',     anchor:20500, yr:[2018,2022] },
  { make:'Chevrolet', model:'Equinox',      trims:['LT','Premier'],                    body:'SUV',     wmi:'2GN', plant:'L', dt:['AWD','FWD'],  eng:'1.5L Turbo 4',      anchor:19500, yr:[2018,2022] },
  { make:'Volkswagen',model:'Jetta',        trims:['S','SE','SEL'],                    body:'Sedan',   wmi:'3VW', plant:'M', dt:['FWD'],        eng:'1.4L TSI',          anchor:18000, yr:[2018,2022] },
];

const COLORS = [
  ['Magnetic Gray','#5c6066'], ['Oxford White','#eef0f2'], ['Agate Black','#1a1c20'],
  ['Barcelona Red','#9c2b23'], ['Silver Ice','#b9bdc2'], ['Velocity Blue','#1f4e8c'],
  ['Cement','#8d8a80'], ['Ingot Silver','#a7abb0'], ['Crystal Black','#141519'],
  ['Deep Sea Blue','#22405e'], ['Army Green','#4a5240'], ['Rapid Red','#8a1d24'],
  ['Summit White','#f2f3f4'], ['Storm Gray','#4b5158'], ['Sandstone','#b3a289'],
];
const INTERIORS = ['Black Cloth','Black Leather','Gray Cloth','Tan Leather','Charcoal Cloth','Ebony Leatherette'];

const FEATURES_BY_BODY = {
  Pickup: ['Tow Package','Bed Liner','Running Boards','Backup Camera','Trailer Brake Controller','Bluetooth','Apple CarPlay','Heated Seats','Remote Start','Bedcover'],
  SUV:    ['Third Row','Backup Camera','Blind Spot Monitor','Apple CarPlay','Heated Seats','Panoramic Roof','Roof Rails','Power Liftgate','Adaptive Cruise','Remote Start'],
  Sedan:  ['Backup Camera','Apple CarPlay','Heated Seats','Sunroof','Blind Spot Monitor','Adaptive Cruise','Keyless Entry','Lane Keep Assist'],
  Wagon:  ['AWD','Roof Rails','Backup Camera','Apple CarPlay','Heated Seats','Power Liftgate','EyeSight Driver Assist','All-Weather Package'],
};

const SOURCES = ['Trade-in','Auction — Manheim Portland','Auction — ADESA Seattle','Street purchase','Trade-in','Auction — Manheim Portland'];

const ROOFTOPS = [
  { id:'rt_fourthplain', name:'Cascade Motors — Fourth Plain', short:'Fourth Plain', city:'Vancouver', state:'WA', address:'7412 NE Fourth Plain Blvd', phone:'(360) 555-0142', type:'physical' },
  { id:'rt_orchards',    name:'Cascade Motors — Orchards',     short:'Orchards',     city:'Vancouver', state:'WA', address:'11205 NE 117th Ave',       phone:'(360) 555-0188', type:'physical' },
];
const VIRTUAL_ROOFTOP = { id:'rt_cascade_online', name:'Cascade Motors', type:'virtual', consolidates:['rt_fourthplain','rt_orchards'], domain:'cascademotorswa.com' };

const PEOPLE = [
  { id:'u_ray',   name:'Ray Kessler',  role:'Dealer Principal', initials:'RK', color:'#1f4e8c', rooftop:'rt_fourthplain' },
  { id:'u_mike',  name:'Mike Ruiz',    role:'Sales',            initials:'MR', color:'#9c2b23', rooftop:'rt_fourthplain' },
  { id:'u_tina',  name:'Tina Alvarez', role:'Sales',            initials:'TA', color:'#2f6f4f', rooftop:'rt_orchards'    },
  { id:'u_rob',   name:'Rob Chen',     role:'Recon & Detail',   initials:'RC', color:'#6b4c9a', rooftop:'rt_fourthplain' },
  { id:'u_tim',   name:'Tim Boyd',     role:'Sales',            initials:'TB', color:'#b5721c', rooftop:'rt_orchards'    },
];

// ---------- aging plan: deliberate spread across buckets ----------
// bucket targets so the demo shows every color on screen
const DIS_PLAN = [
  3, 5, 7, 9, 11, 13,            // fresh air (<15)  — 6 units
  17, 20, 23, 26, 29,            // 16-30            — 5 units
  32, 35, 38, 41, 44,            // 31-45 at-risk    — 5 units
  48, 52, 56, 59,                // 46-60 at-risk    — 4 units
  67, 74, 88, 103, 121,          // 61+ aged         — 5 units
];

const RECON_NOTES = [
  'Front pads + rotors, alignment',
  'Full detail, headlight restoration',
  'Two tires, oil service, safety inspection',
  'Windshield replacement, detail',
  'Timing service, brake flush, detail',
  'Bumper respray, wheel refinish',
  'Battery, cabin filter, full detail',
];

const vehicles = [];
const usedStock = new Set();

DIS_PLAN.forEach((dis, i) => {
  const c = CATALOG[i % CATALOG.length];
  const year = ri(c.yr[0], c.yr[1]);
  const age = 2026 - year;
  const [colorName, colorHex] = pick(COLORS);
  const trim = pick(c.trims);
  const dt = pick(c.dt);

  // mileage: ~11k/yr with spread, floor 4k
  const mileage = Math.max(4200, Math.round((age * ri(8500, 15500) + ri(-3000, 4000)) / 10) * 10);

  // ---- market value: anchored to a 2023 / 40k-mile example, then adjusted ----
  const yearsOffAnchor = Math.max(0, 2023 - year);
  const yearFactor  = Math.pow(0.945, yearsOffAnchor);
  const milePenalty = Math.min(0.36, Math.max(-0.06, ((mileage - 40000) / 40000) * 0.13));
  const trimFactor  = 0.94 + c.trims.indexOf(trim) * 0.09;      // trims listed low -> high
  const holdsValue  = (c.body === 'Pickup' || c.model === '4Runner' || c.model === 'Wrangler Unlimited') ? 1.10 : 1.0;

  let market = c.anchor * yearFactor * (1 - milePenalty) * trimFactor * holdsValue;
  market = Math.max(7500, Math.round(market / 50) * 50);

  // ---- asking price: near market, priced the way lots actually price (xx,995) ----
  const priceJitter = ri(97, 105) / 100;
  let price = Math.round((market * priceJitter) / 500) * 500 - 5;
  price = Math.max(price, 6995);

  // ---- work backward to cost. Front-end gross is what shrinks as a unit ages. ----
  const pack = 795;                                            // flat pack, typical independent
  const reconCost = Math.round(ri(250, 2400) / 25) * 25;
  const oldest = i >= DIS_PLAN.length - 2;                     // two worst units were bought rich
  const targetGross =
      oldest        ? ri(-1600, -200)
    : dis > 60      ? ri(-400, 1600)
    : dis > 45      ? ri(1400, 3000)
    :                 ri(2400, 4400);
  const cost = Math.round((price - pack - reconCost - targetGross) / 25) * 25;
  const totalCost = cost + pack + reconCost;

  const isWater = totalCost > market;

  // recon: fresher units may still be in recon
  const inRecon = dis <= 6 && rnd() < 0.6;
  const reconDays = inRecon ? dis : Math.min(dis, ri(3, 11));
  const photoCount = inRecon ? ri(0, 3) : ri(14, 32);
  const frontLineReady = !inRecon && photoCount >= 12;

  // VDP views: decay with age, boost for trucks & fresh units
  const bodyBoost = c.body === 'Pickup' ? 1.45 : c.body === 'SUV' ? 1.15 : 0.85;
  const freshBoost = dis < 15 ? 1.8 : dis < 30 ? 1.2 : dis < 60 ? 0.8 : 0.45;
  const vdp7 = frontLineReady ? Math.round(ri(14, 62) * bodyBoost * freshBoost) : 0;
  const vdpTotal = frontLineReady ? Math.round(vdp7 * (dis / 7) * ri(70, 115) / 100) + ri(5, 40) : 0;
  const leads = frontLineReady ? Math.max(0, Math.round(vdpTotal / ri(28, 70))) : 0;

  let stock;
  do { stock = String(ri(4100, 4899)); } while (usedStock.has(stock));
  usedStock.add(stock);

  const rooftop = i % 3 === 2 ? 'rt_orchards' : 'rt_fourthplain';

  const feats = [...FEATURES_BY_BODY[c.body]];
  const features = [];
  const nFeat = ri(4, 7);
  for (let k = 0; k < nFeat && feats.length; k++) features.push(feats.splice(Math.floor(rnd() * feats.length), 1)[0]);
  if (dt === 'AWD' || dt === '4WD') features.unshift(dt);

  const acquired = new Date(Date.UTC(2026, 7, 1) - dis * 86400000).toISOString().slice(0, 10);

  vehicles.push({
    id: 'v' + (i + 1),
    vin: buildVin(c.wmi, vds(), year, c.plant),
    stock, year, make: c.make, model: c.model, trim,
    body: c.body, drivetrain: dt, transmission: 'Automatic', engine: c.eng,
    exteriorColor: colorName, colorHex, interiorColor: pick(INTERIORS),
    mileage, cost, pack, reconCost, totalCost, market, price,
    daysInStock: dis, acquired, source: pick(SOURCES),
    reconStatus: inRecon ? 'in_recon' : 'complete',
    reconDays, reconNote: pick(RECON_NOTES),
    photoCount, frontLineReady, isWater,
    vdpViews7: vdp7, vdpViewsTotal: vdpTotal, leads,
    rooftop, features,
    titleStatus: rnd() < 0.9 ? 'In hand' : 'Pending',
    carfax: rnd() < 0.82 ? 'Clean' : (rnd() < 0.5 ? '1 Owner' : 'Minor damage reported'),
  });
});

const out = { generated: '2026-08-01', rooftops: ROOFTOPS, virtualRooftop: VIRTUAL_ROOFTOP, people: PEOPLE, vehicles };
fs.writeFileSync(__dirname + '/seed.json', JSON.stringify(out, null, 2));

// ---------- sanity ----------
const bad = vehicles.filter(v => v.vin.length !== 17 || checkDigit(v.vin) !== v.vin[8] || /[IOQ]/.test(v.vin));
console.log('vehicles:', vehicles.length, '| invalid VINs:', bad.length);
console.log('water units:', vehicles.filter(v => v.isWater).length,
            '| in recon:', vehicles.filter(v => v.reconStatus === 'in_recon').length,
            '| front-line ready:', vehicles.filter(v => v.frontLineReady).length);
const buckets = { '0-15':0, '16-30':0, '31-45':0, '46-60':0, '61+':0 };
vehicles.forEach(v => { const d=v.daysInStock;
  buckets[d<=15?'0-15':d<=30?'16-30':d<=45?'31-45':d<=60?'46-60':'61+']++; });
console.log('aging:', buckets);
console.log('price range: $' + Math.min(...vehicles.map(v=>v.price)).toLocaleString() + ' – $' + Math.max(...vehicles.map(v=>v.price)).toLocaleString());
console.log('sample:', vehicles.slice(0,3).map(v=>`${v.year} ${v.make} ${v.model} ${v.trim} | ${v.vin} | STK ${v.stock} | ${v.mileage.toLocaleString()}mi | $${v.price.toLocaleString()} | ${v.daysInStock}d`).join('\n        '));
