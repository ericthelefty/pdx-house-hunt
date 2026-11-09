// PDX House Hunt — listings + map
const WALK_M = 800; // ~10-minute walk
const CATS = {
  grocery: { label: 'Grocery', plural: 'groceries', q: 'nwr["shop"~"^(supermarket|grocery|greengrocer)$"]', color: '#d9822b' },
  park:    { label: 'Park',    plural: 'parks',     q: 'nwr["leisure"="park"]["name"]',                      color: '#3b8a4e' },
  coffee:  { label: 'Coffee',  plural: 'coffee',    q: 'nwr["amenity"="cafe"]',                              color: '#7a4e2d' },
  bar:     { label: 'Bar',     plural: 'bars',      q: 'nwr["amenity"~"^(bar|pub|biergarten)$"]',             color: '#7c3aed' },
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
const walkMin = m => Math.max(1, Math.round(m * 1.25 / 80)); // street detour factor, ~80 m/min
const fmtDist = m => { const mi = m / 1609.34; return (mi < 0.1 ? Math.round(m * 3.28) + ' ft' : mi.toFixed(1) + ' mi') + ' · ' + walkMin(m) + ' min walk'; };
const isMobile = () => window.matchMedia('(max-width:760px)').matches;

let D = null, selected = null, latest = '';
let markers = {};
let mapFitted = false;

// ---------- map ----------
const map = L.map('map', { zoomControl: true }).setView([45.53, -122.64], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);
const walkLayer = L.layerGroup().addTo(map);
const listingLayer = L.layerGroup().addTo(map);
const poiLayers = Object.fromEntries(Object.keys(CATS).map(k => [k, L.layerGroup()]));
const nearLayer = L.layerGroup().addTo(map);

// legend + fit control
const Legend = L.Control.extend({
  options: { position: 'bottomleft' },
  onAdd() {
    const d = L.DomUtil.create('div', 'legend');
    d.innerHTML = '<span class="pin match sw">$2.4k</span> Yard + dishwasher confirmed' +
      '<span class="pin sw">$2.4k</span> Not yet confirmed' +
      '<span class="pin pass sw">$2.4k</span> Passed';
    const b = L.DomUtil.create('button', 'fit', d); b.type = 'button'; b.textContent = 'Fit to results';
    L.DomEvent.disableClickPropagation(d);
    b.addEventListener('click', fitToResults);
    return d;
  }
});
map.addControl(new Legend());

function pinIcon(l) {
  const cls = 'pin' + (isMatch(l) ? ' match' : '') + (st(l) === 'pass' ? ' pass' : '') + (selected === l.id ? ' sel' : '');
  return L.divIcon({ className: 'pin-icon', html: `<span class="${cls}">${'$' + (l.price / 1000).toFixed(1) + 'k'}</span>`, iconSize: [0, 0] });
}

function popupFor(l, done) {
  const d = el('div', 'pop');
  d.addEventListener('click', e => e.stopPropagation());
  const r = el('div', 'row'); r.append(el('span', 'price', money(l.price)), el('span', 'addr', l.address)); d.append(r);
  const meta = [`${l.beds} bd`, `${l.baths} ba`]; if (l.sqft) meta.push(l.sqft.toLocaleString() + ' sq ft'); if (l.available) meta.push('Avail. ' + l.available);
  d.append(el('div', 'meta', meta.join(' · ')));
  const tags = el('div', 'tags'); tags.append(el('span', 'tag src', l.source), tag('Yard', l.yard), tag('Dishwasher', l.dishwasher)); d.append(tags);
  if (l.notes) d.append(el('div', 'notes', l.notes));
  const act = el('div', 'actions');
  act.append(statusSelect(l));
  const a = el('a', null, 'Open listing ↗'); a.href = l.url; a.target = '_blank'; a.rel = 'noopener'; act.append(a);
  d.append(act);
  const near = el('div', 'near'); d.append(near);
  loadNearby(l, near, done);
  return d;
}

// ---------- saved places (places.json, refreshed by a GitHub Action) ----------
let PLACES = [];
let placesStatus = 'loading'; // loading | ok | missing
const canvas = L.canvas({ padding: 0.5 });
function drawPlaces() {
  for (const k in poiLayers) poiLayers[k].clearLayers();
  for (const p of PLACES) {
    const def = CATS[p.cat]; if (!def) continue;
    L.circleMarker([p.lat, p.lng], { renderer: canvas, radius: p.cat === 'park' ? 6 : 4.5, color: '#fff', weight: 1.2, fillColor: def.color, fillOpacity: .9 })
      .bindTooltip(`${p.name || '(unnamed)'} · ${def.label}`).addTo(poiLayers[p.cat]);
  }
  updateLayerVisibility();
}
function updateLayerVisibility() {
  const hint = $('poiHint');
  const zoomed = map.getZoom() >= 13;
  document.querySelectorAll('[data-poi]').forEach(c => {
    const layer = poiLayers[c.dataset.poi];
    (c.checked && zoomed) ? layer.addTo(map) : map.removeLayer(layer);
  });
  if (placesStatus === 'loading') hint.textContent = 'Loading places…';
  else if (placesStatus === 'missing') hint.textContent = 'Nearby places are still being collected. Check back soon.';
  else hint.textContent = zoomed ? 'Places within a mile of each house' : 'Zoom in to see places';
}
document.querySelectorAll('[data-poi]').forEach(c => { c.checked = true; c.addEventListener('change', updateLayerVisibility); });
map.on('zoomend', updateLayerVisibility);

// nearest-of-each + 10-minute-walk counts for one listing
function loadNearby(l, box, done) {
  box.replaceChildren();
  if (placesStatus !== 'ok') {
    box.append(el('span', 'loading', placesStatus === 'loading' ? 'Loading nearby places…' : 'Nearby places are still being collected. Check back soon.'));
    return;
  }
  const pois = PLACES.map(p => ({ ...p, m: dist(l.lat, l.lng, p.lat, p.lng) })).filter(p => p.m <= 1600);
  const counts = el('div', 'counts');
  counts.append(el('span', 'counts-title', 'Within a 10-min walk:'));
  for (const [cat, def] of Object.entries(CATS)) {
    const n = pois.filter(p => p.cat === cat && p.m <= WALK_M).length;
    const c = el('span', 'count'); c.append(el('span', 'dot ' + cat), document.createTextNode(`${n} ${n === 1 ? def.label.toLowerCase() : def.plural}`));
    counts.append(c);
  }
  box.append(counts);
  const grid = el('div', 'nearest');
  if (selected === l.id) nearLayer.clearLayers();
  for (const [cat, def] of Object.entries(CATS)) {
    const best = pois.filter(p => p.cat === cat && p.name).sort((a, b) => a.m - b.m)[0];
    grid.append(el('span', 'dot ' + cat));
    if (best) {
      grid.append(el('span', 'n', best.name), el('span', 'd', fmtDist(best.m)));
      if (selected === l.id)
        L.circleMarker([best.lat, best.lng], { radius: 8, color: '#fff', weight: 2.5, fillColor: def.color, fillOpacity: 1 })
          .bindTooltip(`Nearest ${def.label.toLowerCase()}: ${best.name} · ${fmtDist(best.m)}`).addTo(nearLayer);
    } else grid.append(el('span', 'n', 'None within 1 mile'), el('span', 'd', ''));
  }
  box.append(grid);
  if (done) done();
}

// ---------- list ----------
function tag(label, val) {
  const cls = val === 'yes' || val === 'small OK' ? 'yes' : val === '?' ? 'unk' : '';
  return el('span', 'tag ' + cls, label + (val === '?' ? ' ?' : val === 'no' ? ' ✕' : ' ✓'));
}
function statusSelect(l) {
  const sel = el('select'); for (const [v, t] of STATUS) { const o = el('option', null, t); o.value = v; sel.append(o); }
  sel.value = st(l);
  sel.addEventListener('click', e => e.stopPropagation());
  sel.addEventListener('change', () => { saved[l.id] = sel.value; persist(); render(); });
  return sel;
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
  const list = $('list'); list.replaceChildren();
  listingLayer.clearLayers(); markers = {};
  $('count').textContent = `${rows.length} of ${D.listings.length} houses`;
  if (!rows.length) list.append(el('div', 'empty', 'No listings match these filters.'));
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
    act.append(statusSelect(l));
    const a = el('a', null, 'Open listing ↗'); a.href = l.url; a.target = '_blank'; a.rel = 'noopener';
    a.addEventListener('click', e => e.stopPropagation());
    act.append(a);
    if (!l.lat) act.append(el('span', 'notes', 'No address to map'));
    it.append(act);
    if (selected === l.id && l.lat) { const box = el('div', 'near'); it.append(box); loadNearby(l, box); }
    it.addEventListener('click', () => select(l.id, true));
    it.addEventListener('mouseenter', () => hover(l.id, true));
    it.addEventListener('mouseleave', () => hover(l.id, false));
    list.append(it);
    if (l.lat) {
      const mk = L.marker([l.lat, l.lng], { icon: pinIcon(l), zIndexOffset: selected === l.id ? 1000 : isMatch(l) ? 500 : 0, riseOnHover: true })
        .bindTooltip(`${money(l.price)} · ${l.beds}bd/${l.baths}ba · ${l.address}`, { direction: 'top', offset: [0, -24] })
        .on('click', () => select(l.id, false));
      mk.addTo(listingLayer); markers[l.id] = mk;
    }
  }
  drawWalk();
}
function hover(id, on) {
  const mk = markers[id]; if (!mk) return;
  const pin = mk.getElement && mk.getElement()?.querySelector('.pin');
  if (pin) pin.classList.toggle('hover', on);
  mk.setZIndexOffset(on ? 2000 : selected === id ? 1000 : 0);
}
function drawWalk() {
  walkLayer.clearLayers();
  const l = selected && D.listings.find(x => x.id === selected);
  if (l && l.lat) L.circle([l.lat, l.lng], { radius: WALK_M, color: '#2f6b4f', weight: 1.5, dashArray: '4 4', fillColor: '#2f6b4f', fillOpacity: .06, interactive: false }).addTo(walkLayer);
}
function select(id, fromList) {
  selected = (selected === id && fromList) ? null : id;
  nearLayer.clearLayers(); map.closePopup();
  render();
  const l = D.listings.find(x => x.id === id);
  if (!selected || !l.lat) return;
  if (fromList) {
    if (isMobile()) setView('map');
    map.setView([l.lat, l.lng], Math.max(map.getZoom(), 15));
  } else {
    if (isMobile()) {
      const pop = L.popup({ maxWidth: 280, offset: [0, -22], autoPanPaddingTopLeft: [60, 60], autoPanPaddingBottomRight: [10, 20] }).setLatLng([l.lat, l.lng]);
      pop.setContent(popupFor(l, () => setTimeout(() => { if (pop.isOpen()) { pop.update(); if (pop._adjustPan) pop._adjustPan(); } }, 0))).openOn(map);
    } else {
      const n = $('item-' + id); if (n) n.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}
function fitToResults() {
  const pts = filtered().filter(l => l.lat).map(l => [l.lat, l.lng]);
  const size = map.getSize();
  if (!size.x || !size.y) return; // map hidden (phone list view): fit when it opens
  if (pts.length) { map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 }); mapFitted = true; }
}
function setView(v) {
  $('split').classList.toggle('show-list', v === 'list');
  $('split').classList.toggle('show-map', v === 'map');
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  if (v === 'map') setTimeout(() => { map.invalidateSize(); if (!mapFitted && !selected) fitToResults(); }, 50);
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
['fSource', 'fStatus', 'sort', 'fMatch', 'fBath', 'fPass'].forEach(id => $(id).addEventListener('change', render));
window.addEventListener('resize', () => map.invalidateSize());

function header() {
  $('updated').textContent = 'Houses on Craigslist & Zillow · data from ' + new Date(D.updated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const c = D.criteria;
  for (const t of [`≤ ${money(c.maxRent)}`, `${c.minBeds}+ bd`, `${c.minBaths}+ ba (ideally ${c.idealBaths})`, c.type, ...c.mustHave])
    $('criteria').append(el('span', 'chip', t));
}

fetch('listings.json', { cache: 'no-store' }).then(r => r.json()).then(j => {
  D = j;
  latest = D.listings.reduce((m, l) => l.firstSeen > m ? l.firstSeen : m, '');
  header(); setView('list'); render(); fitToResults();
  return fetch('places.json', { cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(p => { PLACES = p.places || []; placesStatus = PLACES.length ? 'ok' : 'missing'; })
    .catch(() => { placesStatus = 'missing'; })
    .then(() => { drawPlaces(); render(); });
}).catch(() => { $('list').append(el('div', 'empty', 'Couldn’t load listings.')); });

// on phones, tuck the layers panel away while a popup is open
map.on('popupopen', () => { if (isMobile()) $('layers').classList.add('hidden'); });
map.on('popupclose', () => $('layers').classList.remove('hidden'));
