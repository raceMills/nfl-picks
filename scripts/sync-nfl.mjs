// Pulls this week's NFL games, posted spreads, live scores and news from ESPN into Supabase.
// Runs every few minutes from .github/workflows/sync.yml.
// Needs two repo secrets: SUPABASE_URL and SUPABASE_SERVICE_KEY (the service_role key).
// The service key bypasses row security, so it only ever lives in GitHub secrets.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const now = () => new Date().toISOString();

async function getJson(url) {
  const r = await fetch(url, { headers: { "user-agent": "hotdawgs-nfl-pool" } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

// Upserts rows into a table by its primary key.
async function upsert(table, rows, conflict) {
  if (!rows.length) return 0;
  const r = await fetch(`${SB_URL}/rest/v1/${table}?on_conflict=${conflict}`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      authorization: `Bearer ${SB_KEY}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`${table} upsert HTTP ${r.status}: ${await r.text()}`);
  return rows.length;
}

// ESPN odds text such as "KC -3.5" => { team: "KC", line: -3.5 }. "PK" or missing => null.
function parseOddsDetails(details) {
  const m = /^([A-Z]{2,4})\s+([+-]?\d+(?:\.\d+)?)$/.exec((details || "").trim());
  return m ? { team: m[1], line: Number(m[2]) } : null;
}

const numOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

// ESPN state: pre = scheduled, in = in progress, post = final.
const statusOf = (state) => (state === "post" ? "final" : state === "in" ? "in_progress" : "scheduled");

// Central-time pieces of a moment: weekday, year, month, day, hour.
const ctFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago", weekday: "short", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", hourCycle: "h23",
});
function ctParts(d) {
  const o = {};
  for (const p of ctFmt.formatToParts(d)) o[p.type] = p.value;
  return o;
}

// The most recent Tuesday 12:00 Central at or before kickoff. Picks open and lines lock then.
function lockTimeFor(startIso) {
  const start = new Date(startIso).getTime();
  for (let k = 0; k < 8; k++) {
    const probe = new Date(start - k * 86400e3);
    const p = ctParts(probe);
    if (p.weekday !== "Tue") continue;
    // Noon UTC on that calendar day, then shift so it reads 12:00 in Central
    let t = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), 12);
    const hourAtGuess = Number(ctParts(new Date(t)).hour);
    t -= (hourAtGuess - 12) * 3600e3;
    if (t <= start) return new Date(t).toISOString();
  }
  return null;
}

function gameRow(ev, week) {
  const c = ev.competitions[0];
  const home = c.competitors.find((t) => t.homeAway === "home");
  const away = c.competitors.find((t) => t.homeAway === "away");
  const hAbbr = home.team.abbreviation;
  const aAbbr = away.team.abbreviation;

  // The posted line is for the favorite. Store it from the home team's point of view.
  let spreadHome = null;
  const details = ((c.odds || [])[0]?.details || "").trim();
  if (details.toUpperCase() === "PK") spreadHome = 0; // a pick'em line
  const parsed = parseOddsDetails(details);
  if (parsed) {
    if (parsed.team === hAbbr) spreadHome = parsed.line;
    else if (parsed.team === aAbbr) spreadHome = -parsed.line;
  }

  return {
    id: String(ev.id),
    week,
    start_at: ev.date,
    home: hAbbr,
    away: aAbbr,
    spread_home: spreadHome,
    home_score: numOrNull(home.score),
    away_score: numOrNull(away.score),
    status: statusOf(ev.status?.type?.state),
    // ESPN gives a short forecast (e.g. "Clear, 41°F") for outdoor games; null for domes
    weather: c.weather?.displayValue || null,
    picks_open_at: lockTimeFor(ev.date),
    updated_at: now(),
  };
}

// Locks the line for each game whose Tuesday noon has passed and that hasn't kicked off.
// The line is whatever we last saw at that moment, so it doesn't move after lock.
async function lockLines() {
  const nowIso = encodeURIComponent(now());
  const q = `${SB_URL}/rest/v1/nfl_games?select=id,spread_home&line_locked=eq.false` +
    `&spread_home=not.is.null&picks_open_at=lte.${nowIso}&start_at=gt.${nowIso}`;
  const r = await fetch(q, { headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}` } });
  if (!r.ok) throw new Error(`lock read HTTP ${r.status}`);
  const rows = await r.json();
  for (const g of rows) {
    const p = await fetch(`${SB_URL}/rest/v1/nfl_games?id=eq.${encodeURIComponent(g.id)}`, {
      method: "PATCH",
      headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({ line_locked: true, locked_spread_home: g.spread_home }),
    });
    if (!p.ok) throw new Error(`lock write HTTP ${p.status}`);
  }
  console.log(`lines: locked ${rows.length} new`);
}

// How many games we already have per week, and how many of them are final.
async function existingWeeks() {
  const r = await fetch(`${SB_URL}/rest/v1/nfl_games?select=week,status&limit=10000`, {
    headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`nfl_games read HTTP ${r.status}`);
  const have = {};
  for (const g of await r.json()) {
    have[g.week] ??= { total: 0, final: 0 };
    have[g.week].total++;
    if (g.status === "final") have[g.week].final++;
  }
  return have;
}

// Loads every regular-season week from week 1 to now. Weeks already complete in the
// database are skipped; the current week and any unfinished week are refreshed each run.
async function syncGames() {
  const board = await getJson(`${ESPN}/scoreboard`);
  const current = board.week?.number;
  if (!current) throw new Error("ESPN scoreboard had no week number");

  const have = await existingWeeks();
  const weeks = [];
  for (let w = 1; w <= 18; w++) {
    const h = have[w];
    const complete = h && h.total > 0 && h.final === h.total;
    if (!complete || w >= current) weeks.push(w);
  }

  let total = 0;
  for (const w of weeks) {
    try {
      const data = await getJson(`${ESPN}/scoreboard?seasontype=2&week=${w}`);
      const rows = (data.events || []).map((ev) => gameRow(ev, w));
      total += await upsert("nfl_games", rows, "id");
      console.log(`games: week ${w} -> ${rows.length} games`);
    } catch (err) {
      console.error(`games: week ${w} failed: ${err.message}`);
    }
  }
  console.log(`games: wrote ${total} across ${weeks.length} weeks (current week ${current})`);
}

async function syncNews() {
  const feed = await getJson(`${ESPN}/news?limit=25`);
  const rows = (feed.articles || [])
    .map((a) => {
      const url = a.links?.web?.href || null;
      return {
        id: url || String(a.id),
        kind: "news",
        team: null,
        headline: a.headline,
        summary: a.description || null,
        url,
        published_at: a.published || null,
        updated_at: now(),
      };
    })
    .filter((r) => r.headline && r.id);
  const n = await upsert("nfl_news", rows, "id");
  console.log(`news: wrote ${n}`);
}

// Games matter most, so a news failure shouldn't stop the schedule from updating.
try {
  await syncGames();
} catch (err) {
  console.error("games failed:", err.message);
  process.exitCode = 1;
}
try {
  await lockLines();
} catch (err) {
  console.error("lines failed:", err.message);
  process.exitCode = 1;
}
try {
  await syncNews();
} catch (err) {
  console.error("news failed (games still updated):", err.message);
}
