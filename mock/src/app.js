/* ============================================================
   Rooftop — demo application
   Single-page, hash routed, no build step. Every screen renders
   from `state`; mutations call render(). Fine for a demo, and it
   maps 1:1 onto the Next.js App Router pages we build next.
   ============================================================ */

const $ = (s, r = document) => r.querySelector(s);
const money = (n) => '$' + Math.round(n).toLocaleString();
const vname = (v) => `${v.year} ${v.make} ${v.model}`;
const vfull = (v) => `${v.year} ${v.make} ${v.model} ${v.trim}`;

state.ui = { tab: 'wall', shot: 0, synVeh: null, synPrice: null, busy: false,
             stFilters: { makes: [], body: [], q: '', maxPrice: 60000, maxMiles: 200000 }, stShot: 0 };

const MARK = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/></svg>';

/* ============================ chrome ============================ */
function topbar() {
  const me = person(state.me);
  const r = state.route;
  const on = (p) => r.startsWith(p) ? 'on' : '';
  return `<div class="topbar">
    <div class="brand"><span class="brandmark">${MARK}</span>Rooftop<small>AUTO</small></div>
    <nav class="nav">
      <a href="#/lotwalk" class="${on('#/lotwalk')}">Lot Walk</a>
      <a href="#/inventory" class="${on('#/inventory')}">Inventory</a>
      <a href="#/syndication" class="${on('#/syndication')}">Syndication</a>
      <a href="#/reporting" class="${on('#/reporting')}">Reporting</a>
    </nav>
    <div class="spacer"></div>
    <div class="rtpick">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/></svg>
      <select data-act="rooftop">
        <option value="all" ${state.rooftop === 'all' ? 'selected' : ''}>All rooftops (2)</option>
        ${SEED.rooftops.map(rt => `<option value="${rt.id}" ${state.rooftop === rt.id ? 'selected' : ''}>${esc(rt.short)}</option>`).join('')}
      </select>
    </div>
    <a class="iconbtn" href="#/store" title="View the storefront">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/></svg></a>
    <button class="iconbtn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg><span class="dot"></span></button>
    <div class="me" style="background:${me.color}">${me.initials}</div>
  </div>`;
}

function railL() {
  const m = metrics();
  const lnk = (href, ic, label, badge) =>
    `<a class="lnk ${state.route.startsWith(href) ? 'on' : ''}" href="${href}">
       <span class="ic">${ic}</span><span class="grow">${label}</span>
       ${badge != null ? `<span class="chip ${badge.cls || ''}">${badge.v}</span>` : ''}</a>`;
  return `<div class="railL sticky">
    ${lnk('#/lotwalk', '🏠', 'Lot Walk')}
    ${lnk('#/inventory', '🚗', 'Inventory', { v: m.units })}
    ${lnk('#/syndication', '📡', 'Syndication')}
    ${lnk('#/reporting', '📊', 'Reporting')}
    <div class="grp">Work lists</div>
    ${lnk('#/inventory?f=b2', '⚠︎', 'At-risk list', { v: m.atRisk, cls: 'b2' })}
    ${lnk('#/inventory?f=b4', '🕒', 'Aged units', { v: m.aged, cls: 'b4' })}
    ${lnk('#/inventory?f=recon', '🔧', 'In recon', { v: m.inRecon })}
    ${lnk('#/inventory?f=water', '🌊', 'Water units', { v: m.water, cls: 'b4' })}
    <div class="grp">Rooftops</div>
    ${SEED.rooftops.map(rt => `<a class="lnk" href="#" data-act="rooftop-set" data-id="${rt.id}">
        <span class="ic">📍</span><span class="grow">${esc(rt.short)}</span>
        <span class="chip">${state.vehicles.filter(v => v.rooftop === rt.id).length}</span></a>`).join('')}
    <a class="lnk" href="#/store"><span class="ic">🌐</span><span class="grow">${esc(SEED.virtualRooftop.name)}</span>
      <span class="chip brand">Online</span></a>
  </div>`;
}

function metricStrip() {
  const m = metrics();
  const tile = (k, v, n) => `<div class="metric"><div class="k">${k}</div><div class="v num">${v}</div><div class="n">${n}</div></div>`;
  return `<div class="metrics">
    ${tile('Days supply', m.daysSupply, `${m.units} units · ${m.sales30} sold / 30d`)}
    ${tile('Turn rate', m.turn + '×', `<b class="${m.turn >= 12 ? 'up' : 'down'}">${m.turn >= 12 ? 'strong' : 'below 12×'}</b> · avg ${m.avgDis}d`)}
    ${tile('Fresh air', m.fresh, 'under 15 days')}
    ${tile('At risk', `<span style="color:var(--b2)">${m.atRisk}</span>`, `30–45 days · ${m.watch} at 46–60`)}
    ${tile('Front-line ready', m.frontLine, `${m.inRecon} still in recon`)}
    ${tile('VDP views 7d', m.vdp7.toLocaleString(), `${m.leads7} leads this week`)}
  </div>`;
}

