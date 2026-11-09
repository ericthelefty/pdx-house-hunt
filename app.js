// PDX House Hunt — listings + map
const WALK_M = 800; // ~10-minute walk
const CATS = {
  grocery: { label: 'Grocery', plural: 'groceries', q: 'nwr["shop"~"^(supermarket|grocery|greengrocer)$"]', color: '#d9822b' },
  park:    { label: 'Park',    plural: 'parks',     q: 'nwr["leisure"="park"]["name"]',                      color: '#3b8a4e' },
  coffee:  { label: 'Coffee',  plural: 'coffee',    q: 'nwr["amenity"="cafe"]',                              color: '#7a4e2d' },
  bar:     { label: 'Bar',     plural: 'bars',      q: 'nwr["amenity"~"^(bar|pub|biergarten)$"]',             color: '#7c3aed' },
  brewery: { label: 'Brewery', plural: 'breweries', color: '#c99a06' },
  restaurant: { label: 'Restaurant', plural: 'restaurants', color: '#d6336c' },
  library: { label: 'Library', plural: 'libraries', color: '#1c7ed6' },
};
const DEFAULT_OFF = ['restaurant']; // there are a lot of them; turn on from the Nearby panel
// one solid heart shape for every heart in the app: filled red when saved, red outline when not
const HEART_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 21.2l-1.45-1.32C5.4 15.24 2 12.16 2 8.4 2 5.32 4.42 2.9 7.5 2.9c1.74 0 3.41.81 4.5 2.09A5.98 5.98 0 0 1 16.5 2.9C19.58 2.9 22 5.32 22 8.4c0 3.76-3.4 6.84-8.55 11.49L12 21.2z"/></svg>';
const STATUS = [['new','New'],['interested','Interested'],['contacted','Contacted'],['toured','Toured'],['pass','Pass']];
const OLD_STATUS_KEY = 'pdx-house-hunt-status-v1';
const NAME_KEY = 'pdx-house-hunt-name';

// ---------- shared edits (Supabase, rec-league project, hh_ tables) ----------
const SB_URL = 'https://rwgnqoekvafejhltqhri.supabase.co/rest/v1/hh_listing_edits';
const SB_KEY = 'sb_publishable_eK00y0GIVEUcxrL_WwFZSQ_j69dqjnW'; // publishable key: safe in the browser; access is limited by row-level security
const sbHeaders = { apikey: SB_KEY, 'Content-Type': 'application/json' };
let EDITS = {};          // listing_id -> { data, updated_by, updated_at }
let editsOk = null;      // null = loading, true, false
let editsSig = '';
async function loadEdits() {
  try {
    const r = await fetch(SB_URL + '?select=listing_id,data,updated_by,updated_at', { headers: sbHeaders, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rows = await r.json();
    const sig = JSON.stringify(rows.map(x => [x.listing_id, x.updated_at]).sort());
    const changed = sig !== editsSig;
    editsSig = sig; EDITS = Object.fromEntries(rows.map(x => [x.listing_id, x])); editsOk = true;
    return changed;
  } catch (e) { console.warn('Could not load shared edits', e); const was = editsOk; editsOk = false; return was !== false; }
}
async function saveEdit(id, patch) {
  const base = BASE.find(b => b.id === id) || {};
  const data = { ...(EDITS[id]?.data || {}), ...patch };
  for (const k of Object.keys(data)) if ((data[k] == null && base[k] == null) || data[k] === base[k] || (data[k] === '' && base[k] == null)) delete data[k]; // keep only real changes
  const row = { listing_id: id, data, updated_by: myName() || null };
  const r = await fetch(SB_URL + '?on_conflict=listing_id', {
    method: 'POST', headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(row)
  });
  if (!r.ok) throw new Error('Save failed (HTTP ' + r.status + ')');
  const [saved] = await r.json();
  EDITS[id] = saved;
  applyEdits();
}
function myName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } }
function setMyName(n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) {} }
let BASE = [];
let PHOTOS = {}; // id -> { file } saved copies from photos/index.json
function photoCandidates(l) {
  const out = [];
  if (l._edit && l._edit.data && l._edit.data.photo) out.push(l._edit.data.photo);
  const base = BASE.find(b => b.id === l.id);
  const saved = PHOTOS[l.id];
  if (saved && base && saved.source === base.photo && !(l._edit && l._edit.data && l._edit.data.photo)) out.push('photos/' + saved.file);
  if (base && base.photo) out.push(base.photo);
  return [...new Set(out)];
}
function photoEl(l, cls) {
  const srcs = photoCandidates(l);
  const wrap = el('div', 'photo ' + cls);
  if (!srcs.length) { wrap.classList.add('none'); wrap.append(el('span', null, 'No photo')); return wrap; }
  const img = el('img'); img.alt = 'Photo of ' + l.address; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
  let i = 0;
  img.src = srcs[0];
  img.addEventListener('error', () => {
    i++;
    if (i < srcs.length) img.src = srcs[i];
    else { img.remove(); wrap.classList.add('none'); wrap.append(el('span', null, 'Photo unavailable')); }
  });
  wrap.append(img);
  return wrap;
}
function applyEdits() {
  D.listings = BASE.map(b => EDITS[b.id] ? { ...b, ...EDITS[b.id].data, _edit: EDITS[b.id] } : b);
}
// one-time: move statuses saved on this device (older version) into the shared list
async function migrateLocalStatuses() {
  let old = {}; try { old = JSON.parse(localStorage.getItem(OLD_STATUS_KEY) || '{}'); } catch (e) { return; }
  for (const [id, status] of Object.entries(old)) {
    if (!BASE.some(b => b.id === id) || EDITS[id]?.data?.status) continue;
    try { await saveEdit(id, { status }); } catch (e) { return; }
  }
  try { localStorage.removeItem(OLD_STATUS_KEY); } catch (e) {}
}

