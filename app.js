// PDX House Hunt — listings + map
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const CATS = {
  grocery: { label: 'Grocery', q: 'nwr["shop"~"^(supermarket|grocery|greengrocer)$"]', color: '#d9822b' },
  park:    { label: 'Park',    q: 'nwr["leisure"="park"]["name"]',                      color: '#3b8a4e' },
  coffee:  { label: 'Coffee',  q: 'nwr["amenity"="cafe"]',                              color: '#7a4e2d' },
  bar:     { label: 'Bar',     q: 'nwr["amenity"~"^(bar|pub|biergarten)$"]',             color: '#7c3aed' },
};
const STATUS = [['new','New'],['interested','Interested'],['contacted','Contacted'],['toured','Toured'],['pass','Pass']];
const KEY = 'pdx-house-hunt-status-v1';

let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {} };

const $ = id => document.getElementById(id);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
const money = n => '$' + n.toLocaleString();
const st = l => saved[l.id] || l.status || 'new';
const isMatch = l => l.yard === 'yes' && l.dishwasher === 'yes';
const dist = (a, b, c, d) => { const R = 6371000, r = Math.PI / 180; const x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r; return Math.sqrt(x * x + y * y) * R; };
const fmtDist = m => { const mi = m / 1609.34; const walk = Math.round(m * 1.25 / 80); return (mi < 0.1 ? Math.round(m * 3.28) + ' ft' : mi.toFixed(1) + ' mi') + ' · ' + Math.max(1, walk) + ' min walk'; };

let D = null, selected = null, latest = '';
const markers = {};

// ---------- map ----------
const map = L.map('map', { zoomControl: true }).setView([45.53, -122.64], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);
const listingLayer = L.layerGroup().addTo(map);
const poiLayers = Object.fromEntries(Object.keys(CATS).map(k => [k, L.layerGroup()]));
const nearLayer = L.layerGroup().addTo(map);

function pinIcon(l) {
  const cls = 'pin' + (isMatch(l) ? ' match' : '') + (st(l) === 'pass' ? ' pass' : '') + (selected === l.id ? ' sel' : '');
  return L.divIcon({ className: 'pin-icon', html: `<span class="${cls}">${'$' + (l.price / 1000).toFixed(1) + 'k'}</span>`, iconSize: [0, 0] });
}

// ---------- overpass ----------
async function overpass(query) {
  const r = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(query) });
  if (!r.ok) throw new Error('Overpass ' + r.status);
  return (await r.json()).elements.map(e => ({
    id: e.type + e.id, name: (e.tags && e.tags.name) || '(unnamed)',
    lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon, tags: e.tags || {}
  })).filter(p => p.lat != null);
}

const poiCache = {}; // cat -> Map(id -> poi)
let poiTimer = null;
function activeCats() { return [...document.querySelectorAll('[data-poi]')].filter(c => c.checked).map(c => c.dataset.poi); }
function refreshPois() {
  clearTimeout(poiTimer);
  poiTimer = setTimeout(async () => {
    const cats = activeCats();
    const hint = $('poiHint');
    if (!cats.length) { hint.textContent = 'Turn on a layer to see places'; return; }
    if (map.getZoom() < 14) { hint.textContent = 'Zoom in closer to load places'; return; }
    const b = map.getBounds().pad(0.2);
    const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(n => n.toFixed(4)).join(',');
    hint.textContent = 'Loading…';
    try {
      const q = `[out:json][timeout:25];(${cats.map(c => CATS[c].q + `(${bbox});`).join('')});out center tags;`;
      const pois = await overpass(q);
      for (const p of pois) {
        const cat = classify(p.tags); if (!cat) continue;
        poiCache[cat] = poiCache[cat] || new Map();
        if (poiCache[cat].has(p.id)) continue;
        poiCache[cat].set(p.id, p);
        L.circleMarker([p.lat, p.lng], { radius: cat === 'park' ? 7 : 5, color: '#fff', weight: 1.5, fillColor: CATS[cat].color, fillOpacity: .9 })
          .bindTooltip(`${p.name} · ${CATS[cat].label}`).addTo(poiLayers[cat]);
      }
      hint.textContent = 'Showing places in view';
    } catch (e) { hint.textContent = 'Map data busy — try again in a moment'; }
  }, 500);
}
function classify(t) {
  if (/^(supermarket|grocery|greengrocer)$/.test(t.shop || '')) return 'grocery';
  if (t.leisure === 'park') return 'park';
  if (t.amenity === 'cafe') return 'coffee';
  if (/^(bar|pub|biergarten)$/.test(t.amenity || '')) return 'bar';
  return null;
}
document.querySelectorAll('[data-poi]').forEach(c => c.addEventListener('change', () => {
  const layer = poiLayers[c.dataset.poi];
  c.checked ? layer.addTo(map) : map.removeLayer(layer);
  refreshPois();
}));
map.on('moveend', refreshPois);

