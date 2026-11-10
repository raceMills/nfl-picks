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
  if (error) throw new Error(error.message);
  return data;
}

let me = null;
let settings = { venmo_handle: "", entry_fee: "" };

// ---------- Screens ----------
function show(id) {
  $("#gate").hidden = id !== "gate";
  $("#home").hidden = id !== "home";
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
      if (r && r.length) { me = r[0]; return enter(false); }
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
    enter(true);
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
    enter(true);
  } catch (err) { flash(err.message); }
}

function enter(justLoggedIn) {
  show("home");
  render();
  if (justLoggedIn && window.HD && HD.eggBeer) HD.eggBeer(me.name);
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

// Spread text from the favourite's point of view.
function spreadText(g) {
  const s = Number(g.spread_home);
  if (g.spread_home === null || isNaN(s)) return "No line yet";
  if (s === 0) return "Pick 'em";
  return s < 0 ? `${g.home} -${Math.abs(s)}` : `${g.away} -${Math.abs(s)}`;
}

// Which side covered: returns "home", "away", "push", or null if not final.
function covered(g) {
  if (g.status !== "final" || g.home_score == null || g.away_score == null || g.spread_home == null) return null;
  const margin = Number(g.home_score) - Number(g.away_score) + Number(g.spread_home);
  if (margin === 0) return "push";
  return margin > 0 ? "home" : "away";
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
    const [games, picks, surv] = await Promise.all([
      sb.from("nfl_games").select("*").order("start_at"),
      sb.from("nfl_picks").select("*").eq("player", me.name),
      sb.from("nfl_survivor").select("*").eq("player", me.name)
    ]);
    if (games.error) throw games.error;
    if (picks.error) throw picks.error;
    if (surv.error) throw surv.error;

    const all = games.data;
    const week = currentWeek(all);
    const wg = all.filter((g) => g.week === week);
    const myPicks = Object.fromEntries(picks.data.map((p) => [p.game_id, p.side]));
    const survThisWeek = (surv.data.find((s) => s.week === week) || {}).team;
    const usedElsewhere = new Set(surv.data.filter((s) => s.week !== week).map((s) => s.team));

    // Record across every final game you picked
    let won = 0, lost = 0, pushed = 0;
    for (const p of picks.data) {
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
      const lock = started(g) || !me.paid;
      const pick = myPicks[g.id];
      const score = g.status === "final" || g.status === "in_progress"
        ? `<div class="score">${esc(g.away)} ${g.away_score ?? 0} – ${esc(g.home)} ${g.home_score ?? 0}${g.status === "final" ? " (final)" : ""}</div>`
        : `<div class="kick">${fmtKick(g)}</div>`;
      const btn = (side, abbr) => `<button class="pickbtn ${pick === side ? "on" : ""}" data-game="${esc(g.id)}" data-side="${side}" ${lock ? "disabled" : ""}>${esc(abbr)}</button>`;
      return `<div class="game">
        <div class="spread">${esc(spreadText(g))}</div>
        <div class="teams">${btn("away", g.away)}<span>@</span>${btn("home", g.home)}</div>
        ${score}
      </div>`;
    }).join("") || `<p class="hint">No games posted for this week yet.</p>`;

    const teams = [...new Set(wg.flatMap((g) => [g.home, g.away]))].sort();
    const survRows = teams.map((tm) => {
      const used = usedElsewhere.has(tm);
      const g = wg.find((x) => x.home === tm || x.away === tm);
      const lock = !me.paid || (g && started(g));
      return `<button class="teambtn ${survThisWeek === tm ? "on" : ""}" data-team="${esc(tm)}" ${used || lock ? "disabled" : ""}>${esc(tm)}${used ? " ✕" : ""}</button>`;
    }).join("") || `<p class="hint">No games posted yet.</p>`;

    $("#home-body").innerHTML = `
      <header class="top">
        <div><h1>Hotdawgs NFL Pool</h1><p class="hint">Hi ${esc(me.name)} · pick'em record ${won}-${lost}${pushed ? `-${pushed}` : ""}</p></div>
        <button class="linkbtn" id="logout">Log out</button>
      </header>
      ${payBox}
      <div id="msg2"></div>
      <h2>Week ${esc(week)} · Pick'em</h2>
      <p class="hint">Pick the side that covers the spread.</p>
      ${pickRows}
      <h2>Week ${esc(week)} · Survivor</h2>
      <p class="hint">One team per week. You can't reuse a team. ${survThisWeek ? `This week: <b>${esc(survThisWeek)}</b>` : "No team picked yet."}</p>
      <div class="teamgrid">${survRows}</div>
      <div id="admin"></div>`;

    $("#logout").onclick = logOut;
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
        <label for="s-invite">Group password (new players need it to join)</label>
        <input type="text" id="s-invite" autocomplete="off" autocapitalize="none" placeholder="Leave blank to keep the current one">
        <button class="btn" id="s-save" type="button">Save settings</button>
      </div>

      <h2>Commissioner · Paid (${paidCount} of ${players.length})</h2>
      <p class="hint">Check each player off once their $${esc(settings.entry_fee)} Venmo arrives.</p>
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
  } catch (err) { box.innerHTML = ""; }
}

// Saves whichever settings changed. Blank group password = keep the current one.
async function saveSettings() {
  const t = token();
  const venmo = $("#s-venmo").value.trim();
  const fee = $("#s-fee").value.trim();
  const invite = $("#s-invite").value.trim();
  try {
    if (venmo !== settings.venmo_handle) await rpc("nfl_admin_set_config", { p_token: t, p_key: "venmo_handle", p_value: venmo });
    if (fee !== settings.entry_fee) await rpc("nfl_admin_set_config", { p_token: t, p_key: "entry_fee", p_value: fee });
    if (invite) await rpc("nfl_admin_set_config", { p_token: t, p_key: "invite", p_value: invite });
    const s = await rpc("nfl_settings");
    if (s && s[0]) settings = s[0];
    flash("Settings saved.", true, "#msg2");
    renderAdmin();
  } catch (err) { flash(err.message, false, "#msg2"); }
}

// ---------- Wire up ----------
document.addEventListener("DOMContentLoaded", () => {
  $("#tab-login").onclick = () => showGate("login");
  $("#tab-join").onclick = () => showGate("join");
  $("#f-login").onsubmit = onLogin;
  $("#f-join").onsubmit = onJoin;
  init();
});
