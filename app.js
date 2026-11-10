// Hotdawgs NFL Pool: sign up / log in, personal home page, pick'em, survivor, commissioner.
// All access goes through the nfl_* Postgres functions in sql/schema.sql. The public key
// can't read passwords or sessions, and the database enforces payment and kickoff locks.

const SB_URL = "https://ecvjuminsfjszwgzfqte.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdmp1bWluc2Zqc3p3Z3pmcXRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5NzA0NTAsImV4cCI6MjEwOTU0NjQ1MH0.iDyN7v21oFkEbJobjbr-u3WCpRO-tgJ7efkd0bBwtVE";
const sb = supabase.createClient(SB_URL, SB_KEY);
const SES = "nfl-session";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const token = () => { try { return localStorage.getItem(SES); } catch (e) { return null; } };
const setToken = (t) => { try { localStorage.setItem(SES, t); } catch (e) {} };
const clearToken = () => { try { localStorage.removeItem(SES); } catch (e) {} };

async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    // Logins last one hour; when one expires, send the player back to the log-in screen
    if (/log in again/i.test(error.message)) { clearToken(); location.reload(); }
    throw new Error(error.message);
  }
  return data;
}

let me = null;
let settings = { venmo_handle: "", entry_fee: "", weekly_prize: "0", survivor_prize: "0", season_start_week: 1, test_season: false, paid_count: 0, announcement: "" };
let view = "picks"; // picks | payouts | news

// ---------- Screens ----------
function show(id) {
  $("#gate").hidden = id !== "gate";
  $("#home").hidden = id !== "home";
  $("#appbar").hidden = id !== "home";
}
function flash(text, ok = false, where = "#msg") {
  const el = $(where);
  el.textContent = text;
  el.className = ok ? "ok" : "err";
}
function showGate(mode = "login") {
  show("gate");
  $("#tab-login").classList.toggle("on", mode === "login");
  $("#tab-join").classList.toggle("on", mode === "join");
  $("#f-login").hidden = mode !== "login";
  $("#f-join").hidden = mode !== "join";
  flash("");
}

// ---------- Start ----------
async function init() {
  try {
    const s = await rpc("nfl_settings");
    if (s && s[0]) settings = s[0];
  } catch (e) { /* settings are optional for the screens to load */ }
  const t = token();
  if (t) {
    try {
      const r = await rpc("nfl_me", { p_token: t });
      if (r && r.length) { me = r[0]; return enter(); }
    } catch (e) { /* fall through to login */ }
  }
  clearToken();
  showGate("login");
}

// ---------- Log in / sign up ----------
async function onLogin(e) {
  e.preventDefault();
  try {
    const t = await rpc("nfl_login", { p_name: $("#l-name").value, p_pass: $("#l-pass").value });
    setToken(t);
    me = (await rpc("nfl_me", { p_token: t }))[0];
    enter();
  } catch (err) { flash(err.message); }
}

async function onJoin(e) {
  e.preventDefault();
  const pass = $("#j-pass").value;
  if (pass !== $("#j-pass2").value) return flash("Those passwords don't match.");
  try {
    const t = await rpc("nfl_signup", {
      p_name: $("#j-name").value,
      p_invite: $("#j-invite").value,
      p_pass: pass,
      p_venmo: $("#j-venmo").value
    });
    setToken(t);
    me = (await rpc("nfl_me", { p_token: t }))[0];
    enter();
  } catch (err) { flash(err.message); }
}

// The egg beer plays every time the app opens while you're logged in.
function enter() {
  show("home");
  render();
  if (window.HD && HD.eggBeer) HD.eggBeer(me.name);
}

function logOut() {
  clearToken();
  location.reload();
}

// ---------- Game helpers ----------
const started = (g) => Date.now() >= Date.parse(g.start_at);
const fmtKick = (g) => new Date(g.start_at).toLocaleString("en-US", {
  weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago"
}) + " CT";

// The line that applies to a game: the locked line once lines lock. Games from before
// line locking keep the line they always had.
// Games with a lock time show no line until it locks, so nobody sees a line that may still move.
const lineOf = (g) => (g.line_locked ? g.locked_spread_home : g.picks_open_at ? null : g.spread_home);
const lineNum = (g) => {
  const v = lineOf(g);
  return v === null || v === undefined || v === "" ? NaN : Number(v);
};

// Spread text from the favourite's point of view.
function spreadText(g) {
  const s = lineNum(g);
  if (isNaN(s)) return g.line_locked || !g.picks_open_at ? "Line not posted yet" : "Line locks Tue 12 PM CT";
  if (s === 0) return "Pick 'em";
  return s < 0 ? `${g.home} -${Math.abs(s)}` : `${g.away} -${Math.abs(s)}`;
}

// Plain-English option (off by default). Saved on this phone.
const plainOn = () => { try { return localStorage.getItem("nfl-plain") === "1"; } catch (e) { return false; } };
const setPlain = (on) => { try { localStorage.setItem("nfl-plain", on ? "1" : "0"); } catch (e) {} };

// One sentence for the game, from the favourite's point of view.
function plainSpread(g) {
  const s = lineNum(g);
  if (isNaN(s)) return "Line not posted yet";
  if (s === 0) return "Pick 'em: the winner gets the pick";
  const fav = s < 0 ? g.home : g.away;
  return `${fav} must win by more than ${Math.abs(s)} to cover`;
}

