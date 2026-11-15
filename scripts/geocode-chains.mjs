// Fills in map coordinates for stores in chains.json that don't have them yet.
// Store lists come from the chains' own websites; coordinates come from the
// US Census address lookup, with OpenStreetMap's Nominatim as a fallback.
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'chains.json';
const data = JSON.parse(readFileSync(file, 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = { 'User-Agent': 'pdx-house-hunt (GitHub Action; github.com/ericthelefty/pdx-house-hunt)' };

async function census(addr) {
  const u = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(addr);
  const j = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) }).then(r => r.json());
  const m = j?.result?.addressMatches?.[0];
  return m ? { lat: m.coordinates.y, lng: m.coordinates.x } : null;
}
async function nominatim(addr) {
  const u = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(addr);
  const j = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) }).then(r => r.json());
  return j?.[0] ? { lat: +j[0].lat, lng: +j[0].lon } : null;
}

let changed = 0, missing = 0;
for (const s of data.stores) {
  if (s.lat != null && s.lng != null) continue;
  const addr = `${s.street}, ${s.city}, ${s.state} ${s.zip}`;
  let hit = null;
  try { hit = await census(addr); } catch (e) { console.warn('Census failed:', addr, e.message); }
  if (!hit) { try { await sleep(1100); hit = await nominatim(addr); } catch (e) { console.warn('Nominatim failed:', addr, e.message); } }
  if (hit) { s.lat = +hit.lat.toFixed(5); s.lng = +hit.lng.toFixed(5); changed++; console.log('Located', s.chain, s.name, s.lat, s.lng); }
  else { missing++; console.warn('Could not locate', s.chain, s.name, addr); }
  await sleep(300);
}
if (changed) writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
console.log(`Located ${changed} store(s); ${missing} still without coordinates.`);
