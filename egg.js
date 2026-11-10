// The NFL version of the egg beer: a football drops into a beer, the beer gets chugged,
// and a big splash says TOUCHDOWN! Plays every time the app opens while logged in.
// About 4.3 seconds. Tap anywhere to skip. Respects "Reduce Motion".

(function () {
  const style = document.createElement("style");
  style.textContent = `
    .egg-ov { position: fixed; inset: 0; z-index: 200; display: flex; flex-direction: column; align-items: center;
      justify-content: center; background: radial-gradient(circle at 50% 40%, #fff6e3 0%, #ffd77a 70%, #f2b33d 100%);
      animation: eggFadeIn .25s ease-out; cursor: pointer; }
    .egg-ov.out { animation: eggFadeOut .35s ease-in forwards; }
    @keyframes eggFadeIn { from { opacity: 0; } }
    @keyframes eggFadeOut { to { opacity: 0; transform: scale(1.04); } }
    .egg-ov svg { width: min(68vw, 260px); height: auto; overflow: visible; }
    .egg-cap { margin-top: 12px; font-family: "Rockwell", Georgia, serif; font-weight: 900; font-size: 26px;
      color: #8f1d1d; text-align: center; min-height: 34px; padding: 0 20px; }
    .egg-sub { font-weight: 800; font-size: 13px; color: #5a3b14; opacity: .7; margin-top: 6px; }

    /* 0–0.9s: the egg drops in */
    .egg-egg { transform-box: fill-box; transform-origin: center; animation: eggDrop .9s cubic-bezier(.5,0,.9,.5) forwards; }
    @keyframes eggDrop { 0% { transform: translateY(-230px) rotate(-25deg); } 85% { opacity: 1; }
      100% { transform: translateY(78px) rotate(10deg); opacity: 0; } }
    /* Splash and the yolk sinking */
    .egg-splash { opacity: 0; transform-box: fill-box; transform-origin: center bottom; animation: eggSplash .5s ease-out .82s forwards; }
    @keyframes eggSplash { 0% { opacity: 1; transform: scale(.3); } 100% { opacity: 0; transform: scale(2.6) translateY(-18px); } }
    /* The TOUCHDOWN! burst, popping in right after the splash */
    .egg-td { opacity: 0; font-family: Rockwell, Georgia, serif; font-weight: 900; font-size: 27px; fill: #D92B2B;
      stroke: #fff6e3; stroke-width: 7px; paint-order: stroke; text-anchor: middle;
      transform-box: fill-box; transform-origin: center; animation: eggTD .5s cubic-bezier(.2,1.6,.4,1) .9s forwards; }
    @keyframes eggTD { 0% { opacity: 0; transform: scale(.2) rotate(-8deg); } 100% { opacity: 1; transform: scale(1) rotate(-6deg); } }
    .egg-yolk { opacity: 0; animation: eggYolk 1.2s ease-in .85s forwards; }
    @keyframes eggYolk { 0% { opacity: 1; transform: translateY(0); } 100% { opacity: 1; transform: translateY(56px); } }
    /* 1.4–3.1s: tilt and chug */
    .egg-glass { transform-box: fill-box; transform-origin: 50% 40%; animation: eggTilt 1.7s ease-in-out 1.4s forwards; }
    @keyframes eggTilt { 0% { transform: rotate(0); } 20% { transform: translateY(-14px) rotate(-24deg); }
      82% { transform: translateY(-18px) rotate(-32deg); } 100% { transform: translateY(0) rotate(0); } }
    .egg-beer { transform-box: view-box; animation: eggDrain 1.2s ease-in 1.75s forwards; }
    @keyframes eggDrain { to { transform: translateY(150px); } }
    .egg-bub { animation: eggBub 1s ease-in infinite; }
    .egg-bub:nth-child(2) { animation-delay: .3s; } .egg-bub:nth-child(3) { animation-delay: .6s; }
    @keyframes eggBub { from { transform: translateY(0); opacity: .9; } to { transform: translateY(-60px); opacity: 0; } }
    .egg-gulp { opacity: 0; font-weight: 900; font-size: 22px; fill: #8f1d1d; animation: eggGulp 1.4s ease-out 1.8s forwards; }
    @keyframes eggGulp { 0%, 100% { opacity: 0; } 20%, 80% { opacity: 1; } }
    .egg-slam { transform-box: fill-box; transform-origin: center bottom; animation: eggSlam .3s ease-out 3.05s; }
    @keyframes eggSlam { 50% { transform: scale(1.08, .92); } }
    @media (prefers-reduced-motion: reduce) {
      .egg-ov *, .egg-ov { animation-duration: .01s !important; animation-delay: 0s !important; }
    }
  `;
  document.head.appendChild(style);

  const LINES = [
    "Down the hatch. Now go make your picks.",
    "Raw egg, cold beer, hot dawgs. Breakfast of champions.",
    "Lay the points or take the dog. Chug first.",
    "Shell check: clean. You're cleared to pick.",
    "Cover the spread and the beer tastes better."
  ];
  const SVG = `
  <svg viewBox="0 0 200 260" aria-hidden="true">
    <ellipse cx="100" cy="250" rx="58" ry="7" fill="#000" opacity=".12"/>
    <g class="egg-slam"><g class="egg-glass">
      <defs><clipPath id="eggClip"><path d="M52 60 L148 60 L140 236 Q100 244 60 236 Z"/></clipPath></defs>
      <g clip-path="url(#eggClip)">
        <g class="egg-beer">
          <rect x="40" y="86" width="120" height="170" fill="#f4a51c"/>
          <rect x="40" y="86" width="120" height="170" fill="url(#eggShine)" opacity=".35"/>
          <g fill="#fff3c4"><circle class="egg-bub" cx="80" cy="220" r="3"/><circle class="egg-bub" cx="112" cy="200" r="2.5"/><circle class="egg-bub" cx="96" cy="230" r="2"/></g>
          <path d="M44 88 Q60 70 76 84 Q92 66 108 82 Q124 66 140 84 Q152 74 158 88 L158 100 L44 100 Z" fill="#fffaf0"/>
          <g class="egg-yolk">
            <ellipse cx="102" cy="110" rx="15" ry="9" transform="rotate(-25 102 110)" fill="#8B4513" stroke="#3a2a1a" stroke-width="1.5"/>
            <path d="M94 116 L110 104 M97 113 L100 110 M103 107 L106 104 M99 108 L103 112" stroke="#fff" stroke-width="1.6" stroke-linecap="round" transform="rotate(-25 102 110)"/>
          </g>
        </g>
      </g>
      <defs><linearGradient id="eggShine" x1="0" x2="1"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
      <path d="M52 60 L148 60 L140 236 Q100 244 60 236 Z" fill="none" stroke="#3a2a1a" stroke-width="5" stroke-linejoin="round"/>
      <path d="M62 72 L68 220" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55"/>
    </g></g>
    <g class="egg-splash" fill="#fffaf0" stroke="#3a2a1a" stroke-width="2">
      <circle cx="78" cy="78" r="6"/><circle cx="124" cy="74" r="7"/><circle cx="100" cy="66" r="5"/><circle cx="140" cy="84" r="4"/>
    </g>
    <g class="egg-egg"><ellipse cx="102" cy="40" rx="17" ry="22" fill="#fffdf7" stroke="#3a2a1a" stroke-width="4"/>
      <ellipse cx="96" cy="32" rx="5" ry="7" fill="#fff" opacity=".9"/></g>
    <text class="egg-td" x="100" y="34">TOUCHDOWN!</text>
    <text class="egg-gulp" x="150" y="30">GLUG</text>
    <text class="egg-gulp" x="0" y="20" style="animation-delay:2.3s">GLUG</text>
  </svg>`;

  function eggBeer(name) {
    if (document.querySelector(".egg-ov")) return;
    const ov = document.createElement("div");
    ov.className = "egg-ov";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "Welcome animation. Tap to skip.");
    ov.innerHTML = SVG + `<div class="egg-cap">Touchdown${name ? ", " + name : ""}! 🏈🍺</div><div class="egg-sub">Tap to skip</div>`;
    document.body.appendChild(ov);
    const cap = ov.querySelector(".egg-cap");
    const t1 = setTimeout(() => { cap.textContent = "Chug! Chug! Chug!"; }, 1500);
    const t2 = setTimeout(() => { cap.textContent = LINES[Math.floor(Math.random() * LINES.length)]; }, 3050);
    let gone = false;
    const close = () => {
      if (gone) return; gone = true;
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      ov.classList.add("out");
      setTimeout(() => ov.remove(), 360);
    };
    const t3 = setTimeout(close, 4300);
    ov.addEventListener("click", close);
    if (navigator.vibrate) try { setTimeout(() => navigator.vibrate([30, 60, 30]), 3050); } catch (e) {}
  }

  window.HD = Object.assign(window.HD || {}, { eggBeer });
})();
