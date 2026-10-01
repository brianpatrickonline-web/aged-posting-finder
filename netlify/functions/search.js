// Aged Job Finder — server function.
// Keeps the TheirStack API key private and enforces the prototype limits.
//
// Netlify environment variables:
//   THEIRSTACK_API_KEY  (required for live data; without it the tool returns clearly-labeled sample data)
//   MAX_RESULTS         (optional, default 10, hard cap 100) — each job returned costs 1 TheirStack API credit
//   ACCESS_CODE         (optional) — if set, reps must enter this code to search, so outsiders can't burn credits

const API_URL = "https://api.theirstack.com/v1/jobs/search";
const DEFAULT_MIN_AGE = 30;
const DEFAULT_MAX_AGE = 90;

const STATES = {
  AL:"Alabama", AK:"Alaska", AZ:"Arizona", AR:"Arkansas", CA:"California", CO:"Colorado", CT:"Connecticut",
  DE:"Delaware", DC:"District of Columbia", FL:"Florida", GA:"Georgia", HI:"Hawaii", ID:"Idaho", IL:"Illinois",
  IN:"Indiana", IA:"Iowa", KS:"Kansas", KY:"Kentucky", LA:"Louisiana", ME:"Maine", MD:"Maryland",
  MA:"Massachusetts", MI:"Michigan", MN:"Minnesota", MS:"Mississippi", MO:"Missouri", MT:"Montana",
  NE:"Nebraska", NV:"Nevada", NH:"New Hampshire", NJ:"New Jersey", NM:"New Mexico", NY:"New York",
  NC:"North Carolina", ND:"North Dakota", OH:"Ohio", OK:"Oklahoma", OR:"Oregon", PA:"Pennsylvania",
  RI:"Rhode Island", SC:"South Carolina", SD:"South Dakota", TN:"Tennessee", TX:"Texas", UT:"Utah",
  VT:"Vermont", VA:"Virginia", WA:"Washington", WV:"West Virginia", WI:"Wisconsin", WY:"Wyoming",
};
// Regions are easy to change: edit the state lists below.
const REGIONS = {
  Northeast: ["CT","DE","DC","ME","MD","MA","NH","NJ","NY","PA","RI","VT"],
  Southeast: ["AL","AR","FL","GA","KY","LA","MS","NC","SC","TN","VA","WV"],
  Midwest:   ["IL","IN","IA","KS","MI","MN","MO","NE","ND","OH","SD","WI"],
  Southwest: ["AZ","NM","OK","TX"],
  West:      ["AK","CA","CO","HI","ID","MT","NV","OR","UT","WA","WY"],
};

// Resolve a location choice to a list of state codes ([] = anywhere in the US).
function resolveStates(loc) {
  if (!loc || !loc.type || loc.type === "all") return { codes: [], label: "Anywhere in the US" };
  if (loc.type === "region") {
    const codes = REGIONS[loc.region];
    if (!codes) return { error: "Pick a region." };
    return { codes, label: `${loc.region} region` };
  }
  if (loc.type === "states") {
    const codes = [...new Set((loc.states || []).map((c) => String(c).toUpperCase()).filter((c) => STATES[c]))];
    if (!codes.length) return { error: "Pick at least one state." };
    return { codes, label: codes.length <= 4 ? codes.map((c) => STATES[c]).join(", ") : `${codes.length} states` };
  }
  return { error: "Unknown location option." };
}

// TheirStack filters locations by its own location IDs. Look up the IDs for US states
// once per warm function instance and cache them.
let stateIdCache = null;
async function getStateIds(apiKey) {
  if (stateIdCache) return stateIdCache;
  const url = "https://api.theirstack.com/v0/catalog/locations?country_code=US&feature_code=ADM1&limit=100";
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const payload = await res.json();
  const rows = Array.isArray(payload) ? payload : (payload.data || payload.locations || []);
  const byName = {};
  for (const r of rows) {
    const n = String(r.name || r.admin1_name || "").toLowerCase();
    if (n && r.id != null) byName[n] = r.id;
  }
  const ids = {};
  for (const [code, name] of Object.entries(STATES)) {
    const id = byName[name.toLowerCase()] ?? (code === "DC" ? byName["washington, d.c."] : undefined);
    if (id != null) ids[code] = id;
  }
  if (Object.keys(ids).length < 40) throw new Error("catalog incomplete");
  stateIdCache = ids;
  return ids;
}

// Fallback if the ID lookup fails: match location text, e.g. "Atlanta, GA" or "Georgia".
// Avoids \\b (not supported the same way by every regex engine). Full state names are skipped
// where they'd also match another state: Kansas (Arkansas), Virginia (West Virginia), Washington (DC).
const NAME_UNSAFE = new Set(["KS", "VA", "WA"]);
function statePatterns(codes) {
  return codes.map((c) => {
    const abbr = `, ${c}($|[^A-Za-z])`;
    return NAME_UNSAFE.has(c) ? abbr : `(${abbr}|${STATES[c]})`;
  });
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

// Today's date in US Eastern time, as a UTC-midnight Date for clean day math.
function todayEastern() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()); // "YYYY-MM-DD"
  return new Date(parts + "T00:00:00Z");
}
function isoDay(d) { return d.toISOString().slice(0, 10); }
function daysBefore(base, n) { return new Date(base.getTime() - n * 86400000); }
function daysBetween(fromIso, to) {
  if (!fromIso) return null;
  const from = new Date(String(fromIso).slice(0, 10) + "T00:00:00Z");
  if (isNaN(from)) return null;
  return Math.round((to - from) / 86400000);
}