const $ = id => document.getElementById(id);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
const money = n => '$' + n.toLocaleString();
const st = l => l.status || 'new';
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
  return L.divIcon({ className: 'pin-icon', html: `<span class="${cls}">${isFav(l) ? '<svg class="pinheart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.2l-1.45-1.32C5.4 15.24 2 12.16 2 8.4 2 5.32 4.42 2.9 7.5 2.9c1.74 0 3.41.81 4.5 2.09A5.98 5.98 0 0 1 16.5 2.9C19.58 2.9 22 5.32 22 8.4c0 3.76-3.4 6.84-8.55 11.49L12 21.2z"/></svg>' : ''}${'$' + (l.price / 1000).toFixed(1) + 'k'}</span>`, iconSize: [0, 0] });
}

function popupFor(l, done) {
  const d = el('div', 'pop');
  d.addEventListener('click', e => e.stopPropagation());
  const heroWrap = el('div', 'herowrap'); heroWrap.append(photoEl(l, 'hero'), heartButton(l)); d.append(heroWrap);
  const r = el('div', 'row'); r.append(el('span', 'price', money(l.price)), el('span', 'addr', l.address)); d.append(r);
  const meta = [`${l.beds} bd`, `${l.baths} ba`]; if (l.sqft) meta.push(l.sqft.toLocaleString() + ' sq ft'); if (l.available) meta.push('Avail. ' + l.available);
  d.append(el('div', 'meta', meta.join(' · ')));
  const tags = el('div', 'tags'); tags.append(el('span', 'tag src', l.source), tag('Yard', l.yard), tag('Dishwasher', l.dishwasher)); d.append(tags);
  if (l.notes) d.append(el('div', 'notes', l.notes));
  const act = el('div', 'actions');
  act.append(statusSelect(l), editButton(l));
  const a = el('a', null, 'Open listing ↗'); a.href = l.url; a.target = '_blank'; a.rel = 'noopener'; act.append(a);
  d.append(act);
  if (hasDetailEdits(l)) d.append(editedLine(l));
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
    L.circleMarker([p.lat, p.lng], { renderer: canvas, radius: p.cat === 'park' || p.cat === 'library' || p.cat === 'brewery' ? 6 : 4.5, color: '#fff', weight: 1.2, fillColor: def.color, fillOpacity: .9 })
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
document.querySelectorAll('[data-poi]').forEach(c => { c.checked = !DEFAULT_OFF.includes(c.dataset.poi); c.addEventListener('change', updateLayerVisibility); });
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
  sel.addEventListener('change', async () => {
    sel.disabled = true;
    try { await saveEdit(l.id, { status: sel.value }); render(); }
    catch (e) { toast('Couldn’t save — ' + e.message); sel.value = st(l); sel.disabled = false; }
  });
  return sel;
}
function filtered() {
  const fs = $('fSource').value, fst = $('fStatus').value, m = $('fMatch').checked, b = $('fBath').checked, sp = $('fPass').checked, fv = $('fFav').checked;
  const rows = D.listings.filter(l => (!fv || isFav(l)) && (!fs || l.source === fs) && (!fst || st(l) === fst) && (!m || isMatch(l)) && (!b || l.baths >= 1.5) && (sp || fst === 'pass' || st(l) !== 'pass'));
  const s = $('sort').value;
  rows.sort((a, c) => s === 'price' ? a.price - c.price : s === 'priceDesc' ? c.price - a.price : s === 'beds' ? (c.beds - a.beds) || (a.price - c.price)
    : (c.firstSeen.localeCompare(a.firstSeen)) || (isMatch(c) - isMatch(a)) || a.source.localeCompare(c.source));
  return rows;
}
function render() {
  const rows = filtered();
  const list = $('list'); list.replaceChildren();
  listingLayer.clearLayers(); markers = {};
  $('count').textContent = `${rows.length} of ${D.listings.length} houses` + ($('fFav').checked ? ' · favorites' : '');
  if (!rows.length) list.append(el('div', 'empty', $('fFav').checked ? 'No favorites yet. Tap the heart on a listing to save it here.' : 'No listings match these filters.'));
  for (const l of rows) {
    const it = el('div', 'item' + (isMatch(l) ? ' match' : '') + (st(l) === 'pass' ? ' dim' : '') + (selected === l.id ? ' sel' : ''));
    it.id = 'item-' + l.id;
    it.append(photoEl(l, 'thumb'), heartButton(l));
    const body = el('div', 'ibody'); it.append(body);
    const r1 = el('div', 'row');
    r1.append(el('span', 'price', money(l.price)), el('span', 'addr', l.address));
    if (l.firstSeen === latest) r1.append(el('span', 'new', 'New'));
    body.append(r1);
    const meta = [`${l.beds} bd`, `${l.baths} ba`]; if (l.sqft) meta.push(l.sqft.toLocaleString() + ' sq ft'); if (l.area) meta.push(l.area); if (l.available) meta.push('Avail. ' + l.available);
    body.append(el('div', 'meta', (l.title && l.title !== 'House for rent' ? l.title + ' · ' : '') + meta.join(' · ')));
    const tags = el('div', 'tags');
    tags.append(el('span', 'tag src', l.source), tag('Yard', l.yard), tag('Dishwasher', l.dishwasher), tag('W/D', l.laundry), tag('Dogs', l.dogs));
    body.append(tags);
    if (l.notes) body.append(el('div', 'notes', l.notes));
    const act = el('div', 'actions');
    act.append(statusSelect(l), editButton(l));
    const a = el('a', null, 'Open listing ↗'); a.href = l.url; a.target = '_blank'; a.rel = 'noopener';
    a.addEventListener('click', e => e.stopPropagation());
    act.append(a);
    if (!l.lat) act.append(el('span', 'notes', 'No address to map'));
    body.append(act);
    if (hasDetailEdits(l)) body.append(editedLine(l));
    if (selected === l.id && l.lat) { const box = el('div', 'near'); body.append(box); loadNearby(l, box); }
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
document.getElementById('favBtn').innerHTML = HEART_SVG + '<span>Favorites</span>';
$('fFav').addEventListener('change', () => { $('favBtn').classList.toggle('on', $('fFav').checked); render(); fitToResults(); });
$('favBtn').addEventListener('click', () => { $('fFav').checked = !$('fFav').checked; $('fFav').dispatchEvent(new Event('change')); });
window.addEventListener('resize', () => map.invalidateSize());

function header() {
  $('updated').textContent = 'Houses on Craigslist & Zillow · data from ' + new Date(D.updated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const c = D.criteria;
  for (const t of [`≤ ${money(c.maxRent)}`, `${c.minBeds}+ bd`, `${c.minBaths}+ ba (ideally ${c.idealBaths})`, c.type, ...c.mustHave])
    $('criteria').append(el('span', 'chip', t));
}

fetch('listings.json', { cache: 'no-store' }).then(r => r.json()).then(j => {
  D = j; BASE = j.listings;
  latest = BASE.reduce((m, l) => l.firstSeen > m ? l.firstSeen : m, '');
  header(); setView('list'); render(); fitToResults();
  loadEdits().then(() => {
    applyEdits(); render(); showEditsBanner();
    if (editsOk) migrateLocalStatuses().then(render);
  });
  fetch('photos/index.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).then(p => { PHOTOS = p || {}; render(); }).catch(() => {});
  return fetch('places.json', { cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(p => { PLACES = p.places || []; placesStatus = PLACES.length ? 'ok' : 'missing'; })
    .catch(() => { placesStatus = 'missing'; })
    .then(() => { drawPlaces(); render(); });
}).catch(() => { $('list').append(el('div', 'empty', 'Couldn’t load listings.')); });

// on phones, tuck the layers panel away while a popup is open
map.on('popupopen', () => { if (isMobile()) document.body.classList.add('popup-open'); });
map.on('popupclose', () => document.body.classList.remove('popup-open'));

// ---------- editing ----------
const FIELDS = [
  { k: 'dishwasher', label: 'Dishwasher', type: 'tri' },
  { k: 'yard', label: 'Yard', type: 'tri' },
  { k: 'laundry', label: 'W/D in unit', type: 'tri' },
  { k: 'dogs', label: 'Small dogs', type: 'choice', opts: [['yes', 'Allowed'], ['small OK', 'Small OK'], ['no', 'Not allowed'], ['?', 'Unknown']] },
  { k: 'price', label: 'Rent ($/mo)', type: 'number' },
  { k: 'beds', label: 'Bedrooms', type: 'number' },
  { k: 'baths', label: 'Bathrooms', type: 'number', step: '0.5' },
  { k: 'sqft', label: 'Sq ft', type: 'number' },
  { k: 'available', label: 'Available', type: 'text', placeholder: 'e.g. Mar 1' },
  { k: 'notes', label: 'Notes', type: 'textarea' },
  { k: 'photo', label: 'Photo link (paste an image address to use a better shot)', type: 'url', wide: true },
];
const isFav = l => !!l.fav;
function heartButton(l) {
  const b = el('button', 'heart' + (isFav(l) ? ' on' : '')); b.type = 'button';
  const setLabel = on => { b.innerHTML = HEART_SVG; b.title = on ? 'Remove from favorites' : 'Save as favorite'; b.setAttribute('aria-label', b.title); b.setAttribute('aria-pressed', on); };
  setLabel(isFav(l));
  b.addEventListener('click', async e => {
    e.stopPropagation();
    const next = !isFav(l);
    b.classList.toggle('on', next); setLabel(next); b.disabled = true;
    try { await saveEdit(l.id, { fav: next ? true : null }); render(); if (next) toast('Saved to favorites.'); }
    catch (err) { b.classList.toggle('on', !next); setLabel(!next); toast('Couldn’t save — ' + err.message); }
    finally { b.disabled = false; }
  });
  return b;
}
function editButton(l) {
  const b = el('button', 'editbtn', 'Edit details'); b.type = 'button';
  b.addEventListener('click', e => { e.stopPropagation(); openEditor(l.id); });
  return b;
}
const hasDetailEdits = l => !!(l._edit && Object.keys(l._edit.data || {}).some(k => k !== 'status' && k !== 'fav'));
function editedLine(l) {
  const e = l._edit, who = e.updated_by ? e.updated_by : 'someone';
  const when = new Date(e.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return el('div', 'edited', `Edited by ${who} · ${when}`);
}
function openEditor(id) {
  const l = D.listings.find(x => x.id === id), base = BASE.find(x => x.id === id);
  const dlg = $('editor'), form = $('editForm');
  $('editTitle').textContent = l.address;
  $('editSub').textContent = `${l.source} listing · original details from the listing are shown under each field`;
  const body = $('editFields'); body.replaceChildren();
  for (const f of FIELDS) {
    const wrap = el('label', 'field' + (f.type === 'textarea' || f.wide ? ' wide' : ''));
    wrap.append(el('span', 'flabel', f.label));
    let input;
    if (f.type === 'tri' || f.type === 'choice') {
      input = el('select');
      for (const [v, t] of (f.opts || [['yes', 'Yes'], ['no', 'No'], ['?', 'Unknown']])) { const o = el('option', null, t); o.value = v; input.append(o); }
      input.value = l[f.k] ?? '?';
    } else if (f.type === 'textarea') {
      input = el('textarea'); input.rows = 3; input.maxLength = 1000; input.value = l[f.k] || '';
    } else {
      input = el('input'); input.type = f.type; if (f.step) input.step = f.step; if (f.placeholder) input.placeholder = f.placeholder;
      if (f.type === 'number') input.min = '0'; else input.maxLength = f.type === 'url' ? 500 : 60;
      input.value = f.k === 'photo' ? ((l._edit && l._edit.data.photo) || '') : (l[f.k] ?? '');
      if (f.k === 'photo') input.placeholder = 'https://…';
    }
    input.name = f.k;
    wrap.append(input);
    const orig = f.k === 'photo' ? undefined : base[f.k];
    if (f.k !== 'photo' && String(orig ?? '') !== String(l[f.k] ?? '')) wrap.append(el('span', 'orig', 'Listing said: ' + (orig === '' || orig == null ? '(blank)' : orig === '?' ? 'unknown' : orig)));
    body.append(wrap);
  }
  $('editName').value = myName();
  $('editError').textContent = '';
  form.onsubmit = async e => {
    e.preventDefault();
    const patch = {};
    for (const f of FIELDS) {
      let v = form.elements[f.k].value.trim();
      if (f.k === 'photo') { if (v && !/^https:\/\//i.test(v)) { $('editError').textContent = 'Photo link must start with https://'; return; } patch.photo = v || null; continue; }
      if (f.type === 'number') { if (v === '') { v = null; } else { v = Number(v); if (!isFinite(v) || v < 0) { $('editError').textContent = f.label + ' must be a number.'; return; } } }
      patch[f.k] = v;
    }
    const name = $('editName').value.trim().slice(0, 40); setMyName(name);
    const btn = $('editSave'); btn.disabled = true; btn.textContent = 'Saving…';
    try { await saveEdit(id, patch); dlg.close(); render(); toast('Saved — everyone with the link will see it.'); }
    catch (err) { $('editError').textContent = 'Couldn’t save: ' + err.message + '. Try again.'; }
    finally { btn.disabled = false; btn.textContent = 'Save'; }
  };
  $('editReset').onclick = async () => {
    if (!EDITS[id]) { dlg.close(); return; }
    const keep = {}; for (const k of ['status', 'fav']) if (EDITS[id].data[k]) keep[k] = EDITS[id].data[k];
    try { EDITS[id].data = keep; await saveEdit(id, {}); dlg.close(); render(); toast('Back to the original listing details.'); }
    catch (err) { $('editError').textContent = 'Couldn’t reset: ' + err.message; }
  };
  $('editReset').hidden = !EDITS[id] || Object.keys(EDITS[id].data).every(k => k === 'status' || k === 'fav');
  map.closePopup();
  dlg.showModal();
}
$('editCancel').addEventListener('click', () => $('editor').close());

let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 3500); }
function showEditsBanner() {
  const b = $('banner');
  b.hidden = editsOk !== false;
  b.textContent = 'Shared edits couldn’t be loaded, so you’re seeing the original listing details. Edits won’t save until the connection is back.';
}
// pick up your partner's edits: when the tab regains focus, and every minute
async function syncEdits() {
  if (!D || $('editor').open) return;
  const changed = await loadEdits();
  if (changed) { applyEdits(); render(); }
  showEditsBanner();
}
window.addEventListener('focus', syncEdits);
setInterval(() => { if (!document.hidden) syncEdits(); }, 60000);