// Small label under a team button in plain mode.
function plainSide(g, side) {
  const s = lineNum(g);
  if (isNaN(s) || s === 0) return "";
  const m = Math.abs(s);
  const isFav = (side === "home") === (s < 0);
  return isFav ? `Needs to win by more than ${m}` : `Wins, or loses by less than ${m}`;
}

// Which side covered: returns "home", "away", "push", or null if not final.
function covered(g) {
  const line = lineNum(g);
  if (g.status !== "final" || g.home_score == null || g.away_score == null || isNaN(line)) return null;
  const margin = Number(g.home_score) - Number(g.away_score) + line;
  if (margin === 0) return "push";
  return margin > 0 ? "home" : "away";
}

// "2h 14m", "3d 1h" for the lock countdown.
function fmtLeft(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

// First-visit how-to card, hidden after "Got it".
const seenHowTo = () => { try { return localStorage.getItem("nfl-howto") === "1"; } catch (e) { return true; } };
const setHowTo = () => { try { localStorage.setItem("nfl-howto", "1"); } catch (e) {} };

// Swipe right = home team, swipe left = away team. Taps still work as a fallback.
function attachSwipe(el) {
  let x0 = null, y0 = 0;
  el.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    submitPick(el.dataset.gid, dx > 0 ? "home" : "away");
  });
}

// The week to show: the earliest week that still has a game not yet final.
function currentWeek(games) {
  const open = games.filter((g) => g.status !== "final");
  if (open.length) return Math.min(...open.map((g) => g.week));
  return games.length ? Math.max(...games.map((g) => g.week)) : null;
}

// ---------- Home page ----------
async function render() {
  const t = token();
  try {
    // Check the login hasn't run out (one hour) before showing picks
    const still = await rpc("nfl_me", { p_token: t });
    if (!still.length) { clearToken(); return location.reload(); }
    if (view !== "picks") return renderSection();
    await loadProfiles();

    const [games, picks, surv, tbs] = await Promise.all([
      sb.from("nfl_games").select("*").order("start_at"),
      rpc("nfl_picks_visible", { p_token: t }),
      rpc("nfl_survivor_visible", { p_token: t }),
      rpc("nfl_tiebreak_visible", { p_token: t })
    ]);
    if (games.error) throw games.error;

    const all = games.data;
    const week = currentWeek(all);
    const wg = all.filter((g) => g.week === week);
    // The server only sends other players' picks once their game has kicked off
    const mine = picks.filter((p) => p.player === me.name);
    const myPicks = Object.fromEntries(mine.map((p) => [p.game_id, p.side]));
    const survMine = surv.filter((s) => s.player === me.name);
    const survThisWeek = (survMine.find((s) => s.week === week) || {}).team;
    const usedElsewhere = new Set(survMine.filter((s) => s.week !== week).map((s) => s.team));

    // After kickoff, show who took each side (others only; yours is on the button)
    const revealHtml = (g) => {
      if (!started(g)) return "";
      const all = picks.filter((p) => p.game_id === g.id);
      const others = all.filter((p) => p.player !== me.name);
      const names = (side) => others.filter((p) => p.side === side).map((p) => nameHtml(p.player)).join(", ") || "nobody else";
      // Share of the group on each side, counting your own pick too
      const pct = (side) => all.length ? Math.round(100 * all.filter((p) => p.side === side).length / all.length) : 0;
      return `<div class="reveal">Locked. ${esc(g.away)} ${pct("away")}% (${names("away")}) · ${esc(g.home)} ${pct("home")}% (${names("home")})</div>`;
    };

    // Record across every final game you picked
    let won = 0, lost = 0, pushed = 0;
    for (const p of mine) {
      const g = all.find((x) => x.id === p.game_id);
      const c = g && covered(g);
      if (!c) continue;
      if (c === "push") pushed++; else if (c === p.side) won++; else lost++;
    }

    const payBox = me.paid ? "" : `
      <div class="card warn">
        <b>Entry: $${esc(settings.entry_fee)}</b> to <b>${esc(settings.venmo_handle)}</b> on Venmo.
        You can make picks once the commissioner marks you paid.
      </div>`;

    const pickRows = wg.map((g) => {
      const lock = started(g) || !me.paid || !g.line_locked;
      const pick = myPicks[g.id];
      const score = g.status === "final" || g.status === "in_progress"
        ? `<div class="score">${esc(g.away)} ${g.away_score ?? 0} – ${esc(g.home)} ${g.home_score ?? 0}${g.status === "final" ? " (final)" : ""}</div>`
        : started(g) ? "" : `<div class="kick">Locks in ${fmtLeft(Date.parse(g.start_at) - Date.now())} · ${fmtKick(g)}</div>`;
      const reveal = revealHtml(g);
      const wxLine = g.weather ? `<div class="wx">☁️ ${esc(g.weather)}</div>` : "";
      // Filled in by updateLive() every 30 seconds while a game is on
      const liveBox = `<div class="live" data-gid="${esc(g.id)}" data-spread="${lineOf(g) ?? ""}" data-pick="${pick || ""}"></div>`;
      // Before the line locks, say when picks open
      const lineNote = !g.line_locked && !started(g)
        ? `<div class="kick">${g.picks_open_at && Date.now() < Date.parse(g.picks_open_at)
            ? `Lines lock ${fmtKick({ start_at: g.picks_open_at })}`
            : "Waiting for a line to post"}</div>`
        : "";
      const plain = plainOn();
      const btn = (side, abbr) => `<button class="pickbtn ${pick === side ? "on" : ""}" data-game="${esc(g.id)}" data-side="${side}" ${lock ? "disabled" : ""}>${pick === side ? "🌭 " : ""}${esc(abbr)}${plain && plainSide(g, side) ? `<small>${esc(plainSide(g, side))}</small>` : ""}</button>`;
      return `<div class="game" data-gid="${esc(g.id)}" data-lock="${lock ? 1 : 0}">
        <div class="spread">${esc(plain ? plainSpread(g) : spreadText(g))}</div>
        <div class="teams">${btn("away", g.away)}<span>@</span>${btn("home", g.home)}</div>
        ${wxLine}
        ${score}
        ${lineNote}
        ${liveBox}
        ${reveal}
      </div>`;
    }).join("") || `<p class="hint">No games posted for this week yet.</p>`;

    const teams = [...new Set(wg.flatMap((g) => [g.home, g.away]))].sort();
    const survRows = teams.map((tm) => {
      const used = usedElsewhere.has(tm);
      const g = wg.find((x) => x.home === tm || x.away === tm);
      const lock = !me.paid || (g && started(g));
      return `<button class="teambtn ${survThisWeek === tm ? "on" : ""}" data-team="${esc(tm)}" ${used || lock ? "disabled" : ""}>${survThisWeek === tm ? "🏈 " : ""}${esc(tm)}${used ? " 🥚" : ""}</button>`;
    }).join("") || `<p class="hint">No games posted yet.</p>`;

    $("#home-body").innerHTML = `
      <p class="hint greet">Hi ${esc(me.name)} · pick'em record ${won}-${lost}${pushed ? `-${pushed}` : ""}</p>
      ${payBox}
      ${settings.announcement ? `<div class="card ann"><b>📣 From the commissioner</b><p class="hint">${esc(settings.announcement)}</p></div>` : ""}
      <div id="msg2"></div>
      ${seenHowTo() ? "" : `<div class="card howto">
        <b>How it works</b>
        <p class="hint">1. Each game has a spread. Pick the team you think covers it.<br>
        2. Swipe right for the home team, left for the away team (or tap).<br>
        3. Picks lock at kickoff. Until then you can change them, and nobody sees yours.<br>
        4. Survivor: pick one team a week. You can't reuse a team, and a loss knocks you out.</p>
        <button class="btn" id="howto-ok" type="button">Got it</button>
      </div>`}
      <h2>Week ${esc(week)} · Pick'em</h2>
      <label class="toggle"><input type="checkbox" id="plain-toggle" ${plainOn() ? "checked" : ""}> Plain-English spreads</label>
      <p class="hint">Pick the side that covers the spread.</p>
      ${pickRows}
      ${tiebreakHtml(wg, tbs, week)}
      <h2>Week ${esc(week)} · Survivor</h2>
      <p class="hint">One team per week. You can't reuse a team. ${survThisWeek ? `This week: <b>${esc(survThisWeek)}</b>` : "No team picked yet."}</p>
      <div class="teamgrid">${survRows}</div>
      <div id="admin"></div>`;

    bindTabs();
    if ($("#tb-save")) $("#tb-save").onclick = () => saveTiebreak(week);
    refreshLive().then(updateLive);
    $("#plain-toggle").onchange = (e) => { setPlain(e.target.checked); render(); };
    if ($("#howto-ok")) $("#howto-ok").onclick = () => { setHowTo(); render(); };
    document.querySelectorAll(".game[data-lock='0']").forEach(attachSwipe);
    document.querySelectorAll(".pickbtn:not([disabled])").forEach((b) => b.onclick = () => submitPick(b.dataset.game, b.dataset.side));
    document.querySelectorAll(".teambtn:not([disabled])").forEach((b) => b.onclick = () => submitSurvivor(week, b.dataset.team));

    if (me.is_admin) renderAdmin(t);
  } catch (err) {
    flash(err.message, false, "#msg2");
  }
}

