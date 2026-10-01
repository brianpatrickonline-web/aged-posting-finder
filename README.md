# Aged Posting Finder (prototype)

Reps enter job titles/keywords and an age range (default 30–90 days). The tool returns open US postings in that range, oldest first, with a CSV download. Data comes from TheirStack.

## Files
- `index.html` — the page reps use
- `netlify/functions/search.js` — server function that calls TheirStack and keeps the API key private
- `netlify.toml` — tells Netlify where the page and function live

## Netlify environment variables
| Name | Required | What it does |
|---|---|---|
| `THEIRSTACK_API_KEY` | For live data | Your TheirStack API key. Without it, the site shows clearly labeled **sample data**. |
| `MAX_RESULTS` | No (default 10) | Results per search, capped at 100. Each job returned costs 1 TheirStack API credit. |
| `ACCESS_CODE` | Recommended | If set, reps must enter this code before searching, so outsiders can't use up credits. |

After changing environment variables in Netlify, trigger a new deploy so the function picks them up.

## Location options
Reps choose **Anywhere in the US**, **a region**, or **specific states**. Regions (edit `REGIONS` in both `netlify/functions/search.js` and `index.html` to change them):
- Northeast: CT, DE, DC, ME, MD, MA, NH, NJ, NY, PA, RI, VT
- Southeast: AL, AR, FL, GA, KY, LA, MS, NC, SC, TN, VA, WV
- Midwest: IL, IN, IA, KS, MI, MN, MO, NE, ND, OH, SD, WI
- Southwest: AZ, NM, OK, TX
- West: AK, CA, CO, HI, ID, MT, NV, OR, UT, WA, WY

How it filters: the function looks up TheirStack's location IDs for US states (catalog endpoint) and filters with `job_location_or`. If that lookup fails, it falls back to matching location text (e.g. ", GA" or "Georgia"). The API response includes `locationMethod` (`location_ids` or `text_match`) so you can see which was used.

## Fixed search rules
- US postings only, still open (`is_closed: false`), oldest first
- Age range 0–365 days; minimum must be lower than maximum
- Up to 20 titles/keywords per search
