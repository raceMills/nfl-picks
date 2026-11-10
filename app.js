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

// Spread text from the favourite's point of view.
function spreadText(g) {
  const s = Number(g.spread_home);
  if (g.spread_home === null || isNaN(s)) return "No line yet";
  if (s === 0) return "Pick 'em";
  return s < 0 ? `${g.home} -${Math.abs(s)}` : `${g.away} -${Math.abs(s)}`;
}

// Plain-English option (off by default). Saved on this phone.
const plainOn = () => { try { return localStorage.getItem("nfl-plain") === "1"; } catch (e) { return false; } };
const setPlain = (on) => { try { localStorage.setItem("nfl-plain", on ? "1" : "0"); } catch (e) {} };

// One sentence for the game, from the favourite's point of view.
function plainSpread(g) {
  const s = Number(g.spread_home);
  if (g.spread_home === null || isNaN(s)) return "No line yet";
  if (s === 0) return "Pick 'em: the winner gets the pick";
  const fav = s < 0 ? g.home : g.away;
  return `${fav} must win by more than ${Math.abs(s)} to cover`;
}

// Small label under a team button in plain mode.
function plainSide(g, side) {
  const s = Number(g.spread_home);
  if (g.spread_home === null || isNaN(s) || s === 0) return "";
  const m = Math.abs(s);
  const isFav = (side === "home") === (s < 0);
  return isFav ? `Needs to win by more than ${m}` : `Wins, or loses by less than ${m}`;
}

// Which side covered: returns "home", "away", "push", or null if not final.
function covered(g) {
  if (g.status !== "final" || g.home_score == null || g.away_score == null || g.spread_home == null) return null;
  const margin = Number(g.home_score) - Number(g.away_score) + Number(g.spread_home);
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

    const [games, picks, surv] = await Promise.all([
      sb.from("nfl_games").select("*").order("start_at"),
      rpc("nfl_picks_visible", { p_token: t }),
      rpc("nfl_survivor_visible", { p_token: t })
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
      const rows = picks.filter((p) => p.game_id === g.id && p.player !== me.name);
      const names = (side) => rows.filter((p) => p.side === side).map((p) => esc(p.player)).join(", ") || "nobody else";
      return `<div class="reveal">Locked. ${esc(g.away)}: ${names("away")} · ${esc(g.home)}: ${names("home")}</div>`;
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
      const lock = started(g) || !me.paid;
      const pick = myPicks[g.id];
      const score = g.status === "final" || g.status === "in_progress"
        ? `<div class="score">${esc(g.away)} ${g.away_score ?? 0} – ${esc(g.home)} ${g.home_score ?? 0}${g.status === "final" ? " (final)" : ""}</div>`
        : started(g) ? "" : `<div class="kick">Locks in ${fmtLeft(Date.parse(g.start_at) - Date.now())} · ${fmtKick(g)}</div>`;
      const reveal = revealHtml(g);
      const plain = plainOn();
      const btn = (side, abbr) => `<button class="pickbtn ${pick === side ? "on" : ""}" data-game="${esc(g.id)}" data-side="${side}" ${lock ? "disabled" : ""}>${pick === side ? "🌭 " : ""}${esc(abbr)}${plain && plainSide(g, side) ? `<small>${esc(plainSide(g, side))}</small>` : ""}</button>`;
      return `<div class="game" data-gid="${esc(g.id)}" data-lock="${lock ? 1 : 0}">
        <div class="spread">${esc(plain ? plainSpread(g) : spreadText(g))}</div>
        <div class="teams">${btn("away", g.away)}<span>@</span>${btn("home", g.home)}</div>
        ${score}
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
      <header class="top">
        <div><h1>🌭 Hotdawgs NFL Pool</h1><p class="hint">Hi ${esc(me.name)} · pick'em record ${won}-${lost}${pushed ? `-${pushed}` : ""}</p></div>
        <button class="linkbtn" id="logout">Log out</button>
      </header>
      ${payBox}
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
      <h2>Week ${esc(week)} · Survivor</h2>
      <p class="hint">One team per week. You can't reuse a team. ${survThisWeek ? `This week: <b>${esc(survThisWeek)}</b>` : "No team picked yet."}</p>
      <div class="teamgrid">${survRows}</div>
      <div id="admin"></div>`;

    $("#logout").onclick = logOut;
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
  // Keep the lock countdowns current while the app is open
  setInterval(() => { if (me && !$("#home").hidden && !document.hidden) render(); }, 60000);
});