async function submitPick(gameId, side) {
  try {
    await rpc("nfl_pick", { p_token: token(), p_game_id: gameId, p_side: side });
    render();
  } catch (err) { flash(err.message, false, "#msg2"); }
}

async function submitSurvivor(week, team) {
  try {
    await rpc("nfl_survivor_pick", { p_token: token(), p_week: week, p_team: team });
    render();
  } catch (err) { flash(err.message, false, "#msg2"); }
}

// ---------- Tabs: Picks, Payouts, News ----------
const VIEWS = [["picks", "Picks"], ["standings", "Standings"], ["payouts", "Payouts"], ["news", "News"], ["chat", "Chat"], ["profile", "Profile"]];
function tabsHtml() {
  return `<nav class="tabs">${VIEWS.map(([k, l]) => `<button type="button" data-view="${k}" class="${view === k ? "on" : ""}">${l}</button>`).join("")}</nav>`;
}
// The side menu holds the section links. Tapping one closes the menu and shows that section.
function bindTabs() {
  document.querySelectorAll("#drawer-nav [data-view]").forEach((b) => b.onclick = () => {
    view = b.dataset.view;
    draft = null;
    closeDrawer();
    paintNav();
    render();
  });
}
const openDrawer = () => document.body.classList.add("drawer-open");
const closeDrawer = () => document.body.classList.remove("drawer-open");
function paintNav() {
  document.querySelectorAll("#drawer-nav [data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
}

// Payouts and news are their own screens; picks keeps the full home page above.
async function renderSection() {
  const header = `<p class="hint greet">Hi ${esc(me.name)}</p>`;
  let body;
  await loadProfiles();
  try {
    body = view === "profile" ? profileHtml()
      : view === "payouts" ? await payoutsHtml()
      : view === "standings" ? await standingsHtml()
      : view === "chat" ? await chatHtml()
      : await newsHtml();
  }
  catch (err) { body = `<p class="err">${esc(err.message)}</p>`; }
  $("#home-body").innerHTML = header + `<div id="msg2"></div><div>${body}</div>`;
  bindTabs();
  if (view === "chat") bindChat();
  if (view === "profile") bindProfile();
}

// ---------- Pool chat ----------
const fmtChatTime = (iso) => new Date(iso).toLocaleString("en-US", {
  weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago"
});

async function chatHtml() {
  return `
    <h2>Pool chat</h2>
    <div class="card">
      <div id="chat-list"><p class="hint">Loading…</p></div>
      <form id="chat-form" class="chatform">
        <input type="text" id="chat-in" maxlength="500" placeholder="Say something…" autocomplete="off">
        <button class="btn" type="submit">Send</button>
      </form>
      <p class="hint">Be nice. The commissioner can delete any message.</p>
    </div>`;
}

function bindChat() {
  $("#chat-form").onsubmit = async (e) => {
    e.preventDefault();
    const input = $("#chat-in");
    const body = input.value.trim();
    if (!body) return;
    try {
      await rpc("nfl_chat_post", { p_token: token(), p_body: body });
      input.value = "";
      loadChat();
    } catch (err) { flash(err.message, false, "#msg2"); }
  };
  loadChat();
}

async function loadChat() {
  const box = $("#chat-list");
  if (!box) return;
  try {
    const rows = await rpc("nfl_chat_list", { p_token: token() });
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
    box.innerHTML = rows.map((m) => `
      <div class="msg ${m.is_mine ? "mine" : ""}">
        <div class="meta">${nameHtml(m.player)} <span class="hint">${fmtChatTime(m.created_at)}</span>
          ${m.can_delete ? `<button class="linkbtn tiny" data-del="${m.id}" type="button">Delete</button>` : ""}</div>
        <div>${esc(m.body)}</div>
      </div>`).join("") || `<p class="hint">No messages yet. Say hi 👋</p>`;
    if (atBottom) box.scrollTop = box.scrollHeight;
    box.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => deleteMsg(b.dataset.del));
  } catch (err) { box.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
}

async function deleteMsg(id) {
  if (!confirm("Delete this message?")) return;
  try {
    await rpc("nfl_chat_delete", { p_token: token(), p_id: Number(id) });
    loadChat();
  } catch (err) { flash(err.message, false, "#msg2"); }
}

// Best-guess payouts: a flat amount for each week's pick'em winner, and a bigger survivor prize.
// Winners are worked out from the final results. Ties split the weekly prize.
async function payoutsHtml() {
  const s = settings;
  const [games, picks] = await Promise.all([
    sb.from("nfl_games").select("*").order("start_at"),
    rpc("nfl_picks_visible", { p_token: token() })
  ]);
  if (games.error) throw games.error;
  const all = games.data;
  const weekly = Number(s.weekly_prize) || 0;
  const pot = s.paid_count * (Number(s.entry_fee) || 0);
  const start = Number(s.season_start_week) || 1;

  const weekRows = [];
  for (let w = start; w <= 18; w++) {
    const wg = all.filter((g) => g.week === w);
    if (!wg.length) { weekRows.push(`<div class="card pay"><b>Week ${w}</b><div class="hint">Not posted yet · $${weekly} to the weekly winner(s)</div></div>`); continue; }
    const done = wg.every((g) => g.status === "final");
    const tally = {};
    for (const p of picks) {
      const g = wg.find((x) => x.id === p.game_id);
      const c = g && covered(g);
      if (!c) continue;
      tally[p.player] = tally[p.player] || 0;
      if (c !== "push" && c === p.side) tally[p.player]++;
    }
    const best = Math.max(0, ...Object.values(tally));
    const winners = Object.keys(tally).filter((n) => tally[n] === best && best > 0);
    const each = winners.length ? (weekly / winners.length).toFixed(2) : null;
    const status = done
      ? (winners.length ? `${best} right · ${winners.map((n) => nameHtml(n)).join(", ")} · $${each} each` : "No picks scored")
      : "Games still in progress";
    weekRows.push(`<div class="card pay"><b>Week ${w}</b><div class="hint">${status}</div></div>`);
  }

  const note = s.test_season && start > 1
    ? `<div class="card warn"><b>Test season:</b> weeks 1 to ${start - 1} have no picks and no payouts.</div>`
    : "";
  return `
    <h2>Payouts</h2>
    <div class="card">
      <b>Pot so far:</b> ${s.paid_count} paid × $${esc(s.entry_fee)} = <b>$${pot}</b>
      <div class="hint">Weekly winner: <b>$${weekly}</b> each week · Survivor winner: <b>$${esc(s.survivor_prize)}</b></div>
    </div>
    ${note}
    <h2>Weekly pick'em</h2>
    ${weekRows.join("")}
    <h2>Survivor</h2>
    <div class="card pay"><b>Survivor winner: $${esc(s.survivor_prize)}</b><div class="hint">Survivor elimination isn't tracked yet, so the winner shows here once it is.</div></div>`;
}

// Injuries and news, filled by the news feed job (not connected yet).
async function newsHtml() {
  const { data, error } = await sb.from("nfl_news").select("*").order("published_at", { ascending: false }).limit(40);
  if (error) throw error;
  if (!data.length) {
    return `<h2>Injuries & news</h2><div class="card"><p class="hint">Nothing posted yet. Injury reports and headlines will show up here once the news feed is connected.</p></div>`;
  }
  const items = data.map((n) => `
    <div class="card news-item">
      <span class="tag ${n.kind}">${n.kind === "injury" ? "Injury" : "News"}</span>${n.team ? ` <b>${esc(n.team)}</b>` : ""}
      <h3>${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.headline)}</a>` : esc(n.headline)}</h3>
      ${n.summary ? `<p class="hint">${esc(n.summary)}</p>` : ""}
    </div>`).join("");
  return `<h2>Injuries & news</h2>${items}`;
}

// ---------- Live covering: live scores from ESPN, checked against each player's own pick ----------
const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
let liveScores = {}; // game id -> { state, detail, home, away, hs, as }

async function refreshLive() {
  try {
    const r = await fetch(ESPN_SCOREBOARD, { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    const next = {};
    for (const ev of d.events || []) {
      const c = ev.competitions?.[0];
      if (!c) continue;
      const h = c.competitors.find((t) => t.homeAway === "home");
      const a = c.competitors.find((t) => t.homeAway === "away");
      next[String(ev.id)] = {
        state: ev.status?.type?.state,
        detail: ev.status?.type?.shortDetail || "",
        home: h?.team?.abbreviation, away: a?.team?.abbreviation,
        hs: Number(h?.score ?? 0), as: Number(a?.score ?? 0),
      };
    }
    liveScores = next;
  } catch (e) { /* keep the last scores we had */ }
}

// Covering = home score - away score + home spread, judged on your side.
function updateLive() {
  document.querySelectorAll(".live[data-gid]").forEach((el) => {
    const L = liveScores[el.dataset.gid];
    if (!L || L.state !== "in") { el.innerHTML = ""; return; }
    const scoreLine = `<div class="livescore">${esc(L.away)} ${L.as} – ${esc(L.home)} ${L.hs} · ${esc(L.detail)}</div>`;
    const spread = el.dataset.spread === "" ? null : Number(el.dataset.spread);
    const side = el.dataset.pick;
    let pickLine = "";
    if (side && spread !== null && !isNaN(spread)) {
      const margin = L.hs - L.as + spread;
      if (margin === 0) pickLine = `<div class="livepick">Exactly on the number</div>`;
      else {
        const covering = side === "home" ? margin > 0 : margin < 0;
        pickLine = `<div class="livepick ${covering ? "ok" : "err"}">${covering ? "Covering" : "Not covering"} by ${Math.abs(margin)}</div>`;
      }
    }
    el.innerHTML = scoreLine + pickLine;
  });
}

// ---------- Profiles: avatar, favorite team, and how names show ----------
const AVATARS = ["🏈", "🌭", "🥚", "🍺", "🦅", "🐻", "🐯", "🦁", "🐺", "🚀", "⚡", "🔥", "🎯", "👑", "🧀", "🐂"];
const TEAMS = ["ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LV", "LAC", "LAR", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SF", "SEA", "TB", "TEN", "WSH"];
let profiles = {};   // name -> { avatar, favorite_team, display_mode }
let draft = null;    // profile edits in progress

async function loadProfiles() {
  try {
    const rows = await rpc("nfl_profiles");
    profiles = Object.fromEntries(rows.map((p) => [p.name, p]));
  } catch (e) { /* keep the last ones we had */ }
}

// A steady colour per favorite team, so the same team always looks the same.
const teamColor = (team) => {
  if (!team) return "#8a7a66";
  let h = 0;
  for (const ch of team) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 62%, 42%)`;
};

// A player's name as shown everywhere: name, avatar, or both, with a favorite-team tag.
function nameHtml(name, p = profiles[name] || {}) {
  const mode = p.display_mode || "both";
  const team = p.favorite_team;
  const badge = `<span class="av" style="background:${teamColor(team)}" title="${esc(name)}">${esc(p.avatar || "🏈")}</span>`;
  const tag = team ? ` <span class="tm">${esc(team)}</span>` : "";
  if (mode === "avatar") return `${badge}${tag}`;
  if (mode === "name") return `<b>${esc(name)}</b>${tag}`;
  return `${badge}<b>${esc(name)}</b>${tag}`;
}

function profileHtml() {
  if (!draft) {
    const p = profiles[me.name] || {};
    draft = { avatar: p.avatar || "🏈", team: p.favorite_team || "", mode: p.display_mode || "both" };
  }
  return `
    <h2>Your profile</h2>
    <div class="card">
      <div class="preview">${nameHtml(me.name, { avatar: draft.avatar, favorite_team: draft.team || null, display_mode: draft.mode })}</div>
      <label>Avatar</label>
      <div class="avgrid">${AVATARS.map((a) => `<button type="button" class="avpick ${a === draft.avatar ? "on" : ""}" data-av="${a}">${a}</button>`).join("")}</div>
      <label for="pf-team">Favorite team</label>
      <select id="pf-team" class="teamsel">
        <option value="">None</option>
        ${TEAMS.map((t) => `<option value="${t}" ${t === draft.team ? "selected" : ""}>${t}</option>`).join("")}
      </select>
      <label>Show my name as</label>
      <div class="modes">
        ${[["both", "Avatar and name"], ["avatar", "Avatar only"], ["name", "Name only"]]
          .map(([v, l]) => `<button type="button" class="modebtn ${draft.mode === v ? "on" : ""}" data-mode="${v}">${l}</button>`).join("")}
      </div>
      <button class="btn" id="pf-save" type="button">Save profile</button>
    </div>`;
}

function bindProfile() {
  const paint = () => {
    document.querySelectorAll(".avpick").forEach((b) => b.classList.toggle("on", b.dataset.av === draft.avatar));
    document.querySelectorAll(".modebtn").forEach((b) => b.classList.toggle("on", b.dataset.mode === draft.mode));
    const pv = document.querySelector(".preview");
    if (pv) pv.innerHTML = nameHtml(me.name, { avatar: draft.avatar, favorite_team: draft.team || null, display_mode: draft.mode });
  };
  document.querySelectorAll(".avpick").forEach((b) => b.onclick = () => { draft.avatar = b.dataset.av; paint(); });
  document.querySelectorAll(".modebtn").forEach((b) => b.onclick = () => { draft.mode = b.dataset.mode; paint(); });
  $("#pf-team").onchange = (e) => { draft.team = e.target.value; paint(); };
  $("#pf-save").onclick = saveProfile;
  paint();
}

async function saveProfile() {
  try {
    await rpc("nfl_set_profile", {
      p_token: token(), p_avatar: draft.avatar, p_favorite_team: draft.team || null, p_display_mode: draft.mode
    });
    draft = null;
    await loadProfiles();
    renderSection();
  } catch (err) { flash(err.message, false, "#msg2"); }
}

// ---------- Shared helpers for results ----------
// What happened to a team's game: "win", "loss", "push", or null if not final yet.
function teamResult(g, team) {
  if (g.status !== "final" || g.home_score == null || g.away_score == null) return null;
  const hs = Number(g.home_score), as = Number(g.away_score);
  if (hs === as) return "push";
  return (hs > as ? g.home : g.away) === team ? "win" : "loss";
}

// Weekly pick'em winners for one week: most correct picks, ties share.
function weekWinners(w, all, picks) {
  const wg = all.filter((g) => g.week === w);
  const tally = {};
  for (const p of picks) {
    const g = wg.find((x) => x.id === p.game_id);
    const c = g && covered(g);
    if (!c) continue;
    tally[p.player] = tally[p.player] || 0;
    if (c !== "push" && c === p.side) tally[p.player]++;
  }
  const best = Math.max(0, ...Object.values(tally));
  const names = Object.keys(tally).filter((n) => tally[n] === best && best > 0);
  return { best, names, done: wg.length > 0 && wg.every((g) => g.status === "final") };
}

// Monday night tiebreaker: who guessed closest to the last game's total.
function tiebreakWinner(w, all, tbs) {
  const wg = all.filter((g) => g.week === w);
  const last = wg.slice().sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at))[0];
  if (!last || last.status !== "final") return null;
  const total = Number(last.home_score) + Number(last.away_score);
  const guesses = tbs.filter((t) => t.week === w);
  if (!guesses.length) return null;
  const closest = Math.min(...guesses.map((t) => Math.abs(t.points - total)));
  const names = guesses.filter((t) => Math.abs(t.points - total) === closest).map((t) => t.player);
  return { total, names, last };
}

