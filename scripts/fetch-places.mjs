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
const query = `[out:json][timeout:120];(${Object.values(CATS).map(q => `${q}(${bbox});`).join('')});out center tags;`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchOverpass() {
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const ep of ENDPOINTS) {
      try {
        const r = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'pdx-house-hunt (GitHub Action)' },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(180000),
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
  if (/^(supermarket|grocery|greengrocer)$/.test(t.shop || '')) return 'grocery';
  if (t.leisure === 'park') return 'park';
  if (t.amenity === 'cafe') return 'coffee';
  if (/^(bar|pub|biergarten)$/.test(t.amenity || '')) return 'bar';
  return null;
}
function dist(a, b, c, d) {
  const r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
}

const elements = await fetchOverpass();
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
places.sort((a, b) => a.id.localeCompare(b.id));

const counts = Object.fromEntries(Object.keys(CATS).map(c => [c, places.filter(p => p.cat === c).length]));
const out = { updated: new Date().toISOString(), source: 'OpenStreetMap contributors (ODbL), via Overpass API', radiusMeters: RADIUS_M, counts, places };

// only rewrite when the places themselves changed, so the commit history stays quiet
if (existsSync('places.json')) {
  const prev = JSON.parse(readFileSync('places.json', 'utf8'));
  if (JSON.stringify(prev.places) === JSON.stringify(places)) { console.log('No changes to places.'); process.exit(0); }
}
writeFileSync('places.json', JSON.stringify(out));
console.log('Wrote places.json:', counts);
