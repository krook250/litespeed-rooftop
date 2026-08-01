/* ============================================================
   Rooftop — derived demo state
   SEED is inlined at build time. Everything below is derived so
   the same shapes map onto real Postgres tables later:
   rooftop, vehicle, vehicle_photo, channel, channel_listing,
   sync_job, feed_event, feed_reaction, feed_comment.
   ============================================================ */

const TODAY = new Date('2026-08-01T09:20:00');

/* ---------- aging ---------- */
const BUCKETS = [
  { id: 'b0', label: '0–15',  name: 'Fresh air',   min: 0,  max: 15,       cls: 'b0' },
  { id: 'b1', label: '16–30', name: '16–30 days',  min: 16, max: 30,       cls: 'b1' },
  { id: 'b2', label: '31–45', name: 'At risk',     min: 31, max: 45,       cls: 'b2' },
  { id: 'b3', label: '46–60', name: 'At risk',     min: 46, max: 60,       cls: 'b3' },
  { id: 'b4', label: '61+',   name: 'Aged unit',   min: 61, max: 1e9,      cls: 'b4' },
];
const bucketOf = (d) => BUCKETS.find(b => d >= b.min && d <= b.max);
const isAtRisk = (v) => v.daysInStock >= 30 && v.daysInStock <= 45;   // David's definition
const isWatch  = (v) => v.daysInStock >= 46 && v.daysInStock <= 60;
const isAged   = (v) => v.daysInStock >= 61;
const isFresh  = (v) => v.daysInStock <= 15;

/* ---------- channels ----------
   `cadence` is the honest real-world behaviour we will implement
   for real later; the demo only compresses the clock. */
const CHANNELS = [
  { id:'site',   name:'Cascade Motors website', short:'Website',    logo:'CM', color:'#0f1620', kind:'Owned site',
    cadence:'Instant — writes straight to the site database',           demoMs:[350,650],   realNote:'instant' },
  { id:'meta',   name:'Meta Catalog',           short:'Meta',       logo:'M',  color:'#1877f2', kind:'Ads',
    cadence:'Catalog push, then Meta re-crawls — usually under 15 min', demoMs:[1100,1700], realNote:'~15 min' },
  { id:'mkt',    name:'Facebook Marketplace',   short:'Marketplace',logo:'FB', color:'#0866ff', kind:'Marketplace',
    cadence:'Partner listing feed, refreshed hourly',                   demoMs:[1500,2200], realNote:'~1 hr' },
  { id:'gva',    name:'Google Vehicle Ads',     short:'Google VA',  logo:'G',  color:'#ea4335', kind:'Ads',
    cadence:'Vehicle feed to Merchant Center, re-fetched up to 4× a day',demoMs:[2000,2900], realNote:'up to 4 hrs' },
  { id:'cars',   name:'Cars.com',               short:'Cars.com',   logo:'C',  color:'#7b1fa2', kind:'Aggregator',
    cadence:'Nightly inventory feed, 2:00 AM PT',                       demoMs:[1800,2600], realNote:'next 2:00 AM' },
  { id:'atc',    name:'Autotrader',             short:'Autotrader', logo:'AT', color:'#c8102e', kind:'Aggregator',
    cadence:'Nightly inventory feed, 1:00 AM PT',                       demoMs:[1900,2700], realNote:'next 1:00 AM' },
  { id:'cg',     name:'CarGurus',               short:'CarGurus',   logo:'CG', color:'#00a4a6', kind:'Aggregator',
    cadence:'Feed pickup every 6 hrs',                                  demoMs:[1700,2500], realNote:'~6 hrs' },
];

/* ---------- recent sales (drives turn rate, days supply, the board) ---------- */
const SALES = [
  { id:'s1', when:-0, who:'u_mike', year:2019, make:'Ford',      model:'F-150',    trim:'XLT',       stock:'3902', gross:3150, dis:22, price:32995 },
  { id:'s2', when:-0, who:'u_tina', year:2020, make:'Subaru',    model:'Forester', trim:'Premium',   stock:'3877', gross:2480, dis:16, price:23495 },
  { id:'s3', when:-1, who:'u_mike', year:2018, make:'Toyota',    model:'RAV4',     trim:'XLE',       stock:'3861', gross:2890, dis:41, price:21995 },
  { id:'s4', when:-2, who:'u_tina', year:2017, make:'Chevrolet', model:'Equinox',  trim:'LT',        stock:'3844', gross:1620, dis:63, price:14995 },
  { id:'s5', when:-3, who:'u_mike', year:2021, make:'Ram',       model:'1500',     trim:'Big Horn',  stock:'3890', gross:4110, dis:12, price:36995 },
  { id:'s6', when:-4, who:'u_tina', year:2019, make:'Honda',     model:'CR-V',     trim:'EX',        stock:'3818', gross:2240, dis:34, price:23495 },
];
const SALES_30D = 19;                     // trailing 30 days, all rooftops
const SALES_12M = [14,16,13,18,21,19,17,15,20,22,18,19];   // trailing 12 months