// ---------- Monday night tiebreaker card (picks screen) ----------
function tiebreakHtml(wg, tbs, week) {
  const last = wg.slice().sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at))[0];
  if (!last) return "";
  const mine = tbs.find((t) => t.player === me.name && t.week === week);
  const locked = started(last);
  // Other players' guesses show once the last game kicks off
  const others = locked ? tbs.filter((t) => t.week === week && t.player !== me.name) : [];
  const othersLine = others.length
    ? `<p class="hint">Guesses: ${others.map((t) => `${nameHtml(t.player)} ${t.points}`).join(" · ")}</p>` : "";
  return `
    <h2>Monday tiebreaker</h2>
    <div class="card">
      <p class="hint">Guess the combined final score of ${esc(last.away)} @ ${esc(last.home)}. The closest guess wins ties.</p>
      ${locked
        ? `<p><b>Locked.</b> Your guess: ${mine ? mine.points : "none"}</p>${othersLine}`
        : `<div class="tbrow">
             <input type="text" inputmode="numeric" id="tb-pts" placeholder="Total points" value="${mine ? mine.points : ""}">
             <button class="btn" id="tb-save" type="button">Save</button>
           </div>`}
    </div>`;
}

async function saveTiebreak(week) {
  const v = $("#tb-pts").value.trim();
  if (v === "") return flash("Enter a total first.", false, "#msg2");
  try {
    await rpc("nfl_set_tiebreak", { p_token: token(), p_week: week, p_points: Number(v) });
    render();
  } catch (err) { flash(err.message, false, "#msg2"); }
}