/* ============================ Lot Walk ============================ */
function postCard(e) {
  const p = e.actor === 'system' ? null : person(e.actor);
  const rx = state.reactions[e.id] || {};
  const base = e.react || { thumb: 0, fire: 0 };
  const nThumb = base.thumb + (rx.thumb ? 1 : 0), nFire = base.fire + (rx.fire ? 1 : 0);
  const cmts = [...(e.comments || []), ...(state.extraComments[e.id] || [])];

  const media = e.vehicle
    ? `<a class="postmedia" href="#/vehicle/${e.vehicle.id}"><img src="${e.vehicle.hero}" alt=""></a>` : '';

  const unitStrip = e.units ? `<div style="padding:0 16px 12px;display:flex;flex-direction:column;gap:1px;
      border:1px solid var(--line);border-radius:10px;margin:0 16px 12px;overflow:hidden;background:var(--line2)">
      ${e.units.map(v => `<a class="rrow" style="background:#fff" href="#/vehicle/${v.id}">
        <img class="thumb" src="${v.hero}"><div class="grow">
        <div class="sm" style="font-weight:750">${esc(vfull(v))}</div>
        <div class="tiny muted">STK ${v.stock} · ${money(v.price)} · ${v.vdpViews7} VDP / 7d</div></div>
        <span class="chip ${bucketOf(v.daysInStock).cls}">${v.daysInStock}d</span></a>`).join('')}
    </div>` : '';

  const personCard = e.person ? (() => {
    const t = person(e.person);
    return `<div style="margin:0 16px 12px;border:1px solid var(--line);border-radius:10px;padding:14px;display:flex;gap:12px;align-items:center;background:var(--card2)">
      <div class="av" style="width:48px;height:48px;font-size:15px;background:${t.color}">${t.initials}</div>
      <div class="grow"><div style="font-weight:800;font-size:15px">${esc(t.name)}</div>
      <div class="sm muted">${esc(t.role)} · ${esc(rooftopName(t.rooftop))}</div></div>
      <button class="btn ghost sm">Say hi</button></div>`;
  })() : '';

  return `<article class="post" data-ev="${e.id}">
    <div class="top">
      ${p ? `<div class="av" style="background:${p.color}">${p.initials}</div>`
          : `<div class="av sys">${MARK}</div>`}
      <div class="grow">
        <div class="who">${p ? esc(p.name) : 'Rooftop'}</div>
        <div class="when">${p ? esc(p.role) : 'Automatic'} · ${ago(e.hours)} ago
          ${e.vehicle ? `· <span class="chip ${bucketOf(e.vehicle.daysInStock).cls}">${e.vehicle.daysInStock}d</span>` : ''}</div>
      </div>
      <button class="iconbtn" style="color:var(--ink4)">···</button>
    </div>
    <div class="body"><h4>${e.icon} ${esc(e.title)}</h4><p>${esc(e.text)}</p></div>
    ${personCard}${unitStrip}${media}
    ${e.stats ? `<div class="stats">${e.stats.map(s =>
      `<div class="stat"><div class="k">${esc(s.k)}</div>
        <div class="v num ${s.good ? 'up' : s.bad ? 'down' : ''}">${s.v}</div></div>`).join('')}</div>` : ''}
    ${e.fix ? `<div style="padding:11px 16px;border-top:1px solid var(--line2);display:flex;gap:8px">
        <button class="btn sm" data-act="goto-syn">Open in Syndication</button>
        <button class="btn ghost sm">Re-upload photo</button></div>` : ''}
    <div class="react">
      <button class="rbtn ${rx.thumb ? 'on' : ''}" data-act="react" data-ev="${e.id}" data-kind="thumb">👍 ${nThumb || ''}</button>
      <button class="rbtn ${rx.fire ? 'on' : ''}" data-act="react" data-ev="${e.id}" data-kind="fire">🔥 ${nFire || ''}</button>
      <button class="rbtn">💬 Comment${cmts.length ? ' ' + cmts.length : ''}</button>
      <div class="grow"></div>
      ${e.vehicle ? `<a class="rbtn" href="#/vehicle/${e.vehicle.id}">Open unit →</a>` : ''}
    </div>
    ${cmts.length ? `<div class="cmts">${cmts.map(c => { const w = person(c.who);
      return `<div class="cmt"><div class="av" style="background:${w.color}">${w.initials}</div>
        <div class="bub"><b>${esc(w.name)}</b>${esc(c.text)}</div></div>`; }).join('')}
      ${commentBox(e.id)}</div>` : `<div class="cmts">${commentBox(e.id)}</div>`}
  </article>`;
}
const commentBox = (id) => {
  const me = person(state.me);
  return `<div class="cmtin"><div class="av" style="width:28px;height:28px;font-size:10.5px;background:${me.color}">${me.initials}</div>
    <input placeholder="Write a comment…" data-act="comment" data-ev="${id}"></div>`;
};

function railR() {
  const inv = scoped();
  const m = metrics();
  const atRisk = inv.filter(isAtRisk).sort((a, b) => b.daysInStock - a.daysInStock).slice(0, 5);
  const recon = inv.filter(v => v.reconStatus === 'in_recon');
  return `<div class="railR sticky stack">
    <div class="card">
      <div class="hd"><h3>Today's board</h3></div>
      <div class="board">
        <div><div class="k">Sold today</div><div class="v num">${SALES.filter(s => s.when === 0).length}</div></div>
        <div><div class="k">Sold MTD</div><div class="v num">${m.sales30}</div></div>
        <div><div class="k">Front gross MTD</div><div class="v num">${money(m.grossMTD)}</div></div>
        <div><div class="k">Inventory $</div><div class="v num">${'$' + Math.round(m.invValue / 1000)}k</div></div>
      </div>
    </div>

    <div class="card">
      <div class="hd"><h3>At-risk list</h3><div class="grow"></div>
        <span class="chip b2">${m.atRisk}</span></div>
      ${atRisk.map(v => `<a class="rrow" href="#/vehicle/${v.id}">
        <img class="thumb" src="${v.hero}"><div class="grow">
          <div class="sm trunc" style="font-weight:750">${esc(vname(v))}</div>
          <div class="tiny muted">STK ${v.stock} · ${money(v.price)}</div></div>
        <span class="chip ${bucketOf(v.daysInStock).cls}">${v.daysInStock}d</span></a>`).join('')}
      <a class="rrow" href="#/inventory?f=b2" style="justify-content:center;font-weight:750;color:var(--brand-dk);font-size:12.5px">See the whole list →</a>
    </div>

    ${recon.length ? `<div class="card">
      <div class="hd"><h3>In the recon bay</h3><div class="grow"></div><span class="chip">${recon.length}</span></div>
      ${recon.map(v => `<a class="rrow" href="#/vehicle/${v.id}">
        <img class="thumb" src="${v.hero}"><div class="grow">
          <div class="sm trunc" style="font-weight:750">${esc(vname(v))}</div>
          <div class="tiny muted">${esc(v.reconNote)}</div></div>
        <span class="chip ${v.reconDays > 7 ? 'warn' : 'ok'}">${v.reconDays}d</span></a>`).join('')}
      <div class="pad tiny muted" style="padding-top:0">Target recon time is 5–7 days.</div>
    </div>` : ''}

    <div class="card">
      <div class="hd"><h3>On the lot today</h3></div>
      <div class="pad" style="display:flex;flex-wrap:wrap;gap:8px">
        ${SEED.people.map(p => `<div class="row" style="gap:7px">
          <div class="av" style="width:28px;height:28px;font-size:10.5px;background:${p.color}">${p.initials}</div>
          <div><div class="tiny" style="font-weight:750">${esc(p.name.split(' ')[0])}</div>
          <div class="tiny muted" style="font-size:10.5px">${esc(p.role)}</div></div></div>`).join('')}
      </div>
    </div>
  </div>`;
}

function viewLotWalk() {
  const me = person(state.me);
  return `<div class="wrap"><div class="cols">
    ${railL()}
    <div class="stack">
      ${metricStrip()}
      <div class="card">
        <div class="composer">
          <div class="av" style="background:${me.color}">${me.initials}</div>
          <input placeholder="Post something to the lot, ${esc(me.name.split(' ')[0])}…">
        </div>
        <div class="quick">
          <button>🚚 Log a unit</button><button>🔔 Ring the bell</button>
          <button>💲 Price change</button><button>📸 Request photos</button><button>📣 Announcement</button>
        </div>
      </div>
      ${buildFeed().map(postCard).join('')}
      <div class="card pad" style="text-align:center" class="muted">
        <div class="sm muted">That's the whole day. The feed only shows things that moved money.</div>
      </div>
    </div>
    ${railR()}
  </div></div>`;
}

