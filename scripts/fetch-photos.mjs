// Saves a copy of each listing's main photo into photos/<id>.jpg so pictures survive
// after a Craigslist/Zillow post comes down. Writes photos/index.json (id -> file).
// Run by .github/workflows/places.yml whenever listings.json changes.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const MAX_BYTES = 3 * 1024 * 1024;
mkdirSync('photos', { recursive: true });
const listings = JSON.parse(readFileSync('listings.json', 'utf8')).listings;
const index = existsSync('photos/index.json') ? JSON.parse(readFileSync('photos/index.json', 'utf8')) : {};
const safe = id => id.replace(/[^A-Za-z0-9_-]/g, '_');

let saved = 0, kept = 0, failed = 0;
for (const l of listings) {
  if (!l.photo) continue;
  const prev = index[l.id];
  if (prev && prev.source === l.photo && existsSync('photos/' + prev.file)) { kept++; continue; }
  try {
    const r = await fetch(l.photo, { headers: { 'User-Agent': 'Mozilla/5.0 (pdx-house-hunt photo archiver)' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const type = r.headers.get('content-type') || '';
    if (!type.startsWith('image/')) throw new Error('not an image: ' + type);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('too large: ' + buf.length);
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    const file = `${safe(l.id)}.${ext}`;
    writeFileSync('photos/' + file, buf);
    index[l.id] = { file, source: l.photo, saved: new Date().toISOString().slice(0, 10) };
    saved++;
  } catch (err) {
    failed++;
    console.warn(`Photo for ${l.id} not saved (${err.message}); the app will use the original link.`);
  }
}
writeFileSync('photos/index.json', JSON.stringify(index, null, 1));
console.log(`Photos: ${saved} saved, ${kept} already saved, ${failed} failed`);