// ---------- Standings: season record, streaks, survivor alive list, recap, my picks ----------
async function standingsHtml() {
  const [games, picks, surv, tbs] = await Promise.all([
    sb.from("nfl_games").select("*").order("start_at"),
    rpc("nfl_picks_visible", { p_token: token() }),
    rpc("nfl_survivor_visible", { p_token: token() }),
    rpc("nfl_tiebreak_visible", { p_token: token() })
  ]);
  if (games.error) throw games.error;
  const all = games.data;
  const start = Number(settings.season_start_week) || 1;
  const weeks = [...new Set(all.map((g) => g.week))].filter((w) => w >= start).sort((a, b) => a - b);
  const finalWeeks = weeks.filter((w) => all.filter((g) => g.week === w).every((g) => g.status === "final"));

  // Pick'em record and current streak, in game order
  const rec = {};
  const decided = picks
    .map((p) => ({ p, g: all.find((x) => x.id === p.game_id) }))
    .filter((x) => x.g && covered(x.g))
    .sort((a, b) => Date.parse(a.g.start_at) - Date.parse(b.g.start_at));
  for (const { p, g } of decided) {
    const r = (rec[p.player] = rec[p.player] || { w: 0, l: 0, p: 0, streak: 0 });
    const c = covered(g);
    if (c === "push") { r.p++; r.streak = 0; }
    else if (c === p.side) { r.w++; r.streak = r.streak > 0 ? r.streak + 1 : 1; }
    else { r.l++; r.streak = r.streak < 0 ? r.streak - 1 : -1; }
  }
  const standings = Object.entries(rec).sort((a, b) => b[1].w - a[1].w || a[1].l - b[1].l);
  const streakTag = (s) => s >= 3 ? ` 🔥 ${s} in a row` : s <= -3 ? ` ❄️ ${-s} losing` : "";
  const standingRows = standings.map(([name, r], i) => `
    <div class="srow"><span>${i + 1}. ${nameHtml(name)}</span><b>${r.w}-${r.l}${r.p ? `-${r.p}` : ""}</b><span class="hint">${streakTag(r.streak)}</span></div>`).join("")
    || `<p class="hint">No decided picks yet.</p>`;

  // Last finished week's recap
  const lastDone = finalWeeks[finalWeeks.length - 1];
  let recap = `<p class="hint">No finished week yet.</p>`;
  if (lastDone) {
    const wk = weekWinners(lastDone, all, picks);
    const tb = tiebreakWinner(lastDone, all, tbs);
    recap = `<p><b>Week ${lastDone}:</b> ${wk.names.length ? `${wk.names.map((n) => nameHtml(n)).join(", ")} with ${wk.best} right` : "no picks scored"}</p>
      ${tb ? `<p class="hint">Tiebreaker: ${tb.names.map((n) => nameHtml(n)).join(", ")} (total ${tb.total})</p>` : ""}`;
  }

  // Survivor: alive players, and when everyone else went out
  const survPlayers = [...new Set(surv.map((s) => s.player))];
  const survStatus = {};
  for (const pl of survPlayers) {
    let alive = true, outWeek = null;
    for (const w of finalWeeks) {
      const pick = surv.find((s) => s.player === pl && s.week === w);
      const g = pick && all.find((x) => x.week === w && (x.home === pick.team || x.away === pick.team));
      const res = pick && g ? teamResult(g, pick.team) : null;
      if (res !== "win") { alive = false; outWeek = w; break; }
    }
    survStatus[pl] = { alive, outWeek };
  }
  const alive = survPlayers.filter((pl) => survStatus[pl].alive);
  const out = survPlayers.filter((pl) => !survStatus[pl].alive);
  const survRow = (pl, text) => `<div class="srow"><span>${nameHtml(pl)}</span><span class="hint">${text}</span></div>`;
  const survHtml = survPlayers.length
    ? `<div class="card"><p><b>Alive (${alive.length})</b></p>${alive.map((pl) => survRow(pl, "still in")).join("") || `<p class="hint">Nobody left.</p>`}
       <p><b>Out (${out.length})</b></p>${out.map((pl) => survRow(pl, `out in week ${survStatus[pl].outWeek}`)).join("")}</div>`
    : `<p class="hint">No survivor picks yet.</p>`;

  // My picks, most recent first
  const myRows = decided
    .filter((x) => x.p.player === me.name)
    .reverse()
    .map(({ p, g }) => {
      const c = covered(g);
      const res = c === "push" ? "push" : c === p.side ? "✅ win" : "❌ loss";
      const pick = p.side === "home" ? g.home : g.away;
      return `<div class="srow"><span>Wk ${g.week} · ${esc(pick)}</span><span class="hint">${esc(g.away)} @ ${esc(g.home)}</span><b>${res}</b></div>`;
    }).join("") || `<p class="hint">No decided picks yet.</p>`;

  return `
    <h2>Pick'em standings</h2>
    <div class="card">${standingRows}</div>
    <h2>This week's leader</h2>
    <div class="card">${recap}</div>
    <h2>Survivor</h2>
    ${survHtml}
    <h2>My picks</h2>
    <div class="card">${myRows}</div>`;
}