// nearest-of-each for a selected listing
const nearCache = {};
async function loadNearby(l, box) {
  box.replaceChildren(el('span', 'd', 'Finding what’s nearby…'));
  try {
    if (!nearCache[l.id]) {
      const q = `[out:json][timeout:25];(${Object.values(CATS).map(c => c.q + `(around:1600,${l.lat},${l.lng});`).join('')});out center tags;`;
      nearCache[l.id] = await overpass(q);
    }
    const pois = nearCache[l.id];
    box.replaceChildren();
    nearLayer.clearLayers();
    for (const [cat, def] of Object.entries(CATS)) {
      const best = pois.filter(p => classify(p.tags) === cat && p.name !== '(unnamed)')
        .map(p => ({ ...p, m: dist(l.lat, l.lng, p.lat, p.lng) })).sort((a, b) => a.m - b.m)[0];
      const dot = el('span', 'dot ' + cat);
      box.append(dot);
      if (best) {
        box.append(el('span', 'n', best.name), el('span', 'd', fmtDist(best.m)));
        L.circleMarker([best.lat, best.lng], { radius: 7, color: '#fff', weight: 2, fillColor: def.color, fillOpacity: 1 })
          .bindTooltip(`${best.name} · ${def.label} · ${fmtDist(best.m)}`).addTo(nearLayer);
      } else {
        box.append(el('span', 'n', 'No ' + def.label.toLowerCase() + ' within 1 mile'), el('span', 'd', ''));
      }
    }
  } catch (e) { box.replaceChildren(el('span', 'd', 'Couldn’t load nearby places right now.')); }
}