/* ---------- monthly VDP trend ---------- */
const VDP_TREND = [2180,2340,2110,2620,2880,3050,2740,3210,3480,3320,3610,3890];

/* ---------- state ---------- */
const state = {
  route: '#/lotwalk',
  rooftop: 'all',
  vehicles: SEED.vehicles.map(v => ({
    ...v,
    photos: photoSet(v),
    hero: heroPhoto(v),
    headline: '',
    blurb: '',
    listings: Object.fromEntries(CHANNELS.map(c => [c.id, {
      status: v.frontLineReady ? 'live' : 'off',
      price: v.price,
      pushedAt: v.frontLineReady ? `${v.daysInStock > 2 ? 2 : 0}d ago` : '—',
      error: null,
    }])),
  })),
  reactions: {},     // eventId -> {thumb:bool, fire:bool}
  extraComments: {}, // eventId -> [{who,text}]
  log: [],
  me: 'u_ray',
};

/* two honest failure states — a demo with everything green is a lie */
(() => {
  const noPhotos = state.vehicles.find(v => !v.frontLineReady);
  if (noPhotos) CHANNELS.forEach(c => { if (c.id !== 'site') noPhotos.listings[c.id] = { status:'off', price:noPhotos.price, pushedAt:'—', error:'Held — needs 8+ photos' }; });
  const water = state.vehicles.find(v => v.isWater);
  if (water) water.listings.meta = { status:'error', price:water.price, pushedAt:'6h ago',
    error:'Meta rejected: primary image below 500×500' };
  const aged = state.vehicles.filter(isAged)[1];
  if (aged) aged.listings.gva = { status:'error', price:aged.price, pushedAt:'1d ago',
    error:'Google: missing "condition" attribute' };
})();

const byId = (id) => state.vehicles.find(v => v.id === id);
const person = (id) => SEED.people.find(p => p.id === id);
const rooftopName = (id) => (SEED.rooftops.find(r => r.id === id) || {}).short || 'All rooftops';

function scoped() {
  return state.rooftop === 'all' ? state.vehicles : state.vehicles.filter(v => v.rooftop === state.rooftop);
}

/* ---------- metrics ---------- */
function metrics() {
  const inv = scoped();
  const n = inv.length;
  const share = state.rooftop === 'all' ? 1 : n / state.vehicles.length;
  const sales30 = Math.max(1, Math.round(SALES_30D * share));
  const avgDis = n ? inv.reduce((a, v) => a + v.daysInStock, 0) / n : 0;
  return {
    units: n,
    daysSupply: Math.round(n / (sales30 / 30)),
    turn: +(365 / Math.max(1, avgDis)).toFixed(1),
    avgDis: Math.round(avgDis),
    fresh: inv.filter(isFresh).length,
    atRisk: inv.filter(isAtRisk).length,
    aged: inv.filter(isAged).length,
    frontLine: inv.filter(v => v.frontLineReady).length,
    inRecon: inv.filter(v => v.reconStatus === 'in_recon').length,
    water: inv.filter(v => v.isWater).length,
    vdp7: inv.reduce((a, v) => a + v.vdpViews7, 0),
    leads7: inv.reduce((a, v) => a + leads7(v), 0),
    watch: inv.filter(isWatch).length,
    sales30,
    grossMTD: Math.round(sales30 * (SALES.reduce((a, s) => a + s.gross, 0) / SALES.length)),
    invValue: inv.reduce((a, v) => a + v.totalCost, 0),
  };
}

/* ---------- the Lot Walk feed ----------
   Authored mostly by the system, on behalf of the inventory.
   Human posts are the minority — that is the whole point. */
const leads7 = (v) => Math.round(v.vdpViews7 / 38);
const ago = (h) => h < 1 ? 'Just now' : h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;