// ---------- Commissioner: export and audit log ----------
async function exportCsv() {
  try {
    const [games, picks, surv] = await Promise.all([
      sb.from("nfl_games").select("*"),
      rpc("nfl_picks_visible", { p_token: token() }),
      rpc("nfl_survivor_visible", { p_token: token() })
    ]);
    if (games.error) throw games.error;
    const gm = Object.fromEntries(games.data.map((g) => [g.id, g]));
    const rows = [["week", "player", "game", "pick", "result"]];
    for (const p of picks) {
      const g = gm[p.game_id];
      if (!g) continue;
      const c = covered(g);
      const result = !c ? "" : c === "push" ? "push" : c === p.side ? "win" : "loss";
      rows.push([g.week, p.player, `${g.away} @ ${g.home}`, p.side === "home" ? g.home : g.away, result]);
    }
    for (const s of surv) rows.push([s.week, s.player, "survivor", s.team, ""]);
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "nfl-pool-picks.csv";
    a.click();
  } catch (err) { flash(err.message, false, "#msg2"); }
}

// ---------- Commissioner: who has paid ----------
async function renderAdmin() {
  const box = $("#admin");
  try {
    const players = await rpc("nfl_admin_players", { p_token: token() });
    const paidCount = players.filter((p) => p.paid).length;
    box.innerHTML = `
      <h2>Commissioner · Settings</h2>
      <div class="card">
        <label for="s-venmo">Venmo handle</label>
        <input type="text" id="s-venmo" autocapitalize="none" value="${esc(settings.venmo_handle)}">
        <label for="s-fee">Entry fee ($)</label>
        <input type="text" id="s-fee" inputmode="decimal" value="${esc(settings.entry_fee)}">
        <label for="s-weekly">Weekly prize, each week ($)</label>
        <input type="text" id="s-weekly" inputmode="decimal" value="${esc(settings.weekly_prize)}">
        <label for="s-survivor">Survivor prize ($)</label>
        <input type="text" id="s-survivor" inputmode="decimal" value="${esc(settings.survivor_prize)}">
        <label for="s-ann">Announcement (shown to everyone, 280 characters max)</label>
        <input type="text" id="s-ann" value="${esc(settings.announcement)}">
        <label for="s-invite">Group password (new players need it to join)</label>
        <input type="text" id="s-invite" autocomplete="off" autocapitalize="none" placeholder="Leave blank to keep the current one">
        <button class="btn" id="s-save" type="button">Save settings</button>
      </div>

      <h2>Commissioner · Paid (${paidCount} of ${players.length})</h2>
      <p class="hint">Check each player off once their $${esc(settings.entry_fee)} Venmo arrives.</p>
      <button class="btn" id="csv-btn" type="button">Download picks (CSV)</button>
      <div class="card">${players.map((p) => `
        <label class="paidrow">
          <input type="checkbox" data-name="${esc(p.name)}" ${p.paid ? "checked" : ""}>
          <span>${esc(p.name)} <span class="hint">@${esc(p.venmo)}</span></span>
        </label>`).join("")}</div>`;

    box.querySelectorAll("input[type=checkbox]").forEach((cb) => cb.onchange = async () => {
      try {
        await rpc("nfl_set_paid", { p_token: token(), p_name: cb.dataset.name, p_paid: cb.checked });
        renderAdmin();
      } catch (err) { cb.checked = !cb.checked; flash(err.message, false, "#msg2"); }
    });
    $("#s-save").onclick = saveSettings;
    $("#csv-btn").onclick = exportCsv;

    // Recent commissioner activity
    const log = await rpc("nfl_admin_audit", { p_token: token() });
    box.insertAdjacentHTML("beforeend", `
      <h2>Commissioner · Activity</h2>
      <div class="card">${log.map((a) => `<div class="srow"><span class="hint">${new Date(a.logged_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })}</span><span>${esc(a.actor)} ${esc(a.action)}${a.detail ? `: ${esc(a.detail)}` : ""}</span></div>`).join("") || `<p class="hint">No activity yet.</p>`}</div>`);
  } catch (err) { box.innerHTML = ""; }
}

