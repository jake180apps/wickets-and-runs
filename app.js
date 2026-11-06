import {
  beginSecondInnings,
  createMatch,
  project,
  reviveMatch,
  throwDart,
  undo,
} from "./logic.js";

const MATCH_KEY = "wicketsRuns.match.v1";
const SETUP_KEY = "wicketsRuns.setup.v1";

const app = document.getElementById("app");
const liveRegion = document.getElementById("live-region");

const state = {
  offer: null,
  rules: false,
  confirm: null,
};

let match = null;
let draft = { side1: "Player 1", side2: "Player 2", wickets: 10, bats: null };
let multiplier = 1;
let pendingAnnounce = "";

app.addEventListener("click", onClick);
app.addEventListener("input", onInput);
app.addEventListener("submit", onSubmit);
document.addEventListener("keydown", onKey);

boot();

function boot() {
  draft = loadDraft();
  state.offer = loadOffer();
  render();
  registerServiceWorker();
}

function onClick(event) {
  if (event.target.classList?.contains("overlay")) {
    state.rules = false;
    state.confirm = null;
    render();
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;

  if (action === "mult") {
    multiplier = Number(button.dataset.mult);
    render();
    return;
  }
  if (action === "number") {
    record({ type: "number", multiplier, value: Number(button.dataset.value) });
    return;
  }
  if (action === "outer" || action === "inner" || action === "miss") {
    record({ type: action });
    return;
  }
  if (action === "undo") {
    doUndo();
    return;
  }
  if (action === "rules") {
    state.confirm = null;
    state.rules = true;
    render();
    return;
  }
  if (action === "close-rules" || action === "close-confirm") {
    state.rules = false;
    state.confirm = null;
    render();
    return;
  }
  if (action === "ask-new" || action === "again") {
    askNew();
    return;
  }
  if (action === "confirm-new") {
    clearMatch();
    return;
  }
  if (action === "wickets") {
    draft.wickets = Number(button.dataset.wickets) === 11 ? 11 : 10;
    persistDraft();
    render();
    return;
  }
  if (action === "bats") {
    draft.bats = button.dataset.bats === "random" ? "random" : Number(button.dataset.bats);
    render();
    return;
  }
  if (action === "resume" || action === "resume-saved") {
    if (state.offer) resume(state.offer);
    return;
  }
  if (action === "discard") {
    discardOffer();
    return;
  }
  if (action === "second") {
    startSecond();
    return;
  }
  if (action === "confirm-replace") {
    commitStart();
  }
}

function onInput(event) {
  if (event.target.id === "side1") draft.side1 = event.target.value;
  if (event.target.id === "side2") draft.side2 = event.target.value;
  const first = document.getElementById("bats-0");
  const second = document.getElementById("bats-1");
  if (first) first.querySelector(".choice-name").textContent = clean(draft.side1) || "Player 1";
  if (second) second.querySelector(".choice-name").textContent = clean(draft.side2) || "Player 2";
  persistDraft();
}

function onSubmit(event) {
  event.preventDefault();
  requestStart();
}

function onKey(event) {
  if (event.key === "Escape" && (state.rules || state.confirm)) {
    state.rules = false;
    state.confirm = null;
    render();
    return;
  }
  if (event.key !== "Tab") return;
  const dialog = document.querySelector("[data-modal]");
  if (!dialog) return;
  const items = [...dialog.querySelectorAll("button, input, a")].filter((item) => !item.disabled);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function requestStart() {
  if (draft.bats !== 0 && draft.bats !== 1 && draft.bats !== "random") return;
  if (state.offer) {
    state.confirm = "replace";
    render();
    return;
  }
  commitStart();
}

function commitStart() {
  let battingFirst = draft.bats;
  let toss = "pick";
  if (draft.bats === "random") {
    battingFirst = Math.random() < 0.5 ? 0 : 1;
    toss = "random";
  }
  match = createMatch({
    sides: [draft.side1, draft.side2],
    wickets: draft.wickets,
    battingFirst,
    toss,
  });
  state.offer = null;
  state.confirm = null;
  state.rules = false;
  multiplier = 1;
  persistMatch();
  const name = match.sides[battingFirst];
  pendingAnnounce = toss === "random" ? `Random pick. ${name} bats first.` : `${name} bats first.`;
  render();
}

function record(dart) {
  if (!match) return;
  const before = project(match);
  try {
    match = throwDart(match, dart);
  } catch {
    return;
  }
  multiplier = 1;
  const after = project(match);
  pendingAnnounce = announceChange(before, after);
  persistMatch();
  render();
}

function doUndo() {
  if (!match || match.events.length === 0) return;
  match = undo(match);
  multiplier = 1;
  pendingAnnounce = "Last dart undone.";
  persistMatch();
  render();
}

function startSecond() {
  if (!match) return;
  try {
    match = beginSecondInnings(match);
  } catch {
    return;
  }
  multiplier = 1;
  const view = project(match);
  pendingAnnounce = `${view.sides[view.battingSide]} to bat.`;
  persistMatch();
  render();
}

function askNew() {
  const view = match ? project(match) : null;
  if (!view || view.phase === "done") {
    clearMatch();
    return;
  }
  state.confirm = "new";
  render();
}

function clearMatch() {
  match = null;
  state.offer = null;
  state.confirm = null;
  state.rules = false;
  multiplier = 1;
  draft.bats = null;
  persistMatch();
  pendingAnnounce = "";
  render();
}

function resume(saved) {
  match = saved;
  state.offer = null;
  state.confirm = null;
  multiplier = 1;
  pendingAnnounce = resumeText(project(match));
  render();
}

function discardOffer() {
  state.offer = null;
  try {
    localStorage.removeItem(MATCH_KEY);
  } catch {
    /* Storage can be blocked. The offer is already hidden. */
  }
  render();
}

function render() {
  const view = match ? project(match) : null;
  const screen = screenOf(view);
  const previous = document.body.dataset.screen;
  let body = renderSetup();
  if (screen === "live") body = renderLive(view);
  if (screen === "break") body = renderBreak(view);
  if (screen === "result") body = renderResult(view);
  app.innerHTML = body + (state.rules ? rulesModal() : "") + (state.confirm ? confirmModal() : "");
  document.body.dataset.screen = screen;
  if (state.rules || state.confirm) {
    const screenEl = app.querySelector(".screen");
    if (screenEl) screenEl.inert = true;
    app.querySelector("[data-modal] button")?.focus();
  }
  if (previous && previous !== screen) window.scrollTo(0, 0);
  if (pendingAnnounce && liveRegion) {
    liveRegion.textContent = pendingAnnounce;
    pendingAnnounce = "";
  }
  document.title = screen === "live" ? `${view.sides[view.throwingSide]} · Wickets & Runs` : "Wickets & Runs";
}

function screenOf(view) {
  if (!view) return "setup";
  if (view.phase === "break") return "break";
  if (view.phase === "done") return "result";
  return "live";
}

function renderSetup() {
  const ready = draft.bats === 0 || draft.bats === 1 || draft.bats === "random";
  return `
    <div class="screen screen-setup">
      ${topbar(null)}
      <div class="setup-grid">
        <div class="setup-intro">
          <img src="./icons/icon.svg" width="72" height="72" alt="">
          <h1>Wickets &amp; Runs</h1>
          <p>English cricket darts for two sides. One batting innings each. Not the 15–20 closing game.</p>
        </div>
        <form class="setup-form" id="setup-form">
          ${offerCard()}
          <label class="field">
            <span>Side 1</span>
            <input id="side1" maxlength="24" autocomplete="off" autocapitalize="words" enterkeyhint="next" value="${esc(draft.side1)}">
          </label>
          <label class="field">
            <span>Side 2</span>
            <input id="side2" maxlength="24" autocomplete="off" autocapitalize="words" enterkeyhint="done" value="${esc(draft.side2)}">
          </label>
          <fieldset>
            <legend>Wickets</legend>
            <div class="choice" role="group" aria-label="Wickets">
              ${wicketChoice(10)}
              ${wicketChoice(11)}
            </div>
          </fieldset>
          <fieldset>
            <legend>Who bats first</legend>
            <div class="choice choice-3">
              ${batsChoice(0)}
              ${batsChoice(1)}
              <button type="button" data-action="bats" data-bats="random" class="${draft.bats === "random" ? "is-on" : ""}" aria-pressed="${draft.bats === "random"}">
                <span class="choice-name">Random</span>
                <small>Throw for the bull</small>
              </button>
            </div>
          </fieldset>
          <button type="submit" class="primary" ${ready ? "" : "disabled"}>Start match</button>
        </form>
      </div>
    </div>`;
}

function renderLive(view) {
  const bowling = view.visitRole === "bowler";
  const armed = multiplier === 2 ? " Double is armed." : multiplier === 3 ? " Triple is armed." : "";
  const hint = bowling
    ? "Bowling. Only a bull takes a wicket. Any other number is off target."
    : "Batting. Runs are the visit total above 40. A bull is a wicket and scores 0.";
  return `
    <div class="screen screen-live">
      ${topbar(view)}
      <div class="play">
        <section class="score-col" aria-label="Scoreboard">
          <div class="cards">
            ${sideCard(view, 0)}
            ${sideCard(view, 1)}
          </div>
          ${tossLine(view)}
          ${chaseBanner(view)}
          ${throwBar(view)}
          ${visitBox(view)}
        </section>
        <section class="pad-col" aria-label="Dart entry">
          <p class="hint">${hint}${armed}</p>
          ${pad(view)}
        </section>
      </div>
    </div>`;
}

function renderBreak(view) {
  const name = view.sides[view.battingSide];
  const next = view.sides[view.bowlingSide];
  const total = view.runs[view.battingSide];
  return `
    <div class="screen screen-break">
      ${topbar(view)}
      <div class="stage">
        <p class="eyebrow">Innings closed</p>
        <p class="stage-name">${esc(name)}</p>
        <h1>All out for ${total}</h1>
        <p class="stage-lead">Roles reverse</p>
        <p class="stage-copy">${esc(next)} will bat. ${esc(name)} will bowl.</p>
        ${miniScores(view)}
        ${closingVisit(view)}
        <div class="stage-actions">
          <button type="button" class="primary" data-action="second">Start second innings</button>
          <button type="button" class="texty" data-action="undo">Undo last dart</button>
        </div>
      </div>
    </div>`;
}

function renderResult(view) {
  const result = view.result;
  const title = result.type === "draw" ? "Match drawn" : `${view.sides[result.side]} won`;
  const detail = result.type === "draw"
    ? `Both sides scored ${view.runs[0]}.`
    : `By ${plural(result.margin, "run")}.`;
  const first = view.battingFirst;
  return `
    <div class="screen screen-result">
      ${topbar(view)}
      <div class="stage">
        <p class="eyebrow">Match result</p>
        <h1>${esc(title)}</h1>
        <p class="stage-lead">${esc(detail)}</p>
        <div class="result-scores">
          ${resultCard(view, first, "1st innings")}
          ${resultCard(view, 1 - first, "2nd innings")}
        </div>
        <div class="stage-actions">
          <button type="button" class="primary" data-action="again">Play again</button>
          <button type="button" class="texty" data-action="undo">Undo last dart</button>
        </div>
      </div>
    </div>`;
}

function topbar(view) {
  const sub = !view
    ? "Cricket darts"
    : view.phase === "done"
      ? "Match over"
      : `${view.innings === 1 ? "1st" : "2nd"} innings`;
  const fresh = !view;
  return `
    <header class="topbar">
      <div class="brand">
        <img src="./icons/icon.svg" width="36" height="36" alt="">
        <div>
          <p class="brand-name">Wickets &amp; Runs</p>
          <p class="brand-sub">${sub}</p>
        </div>
      </div>
      <div class="top-actions">
        <button type="button" class="texty" data-action="rules">Rules</button>
        ${fresh ? "" : `<button type="button" class="texty" data-action="ask-new">New game</button>`}
      </div>
    </header>`;
}

function sideCard(view, index) {
  const throwing = view.throwingSide === index;
  const batting = view.battingSide === index;
  const name = view.sides[index];
  let caption = "1st innings";
  if (batting) caption = view.innings === 1 ? "1st innings" : "2nd innings";
  else if (view.innings === 1) caption = "Yet to bat";
  const pending = batting && view.pendingRuns > 0
    ? `<span class="pending">+${view.pendingRuns}<span class="pending-label">pending</span></span>`
    : "";
  return `
    <article class="card ${throwing ? "is-throwing" : ""} ${batting ? "is-batting" : "is-bowling"}" ${throwing ? 'aria-current="true"' : ""}>
      <header class="card-top">
        <h2 class="side-name" title="${esc(name)}">${esc(name)}</h2>
        <span class="role ${batting ? "role-bat" : "role-bowl"}">${batting ? "Batting" : "Bowling"}</span>
      </header>
      <div class="scoreline">
        <p class="score">${view.runs[index]}</p>
        ${pending}
      </div>
      <p class="caption">${caption}</p>
      ${batting ? pipRow(view) : ""}
      ${throwing ? `<p class="throwing-flag">Throwing</p>` : ""}
    </article>`;
}

function pipRow(view) {
  const standing = view.wicketsRemaining;
  const setting = view.wicketsSetting;
  let pips = "";
  for (let i = 0; i < setting; i += 1) {
    pips += `<span class="pip ${i < standing ? "is-up" : "is-down"}"></span>`;
  }
  return `
    <div class="wickets">
      <div class="pips" role="img" aria-label="${standing} of ${setting} wickets standing">${pips}</div>
      <p class="wicket-count">${standing} of ${setting}</p>
    </div>`;
}

function tossLine(view) {
  if (view.canUndo || view.innings !== 1) return "";
  const name = view.sides[view.battingFirst];
  const how = view.toss === "random" ? "Random pick. " : "";
  return `<p class="toss">${how}${esc(name)} bats first.</p>`;
}

function chaseBanner(view) {
  const chase = view.chase;
  if (!chase || view.phase !== "live") return "";
  let main = `Needs ${chase.needed} more to win`;
  let sub = `Target ${chase.target}`;
  if (chase.status === "ahead") {
    main = `Ahead by ${plural(chase.aheadBy, "run")} — already won`;
    sub = "Play on until all out. This lead cannot be caught.";
  } else if (chase.status === "level") {
    main = "Level — needs 1 more to win";
  }
  if (chase.status !== "ahead" && view.pendingRuns > 0) {
    const projected = chase.battingRuns + view.pendingRuns;
    if (projected > chase.opponentRuns) {
      sub = `${plural(view.pendingRuns, "run")} in this visit would take the lead once banked`;
    } else if (projected === chase.opponentRuns) {
      sub = `${plural(view.pendingRuns, "run")} in this visit would level the scores once banked`;
    } else {
      sub = `${plural(view.pendingRuns, "run")} waiting in this visit · target ${chase.target}`;
    }
  }
  return `
    <div class="chase is-${chase.status}" role="status">
      <p class="chase-main">${main}</p>
      <p class="chase-sub">${sub}</p>
    </div>`;
}

function throwBar(view) {
  const name = view.sides[view.throwingSide];
  const batting = view.visitRole === "batter";
  const left = view.dartsLeft;
  return `
    <div class="throwbar ${batting ? "is-batting" : "is-bowling"}">
      <div>
        <p class="eyebrow">Now throwing</p>
        <p class="throw-name">${esc(name)}</p>
      </div>
      <span class="role ${batting ? "role-bat" : "role-bowl"}">${batting ? "Batting" : "Bowling"}</span>
      <div class="darts-left">
        ${dartPips(view.dartsThrown, batting)}
        <p>${left} ${left === 1 ? "dart" : "darts"} left</p>
      </div>
    </div>`;
}

function dartPips(thrown) {
  let pips = `<div class="dart-pips" aria-hidden="true">`;
  for (let i = 0; i < 3; i += 1) pips += `<span class="dart-pip ${i < thrown ? "is-used" : ""}"></span>`;
  return `${pips}</div>`;
}

function visitBox(view) {
  return `
    <div class="visitbox">
      <div class="slots">${slotsHtml(view.visit, "—")}</div>
      <p class="maths ${view.visitRole}">${visitMaths(view)}</p>
      ${lastLine(view)}
    </div>`;
}

function visitMaths(view) {
  if (view.visitRole === "bowler") {
    return `Wickets this visit <strong>${view.wicketsThisVisit}</strong>`;
  }
  if (view.visit.length === 0) return "Runs start above 40 for the visit";
  const wickets = view.wicketsThisVisit ? ` · ${plural(view.wicketsThisVisit, "wicket")}` : "";
  const word = view.pendingRuns === 1 ? "run" : "runs";
  return `Visit ${view.visitPoints} − 40 = <strong>${view.pendingRuns}</strong> ${word}${wickets}`;
}

function lastLine(view) {
  const last = view.lastVisit;
  if (!last || view.visit.length > 0) return "";
  if (last.role === "batter") {
    const wickets = last.wickets ? ` · ${plural(last.wickets, "wicket")}` : "";
    const runs = last.runs === 0 ? "no runs" : plural(last.runs, "run");
    return `<p class="last-visit">Last visit ${last.points} · ${runs} banked${wickets}</p>`;
  }
  return `<p class="last-visit">Last visit · ${plural(last.wickets, "wicket")}</p>`;
}

function closingVisit(view) {
  const closing = view.closingVisit;
  if (!closing) return "";
  const summary = closing.role === "batter"
    ? `Last visit ${closing.points} · ${closing.runs === 0 ? "no runs" : plural(closing.runs, "run")} banked`
    : `Last visit · ${plural(closing.wickets, "wicket")}`;
  return `
    <div class="visitbox">
      <div class="slots">${slotsHtml(closing.darts, "Not thrown")}</div>
      <p class="last-visit">${summary}</p>
    </div>`;
}

function slotsHtml(darts, emptyLabel) {
  return [0, 1, 2].map((index) => slotHtml(darts[index], index, emptyLabel)).join("");
}

function slotHtml(dart, index, emptyLabel) {
  if (!dart) {
    return `<div class="slot"><span class="slot-index">Dart ${index + 1}</span><span class="slot-empty">${emptyLabel}</span></div>`;
  }
  return `
    <div class="slot is-${dart.kind}">
      <span class="slot-index">Dart ${index + 1}</span>
      <span class="slot-label">${esc(dart.label)}</span>
      <span class="slot-note">${esc(dart.note)}</span>
    </div>`;
}

function pad(view) {
  const buttons = [];
  const word = multiplier === 2 ? "Double" : multiplier === 3 ? "Triple" : "Single";
  const tag = multiplier === 2 ? "D" : multiplier === 3 ? "T" : "";
  for (let value = 1; value <= 20; value += 1) {
    buttons.push(`
      <button type="button" class="num" data-action="number" data-value="${value}" aria-label="${word} ${value}">
        ${tag ? `<span class="ntag">${tag}</span>` : ""}
        <span class="nval">${value}</span>
      </button>`);
  }
  return `
    <div class="pad ${view.visitRole === "bowler" ? "is-bowling" : "is-batting"}" data-mult="${multiplier}">
      <div class="mults" role="group" aria-label="Multiplier">
        ${multButton(1, "Single")}
        ${multButton(2, "Double")}
        ${multButton(3, "Triple")}
      </div>
      <div class="nums">${buttons.join("")}</div>
      <div class="actions">
        <button type="button" class="bull bull-outer" data-action="outer">Outer bull<span>25 · 1 wicket</span></button>
        <button type="button" class="bull bull-inner" data-action="inner">Inner bull<span>50 · 2 wickets</span></button>
        <button type="button" data-action="miss">Miss</button>
        <button type="button" data-action="undo" ${view.canUndo ? "" : "disabled"}>Undo</button>
      </div>
    </div>`;
}

function multButton(value, label) {
  const on = multiplier === value;
  return `<button type="button" class="mult ${on ? "is-on" : ""}" data-action="mult" data-mult="${value}" aria-pressed="${on}">${label}</button>`;
}

function miniScores(view) {
  return `
    <div class="mini-scores">
      ${miniCard(view, 0)}
      ${miniCard(view, 1)}
    </div>`;
}

function miniCard(view, index) {
  return `
    <article class="card">
      <h2 class="side-name">${esc(view.sides[index])}</h2>
      <p class="score">${view.runs[index]}</p>
    </article>`;
}

function resultCard(view, index, label) {
  const won = view.result.type === "win" && view.result.side === index;
  return `
    <article class="card ${won ? "is-winner" : ""}">
      <h2 class="side-name">${esc(view.sides[index])}</h2>
      <p class="score">${view.runs[index]}</p>
      <p class="caption">${label}${won ? " · won" : ""}</p>
    </article>`;
}

function wicketChoice(value) {
  const on = draft.wickets === value;
  return `<button type="button" data-action="wickets" data-wickets="${value}" class="${on ? "is-on" : ""}" aria-pressed="${on}">${value}</button>`;
}

function batsChoice(index) {
  const on = draft.bats === index;
  const name = clean(index === 0 ? draft.side1 : draft.side2) || `Player ${index + 1}`;
  return `
    <button type="button" id="bats-${index}" data-action="bats" data-bats="${index}" class="${on ? "is-on" : ""}" aria-pressed="${on}">
      <span class="choice-name">${esc(name)}</span>
      <small>Bats first</small>
    </button>`;
}

function offerCard() {
  if (!state.offer) return "";
  let text = "A match is saved on this tablet.";
  try {
    text = resumeText(project(state.offer));
  } catch {
    /* Keep the generic line if the save cannot be read. */
  }
  return `
    <div class="offer">
      <p class="offer-kicker">Saved match</p>
      <p>${esc(text)}</p>
      <div class="offer-actions">
        <button type="button" class="primary" data-action="resume">Resume</button>
        <button type="button" class="texty" data-action="discard">Discard</button>
      </div>
    </div>`;
}

function rulesModal() {
  return `
    <div class="overlay">
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="rules-title" data-modal>
        <div class="sheet-head">
          <h2 id="rules-title">Rules</h2>
          <button type="button" class="texty" data-action="close-rules">Close</button>
        </div>
        <div class="rules-body">
          <section>
            <h3>Sides</h3>
            <p>Two sides, players or teams. The names are only labels. Each side has one batting innings. The higher total wins. Equal runs is a draw.</p>
          </section>
          <section>
            <h3>Wickets</h3>
            <p>The batting side starts with 10 or 11 wickets. At 0 they are all out.</p>
          </section>
          <section>
            <h3>Visits</h3>
            <p>Three darts a visit. The batter throws first, then the bowler, then the batter, and so on.</p>
          </section>
          <section>
            <h3>Batter</h3>
            <p>Single scores the number, double twice, triple three times. Add the visit. Only points above 40 are runs. Bulls score 0: the 25 and the 50 are wickets, not points.</p>
            <ul>
              <li>A visit of 60 scores 20 runs.</li>
              <li>A visit of 41 scores 1 run.</li>
              <li>A visit of 38 scores 0.</li>
              <li>Treble 20, treble 19, treble 18 is 171 and scores 131 runs.</li>
              <li>Outer bull loses 1 wicket. Inner bull loses 2.</li>
              <li>Treble 20, outer bull, treble 19 is 77 runs and 1 wicket.</li>
            </ul>
          </section>
          <section>
            <h3>Bowler</h3>
            <p>Only bulls count. Outer bull is 1 wicket, inner bull is 2. Any other number is off target. Miss records a miss.</p>
          </section>
          <section>
            <h3>All out</h3>
            <p>Scoring stops at once. A bull that would take more wickets than are left just ends the innings. Darts not yet thrown are skipped. If the batter is out during their own visit, runs from the darts already thrown are kept, using the 40 rule.</p>
          </section>
          <section>
            <h3>Second innings</h3>
            <p>The roles swap. The side batting second needs one more run than the first innings to win. Play until all out, even after the target has been passed.</p>
          </section>
          <section>
            <h3>Undo and saving</h3>
            <p>Undo removes the last dart and puts the runs and wickets back. It can step into the previous visit. The match stays on this tablet if the screen sleeps or the page is refreshed.</p>
          </section>
        </div>
      </div>
    </div>`;
}

function confirmModal() {
  const replace = state.confirm === "replace";
  const title = replace ? "Replace the saved match?" : "Start a new game?";
  const copy = replace
    ? "A match is already saved on this tablet. Starting another one replaces it."
    : "The current match will be cleared from this tablet.";
  const yes = replace ? "confirm-replace" : "confirm-new";
  const yesLabel = replace ? "Replace" : "New game";
  const no = replace ? "resume-saved" : "close-confirm";
  const noLabel = replace ? "Resume saved" : "Keep playing";
  return `
    <div class="overlay">
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title" data-modal>
        <h2 id="confirm-title">${title}</h2>
        <p class="confirm-copy">${copy}</p>
        <div class="confirm-actions">
          <button type="button" class="texty" data-action="${no}">${noLabel}</button>
          <button type="button" class="primary" data-action="${yes}">${yesLabel}</button>
        </div>
      </div>
    </div>`;
}

function announceChange(before, after) {
  if (after.phase === "break" && before.phase !== "break") {
    return `${after.sides[after.battingSide]} all out for ${after.runs[after.battingSide]}. Roles reverse.`;
  }
  if (after.phase === "done" && before.phase !== "done") return resultSentence(after);
  const dart = after.visit.at(-1) || after.lastVisit?.darts.at(-1);
  if (!dart) return "";
  let line;
  if (after.visit.length === 0 && after.lastVisit?.role === "batter") {
    const runs = after.lastVisit.runs === 0 ? "No runs" : plural(after.lastVisit.runs, "run");
    line = `${dart.label}. ${runs} banked. ${after.sides[after.throwingSide]} to bowl.`;
  } else if (after.visit.length === 0 && after.lastVisit?.role === "bowler") {
    line = `${dart.label}. ${plural(after.lastVisit.wickets, "wicket")}. ${after.sides[after.throwingSide]} to bat.`;
  } else if (after.visitRole === "batter") {
    line = `${dart.label}. Visit ${after.visitPoints}. ${plural(after.pendingRuns, "run")}. ${after.wicketsRemaining} wickets standing.`;
  } else {
    line = `${dart.label}. ${dart.note}. ${after.wicketsRemaining} wickets standing.`;
  }
  return line + chaseSpeech(after);
}

function chaseSpeech(view) {
  if (!view.chase || view.phase !== "live") return "";
  if (view.chase.status === "ahead") return ` Ahead by ${plural(view.chase.aheadBy, "run")}. Already won.`;
  if (view.chase.status === "level") return " Level. Needs 1 more to win.";
  return ` Needs ${view.chase.needed} more to win.`;
}

function resultSentence(view) {
  if (view.result.type === "draw") return `Match drawn. Both sides scored ${view.runs[0]}.`;
  return `${view.sides[view.result.side]} won by ${plural(view.result.margin, "run")}.`;
}

function resumeText(view) {
  if (view.phase === "done") {
    if (view.result.type === "draw") return `Drawn. Both sides scored ${view.runs[0]}.`;
    return `${view.sides[view.result.side]} won by ${plural(view.result.margin, "run")}.`;
  }
  if (view.phase === "break") {
    return `${view.sides[view.battingSide]} all out for ${view.runs[view.battingSide]}. Roles reverse.`;
  }
  const thrower = view.sides[view.throwingSide];
  const role = view.visitRole === "batter" ? "batting" : "bowling";
  return `${view.sides[0]} ${view.runs[0]}, ${view.sides[1]} ${view.runs[1]}. ${thrower} ${role}, ${view.wicketsRemaining} wickets standing.`;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loadDraft() {
  const next = { side1: "Player 1", side2: "Player 2", wickets: 10, bats: null };
  try {
    const raw = localStorage.getItem(SETUP_KEY);
    if (!raw) return next;
    const data = JSON.parse(raw);
    if (typeof data.side1 === "string") next.side1 = data.side1.slice(0, 24);
    if (typeof data.side2 === "string") next.side2 = data.side2.slice(0, 24);
    if (data.wickets === 11) next.wickets = 11;
  } catch {
    /* Ignore a broken setup save. */
  }
  return next;
}

function loadOffer() {
  try {
    const raw = localStorage.getItem(MATCH_KEY);
    if (!raw) return null;
    return reviveMatch(JSON.parse(raw));
  } catch {
    try {
      localStorage.removeItem(MATCH_KEY);
    } catch {
      /* Ignore. */
    }
    return null;
  }
}

function persistDraft() {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify({
      side1: draft.side1,
      side2: draft.side2,
      wickets: draft.wickets,
    }));
  } catch {
    /* Ignore private-mode storage failures. */
  }
}

function persistMatch() {
  try {
    if (match) localStorage.setItem(MATCH_KEY, JSON.stringify(match));
    else localStorage.removeItem(MATCH_KEY);
  } catch {
    /* The match still runs for this visit to the page. */
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const host = location.hostname;
  const allowed = location.protocol === "https:" || host === "localhost" || host === "127.0.0.1";
  if (!allowed) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      /* Registration is optional. Scoring still works. */
    });
  });
}