/* ============================ Inventory ============================ */
function viewInventory() {
  const f = (state.route.split('?f=')[1] || '').replace(/#.*$/, '');
  let inv = scoped();
  if (f === 'recon') inv = inv.filter(v => v.reconStatus === 'in_recon');
  else if (f === 'water') inv = inv.filter(v => v.isWater);
  else if (f) inv = inv.filter(v => bucketOf(v.daysInStock).id === f);
  inv = [...inv].sort((a, b) => b.daysInStock - a.daysInStock);

  const chip = (id, label, cls) =>
    `<a class="fchip ${cls || ''} ${f === id ? 'on' : ''}" href="#/inventory${id ? '?f=' + id : ''}">${label}</a>`;

  return `<div class="wrap"><div class="cols">${railL()}
    <div class="stack" style="grid-column:span 2">
      ${metricStrip()}
      <div class="card">
        <div class="filters">
          ${chip('', 'All ' + scoped().length)}
          ${BUCKETS.map(b => chip(b.id, b.label + ' · ' + scoped().filter(v => bucketOf(v.daysInStock).id === b.id).length, b.cls)).join('')}
          <span style="width:1px;height:22px;background:var(--line)"></span>
          ${chip('recon', '🔧 In recon', '')}
          ${chip('water', '🌊 Water', 'b4')}
          <div class="grow"></div>
          <input class="search" placeholder="Search VIN, stock #, make, model…" data-act="invsearch">
          <button class="btn">+ Add vehicle</button>
        </div>
        <div style="overflow:auto">
        <table class="tbl"><thead><tr>
          <th></th><th>Vehicle</th><th>Stock / VIN</th><th class="r">Days</th><th class="r">Miles</th>
          <th class="r">Price</th><th class="r">vs market</th><th class="r">Cost</th><th class="r">Gross</th>
          <th class="r">VDP 7d</th><th>Channels</th><th>Rooftop</th>
        </tr></thead><tbody>
        ${inv.map(v => {
          const b = bucketOf(v.daysInStock);
          const delta = v.price - v.market;
          const gross = v.price - v.totalCost;
          const live = Object.values(v.listings).filter(l => l.status === 'live').length;
          const err = Object.values(v.listings).some(l => l.status === 'error');
          return `<tr data-act="veh" data-id="${v.id}">
            <td><span class="agebar" style="background:var(--${b.cls})"></span></td>
            <td><div class="row"><img class="thumb" src="${v.hero}">
              <div><div style="font-weight:750">${esc(vfull(v))}</div>
              <div class="tiny muted">${esc(v.exteriorColor)} · ${esc(v.drivetrain)} · ${esc(v.body)}
              ${v.reconStatus === 'in_recon' ? ' · <b style="color:var(--warn)">in recon</b>' : ''}
              ${v.isWater ? ' · <b style="color:var(--err)">water</b>' : ''}</div></div></div></td>
            <td class="mono tiny">${v.stock}<br><span class="muted">${v.vin}</span></td>
            <td class="r"><span class="chip ${b.cls}">${v.daysInStock}d</span></td>
            <td class="r num">${v.mileage.toLocaleString()}</td>
            <td class="r num" style="font-weight:800">${money(v.price)}</td>
            <td class="r num ${delta > 0 ? 'down' : 'up'}">${delta > 0 ? '+' : '−'}${money(Math.abs(delta)).slice(1)}</td>
            <td class="r num muted">${money(v.totalCost)}</td>
            <td class="r num ${gross < 1500 ? 'down' : ''}" style="font-weight:750">${gross < 0 ? '−' : ''}${money(Math.abs(gross))}</td>
            <td class="r num">${v.vdpViews7 || '—'}</td>
            <td><span class="chip ${err ? 'err' : live === CHANNELS.length ? 'ok' : ''}">${err ? '⛔ ' : ''}${live}/${CHANNELS.length}</span></td>
            <td class="tiny muted">${esc(rooftopName(v.rooftop))}</td>
          </tr>`;
        }).join('')}
        </tbody></table></div>
        <div class="pad tiny muted" style="border-top:1px solid var(--line2)">
          Showing ${inv.length} of ${scoped().length} units${state.rooftop !== 'all' ? ' at ' + esc(rooftopName(state.rooftop)) : ' across both rooftops'}.
          "vs market" compares your asking price to book retail for the same year, trim and mileage.
        </div>
      </div>
    </div>
  </div></div>`;
}

/* ============================ Vehicle profile ============================ */
function wall(v) {
  const d = v.daysInStock;
  const ev = [];
  const at = (daysAgo) => daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo} days ago`;
  ev.push({ d, ic: '🚚', h: `Acquired — ${v.source}`, t: `Stock #${v.stock} created. ACV ${money(v.cost)}, pack ${money(v.pack)}.` });
  ev.push({ d: d - 1, ic: '🔧', h: 'Into the recon bay', t: v.reconNote });
  if (v.reconStatus === 'complete') {
    ev.push({ d: d - v.reconDays, ic: '✅', h: `Recon closed — ${v.reconDays} days`, t: `${money(v.reconCost)} in recon. ${v.reconDays <= 7 ? 'Inside the 5–7 day target.' : 'Over the 5–7 day target.'}` });
    ev.push({ d: d - v.reconDays, ic: '📸', h: `${v.photoCount} photos uploaded`, t: 'Rob Chen shot the unit on the back row.' });
    ev.push({ d: d - v.reconDays, ic: '🟢', h: 'Front-line ready', t: `Went live on ${CHANNELS.length} channels at ${money(v.price)}.` });
  } else {
    ev.push({ d: 0, ic: '⏳', h: `Still in recon — day ${v.reconDays}`, t: 'Held out of syndication until photos are up.' });
  }
  if (d > 30) ev.push({ d: d - 30, ic: '⚠︎', h: 'Added to the at-risk list', t: 'Crossed 30 days. Flagged for a decision on the next lot walk.' });
  if (d > 45) ev.push({ d: d - 45, ic: '💲', h: 'Price cut $500', t: `${money(v.price + 500)} → ${money(v.price)} at 45 days with no deal.` });
  if (d > 61) ev.push({ d: d - 61, ic: '🕒', h: 'Became an aged unit', t: 'Past 60 days on the ground and still eating floorplan.' });
  if (v.isWater) ev.push({ d: 3, ic: '🌊', h: 'Flagged as a water unit', t: `Total cost ${money(v.totalCost)} is above market of ${money(v.market)}.` });
  if (v.frontLineReady) ev.push({ d: 0, ic: '📈', h: `${v.vdpViews7} VDP views in the last 7 days`, t: `${leads7(v)} lead${leads7(v) === 1 ? '' : 's'} this week · ${v.vdpViewsTotal} views and ${v.leads} leads lifetime.` });

  return ev.sort((a, b) => b.d - a.d).map(e =>
    `<div class="wev"><div class="wdot">${e.ic}</div>
      <div class="grow"><div class="h">${esc(e.h)}</div>
      <div class="sm muted">${esc(e.t)}</div>
      <div class="t" style="margin-top:2px">${at(Math.max(0, e.d))}</div></div></div>`).join('');
}