// Saves whichever settings changed. Blank group password = keep the current one.
async function saveSettings() {
  const t = token();
  const venmo = $("#s-venmo").value.trim();
  const fee = $("#s-fee").value.trim();
  const invite = $("#s-invite").value.trim();
  const weekly = $("#s-weekly").value.trim();
  const survivor = $("#s-survivor").value.trim();
  const ann = $("#s-ann").value.trim();
  try {
    if (ann !== settings.announcement) await rpc("nfl_admin_set_config", { p_token: t, p_key: "announcement", p_value: ann });
    if (venmo !== settings.venmo_handle) await rpc("nfl_admin_set_config", { p_token: t, p_key: "venmo_handle", p_value: venmo });
    if (fee !== settings.entry_fee) await rpc("nfl_admin_set_config", { p_token: t, p_key: "entry_fee", p_value: fee });
    if (weekly !== settings.weekly_prize) await rpc("nfl_admin_set_config", { p_token: t, p_key: "weekly_prize", p_value: weekly });
    if (survivor !== settings.survivor_prize) await rpc("nfl_admin_set_config", { p_token: t, p_key: "survivor_prize", p_value: survivor });
    if (invite) await rpc("nfl_admin_set_config", { p_token: t, p_key: "invite", p_value: invite });
    const s = await rpc("nfl_settings");
    if (s && s[0]) settings = s[0];
    flash("Settings saved.", true, "#msg2");
    renderAdmin();
  } catch (err) { flash(err.message, false, "#msg2"); }
}

