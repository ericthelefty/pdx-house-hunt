// Collects groceries, parks, coffee shops and bars near every listing from OpenStreetMap
// (Overpass API) and writes places.json. Run by .github/workflows/places.yml.
// If every server fails, it exits with an error and leaves the existing places.json alone.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const RADIUS_M = 1600; // ~1 mile around each listing
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const CATS = {
  grocery: 'nwr["shop"~"^(supermarket|grocery|greengrocer)$"]',
  park: 'nwr["leisure"="park"]["name"]',
  coffee: 'nwr["amenity"="cafe"]',
  bar: 'nwr["amenity"~"^(bar|pub|biergarten)$"]',
  restaurant: 'nwr["amenity"="restaurant"]',
  brewery: 'nwr["craft"~"^(brewery|cider)$"];nwr["microbrewery"="yes"]',
  library: 'nwr["amenity"="library"]',
};

const listings = JSON.parse(readFileSync('listings.json', 'utf8')).listings.filter(l => l.lat && l.lng);
if (!listings.length) { console.log('No mapped listings; nothing to do.'); process.exit(0); }

// one bounding box around all listings, padded by the radius
const pad = RADIUS_M / 111000;
const lats = listings.map(l => l.lat), lngs = listings.map(l => l.lng);
const s = Math.min(...lats) - pad, n = Math.max(...lats) + pad;
const lngPad = pad / Math.cos((s + n) / 2 * Math.PI / 180);
const w = Math.min(...lngs) - lngPad, e = Math.max(...lngs) + lngPad;
const bbox = [s, w, n, e].map(x => x.toFixed(4)).join(',');
const queryFor = q => `[out:json][timeout:120];(${q.split(';').map(x => `${x}(${bbox});`).join('')});out center tags;`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchOverpass(query) {
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const ep of ENDPOINTS) {
      try {
        const r = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'pdx-house-hunt (GitHub Action)' },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(150000),
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        if (!Array.isArray(j.elements)) throw new Error('bad response');
        console.log(`Got ${j.elements.length} elements from ${ep}`);
        return j.elements;
      } catch (err) { console.warn(`Failed at ${ep}: ${err.message}`); }
    }
    await sleep(30000);
  }
  throw new Error('All Overpass servers failed');
}

function classify(t = {}) {
  if (/^(brewery|cider)$/.test(t.craft || '') || t.microbrewery === 'yes') return 'brewery';
  if (/^(supermarket|grocery|greengrocer)$/.test(t.shop || '')) return 'grocery';
  if (t.leisure === 'park') return 'park';
  if (t.amenity === 'cafe') return 'coffee';
  if (/^(bar|pub|biergarten)$/.test(t.amenity || '')) return 'bar';
  if (t.amenity === 'restaurant') return 'restaurant';
  if (t.amenity === 'library') return 'library';
  return null;
}
function dist(a, b, c, d) {
  const r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
}

const prevFile = existsSync('places.json') ? JSON.parse(readFileSync('places.json', 'utf8')) : null;
const elements = [];
const failedCats = [];
for (const [cat, q] of Object.entries(CATS)) {
  try { const els = await fetchOverpass(queryFor(q)); elements.push(...els); console.log(`  ${cat}: ${els.length}`); }
  catch (err) { failedCats.push(cat); console.warn(`  ${cat}: failed (${err.message}); keeping previous ${cat} data`); }
  await sleep(2000);
}
if (failedCats.length === Object.keys(CATS).length) throw new Error('All Overpass servers failed for every category');
const seen = new Set(), places = [];
for (const el of elements) {
  const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon, cat = classify(el.tags);
  if (lat == null || !cat) continue;
  const id = el.type[0] + el.id;
  if (seen.has(id)) continue;
  if (!listings.some(l => dist(l.lat, l.lng, lat, lng) <= RADIUS_M)) continue;
  seen.add(id);
  places.push({ id, cat, name: el.tags.name || '', lat: +lat.toFixed(5), lng: +lng.toFixed(5) });
}

