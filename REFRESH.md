# Refreshing listings

Craigslist and Zillow block automated access, so listings are refreshed by hand: ask Claude (with the Claude desktop app's built-in browser) to "refresh PDX House Hunt listings."

What a refresh does:
1. Opens the Craigslist search (houses, ≤ $3,100, 2+ bd, 1+ ba, dogs OK, W/D in unit):
   https://www.craigslist.org/search/subarea/mlt?cat=apa&housing_type=6&laundry=1&max_price=3100&min_bathrooms=1&min_bedrooms=2&pets_dog=1
   and reads each new post for address, baths, availability, dishwasher and yard. Skips likely scams, rooms, duplicates and non-Portland listings.
2. Opens Zillow's Portland house rentals with the same filters plus small dogs and in-unit laundry, and reads the result cards. Zillow listing pages can't be read automatically, so yard/dishwasher stay "?" until checked by hand.
3. Adds new listings to `listings.json` (with `firstSeen` = today and lat/lng), updates `updated` and `log`, commits, and pushes. Vercel redeploys automatically.

`listings.json` fields: id (`cl-<postid>` or `z-<zpid>`), source, title, address, area, price, beds, baths, sqft, available, yard, dishwasher ("yes"/"no"/"?"), laundry, dogs, url, firstSeen, notes, status, lat, lng.