// ---------- Wire up ----------
document.addEventListener("DOMContentLoaded", () => {
  // Side menu: build the links, then wire the menu button, backdrop and log out
  $("#drawer-nav").innerHTML = VIEWS.map(([k, l]) => `<button type="button" data-view="${k}">${l}</button>`).join("");
  paintNav();
  bindTabs();
  $("#menu-btn").onclick = openDrawer;
  $("#scrim").onclick = closeDrawer;
  $("#logout-drawer").onclick = () => { closeDrawer(); logOut(); };
  $("#tab-login").onclick = () => showGate("login");
  $("#tab-join").onclick = () => showGate("join");
  $("#f-login").onsubmit = onLogin;
  $("#f-join").onsubmit = onJoin;
  init();
  // Keep the lock countdowns current while the app is open
  setInterval(() => { if (me && !$("#home").hidden && !document.hidden) render(); }, 60000);
  // Chat refreshes every 20 seconds while it's open
  setInterval(() => {
    if (me && view === "chat" && !$("#home").hidden && !document.hidden) loadChat();
  }, 20000);
  // Live scores every 30 seconds, updating only the covering lines on the page
  setInterval(() => {
    if (me && view === "picks" && !$("#home").hidden && !document.hidden) refreshLive().then(updateLive);
  }, 30000);
});
