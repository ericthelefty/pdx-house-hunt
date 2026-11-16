# Refreshing listings

Craigslist and Zillow block automated access, so listings are refreshed by hand: ask Claude (with the Claude desktop app's built-in browser) to "refresh PDX House Hunt listings."

What a refresh does:
1. Opens the Craigslist search (houses, townhouses and duplexes, ≤ $3,100, 2+ bd, 1+ ba, dogs OK, W/D in unit):
   https://www.craigslist.org/search/subarea/mlt?cat=apa&housing_type=4&housing_type=6&housing_type=9&laundry=1&max_price=3100&min_bathrooms=1&min_bedrooms=2&pets_dog=1
   and reads each new post (results now link as `www.craigslist.org/view/d/<slug>/<token>`; the token is the listing id, and the page shows results only in list view: add `#search=2~list~0`) for address, baths, availability, dishwasher and yard. Skips likely scams, rooms, duplicates and non-Portland listings.
2. Opens Zillow's Portland rentals with Houses and Townhomes turned on and the same filters plus small dogs and in-unit laundry, and reads the result cards. Zillow filter keys: `sf`/`tow` on, `mf`/`con`/`apa`/`apco`/`manu`/`land` off, `sdog` (small dogs) and `lau` (in-unit laundry) on. Duplexes are usually filed as Zillow apartments: run a second search with `sf`/`tow` off, apartments on, and the keyword filter `att: duplex`, then keep the real duplex/plex units (skip complexes, lofts and flats). Zillow listing pages can't be read automatically, so yard/dishwasher stay "?" until checked by hand.
3. Opens Redfin's Portland rentals (search data at `/stingray/api/v1/search/rentals?al=1&isRentals=true&market=oregon&region_id=30772&region_type=6&status=9&v=8&num_homes=350&max_price=3100&num_beds=2&num_baths=1&dogs_allowed=true&has_in_unit_laundry=true&uipt=1,3` for houses + townhouses; run it again with `uipt=4` and keep only `propertyType` 4 (2–4 unit buildings) for duplexes. The older `min_num_beds`/`min_num_baths` names are ignored by Redfin), keeps houses, townhouses and duplex/plex units (skip apartment-complex units), reads each listing page for `standardizedAmenities`/`otherAmenities`, `petPolicies` and `walkScoreData`, and keeps ones with dogs allowed and W/D in unit that aren't outside city limits. Existing listings found on Redfin get Walk/Transit/Bike Scores.
4. Grabs each new listing's main photo URL (Craigslist: the post's `og:image`; Zillow: `imgSrc` in the search results) into the `photo` field.
5. Adds new listings to `listings.json` (with `firstSeen` = today and lat/lng), updates `updated` and `log`, commits, and pushes. The GitHub Action then saves a copy of each photo into `photos/` and Vercel redeploys automatically.

`listings.json` fields: id (`cl-<postid>` or `z-<zpid>`), source, title, address, area, price, beds, baths, sqft, available, yard, dishwasher ("yes"/"no"/"?"), laundry, dogs, url, firstSeen, notes, status, lat, lng, photo.

## Notes from refreshes
- Before starting, make sure the desktop app's Browser pane is showing (ask Eric to press Cmd/Ctrl+Shift+B if it's hidden), so he can see bot checks.
- Zillow (and any site) bot checks: never try to pass or get around one. Stop, tell Eric which page is showing the check, and wait for him to pass it, then continue. Zillow loads 41 results per page (3 pages); a check often appears on page 2 or 3. Zillow removals can only be detected when all pages were read.
- Listings that come down get `gone: <date>` (Craigslist post returns 410/deleted; Redfin listing missing from search and its page shows off market). The app hides gone listings unless someone hearted them, and shows those with a "No longer listed" badge.
- Same house on several sites: keep the first one added and note "Also on Redfin/Zillow"; use Redfin's page for Walk/Transit/Bike Scores and amenity confirmations.

## Grocery chain stores (New Seasons, Trader Joe's, Fred Meyer)
The labeled chain stores on the map come from `chains.json`, built from each chain's own store finder
(newseasonsmarket.com/find-a-store, locations.traderjoes.com/or/, fredmeyer.com/stores/grocery/or/portland).
To update: add or remove stores in `chains.json` (leave `lat`/`lng` as null for new ones) and push.
The GitHub Action fills in coordinates with the US Census address lookup.

## Home types
Every listing has a `type`: `house` (default when missing), `townhouse`, or `duplex` (duplex, half-plex, triplex, fourplex).
Set it from the site's property type, or from the title/description when the site gets it wrong.
Yard can be `yes`, `patio` (patio/balcony only, no real yard), `no` or `?`. Only `yes` counts toward "Confirmed yard, dishwasher, and W/D".