function viewVehicle(id) {
  const v = byId(id); if (!v) return viewInventory();
  const b = bucketOf(v.daysInStock);
  const gross = v.price - v.totalCost;
  const shot = Math.min(state.ui.shot, v.photos.length - 1);
  const tab = state.ui.tab;

  const kv = (k, val, cls) => `<div class="kv"><span class="k">${k}</span><span class="v ${cls || ''}">${val}</span></div>`;

  return `<div class="wrap"><div class="stack">
    <div class="row" style="gap:12px;flex-wrap:wrap">
      <a class="btn ghost sm" href="#/inventory">← Inventory</a>
      <div class="grow"><div style="font-size:22px;font-weight:850;letter-spacing:-.6px">${esc(vfull(v))}</div>
        <div class="sm muted mono">STK ${v.stock} · VIN ${v.vin} · ${esc(rooftopName(v.rooftop))}</div></div>
      <span class="chip ${b.cls}">${v.daysInStock} days · ${esc(b.name)}</span>
      ${v.isWater ? '<span class="chip err">🌊 Water unit</span>' : ''}
      ${v.frontLineReady ? '<span class="chip ok">Front-line ready</span>' : '<span class="chip warn">In recon</span>'}
      <a class="btn ghost sm" href="#/store/v/${v.id}">View public VDP ↗</a>
      <button class="btn sm" data-act="goto-syn-veh" data-id="${v.id}">Push to channels</button>
    </div>

    <div class="vhero">
      <div class="stack">
        <div class="card gal">
          <img class="main" src="${v.photos[shot].src}" alt="">
          <div class="gstrip">
            ${v.photos.map((p, i) => `<img src="${p.src}" class="${i === shot ? 'on' : ''}" data-act="shot" data-i="${i}" title="${esc(p.label)}">`).join('')}
            <div class="add">＋</div>
          </div>
          <div class="pad tiny muted" style="border-top:1px solid var(--line2)">
            ${v.photoCount
              ? `${v.photoCount} photos on file · showing ${v.photos.length} · drag to reorder ·
                 the first photo is what every channel shows in search results.`
              : `No photos yet · held out of syndication until the unit is shot ·
                 the first photo is what every channel shows in search results.`}
          </div>
        </div>

        <div class="card">
          <div class="tabs">
            ${['wall', 'merchandising', 'syndication'].map(t =>
              `<button class="${tab === t ? 'on' : ''}" data-act="tab" data-t="${t}">${t === 'wall' ? 'Wall' : t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
          </div>
          ${tab === 'wall' ? `<div class="wall">${wall(v)}</div>
            <div class="cmts" style="border-top:1px solid var(--line2)">${commentBox('veh_' + v.id)}</div>`
          : tab === 'merchandising' ? `
            <div class="fld"><label>VDP headline</label>
              <input value="${esc(v.headline || `${vfull(v)} · ${v.drivetrain} · ${v.mileage.toLocaleString()} miles`)}">
              <div class="hint">Shows as the title on your site and on every aggregator listing.</div></div>
            <div class="fld"><label>Seller's notes</label>
              <textarea rows="4">${esc(v.blurb || `Local ${v.year} ${v.model} ${v.trim} in ${v.exteriorColor} over ${v.interiorColor}. ${v.carfax} history, ${v.titleStatus.toLowerCase()} title. Just through our shop — ${v.reconNote.toLowerCase()}. ${v.drivetrain} and ready for the pass.`)}</textarea>
              <div class="hint">Dealers who write real notes get more VDP time. This field syndicates everywhere except Google Vehicle Ads.</div></div>
            <div class="fld"><label>Highlighted features</label>
              <div class="feats">${v.features.map(f => `<span class="feat">${esc(f)} ✕</span>`).join('')}<span class="feat" style="border-style:dashed;color:var(--ink3)">＋ Add</span></div></div>
            <div class="grid2">
              <div class="fld"><label>Asking price</label><input value="${money(v.price)}"></div>
              <div class="fld"><label>Internet price</label><input value="${money(v.price)}"></div>
              <div class="fld"><label>Carfax</label><input value="${esc(v.carfax)}"></div>
              <div class="fld"><label>Title</label><input value="${esc(v.titleStatus)}"></div>
            </div>`
          : `<div style="padding:14px 16px" class="stack">
              ${CHANNELS.map(c => { const l = v.listings[c.id];
                return `<div class="row" style="padding:10px 12px;border:1px solid var(--line);border-radius:10px">
                  <span class="chlogo" style="background:${c.color}">${c.logo}</span>
                  <div class="grow"><div style="font-weight:750">${esc(c.name)}</div>
                    <div class="tiny muted">${esc(l.error || c.cadence)}</div></div>
                  <div style="text-align:right"><div class="num sm" style="font-weight:750">${l.status === 'off' ? '—' : money(l.price)}</div>
                    <div class="tiny muted">${esc(l.pushedAt)}</div></div>
                  <span class="chip ${l.status === 'live' ? 'ok' : l.status === 'error' ? 'err' : ''}">${l.status}</span>
                </div>`; }).join('')}
            </div>`}
        </div>
      </div>

      <div class="stack">
        <div class="card money">
          <div class="hd"><h3>The money</h3></div>
          ${kv('ACV / purchase', money(v.cost))}
          ${kv('Pack', money(v.pack))}
          ${kv('Recon', money(v.reconCost))}
          ${kv('Total cost', `<b>${money(v.totalCost)}</b>`)}
          <hr class="sep">
          ${kv('Market retail', money(v.market))}
          ${kv('Asking price', `<b>${money(v.price)}</b>`)}
          ${kv('vs market', `${v.price > v.market ? '+' : '−'}${money(Math.abs(v.price - v.market)).slice(1)}`, v.price > v.market ? 'down' : 'up')}
          <hr class="sep">
          ${kv('Projected front gross', `<b>${gross < 0 ? '−' : ''}${money(Math.abs(gross))}</b>`, gross < 1500 ? 'down' : 'up')}
          ${v.isWater ? `<div class="pad tiny" style="background:var(--b4w);color:var(--b4);font-weight:700">
            🌊 Water unit — you have more in it than it is worth. Wholesale or take the hit retail.</div>` : ''}
        </div>

        <div class="card">
          <div class="hd"><h3>Aging</h3></div>
          <div class="pad">
            <div class="row" style="gap:2px;margin-bottom:9px">
              ${BUCKETS.map(bb => `<div style="flex:${bb.id === 'b4' ? 2 : 1};height:8px;border-radius:3px;
                background:${bucketOf(v.daysInStock).id === bb.id ? `var(--${bb.cls})` : 'var(--line)'}"></div>`).join('')}
            </div>
            <div class="row"><div class="grow"><div style="font-size:26px;font-weight:850;letter-spacing:-1px">${v.daysInStock}<span class="sm muted" style="font-weight:600"> days</span></div>
              <div class="tiny muted">Acquired ${v.acquired} · ${esc(v.source)}</div></div>
              <span class="chip ${b.cls}">${esc(b.name)}</span></div>
          </div>
          <div class="specs" style="border:0;border-top:1px solid var(--line2);border-radius:0">
            <div><div class="k">VDP 7d</div><div class="v num">${v.vdpViews7 || '—'}</div></div>
            <div><div class="k">Lifetime</div><div class="v num">${v.vdpViewsTotal || '—'}</div></div>
            <div><div class="k">Leads</div><div class="v num">${v.leads || '—'}</div></div>
          </div>
        </div>

        <div class="card">
          <div class="hd"><h3>Unit detail</h3></div>
          ${kv('Mileage', v.mileage.toLocaleString() + ' mi')}
          ${kv('Drivetrain', esc(v.drivetrain))}
          ${kv('Engine', esc(v.engine))}
          ${kv('Transmission', esc(v.transmission))}
          ${kv('Exterior', esc(v.exteriorColor))}
          ${kv('Interior', esc(v.interiorColor))}
          ${kv('Title', esc(v.titleStatus))}
          ${kv('History', esc(v.carfax))}
          ${kv('Rooftop', esc(rooftopName(v.rooftop)))}
        </div>
      </div>
    </div>
  </div></div>`;
}

/* ============================ Syndication ============================ */
function logLine(cls, text) { state.log.push({ cls, text }); if (state.log.length > 60) state.log.shift(); }

function pushPrice(v, newPrice) {
  if (state.ui.busy) return;
  state.ui.busy = true;
  const old = v.price;
  v.price = newPrice;
  logLine('br', `▸ price change  STK ${v.stock}  ${money(old)} → ${money(newPrice)}`);
  logLine('dim', `  one record changed. fanning out to ${CHANNELS.length} channels…`);

  CHANNELS.forEach(c => {
    const l = v.listings[c.id];
    if (l.status === 'off') { logLine('dim', `  ${c.short.padEnd(12)} skipped — unit is not syndicated`); return; }
    l.status = 'queued';
    const delay = c.demoMs[0] + Math.random() * (c.demoMs[1] - c.demoMs[0]);
    setTimeout(() => { l.status = 'syncing'; logLine('dim', `  ${c.short.padEnd(12)} pushing…`); render(); }, delay * 0.45);
    setTimeout(() => {
      if (l.error && c.id === 'meta') {
        l.status = 'error';
        logLine('er', `  ${c.short.padEnd(12)} REJECTED — ${l.error}`);
      } else {
        l.status = 'live'; l.price = newPrice; l.pushedAt = 'just now'; l.error = null;
        logLine('ok', `  ${c.short.padEnd(12)} live at ${money(newPrice)}  (real-world: ${c.realNote})`);
      }
      render();
    }, delay);
  });
  setTimeout(() => {
    state.ui.busy = false;
    logLine('dim', `  done. you changed the price once.`);
    render();
  }, 3100);
  render();
}

function viewSyndication() {
  const inv = scoped();
  const sel = state.ui.synVeh ? byId(state.ui.synVeh) : inv.find(v => v.frontLineReady);
  const counts = Object.fromEntries(CHANNELS.map(c => [c.id,
    inv.filter(v => v.listings[c.id].status === 'live').length]));
  const errs = Object.fromEntries(CHANNELS.map(c => [c.id,
    inv.filter(v => v.listings[c.id].status === 'error').length]));

  return `<div class="wrap"><div class="stack">
    <div class="row"><div class="grow">
      <div style="font-size:22px;font-weight:850;letter-spacing:-.6px">Syndication</div>
      <div class="sm muted">One inventory record. Every channel downstream. Change it here, it changes everywhere.</div>
    </div></div>

    <div class="chgrid">
      ${CHANNELS.map(c => `<div class="ch">
        <div class="n"><span class="chlogo" style="background:${c.color}">${c.logo}</span>
          <div class="grow"><div>${esc(c.short)}</div><div class="tiny muted" style="font-weight:600">${esc(c.kind)}</div></div>
          ${errs[c.id] ? `<span class="chip err">${errs[c.id]}</span>` : '<span class="chip ok">✓</span>'}</div>
        <div class="meta"><b class="num">${counts[c.id]}</b> of ${inv.length} units live<br>${esc(c.cadence)}</div>
        <div class="bar"><i style="width:${(counts[c.id] / Math.max(1, inv.length)) * 100}%"></i></div>
      </div>`).join('')}
    </div>

    <div class="card">
      <div class="demobar">
        <div><div class="tiny" style="font-weight:800;letter-spacing:.9px;text-transform:uppercase;color:var(--ink3)">Live demo</div>
          <div style="font-weight:800;font-size:15px;margin-top:2px">Change the price once, watch it land everywhere</div></div>
        <div class="grow"></div>
        <div class="fld"><label>Unit</label>
          <select class="sel" data-act="syn-veh" style="width:280px">
            ${inv.filter(v => v.frontLineReady).map(v => `<option value="${v.id}" ${sel && sel.id === v.id ? 'selected' : ''}>
              STK ${v.stock} — ${esc(vfull(v))}</option>`).join('')}
          </select></div>
        <div class="fld"><label>New price</label>
          <input class="sel" data-act="syn-price" value="${sel ? sel.price : ''}" style="width:120px"></div>
        <button class="btn dark" data-act="push" ${state.ui.busy ? 'disabled' : ''}>
          ${state.ui.busy ? 'Pushing…' : 'Save & push to all channels'}</button>
      </div>

      ${sel ? `<div class="row" style="padding:12px 16px;gap:14px;border-bottom:1px solid var(--line2);flex-wrap:wrap">
        <img class="thumb" style="width:78px;height:50px" src="${sel.hero}">
        <div class="grow"><div style="font-weight:800">${esc(vfull(sel))}</div>
          <div class="tiny muted mono">STK ${sel.stock} · ${sel.vin}</div></div>
        ${CHANNELS.map(c => { const l = sel.listings[c.id];
          return `<div style="text-align:center;min-width:74px">
            <div class="sdot s-${l.status}" style="margin:0 auto 5px">${l.status === 'live' ? '✓' : l.status === 'error' ? '!' : ''}</div>
            <div class="tiny" style="font-weight:750">${esc(c.short)}</div>
            <div class="tiny num muted">${l.status === 'off' ? '—' : money(l.price)}</div></div>`; }).join('')}
      </div>` : ''}

      <div class="pad"><div class="log">${state.log.length
        ? state.log.map(l => `<div class="${l.cls}">${esc(l.text)}</div>`).join('')
        : `<div class="dim">ready. pick a unit, set a price, hit push.<br>nothing here talks to a real API yet — the timing below is what the real thing will do.</div>`}</div>
      </div>
    </div>

    <div class="card">
      <div class="hd"><h3>Per-VIN channel status</h3><div class="grow"></div>
        <span class="chip ok">live</span><span class="chip">queued</span><span class="chip err">error</span>
        <span class="chip" style="background:#eef1f4;color:var(--ink4)">not listed</span></div>
      <div style="overflow:auto"><table class="matrix"><thead><tr>
        <th class="l" style="text-align:left">Unit</th><th class="l">Days</th><th class="l">Price</th>
        ${CHANNELS.map(c => `<th class="v">${esc(c.short)}</th>`).join('')}
        <th class="l">Issue</th></tr></thead><tbody>
        ${inv.sort((a, b) => a.daysInStock - b.daysInStock).map(v => {
          const issue = Object.entries(v.listings).find(([, l]) => l.error);
          return `<tr data-act="veh" data-id="${v.id}">
            <td class="l"><div class="row"><img class="thumb" style="width:44px;height:29px" src="${v.hero}">
              <div><div style="font-weight:700;font-size:12px">${esc(vname(v))}</div>
              <div class="tiny muted mono">${v.stock}</div></div></div></td>
            <td class="l"><span class="chip ${bucketOf(v.daysInStock).cls}">${v.daysInStock}</span></td>
            <td class="l num" style="font-weight:750">${money(v.price)}</td>
            ${CHANNELS.map(c => { const l = v.listings[c.id];
              return `<td><span class="sdot s-${l.status}" title="${esc(c.name)}: ${l.status}">${l.status === 'live' ? '✓' : l.status === 'error' ? '!' : ''}</span></td>`; }).join('')}
            <td class="l tiny" style="color:var(--err);max-width:210px">${issue ? esc(issue[1].error) : ''}</td>
          </tr>`; }).join('')}
      </tbody></table></div>
      <div class="pad tiny muted" style="border-top:1px solid var(--line2)">
        Nothing on this screen calls a real API yet. The channel cadences shown are the real ones — when we wire the
        integrations, a price change hits your own site instantly and reaches the slowest aggregator by the next
        morning feed. No dealer retypes anything.
      </div>
    </div>
  </div></div>`;
}

/* ============================ Reporting ============================ */
function sparkline(vals, w = 560, h = 78, color = 'var(--brand)') {
  const max = Math.max(...vals), min = Math.min(...vals) * 0.9;
  const pt = (v, i) => [i * (w / (vals.length - 1)), h - ((v - min) / (max - min)) * (h - 8) - 4];
  const line = vals.map((v, i) => pt(v, i).join(',')).join(' L');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="sp" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="M${line} L${w},${h} L0,${h} Z" fill="url(#sp)"/>
    <path d="M${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>
    ${vals.map((v, i) => { const [x, y] = pt(v, i); return `<circle cx="${x}" cy="${y}" r="2.5" fill="${color}"/>`; }).join('')}
  </svg>`;
}

function viewReporting() {
  const inv = scoped(); const m = metrics();
  const dist = BUCKETS.map(b => ({ b, n: inv.filter(v => bucketOf(v.daysInStock).id === b.id).length }));
  const maxN = Math.max(...dist.map(d => d.n), 1);
  const mix = ['Pickup', 'SUV', 'Sedan', 'Wagon'].map((k, i) => ({
    k, n: inv.filter(v => v.body === k).length, c: ['#4f46e5', '#0e8fa8', '#c9760a', '#15a34a'][i] }));
  const total = mix.reduce((a, x) => a + x.n, 0) || 1;
  const top = [...inv].sort((a, b) => b.vdpViews7 - a.vdpViews7).slice(0, 6);
  const MONTHS = ['Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul'];
  const maxS = Math.max(...SALES_12M);

  let off = 0;
  const donut = mix.map(x => { const dash = (x.n / total) * 314; const el =
    `<circle cx="60" cy="60" r="50" fill="none" stroke="${x.c}" stroke-width="19"
      stroke-dasharray="${dash} 314" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`;
    off += dash; return el; }).join('');

  return `<div class="wrap"><div class="stack">
    <div><div style="font-size:22px;font-weight:850;letter-spacing:-.6px">Reporting</div>
      <div class="sm muted">Only the numbers a dealer already runs their week on. Demo data.</div></div>
    ${metricStrip()}

    <div class="cols" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
      <div class="stack">
        <div class="card">
          <div class="hd"><h3>Aging distribution</h3><div class="grow"></div>
            <span class="sm muted">${m.atRisk} at risk · ${m.aged} aged</span></div>
          <div class="pad"><div class="bars">
            ${dist.map(d => `<div class="b">
              <div class="vl num" style="color:var(--${d.b.cls})">${d.n}</div>
              <div class="bar" style="height:${(d.n / maxN) * 100}%;background:var(--${d.b.cls})"></div>
              <div class="lb">${d.b.label}<br><span class="muted" style="font-weight:600">${esc(d.b.name)}</span></div>
            </div>`).join('')}
          </div></div>
          <div class="pad tiny muted" style="border-top:1px solid var(--line2)">
            A healthy independent lot wants most of the weight on the left. Anything past 60 days is eating floorplan.
          </div>
        </div>

        <div class="card">
          <div class="hd"><h3>VDP views — trailing 12 months</h3><div class="grow"></div>
            <span class="chip ok">↑ 78% vs a year ago</span></div>
          <div class="pad">${sparkline(VDP_TREND)}
            <div class="row tiny muted" style="justify-content:space-between;margin-top:6px">
              ${MONTHS.map(x => `<span>${x}</span>`).join('')}</div>
          </div>
          <div class="pad tiny muted" style="border-top:1px solid var(--line2)">
            VDP views is the number dealers already track. It is the one metric that connects ad spend to a unit selling.
          </div>
        </div>

        <div class="card">
          <div class="hd"><h3>Units sold by month</h3><div class="grow"></div>
            <span class="sm muted num">${SALES_12M.reduce((a, b) => a + b, 0)} in 12 months</span></div>
          <div class="pad"><div class="bars" style="height:130px">
            ${SALES_12M.map((n, i) => `<div class="b"><div class="vl num" style="font-size:12px">${n}</div>
              <div class="bar" style="height:${(n / maxS) * 100}%;background:${i === 11 ? 'var(--brand)' : '#c9cfe8'}"></div>
              <div class="lb" style="font-size:10px">${MONTHS[i]}</div></div>`).join('')}
          </div></div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="hd"><h3>Turn rate</h3></div>
          <div class="pad">
            <div style="font-size:44px;font-weight:850;letter-spacing:-2px;line-height:1">${m.turn}×</div>
            <div class="sm muted" style="margin-top:4px">Average ${m.avgDis} days to turn a unit.</div>
            <div style="margin-top:14px;height:9px;border-radius:5px;background:var(--line2);position:relative;overflow:hidden">
              <i style="position:absolute;left:0;top:0;bottom:0;width:${Math.min(100, (m.turn / 22) * 100)}%;background:linear-gradient(90deg,var(--b4),var(--b2),var(--b0))"></i>
            </div>
            <div class="row tiny muted" style="justify-content:space-between;margin-top:5px">
              <span>0</span><span>12× strong</span><span>22× top</span></div>
            <div class="tiny" style="margin-top:11px;padding:9px 11px;background:var(--b2w);color:var(--b2);border-radius:8px;font-weight:700">
              You are below 12×. Every extra day of average age costs you a turn.</div>
          </div>
        </div>

        <div class="card">
          <div class="hd"><h3>Inventory mix</h3></div>
          <div class="pad dnut">
            <svg width="120" height="120" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="50" fill="none" stroke="var(--line2)" stroke-width="19"/>${donut}
              <text x="60" y="58" text-anchor="middle" font-size="22" font-weight="800" fill="#0f1620">${inv.length}</text>
              <text x="60" y="74" text-anchor="middle" font-size="9" font-weight="700" fill="#6d7886" letter-spacing="1">UNITS</text>
            </svg>
            <div class="leg">${mix.map(x => `<div><i style="background:${x.c}"></i>${esc(x.k)}
              <b class="num">${x.n}</b><span class="muted">${Math.round((x.n / total) * 100)}%</span></div>`).join('')}</div>
          </div>
        </div>

        <div class="card">
          <div class="hd"><h3>Most VDP views · 7 days</h3></div>
          ${top.map(v => `<a class="rrow" href="#/vehicle/${v.id}">
            <img class="thumb" src="${v.hero}"><div class="grow">
              <div class="sm trunc" style="font-weight:750">${esc(vname(v))}</div>
              <div class="tiny muted">${money(v.price)} · ${leads7(v)} lead${leads7(v) === 1 ? '' : 's'} this week</div></div>
            <div style="text-align:right"><div class="num" style="font-weight:800">${v.vdpViews7}</div>
              <div class="tiny muted">${v.daysInStock}d</div></div></a>`).join('')}
        </div>

        <div class="card">
          <div class="hd"><h3>Days supply</h3></div>
          <div class="pad">
            <div style="font-size:44px;font-weight:850;letter-spacing:-2px;line-height:1">${m.daysSupply}</div>
            <div class="sm muted" style="margin-top:4px">days of inventory at your current sales pace
              (${m.units} units, ${m.sales30} sold in 30 days).</div>
            <div class="tiny" style="margin-top:11px;padding:9px 11px;background:var(--card2);border-radius:8px">
              Most independent operators aim for 30–45 days supply. Above that, you are buying faster than you are selling.</div>
          </div>
        </div>
      </div>
    </div>
  </div></div>`;
}

/* ============================ Storefront ============================ */
function storeHeader() {
  const rt = SEED.virtualRooftop;
  return `<header class="sthead"><div class="in">
    <div class="stlogo">${esc(rt.name)}</div>
    <nav class="stnav"><a href="#/store">Inventory</a><a href="#/store">Financing</a><a href="#/store">Trade-in</a><a href="#/store">About</a></nav>
    <div class="spacer" style="flex:1"></div>
    <div style="text-align:right"><div style="font-size:17px;font-weight:800">(360) 555-0142</div>
      <div class="tiny" style="color:#9aa4b1">Open today until 7:00 PM</div></div>
  </div>
  <div class="stbar"><div class="in">
    <span>📍 Two locations in Vancouver, WA</span>
    <span>·</span><span>Fourth Plain</span><span>·</span><span>Orchards</span>
    <div style="flex:1"></div>
    <a href="#/lotwalk" style="color:#8ea0ff;font-weight:700">← back to Rooftop admin</a>
  </div></div></header>`;
}

function viewStore() {
  const f = state.ui.stFilters;
  let inv = state.vehicles.filter(v => v.frontLineReady);
  const makes = [...new Set(state.vehicles.map(v => v.make))].sort();
  const bodies = [...new Set(state.vehicles.map(v => v.body))].sort();
  if (f.makes.length) inv = inv.filter(v => f.makes.includes(v.make));
  if (f.body.length) inv = inv.filter(v => f.body.includes(v.body));
  if (f.q) { const q = f.q.toLowerCase();
    inv = inv.filter(v => (vfull(v) + v.vin + v.stock + v.exteriorColor).toLowerCase().includes(q)); }
  inv = inv.filter(v => v.price <= f.maxPrice && v.mileage <= f.maxMiles);

  return `<div class="store">${storeHeader()}<div class="stwrap"><div class="stgrid">
    <aside class="sticky" style="top:16px">
      <div class="card pad">
        <div class="fgroup" style="padding-top:0"><h4>Search</h4>
          <input class="search" style="width:100%" placeholder="Make, model, color…" value="${esc(f.q)}" data-act="st-q"></div>
        <div class="fgroup"><h4>Max price — ${money(f.maxPrice)}</h4>
          <input type="range" min="8000" max="60000" step="1000" value="${f.maxPrice}" data-act="st-price" style="width:100%;accent-color:var(--brand)"></div>
        <div class="fgroup"><h4>Max miles — ${f.maxMiles.toLocaleString()}</h4>
          <input type="range" min="20000" max="200000" step="5000" value="${f.maxMiles}" data-act="st-miles" style="width:100%;accent-color:var(--brand)"></div>
        <div class="fgroup"><h4>Body style</h4>
          ${bodies.map(b => `<label class="cbx"><input type="checkbox" data-act="st-body" value="${b}" ${f.body.includes(b) ? 'checked' : ''}>${b}
            <span class="muted tiny">${state.vehicles.filter(v => v.body === b && v.frontLineReady).length}</span></label>`).join('')}</div>
        <div class="fgroup"><h4>Make</h4>
          ${makes.filter(mk => state.vehicles.some(v => v.make === mk && v.frontLineReady)).map(mk => `<label class="cbx"><input type="checkbox" data-act="st-make" value="${mk}" ${f.makes.includes(mk) ? 'checked' : ''}>${mk}
            <span class="muted tiny">${state.vehicles.filter(v => v.make === mk && v.frontLineReady).length}</span></label>`).join('')}</div>
        <button class="btn ghost sm" style="width:100%;justify-content:center;margin-top:12px" data-act="st-clear">Clear filters</button>
      </div>
    </aside>

    <div>
      <div class="row" style="margin-bottom:14px">
        <div class="grow"><div style="font-size:24px;font-weight:850;letter-spacing:-.7px">${inv.length} vehicles available</div>
          <div class="sm muted">Both Vancouver locations shown together — ask us to bring any unit to whichever lot is closer.</div></div>
        <select class="sel"><option>Newest arrivals</option><option>Price: low to high</option><option>Lowest miles</option></select>
      </div>
      <div class="cards">
        ${inv.map(v => `<div class="vcard rel" data-act="stveh" data-id="${v.id}">
          <img src="${v.hero}" alt="">
          ${v.daysInStock <= 7 ? '<span class="badge" style="top:auto;bottom:10px;background:rgba(21,163,74,.94)">Just arrived</span>'
            : isAged(v) ? '<span class="badge" style="top:auto;bottom:10px;background:rgba(207,43,38,.94)">Price reduced</span>' : ''}
          <div class="b">
            <div class="ttl">${esc(vfull(v))}</div>
            <div class="sub">${v.mileage.toLocaleString()} mi · ${esc(v.drivetrain)} · ${esc(v.exteriorColor)}</div>
            <div class="pr">${money(v.price)}</div>
            <div class="row tiny muted" style="margin-top:7px;justify-content:space-between">
              <span>${esc(v.carfax)}</span><span>${esc(rooftopName(v.rooftop))}</span></div>
          </div></div>`).join('')}
      </div>
      ${inv.length === 0 ? '<div class="card pad muted" style="text-align:center">Nothing matches those filters right now.</div>' : ''}
    </div>
  </div></div></div>`;
}

function viewVDP(id) {
  const v = byId(id); if (!v) return viewStore();
  const shot = Math.min(state.ui.stShot, v.photos.length - 1);
  const R = 0.079 / 12;
  const pay = Math.round(((v.price * 0.9) * R) / (1 - Math.pow(1 + R, -72)));
  const similar = state.vehicles.filter(x => x.id !== v.id && x.frontLineReady && x.body === v.body).slice(0, 3);

  return `<div class="store">${storeHeader()}<div class="stwrap">
    <div class="sm muted" style="margin-bottom:12px"><a href="#/store">Inventory</a> › ${esc(v.body)} › ${esc(vname(v))}</div>
    <div class="vdp">
      <div>
        <div class="vdpgal">
          <img class="main" src="${v.photos[shot].src}" alt="">
          <div class="vdpstrip">${v.photos.map((p, i) =>
            `<img src="${p.src}" class="${i === shot ? 'on' : ''}" data-act="stshot" data-i="${i}">`).join('')}</div>
        </div>

        <h1 style="font-size:29px;font-weight:850;letter-spacing:-1px;margin:22px 0 4px">${esc(vfull(v))}</h1>
        <div class="muted" style="margin-bottom:18px">${v.mileage.toLocaleString()} miles · ${esc(v.drivetrain)} · ${esc(v.engine)}
          · Stock #${v.stock} · <span class="mono tiny">VIN ${v.vin}</span></div>

        <div class="specs">
          ${[['Mileage', v.mileage.toLocaleString() + ' mi'], ['Drivetrain', v.drivetrain], ['Transmission', v.transmission],
             ['Engine', v.engine], ['Exterior', v.exteriorColor], ['Interior', v.interiorColor],
             ['Body', v.body], ['History', v.carfax], ['Title', v.titleStatus]]
            .map(([k, val]) => `<div><div class="k">${k}</div><div class="v">${esc(val)}</div></div>`).join('')}
        </div>

        <h3 style="margin:26px 0 10px;font-size:17px;font-weight:800">What's on it</h3>
        <div class="feats">${v.features.map(x => `<span class="feat">${esc(x)}</span>`).join('')}</div>

        <h3 style="margin:26px 0 10px;font-size:17px;font-weight:800">From the lot</h3>
        <p class="muted" style="max-width:64ch;line-height:1.65">Local ${v.year} ${v.model} ${v.trim} in ${esc(v.exteriorColor)}
          over ${esc(v.interiorColor)}. ${esc(v.carfax)} history and ${v.titleStatus.toLowerCase()} title. Just came through our
          shop — ${esc(v.reconNote.toLowerCase())}. ${esc(v.drivetrain)} and ready to go. Sitting at our
          ${esc(rooftopName(v.rooftop))} lot; happy to move it to the other store if that is closer to you.</p>

        <h3 style="margin:30px 0 12px;font-size:17px;font-weight:800">Similar ${esc(v.body.toLowerCase())}s on the lot</h3>
        <div class="cards">${similar.map(s => `<div class="vcard" data-act="stveh" data-id="${s.id}">
          <img src="${s.hero}"><div class="b"><div class="ttl">${esc(vname(s))}</div>
          <div class="sub">${s.mileage.toLocaleString()} mi</div><div class="pr">${money(s.price)}</div></div></div>`).join('')}</div>
      </div>

      <div class="sticky" style="top:16px">
        <div class="pbox">
          <div class="top">
            <div class="tiny muted" style="font-weight:800;letter-spacing:1px;text-transform:uppercase">Our price</div>
            <div class="price">${money(v.price)}</div>
            <div class="pay">Est. <b>${money(pay)}/mo</b> · 72 mo · 10% down · 7.9% APR</div>
            <div class="tiny muted" style="margin-top:6px">Estimate only, on approved credit.</div>
          </div>
          <div style="padding:14px 16px;display:flex;flex-direction:column;gap:9px">
            <button class="btn" style="justify-content:center">Check availability</button>
            <button class="btn ghost" style="justify-content:center">Get my trade value</button>
            <button class="btn ghost" style="justify-content:center">Apply for financing</button>
          </div>
          <div style="border-top:1px solid var(--line2);padding:14px 16px">
            <div class="row" style="gap:10px"><div class="av" style="background:#39434f">CM</div>
              <div><div style="font-weight:800">${esc(SEED.virtualRooftop.name)}</div>
                <div class="tiny muted">${esc((SEED.rooftops.find(r => r.id === v.rooftop) || {}).address)}<br>Vancouver, WA</div></div></div>
            <div style="margin-top:12px;font-size:17px;font-weight:800">${esc((SEED.rooftops.find(r => r.id === v.rooftop) || {}).phone)}</div>
          </div>
          <div style="border-top:1px solid var(--line2);padding:12px 16px" class="tiny muted">
            ${v.daysInStock <= 7 ? '🟢 Just arrived — ' : ''}${v.daysInStock} days on our lot · ${v.vdpViewsTotal} people have viewed this vehicle
          </div>
        </div>
      </div>
    </div>
  </div></div>`;
}

/* ============================ router ============================ */
const RIBBON = `<div class="ribbon">
  <a href="../index.html" class="rb-back">&#9664; rooftopauto.com</a>
  <span class="rb-tag">LIVE DEMO</span>
  <span class="rb-txt">Cascade Motors is a fictional two-rooftop lot in Vancouver, WA. Every number on these screens is sample data. The vehicle photographs are real and freely licensed &mdash; <a href="credits.html" class="rb-link">credits</a>.</span>
</div>`;

function render() {
  const r = state.route;
  let html;
  if (r.startsWith('#/store/v/')) html = viewVDP(r.split('/')[3]);
  else if (r.startsWith('#/store')) html = viewStore();
  else if (r.startsWith('#/vehicle/')) html = topbar() + viewVehicle(r.split('/')[2]);
  else if (r.startsWith('#/inventory')) html = topbar() + viewInventory();
  else if (r.startsWith('#/syndication')) html = topbar() + viewSyndication();
  else if (r.startsWith('#/reporting')) html = topbar() + viewReporting();
  else html = topbar() + viewLotWalk();
  document.body.innerHTML = RIBBON + html;
  const lg = $('.log'); if (lg) lg.scrollTop = lg.scrollHeight;
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const a = t.dataset.act;
  if (a === 'react') {
    const id = t.dataset.ev, k = t.dataset.kind;
    state.reactions[id] = state.reactions[id] || {};
    state.reactions[id][k] = !state.reactions[id][k];
    render(); e.preventDefault();
  } else if (a === 'veh' || a === 'stveh') {
    location.hash = (a === 'veh' ? '#/vehicle/' : '#/store/v/') + t.dataset.id;
    state.ui.tab = 'wall'; state.ui.shot = 0; state.ui.stShot = 0;
  } else if (a === 'tab') { state.ui.tab = t.dataset.t; render(); }
  else if (a === 'shot') { state.ui.shot = +t.dataset.i; render(); }
  else if (a === 'stshot') { state.ui.stShot = +t.dataset.i; render(); }
  else if (a === 'rooftop-set') { state.rooftop = t.dataset.id; render(); e.preventDefault(); }
  else if (a === 'goto-syn') { location.hash = '#/syndication'; }
  else if (a === 'goto-syn-veh') { state.ui.synVeh = t.dataset.id; location.hash = '#/syndication'; }
  else if (a === 'push') {
    const v = state.ui.synVeh ? byId(state.ui.synVeh) : scoped().find(x => x.frontLineReady);
    const raw = ($('[data-act="syn-price"]') || {}).value;
    const np = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
    if (v && np > 0) pushPrice(v, np);
  }
  else if (a === 'st-clear') { state.ui.stFilters = { makes: [], body: [], q: '', maxPrice: 60000, maxMiles: 200000 }; render(); }
});