function buildFeed() {
  const inv = scoped();
  const ev = [];
  const push = (e) => ev.push({ id: e.id, hours: e.hours, ...e });

  // -- scripted human + system moments at the top of the day --
  const atRisk = inv.filter(isAtRisk).sort((a, b) => b.daysInStock - a.daysInStock);
  if (atRisk.length) push({
    id: 'e_atrisk', hours: 1.5, kind: 'at_risk', actor: 'system', icon: '⚠︎',
    title: `${atRisk.length} units are on the at-risk list this morning`,
    text: 'Between 30 and 45 days. This is the window where a price move still works — past 60 you are wholesaling it.',
    units: atRisk.slice(0, 4),
    stats: [
      { k: 'At risk', v: atRisk.length },
      { k: 'Tied up', v: '$' + atRisk.reduce((a, v) => a + v.totalCost, 0).toLocaleString() },
      { k: 'Avg days', v: Math.round(atRisk.reduce((a, v) => a + v.daysInStock, 0) / atRisk.length) },
    ],
    comments: [{ who: 'u_ray', text: 'Tina — get me a price recommendation on the top two before noon.' }],
  });

  SALES.filter(s => s.when === 0).forEach((s, i) => push({
    id: 'e_sold' + s.id, hours: 2.5 + i * 1.4, kind: 'sold', actor: 'system', icon: '🔔',
    title: `${person(s.who).name.split(' ')[0]} sold the ${s.year} ${s.make} ${s.model} ${s.trim}`,
    text: `Stock #${s.stock} · retailed at $${s.price.toLocaleString()} after ${s.dis} days on the lot.`,
    stats: [
      { k: 'Front gross', v: '$' + s.gross.toLocaleString(), good: true },
      { k: 'Days to turn', v: s.dis + 'd' },
      { k: 'Sold price', v: '$' + s.price.toLocaleString() },
    ],
    comments: i === 0
      ? [{ who: 'u_ray', text: 'That is the third F-150 this month. Buy more trucks.' },
         { who: 'u_tina', text: 'Way to go 👏' }]
      : [],
    react: { thumb: 4, fire: 2 },
  }));

  push({
    id: 'e_tim', hours: 5, kind: 'team', actor: 'u_ray', icon: '👋',
    title: 'Meet Tim Boyd — starting Monday at Orchards',
    text: 'Tim comes over from a franchise store with ten years in. Knows trucks cold and has done his own desking. He is on the Orchards side but will float. Say hi when you see him.',
    person: 'u_tim',
    comments: [{ who: 'u_mike', text: 'Welcome aboard Tim.' }],
    react: { thumb: 6, fire: 1 },
  });

  const recon = inv.filter(v => v.reconStatus === 'in_recon');
  if (recon.length) push({
    id: 'e_rob', hours: 7, kind: 'note', actor: 'u_rob', icon: '🔧',
    title: 'Detail bay is down until Thursday — buffer is out for service',
    text: 'Anything that needs paint correction, flag it on the unit and I will batch them Friday morning. Wash and vac are unaffected.',
    comments: [],
  });

  // -- system posts derived straight from inventory state --
  const fresh = inv.filter(isFresh).sort((a, b) => a.daysInStock - b.daysInStock);
  fresh.slice(0, 3).forEach((v, i) => {
    if (v.frontLineReady) push({
      id: 'e_fl' + v.id, hours: 9 + i * 6, kind: 'front_line', actor: 'system', icon: '✅',
      title: `${v.year} ${v.make} ${v.model} ${v.trim} is front-line ready`,
      text: `Recon closed in ${v.reconDays} days, ${v.photoCount} photos up, merchandising complete. It went live on all ${CHANNELS.length} channels.`,
      vehicle: v,
      stats: [
        { k: 'Recon time', v: v.reconDays + 'd', good: v.reconDays <= 7 },
        { k: 'Photos', v: v.photoCount },
        { k: 'Priced at', v: '$' + v.price.toLocaleString() },
      ],
      comments: i === 0 ? [{ who: 'u_mike', text: 'Already have someone coming to look at this Saturday.' }] : [],
      react: { thumb: 3, fire: i === 0 ? 2 : 0 },
    });
    else push({
      id: 'e_acq' + v.id, hours: 9 + i * 6, kind: 'acquired', actor: 'system', icon: '🚚',
      title: `${v.year} ${v.make} ${v.model} ${v.trim} landed on the lot`,
      text: `${v.source} · ${v.mileage.toLocaleString()} miles · in recon now. Not syndicated until photos are up.`,
      vehicle: v,
      stats: [
        { k: 'Days in recon', v: v.reconDays + 'd', bad: v.reconDays > 7 },
        { k: 'Photos', v: `${v.photoCount} / 8`, bad: v.photoCount < 8 },
        { k: 'Total cost', v: '$' + v.totalCost.toLocaleString() },
      ],
      comments: [{ who: 'u_rob', text: v.reconNote + ' — should be out of the bay tomorrow.' }],
    });
  });

  const water = inv.filter(v => v.isWater)[0];
  if (water) push({
    id: 'e_water' + water.id, hours: 20, kind: 'water', actor: 'system', icon: '🌊',
    title: `${water.year} ${water.make} ${water.model} is a water unit`,
    text: `Total cost is now above what the market says it is worth. It has been on the ground ${water.daysInStock} days.`,
    vehicle: water,
    stats: [
      { k: 'Total cost', v: '$' + water.totalCost.toLocaleString() },
      { k: 'Market', v: '$' + water.market.toLocaleString() },
      { k: 'Underwater', v: '−$' + (water.totalCost - water.market).toLocaleString(), bad: true },
    ],
    comments: [{ who: 'u_ray', text: 'We are upside down. Run it through the sale Thursday, take the hit and move on.' }],
  });

  const topVdp = [...inv].filter(v => v.frontLineReady).sort((a, b) => b.vdpViews7 - a.vdpViews7)[0];
  if (topVdp) push({
    id: 'e_vdp' + topVdp.id, hours: 26, kind: 'vdp', actor: 'system', icon: '📈',
    title: `${topVdp.year} ${topVdp.make} ${topVdp.model} led the lot in VDP views last week`,
    text: `${topVdp.vdpViews7} views across all channels in 7 days and ${leads7(topVdp)} lead${leads7(topVdp) === 1 ? '' : 's'}. Interest is there — this one should be closing.`,
    vehicle: topVdp,
    stats: [
      { k: 'VDP views 7d', v: topVdp.vdpViews7, good: true },
      { k: 'Leads this week', v: leads7(topVdp) },
      { k: 'Days on lot', v: topVdp.daysInStock + 'd' },
    ],
    comments: [{ who: 'u_tina', text: 'Two of those leads are the same guy. He is grinding me on the trade.' }],
    react: { thumb: 2, fire: 3 },
  });

  const oldest = [...inv].sort((a, b) => b.daysInStock - a.daysInStock)[0];
  if (oldest && isAged(oldest)) push({
    id: 'e_aged' + oldest.id, hours: 33, kind: 'aged', actor: 'system', icon: '🕒',
    title: `${oldest.year} ${oldest.make} ${oldest.model} just crossed ${oldest.daysInStock} days`,
    text: `Oldest unit on the ground. It has had ${oldest.vdpViewsTotal} VDP views total and ${oldest.leads} lead${oldest.leads === 1 ? '' : 's'} — this is a price problem, not a traffic problem.`,
    vehicle: oldest,
    stats: [
      { k: 'Days in stock', v: oldest.daysInStock + 'd', bad: true },
      { k: 'Asking', v: '$' + oldest.price.toLocaleString() },
      { k: 'Market', v: '$' + oldest.market.toLocaleString() },
    ],
    comments: [{ who: 'u_mike', text: 'Nobody is calling on it at this money.' }],
  });

  const errUnit = inv.find(v => Object.values(v.listings).some(l => l.status === 'error'));
  if (errUnit) {
    const bad = Object.entries(errUnit.listings).find(([, l]) => l.status === 'error');
    const ch = CHANNELS.find(c => c.id === bad[0]);
    push({
      id: 'e_err' + errUnit.id, hours: 12, kind: 'sync_error', actor: 'system', icon: '⛔',
      title: `${ch.name} rejected stock #${errUnit.stock}`,
      text: `${bad[1].error}. The unit is live everywhere else — it is only dark on ${ch.short}.`,
      vehicle: errUnit,
      stats: [
        { k: 'Channel', v: ch.short, bad: true },
        { k: 'Live on', v: `${Object.values(errUnit.listings).filter(l => l.status === 'live').length} of ${CHANNELS.length}` },
        { k: 'Dark for', v: bad[1].pushedAt },
      ],
      comments: [],
      fix: true,
    });
  }

  return ev.sort((a, b) => a.hours - b.hours);
}