function parseTitles(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || "").split(/[\n,;]+/);
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const v = String(t).trim().replace(/\s+/g, " ");
    if (v && v.length <= 80 && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
  }
  return out.slice(0, 20);
}

function sampleJobs(titles, minAge, maxAge, limit, today, codes) {
  const allPlaces = ["Columbus, OH", "Richmond, VA", "Denver, CO", "Tampa, FL", "Hartford, CT", "Austin, TX", "Raleigh, NC", "Boise, ID", "Omaha, NE", "Albany, NY"];
  const places = codes && codes.length ? codes.map((c) => `Sample City, ${c}`) : allPlaces;
  const jobs = [];
  for (let i = 0; i < limit; i++) {
    const age = Math.round(maxAge - (i * (maxAge - minAge)) / Math.max(limit - 1, 1));
    jobs.push({
      title: titles[i % titles.length],
      company: `Sample Employer ${String.fromCharCode(65 + i)}`,
      location: places[i % places.length],
      postedDate: isoDay(daysBefore(today, age)),
      daysOpen: age,
      reposted: i % 4 === 1,
      url: "",
    });
  }
  return jobs;
}

exports.REGIONS = REGIONS;
exports.STATES = STATES;
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST." });

  let input;
  try { input = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Request wasn't valid JSON." }); }

  const accessCode = process.env.ACCESS_CODE;
  if (accessCode && String(input.accessCode || "") !== accessCode) {
    return json(401, { error: "Enter the team access code to search.", code: "ACCESS_REQUIRED" });
  }

  const titles = parseTitles(input.titles);
  if (!titles.length) return json(400, { error: "Enter at least one job title or keyword." });

  const minAge = Number.isFinite(+input.minAge) ? Math.round(+input.minAge) : DEFAULT_MIN_AGE;
  const maxAge = Number.isFinite(+input.maxAge) ? Math.round(+input.maxAge) : DEFAULT_MAX_AGE;
  if (minAge < 0 || maxAge > 365 || minAge >= maxAge) {
    return json(400, { error: "Age range must be between 0 and 365 days, with the minimum lower than the maximum." });
  }

  const loc = resolveStates(input.location);
  if (loc.error) return json(400, { error: loc.error });

  const limit = Math.min(Math.max(parseInt(process.env.MAX_RESULTS || "10", 10) || 10, 1), 100);
  const today = todayEastern();
  const postedFrom = isoDay(daysBefore(today, maxAge)); // oldest allowed
  const postedTo = isoDay(daysBefore(today, minAge));   // newest allowed
  const meta = { titles, minAge, maxAge, postedFrom, postedTo, limit, today: isoDay(today), locationLabel: loc.label };

  const apiKey = process.env.THEIRSTACK_API_KEY;
  if (!apiKey) {
    return json(200, { sample: true, ...meta, total: null, jobs: sampleJobs(titles, minAge, maxAge, limit, today, loc.codes) });
  }

  const body = {
    page: 0,
    limit,
    posted_at_gte: postedFrom,
    posted_at_lte: postedTo,
    job_title_or: titles,
    job_country_code_or: ["US"],
    is_closed: false,
    order_by: [{ field: "date_posted", desc: false }], // oldest first
    include_total_results: true,
    blur_company_data: false,
  };

  let locationMethod = "none";
  if (loc.codes.length) {
    try {
      const ids = await getStateIds(apiKey);
      const picked = loc.codes.map((c) => ids[c]).filter((v) => v != null);
      if (picked.length !== loc.codes.length) throw new Error("missing ids");
      body.job_location_or = picked.map((id) => ({ id }));
      locationMethod = "location_ids";
    } catch (e) {
      body.job_location_pattern_or = statePatterns(loc.codes);
      locationMethod = "text_match";
    }
  }

  let res, data;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
  } catch (e) {
    return json(502, { error: "Couldn't reach TheirStack. Try again in a minute." });
  }

  if (!res.ok) {
    const msg =
      res.status === 401 || res.status === 403 ? "TheirStack rejected the API key. Check THEIRSTACK_API_KEY in Netlify." :
      res.status === 402 ? "The TheirStack account is out of API credits." :
      res.status === 429 ? "Too many searches at once. Wait a minute and try again." :
      `TheirStack returned an error (${res.status}).`;
    return json(res.status === 429 ? 429 : 502, { error: msg, detail: data && (data.detail || data.message || data.raw) || null });
  }

  const jobs = (data.data || []).map((j) => ({
    title: j.job_title || "",
    company: j.company || (j.company_object && j.company_object.name) || "",
    location: j.short_location || j.location || "",
    state: j.state_code || "",
    postedDate: j.date_posted ? String(j.date_posted).slice(0, 10) : "",
    daysOpen: daysBetween(j.date_posted, today),
    reposted: Boolean(j.date_reposted),
    url: j.final_url || j.url || "",
  }));

  return json(200, { sample: false, ...meta, locationMethod, total: data.metadata ? data.metadata.total_results : null, jobs });
};