document.addEventListener('change', (e) => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act;
  if (a === 'rooftop') { state.rooftop = t.value; render(); }
  else if (a === 'syn-veh') { state.ui.synVeh = t.value; render(); }
  else if (a === 'st-make' || a === 'st-body') {
    const key = a === 'st-make' ? 'makes' : 'body';
    const arr = state.ui.stFilters[key];
    const i = arr.indexOf(t.value);
    i > -1 ? arr.splice(i, 1) : arr.push(t.value);
    render();
  }
});

document.addEventListener('input', (e) => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act;
  if (a === 'st-price') { state.ui.stFilters.maxPrice = +t.value; const s = t.value; render();
    const el = $('[data-act="st-price"]'); if (el) el.value = s; }
  else if (a === 'st-miles') { state.ui.stFilters.maxMiles = +t.value; render(); }
});

document.addEventListener('keydown', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t || e.key !== 'Enter') return;
  if (t.dataset.act === 'comment' && t.value.trim()) {
    const id = t.dataset.ev;
    (state.extraComments[id] = state.extraComments[id] || []).push({ who: state.me, text: t.value.trim() });
    render();
  } else if (t.dataset.act === 'st-q') { state.ui.stFilters.q = t.value; render(); }
});

let _q;
document.addEventListener('input', (e) => {
  const t = e.target.closest('[data-act="st-q"]'); if (!t) return;
  clearTimeout(_q); const val = t.value;
  _q = setTimeout(() => { state.ui.stFilters.q = val; render();
    const el = $('[data-act="st-q"]'); if (el) { el.focus(); el.value = val; } }, 260);
});

window.addEventListener('hashchange', () => { state.route = location.hash || '#/lotwalk'; window.scrollTo(0, 0); render(); });
state.route = location.hash || '#/lotwalk';
render();