// ---------- list ----------
function tag(label, val) {
  const cls = val === 'yes' || val === 'small OK' ? 'yes' : val === '?' ? 'unk' : '';
  return el('span', 'tag ' + cls, label + (val === '?' ? ' ?' : val === 'no' ? ' ✕' : ' ✓'));
}
function filtered() {
  const fs = $('fSource').value, fst = $('fStatus').value, m = $('fMatch').checked, b = $('fBath').checked, sp = $('fPass').checked;
  const rows = D.listings.filter(l => (!fs || l.source === fs) && (!fst || st(l) === fst) && (!m || isMatch(l)) && (!b || l.baths >= 1.5) && (sp || fst === 'pass' || st(l) !== 'pass'));
  const s = $('sort').value;
  rows.sort((a, c) => s === 'price' ? a.price - c.price : s === 'priceDesc' ? c.price - a.price : s === 'beds' ? (c.beds - a.beds) || (a.price - c.price)
    : (c.firstSeen.localeCompare(a.firstSeen)) || (isMatch(c) - isMatch(a)) || a.source.localeCompare(c.source));
  return rows;
}
function render() {
  const rows = filtered();
  const L_ = $('list'); L_.replaceChildren();
  listingLayer.clearLayers();
  if (!rows.length) L_.append(el('div', 'empty', 'No listings match these filters.'));
  for (const l of rows) {
    const it = el('div', 'item' + (isMatch(l) ? ' match' : '') + (st(l) === 'pass' ? ' dim' : '') + (selected === l.id ? ' sel' : ''));
    it.id = 'item-' + l.id;
    const r1 = el('div', 'row');
    r1.append(el('span', 'price', money(l.price)), el('span', 'addr', l.address));
    if (l.firstSeen === latest) r1.append(el('span', 'new', 'New'));
    it.append(r1);
    const meta = [`${l.beds} bd`, `${l.baths} ba`]; if (l.sqft) meta.push(l.sqft.toLocaleString() + ' sq ft'); if (l.area) meta.push(l.area); if (l.available) meta.push('Avail. ' + l.available);
    it.append(el('div', 'meta', (l.title && l.title !== 'House for rent' ? l.title + ' · ' : '') + meta.join(' · ')));
    const tags = el('div', 'tags');
    tags.append(el('span', 'tag src', l.source), tag('Yard', l.yard), tag('Dishwasher', l.dishwasher), tag('W/D', l.laundry), tag('Dogs', l.dogs));
    it.append(tags);
    if (l.notes) it.append(el('div', 'notes', l.notes));
    const act = el('div', 'actions');
    const sel = el('select'); for (const [v, t] of STATUS) { const o = el('option', null, t); o.value = v; sel.append(o); }
    sel.value = st(l);
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', () => { saved[l.id] = sel.value; persist(); render(); });
    const a = el('a', null, 'Open listing ↗'); a.href = l.url; a.target = '_blank'; a.rel = 'noopener';
    a.addEventListener('click', e => e.stopPropagation());
    act.append(sel, a);
    if (!l.lat) act.append(el('span', 'notes', 'No address to map'));
    it.append(act);
    if (selected === l.id && l.lat) { const box = el('div', 'near'); it.append(box); loadNearby(l, box); }
    it.addEventListener('click', () => select(l.id, true));
    L_.append(it);
    if (l.lat) {
      const mk = L.marker([l.lat, l.lng], { icon: pinIcon(l), zIndexOffset: isMatch(l) ? 500 : 0 })
        .bindTooltip(`${money(l.price)} · ${l.beds}bd/${l.baths}ba · ${l.address}`, { direction: 'top', offset: [0, -22] })
        .on('click', () => select(l.id, false));
      if (selected === l.id) mk.setZIndexOffset(1000);
      mk.addTo(listingLayer); markers[l.id] = mk;
    }
  }
}
function select(id, fromList) {
  selected = selected === id && fromList ? null : id;
  if (!selected) nearLayer.clearLayers();
  render();
  const l = D.listings.find(x => x.id === id);
  if (selected && l.lat) {
    if (fromList) {
      if (window.matchMedia('(max-width:760px)').matches) setView('map');
      map.setView([l.lat, l.lng], Math.max(map.getZoom(), 15));
    } else {
      setView('list');
      const n = $('item-' + id); if (n) n.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}
function setView(v) {
  $('split').classList.toggle('show-list', v === 'list');
  $('split').classList.toggle('show-map', v === 'map');
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  if (v === 'map') setTimeout(() => map.invalidateSize(), 50);
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
['fSource', 'fStatus', 'sort', 'fMatch', 'fBath', 'fPass'].forEach(id => $(id).addEventListener('change', render));

function header() {
  $('updated').textContent = 'Houses on Craigslist & Zillow · checked ' + new Date(D.updated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const c = D.criteria;
  for (const t of [`≤ ${money(c.maxRent)}`, `${c.minBeds}+ bd`, `${c.minBaths}+ ba (ideally ${c.idealBaths})`, c.type, ...c.mustHave])
    $('criteria').append(el('span', 'chip', t));
  const last = D.log[D.log.length - 1];
  if (last) $('logLine').textContent = 'Last update ' + last.date + ': ' + D.listings.length + ' listings';
}

fetch('listings.json', { cache: 'no-store' }).then(r => r.json()).then(j => {
  D = j;
  latest = D.listings.reduce((m, l) => l.firstSeen > m ? l.firstSeen : m, '');
  header(); setView('list'); render();
  const pts = D.listings.filter(l => l.lat).map(l => [l.lat, l.lng]);
  if (pts.length) map.fitBounds(pts, { padding: [30, 30] });
}).catch(() => { $('list').append(el('div', 'empty', 'Couldn’t load listings.')); });
