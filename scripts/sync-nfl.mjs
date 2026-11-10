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

function gameRow(ev, week) {
  const c = ev.competitions[0];
  const home = c.competitors.find((t) => t.homeAway === "home");
  const away = c.competitors.find((t) => t.homeAway === "away");
  const hAbbr = home.team.abbreviation;
  const aAbbr = away.team.abbreviation;

  // The posted line is for the favorite. Store it from the home team's point of view.
  let spreadHome = null;
  const parsed = parseOddsDetails((c.odds || [])[0]?.details);
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
    updated_at: now(),
  };
}

async function syncGames() {
  const board = await getJson(`${ESPN}/scoreboard`);
  const week = board.week?.number;
  if (!week) throw new Error("ESPN scoreboard had no week number");
  const rows = (board.events || []).map((ev) => gameRow(ev, week));
  const n = await upsert("nfl_games", rows, "id");
  console.log(`games: wrote ${n} for week ${week}`);
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
  await syncNews();
} catch (err) {
  console.error("news failed (games still updated):", err.message);
}
