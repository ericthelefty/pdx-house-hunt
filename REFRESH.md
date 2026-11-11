# Refreshing listings

Craigslist and Zillow block automated access, so listings are refreshed by hand: ask Claude (with the Claude desktop app's built-in browser) to "refresh PDX House Hunt listings."

What a refresh does:
1. Opens the Craigslist search (houses, ≤ $3,100, 2+ bd, 1+ ba, dogs OK, W/D in unit):
   https://www.craigslist.org/search/subarea/mlt?cat=apa&housing_type=6&laundry=1&max_price=3100&min_bathrooms=1&min_bedrooms=2&pets_dog=1
   and reads each new post for address, baths, availability, dishwasher and yard. Skips likely scams, rooms, duplicates and non-Portland listings.
2. Opens Zillow's Portland house rentals with the same filters plus small dogs and in-unit laundry, and reads the result cards. Zillow listing pages can't be read automatically, so yard/dishwasher stay "?" until checked by hand.
3. Opens Redfin's Portland rentals (search data at `/stingray/api/v1/search/rentals?...&region_id=30772&region_type=6&max_price=3100&min_num_beds=2&min_num_baths=1`), keeps plain-address homes (no `/unit-` in the URL), reads each listing page for `standardizedAmenities`/`otherAmenities`, `petPolicies` and `walkScoreData`, and keeps ones with dogs allowed and W/D in unit that aren't duplexes/units or outside city limits. Existing listings found on Redfin get Walk/Transit/Bike Scores.
4. Grabs each new listing's main photo URL (Craigslist: the post's `og:image`; Zillow: `imgSrc` in the search results) into the `photo` field.
5. Adds new listings to `listings.json` (with `firstSeen` = today and lat/lng), updates `updated` and `log`, commits, and pushes. The GitHub Action then saves a copy of each photo into `photos/` and Vercel redeploys automatically.

`listings.json` fields: id (`cl-<postid>` or `z-<zpid>`), source, title, address, area, price, beds, baths, sqft, available, yard, dishwasher ("yes"/"no"/"?"), laundry, dogs, url, firstSeen, notes, status, lat, lng, photo.

## Notes from refreshes
- Before starting, make sure the desktop app's Browser pane is showing (ask Eric to press Cmd/Ctrl+Shift+B if it's hidden), so he can see bot checks.
- Zillow (and any site) bot checks: never try to pass or get around one. Stop, tell Eric which page is showing the check, and wait for him to pass it, then continue. Zillow loads 41 results per page (3 pages); a check often appears on page 2 or 3. Zillow removals can only be detected when all pages were read.
- Listings that come down get `gone: <date>` (Craigslist post returns 410/deleted; Redfin listing missing from search and its page shows off market). The app hides gone listings unless someone hearted them, and shows those with a "No longer listed" badge.
- Same house on several sites: keep the first one added and note "Also on Redfin/Zillow"; use Redfin's page for Walk/Transit/Bike Scores and amenity confirmations.