// ---- Open Brewery DB (free, MIT-licensed): adds breweries OpenStreetMap doesn't tag as breweries
async function fetchOpenBreweryDB() {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`https://api.openbrewerydb.org/v1/breweries?by_city=portland&by_state=oregon&per_page=200&page=${page}`,
      { headers: { 'User-Agent': 'pdx-house-hunt (GitHub Action)' }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error('Open Brewery DB HTTP ' + r.status);
    const rows = await r.json();
    all.push(...rows);
    if (rows.length < 200) break;
  }
  return all;
}
const normName = n => (n || '').toLowerCase().replace(/&/g, 'and').replace(/\b(the|brewing|brewery|brewers|beer|co|company|pub|taproom|tap room|ale ?house|llc|inc)\b/g, '').replace(/[^a-z0-9]/g, '');
try {
  const obdb = await fetchOpenBreweryDB();
  const osmBreweries = places.filter(p => p.cat === 'brewery' || p.cat === 'bar');
  let added = 0, merged = 0, skipped = 0;
  for (const b of obdb) {
    if (['closed', 'planning', 'contract', 'proprietor'].includes(b.brewery_type)) { skipped++; continue; }
    const lat = parseFloat(b.latitude), lng = parseFloat(b.longitude);
    if (!isFinite(lat) || !isFinite(lng)) { skipped++; continue; }
    if (!listings.some(l => dist(l.lat, l.lng, lat, lng) <= RADIUS_M)) continue;
    const nn = normName(b.name);
    // same place already in OpenStreetMap (as a brewery or a pub)? relabel it as a brewery instead of adding a duplicate
    const sameName = p => { const pn = normName(p.name); if (!pn || !nn) return false; if (pn === nn) return true; const [a, b2] = pn.length < nn.length ? [pn, nn] : [nn, pn]; return a.length >= 5 && b2.includes(a); };
    const dupe = osmBreweries
      .map(p => ({ p, m: dist(p.lat, p.lng, lat, lng) }))
      .filter(x => x.m < 150 && sameName(x.p))
      .sort((x, y) => (x.p.cat === 'brewery' ? 0 : 1) - (y.p.cat === 'brewery' ? 0 : 1) || x.m - y.m)[0]?.p;
    if (dupe) { if (dupe.cat !== 'brewery') { dupe.cat = 'brewery'; } merged++; continue; }
    places.push({ id: 'obdb-' + b.id, cat: 'brewery', name: b.name, lat: +lat.toFixed(5), lng: +lng.toFixed(5) });
    added++;
  }
  console.log(`Open Brewery DB: ${obdb.length} Portland entries, ${added} added, ${merged} matched OpenStreetMap, ${skipped} skipped (closed/planned/no location)`);
} catch (err) {
  console.warn('Open Brewery DB unavailable, using OpenStreetMap breweries only:', err.message);
}

// categories that failed this run keep last run's places, so a busy server never empties a layer
if (prevFile && failedCats.length) {
  for (const p of prevFile.places) if (failedCats.includes(p.cat) && !p.id.startsWith('obdb-') && !seen.has(p.id)) { seen.add(p.id); places.push(p); }
}
places.sort((a, b) => a.id.localeCompare(b.id));

const counts = Object.fromEntries(Object.keys(CATS).map(c => [c, places.filter(p => p.cat === c).length]));
const out = { updated: new Date().toISOString(), source: 'OpenStreetMap contributors (ODbL), via Overpass API; breweries also from Open Brewery DB (MIT)', radiusMeters: RADIUS_M, counts, places };

// only rewrite when the places themselves changed, so the commit history stays quiet
if (prevFile) {
  const prev = prevFile;
  if (JSON.stringify(prev.places) === JSON.stringify(places) && JSON.stringify(Object.keys(prev.counts || {})) === JSON.stringify(Object.keys(counts))) { console.log('No changes to places.'); process.exit(0); }
}
writeFileSync('places.json', JSON.stringify(out));
console.log('Wrote places.json:', counts);
