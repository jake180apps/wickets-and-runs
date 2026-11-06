import {
  beginSecondInnings,
  createMatch,
  declareInnings,
  finishMatch,
  project,
  recordTypedVisit,
  reviveMatch,
  runsFromVisit,
  setBattingInput,
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
let draft = defaultDraft();
let multiplier = 1;
let pendingAnnounce = "";
let typedPoints = "";
let typedWickets = 0;

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
  if (action === "innings") {
    draft.inningsEach = Number(button.dataset.innings) === 2 ? 2 : 1;
    persistDraft();
    render();
    return;
  }
  if (action === "format") {
    draft.format = button.dataset.format === "teams" ? "teams" : "singles";
    persistDraft();
    render();
    return;
  }
  if (action === "bats") {
    draft.bats = button.dataset.bats === "random" ? "random" : Number(button.dataset.bats);
    render();
    return;
  }
  if (action === "input-mode") {
    setInputMode(button.dataset.mode === "total" ? "total" : "darts");
    return;
  }
  if (action === "wickets-lost") {
    stepWickets(Number(button.dataset.dir) < 0 ? -1 : 1);
    return;
  }
  if (action === "ask-declare") {
    if (!match || project(match).phase !== "live") return;
    state.rules = false;
    state.confirm = "declare";
    render();
    return;
  }
  if (action === "confirm-declare") {
    confirmDeclare();
    return;
  }
  if (action === "ask-finish") {
    if (!match || !project(match).canFinishEarly) return;
    state.rules = false;
    state.confirm = "finish";
    render();
    return;
  }
  if (action === "confirm-finish") {
    confirmFinish();
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
  const field = event.target;
  if (field.id === "visit-total") {
    typedPoints = field.value;
    updateTypedPreview();
    return;
  }
  if (field.id === "single-0") draft.singles[0] = field.value;
  if (field.id === "single-1") draft.singles[1] = field.value;
  if (field.dataset.team != null) {
    const side = Number(field.dataset.team);
    if (field.dataset.field === "label") draft.teams[side].label = field.value;
    if (field.dataset.player != null) draft.teams[side].players[Number(field.dataset.player)] = field.value;
  }
  const first = document.getElementById("bats-0");
  const second = document.getElementById("bats-1");
  if (first) first.querySelector(".choice-name").textContent = sideLabel(0);
  if (second) second.querySelector(".choice-name").textContent = sideLabel(1);
  persistDraft();
}

function onSubmit(event) {
  event.preventDefault();
  if (event.target.id === "typed-form") {
    bankTyped();
    return;
  }
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
  const inningsEach = draft.inningsEach === 2 ? 2 : 1;
  const battingInput = draft.battingInput === "total" ? "total" : "darts";
  if (draft.format === "teams") {
    match = createMatch({
      format: "teams",
      sides: [draft.teams[0].label, draft.teams[1].label],
      players: [draft.teams[0].players, draft.teams[1].players],
      wickets: draft.wickets,
      battingFirst,
      toss,
      inningsEach,
      battingInput,
    });
  } else {
    match = createMatch({
      sides: draft.singles,
      wickets: draft.wickets,
      battingFirst,
      toss,
      inningsEach,
      battingInput,
    });
  }
  state.offer = null;
  state.confirm = null;
  state.rules = false;
  clearEntry();
  persistMatch();
  const view = project(match);
  pendingAnnounce = toss === "random"
    ? `Random pick. ${view.batterName} bats first.`
    : `${view.batterName} bats first.`;
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

function bankTyped() {
  if (!match) return;
  const points = parseTotal(typedPoints);
  if (points == null) return;
  const before = project(match);
  try {
    match = recordTypedVisit(match, { points, wickets: typedWickets });
  } catch {
    return;
  }
  clearEntry();
  const after = project(match);
  pendingAnnounce = announceChange(before, after);
  persistMatch();
  render();
}

function confirmDeclare() {
  if (!match) return;
  const before = project(match);
  try {
    match = declareInnings(match);
  } catch {
    return;
  }
  state.confirm = null;
  clearEntry();
  pendingAnnounce = announceChange(before, project(match));
  persistMatch();
  render();
}

function confirmFinish() {
  if (!match) return;
  const before = project(match);
  try {
    match = finishMatch(match);
  } catch {
    return;
  }
  state.confirm = null;
  clearEntry();
  pendingAnnounce = announceChange(before, project(match));
  persistMatch();
  render();
}

function stepWickets(dir) {
  if (!match) return;
  const view = project(match);
  const max = Math.min(6, view.wicketsRemaining);
  typedWickets = Math.max(0, Math.min(max, typedWickets + dir));
  render();
}

function setInputMode(mode) {
  draft.battingInput = mode;
  persistDraft();
  if (match) {
    match = setBattingInput(match, mode);
    persistMatch();
  }
  render();
}

function doUndo() {
  if (!match || match.events.length === 0) return;
  match = undo(match);
  clearEntry();
  pendingAnnounce = "Undone.";
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
  clearEntry();
  const view = project(match);
  pendingAnnounce = `${view.batterName} to bat.`;
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
  draft.bats = null;
  clearEntry();
  persistMatch();
  pendingAnnounce = "";
  render();
}

function clearEntry() {
  multiplier = 1;
  typedPoints = "";
  typedWickets = 0;
}

function resume(saved) {
  match = saved;
  state.offer = null;
  state.confirm = null;
  clearEntry();
  if (match.battingInput === "total" || match.battingInput === "darts") {
    draft.battingInput = match.battingInput;
    persistDraft();
  }
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
  app.innerHTML = body + (state.rules ? rulesModal() : "") + (state.confirm ? confirmModal(view) : "");
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
  document.title = screen === "live" ? `${view.throwingName} · Wickets & Runs` : "Wickets & Runs";
}

function screenOf(view) {
  if (!view) return "setup";
  if (view.phase === "break") return "break";
  if (view.phase === "done") return "result";
  return "live";
}

function renderSetup() {
  const ready = draft.bats === 0 || draft.bats === 1 || draft.bats === "random";
  const teams = draft.format === "teams";
  return `
    <div class="screen screen-setup">
      ${topbar(null)}
      <div class="setup-grid">
        <div class="setup-intro">
          <img src="./icons/icon.svg" width="72" height="72" alt="">
          <h1>Wickets &amp; Runs</h1>
          <p>English cricket darts for two sides. Singles or teams of two. One or two innings each.</p>
        </div>
        <form class="setup-form" id="setup-form">
          ${offerCard()}
          <fieldset>
            <legend>Sides</legend>
            <div class="choice" role="group" aria-label="Sides">
              ${setupChoice("format", "singles", "Singles", "Two players", draft.format === "singles")}
              ${setupChoice("format", "teams", "Teams of 2", "Four players", draft.format === "teams")}
            </div>
          </fieldset>
          ${teams ? teamFields() : singleFields()}
          <fieldset>
            <legend>Innings each</legend>
            <div class="choice" role="group" aria-label="Innings each">
              ${setupChoice("innings", "1", "1 innings", "One each", draft.inningsEach !== 2)}
              ${setupChoice("innings", "2", "2 innings", "Two each", draft.inningsEach === 2)}
            </div>
          </fieldset>
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

function singleFields() {
  return `
    <label class="field">
      <span>Player 1</span>
      <input id="single-0" maxlength="24" autocomplete="off" autocapitalize="words" enterkeyhint="next" value="${esc(draft.singles[0])}">
    </label>
    <label class="field">
      <span>Player 2</span>
      <input id="single-1" maxlength="24" autocomplete="off" autocapitalize="words" enterkeyhint="done" value="${esc(draft.singles[1])}">
    </label>`;
}

function teamFields() {
  return `<div class="team-pair">${teamBlock(0)}${teamBlock(1)}</div>`;
}

function teamBlock(index) {
  const team = draft.teams[index];
  return `
    <fieldset class="team-block">
      <legend>Team ${index + 1}</legend>
      <label class="field">
        <span>Team name <span class="optional">(optional)</span></span>
        <input data-team="${index}" data-field="label" maxlength="24" autocomplete="off" autocapitalize="words" enterkeyhint="next" value="${esc(team.label)}" placeholder="${esc(fallbackTeam(index))}">
      </label>
      <label class="field">
        <span>Player 1</span>
        <input data-team="${index}" data-player="0" maxlength="24" autocomplete="off" autocapitalize="words" enterkeyhint="next" value="${esc(team.players[0])}">
      </label>
      <label class="field">
        <span>Player 2</span>
        <input data-team="${index}" data-player="1" maxlength="24" autocomplete="off" autocapitalize="words" enterkeyhint="next" value="${esc(team.players[1])}">
      </label>
    </fieldset>`;
}

function renderLive(view) {
  const typed = showTyped(view);
  const bowling = view.visitRole === "bowler";
  const armed = multiplier === 2 ? " Double is armed." : multiplier === 3 ? " Triple is armed." : "";
  let hint = bowling
    ? "Bowling. Only a bull takes a wicket."
    : "Batting. Runs are the visit total above 40.";
  if (!bowling && view.battingInput === "total" && view.visit.length > 0) {
    hint = "Finish these darts. The next visit can be typed.";
  }
  if (typed) hint = "Type the visit total from the dartboard. Bulls score 0.";
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
          <div class="pad-head">
            ${modeToggle(view)}
            <p class="hint">${hint}${bowling ? "" : armed}</p>
          </div>
          ${typed ? typedPad(view) : pad(view)}
        </section>
      </div>
    </div>`;
}

function renderBreak(view) {
  const name = view.sides[view.battingSide];
  const next = view.sides[view.bowlingSide];
  const declared = view.endReason === "declare";
  const headline = declared ? `Declared on ${view.inningsRuns}` : `All out for ${view.inningsRuns}`;
  const nextNumber = nextInningsNumber(view);
  const nextDetail = view.inningsEach === 2 ? `, innings ${nextNumber} of 2` : "";
  const button = view.inningsEach === 1 ? "Start second innings" : "Start next innings";
  const totalNote = view.inningsEach === 2 ? `<p class="stage-copy">Match total ${view.runs[view.battingSide]}.</p>` : "";
  return `
    <div class="screen screen-break">
      ${topbar(view)}
      <div class="stage">
        <p class="eyebrow">Innings closed</p>
        <p class="stage-name">${esc(name)}</p>
        <h1>${headline}</h1>
        <p class="stage-lead">Roles reverse</p>
        <p class="stage-copy">${esc(next)} will bat${nextDetail}. ${esc(name)} will bowl.</p>
        ${totalNote}
        ${miniScores(view)}
        ${closingVisit(view)}
        <div class="stage-actions">
          <button type="button" class="primary" data-action="second">${button}</button>
          <button type="button" class="texty" data-action="undo">Undo</button>
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
  const early = view.endReason === "finish" ? `<p class="stage-copy">Ended once the result was decided.</p>` : "";
  return `
    <div class="screen screen-result">
      ${topbar(view)}
      <div class="stage">
        <p class="eyebrow">Match result</p>
        <h1>${esc(title)}</h1>
        <p class="stage-lead">${esc(detail)}</p>
        ${early}
        <div class="result-scores">
          ${resultCard(view, first, view.inningsEach === 1 ? "1st innings" : "Match total")}
          ${resultCard(view, 1 - first, view.inningsEach === 1 ? "2nd innings" : "Match total")}
        </div>
        ${renderAverages(view)}
        <div class="stage-actions">
          <button type="button" class="primary" data-action="again">Play again</button>
          <button type="button" class="texty" data-action="undo">Undo</button>
        </div>
      </div>
    </div>`;
}

function topbar(view) {
  const fresh = !view;
  return `
    <header class="topbar">
      <div class="brand">
        <img src="./icons/icon.svg" width="36" height="36" alt="">
        <div>
          <p class="brand-name">Wickets &amp; Runs</p>
          <p class="brand-sub">${esc(topSub(view))}</p>
        </div>
      </div>
      <div class="top-actions">
        <button type="button" class="texty" data-action="rules">Rules</button>
        ${fresh ? "" : `<button type="button" class="texty" data-action="ask-new">New game</button>`}
      </div>
    </header>`;
}

function topSub(view) {
  if (!view) return "Cricket darts";
  if (view.phase === "done") return "Match over";
  if (view.phase === "break") return "Innings break";
  if (view.inningsEach === 1) return view.innings === 1 ? "1st innings" : "2nd innings";
  return `Innings ${view.sideInnings} of 2`;
}

function sideCard(view, index) {
  const throwing = view.throwingSide === index;
  const batting = view.battingSide === index;
  const name = view.sides[index];
  const player = batting ? view.batterName : view.bowlerName;
  const pending = batting && view.pendingRuns > 0
    ? `<span class="pending">+${view.pendingRuns}<span class="pending-label">pending</span></span>`
    : "";
  const playerLine = view.format === "teams"
    ? `<p class="active-player">${esc(player)}</p>`
    : "";
  const split = view.inningsEach === 2 ? `<p class="innings-split">${esc(splitText(view, index))}</p>` : "";
  return `
    <article class="card ${throwing ? "is-throwing" : ""} ${batting ? "is-batting" : "is-bowling"}" ${throwing ? 'aria-current="true"' : ""}>
      <header class="card-top">
        <h2 class="side-name" title="${esc(name)}">${esc(name)}</h2>
        <span class="role ${batting ? "role-bat" : "role-bowl"}">${batting ? "Batting" : "Bowling"}</span>
      </header>
      ${playerLine}
      <div class="scoreline">
        <p class="score">${view.runs[index]}</p>
        ${pending}
      </div>
      <p class="caption">${cardCaption(view, index)}</p>
      ${split}
      ${batting ? pipRow(view) : ""}
      ${throwing ? `<p class="throwing-flag">Throwing</p>` : ""}
    </article>`;
}

function cardCaption(view, index) {
  const batting = view.battingSide === index;
  if (view.inningsEach === 1) {
    if (batting) return view.innings === 1 ? "1st innings" : "2nd innings";
    if (view.innings === 1) return "Yet to bat";
    return "1st innings";
  }
  if (batting) return `Innings ${view.sideInnings} of 2`;
  if (view.byInnings[index].every((runs) => runs == null)) return "Yet to bat";
  return "Match total";
}

function splitText(view, index) {
  return view.byInnings[index].map((runs) => (runs == null ? "—" : String(runs))).join(" · ");
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
    main = `Ahead by ${plural(chase.aheadBy, "run")}`;
    sub = "This lead cannot be caught. Play on, or end the match.";
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
  const finish = view.canFinishEarly
    ? `<button type="button" class="end-match" data-action="ask-finish">End match</button>`
    : "";
  return `
    <div class="chase is-${chase.status}" role="status">
      <p class="chase-main">${main}</p>
      <p class="chase-sub">${sub}</p>
      ${finish}
    </div>`;
}

function throwBar(view) {
  const batting = view.visitRole === "batter";
  const left = view.dartsLeft;
  const team = view.format === "teams" ? `<p class="throw-team">${esc(view.sides[view.throwingSide])}</p>` : "";
  return `
    <div class="throwbar ${batting ? "is-batting" : "is-bowling"}">
      <div class="throw-copy">
        <p class="eyebrow">Now throwing</p>
        <p class="throw-name">${esc(view.throwingName)}</p>
        ${team}
      </div>
      <span class="role ${batting ? "role-bat" : "role-bowl"}">${batting ? "Batting" : "Bowling"}</span>
      <button type="button" class="texty declare-btn" data-action="ask-declare">Declare</button>
      <div class="darts-left">
        ${dartPips(view.dartsThrown)}
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
  return `<p class="last-visit">${esc(visitSummary(last))}</p>`;
}

function visitSummary(last) {
  if (last.kind === "typed") {
    const runs = last.runs === 0 ? "no runs" : plural(last.runs, "run");
    const wickets = last.wickets ? ` · ${plural(last.wickets, "wicket")} lost` : "";
    return `Last visit typed ${last.points} · ${runs} banked${wickets}`;
  }
  if (last.role === "batter") {
    const wickets = last.wickets ? ` · ${plural(last.wickets, "wicket")}` : "";
    const runs = last.runs === 0 ? "no runs" : plural(last.runs, "run");
    return `Last visit ${last.points} · ${runs} banked${wickets}`;
  }
  return `Last visit · ${plural(last.wickets, "wicket")}`;
}

function closingVisit(view) {
  const closing = view.closingVisit;
  if (!closing) return "";
  if (closing.kind === "typed") {
    const dart = {
      kind: closing.wickets ? "wicket" : "score",
      label: String(closing.points),
      note: closing.wickets ? plural(closing.wickets, "wicket") : "Visit total",
    };
    return `
      <div class="visitbox">
        <div class="slots slots-typed">${slotHtml(dart, 0, "")}</div>
        <p class="last-visit">${esc(visitSummary(closing))}</p>
      </div>`;
  }
  return `
    <div class="visitbox">
      <div class="slots">${slotsHtml(closing.darts, "Not thrown")}</div>
      <p class="last-visit">${esc(visitSummary(closing))}</p>
    </div>`;
}

function slotsHtml(darts, emptyLabel) {
  return [0, 1, 2].map((index) => slotHtml(darts[index], index, emptyLabel)).join("");
}

function slotHtml(dart, index, emptyLabel) {
  if (!dart) {
    return `<div class="slot"><span class="slot-index">Dart ${index + 1}</span><span class="slot-empty">${emptyLabel}</span></div>`;
  }
  const indexLabel = dart.note === "Visit total" || emptyLabel === "" ? "Visit total" : `Dart ${index + 1}`;
  return `
    <div class="slot is-${dart.kind}">
      <span class="slot-index">${indexLabel}</span>
      <span class="slot-label">${esc(dart.label)}</span>
      <span class="slot-note">${esc(dart.note)}</span>
    </div>`;
}

function modeToggle(view) {
  const total = view.battingInput === "total";
  return `
    <div class="mode-toggle" role="group" aria-label="Batting entry">
      <button type="button" data-action="input-mode" data-mode="darts" class="${total ? "" : "is-on"}" aria-pressed="${!total}">Darts</button>
      <button type="button" data-action="input-mode" data-mode="total" class="${total ? "is-on" : ""}" aria-pressed="${total}">Type total</button>
    </div>`;
}

function showTyped(view) {
  return view.visitRole === "batter" && view.battingInput === "total" && view.visit.length === 0;
}

function typedPad(view) {
  const max = Math.min(6, view.wicketsRemaining);
  const points = parseTotal(typedPoints);
  return `
    <form class="typed-form" id="typed-form">
      <label class="field">
        <span>Visit total</span>
        <input id="visit-total" inputmode="numeric" enterkeyhint="done" autocomplete="off" maxlength="3" placeholder="0–180" value="${esc(typedPoints)}">
      </label>
      <div class="wicket-step" role="group" aria-label="Wickets lost">
        <button type="button" data-action="wickets-lost" data-dir="-1" ${typedWickets <= 0 ? "disabled" : ""} aria-label="Fewer wickets">−</button>
        <p><span class="eyebrow">Wickets lost</span><strong>${typedWickets}</strong></p>
        <button type="button" data-action="wickets-lost" data-dir="1" ${typedWickets >= max ? "disabled" : ""} aria-label="More wickets">+</button>
      </div>
      <p class="typed-preview" id="typed-preview">${esc(typedPreviewText(points))}</p>
      <div class="typed-actions">
        <button type="button" class="texty" data-action="undo" ${view.canUndo ? "" : "disabled"}>Undo</button>
        <button type="submit" class="primary" id="bank-visit" ${points == null ? "disabled" : ""}>Confirm visit</button>
      </div>
    </form>`;
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
  const caption = view.inningsEach === 2 ? `<p class="caption">Match total</p>` : "";
  return `
    <article class="card">
      <h2 class="side-name">${esc(view.sides[index])}</h2>
      <p class="score">${view.runs[index]}</p>
      ${caption}
    </article>`;
}

function resultCard(view, index, label) {
  const won = view.result.type === "win" && view.result.side === index;
  const split = view.inningsEach === 2 ? `<p class="innings-split">${esc(splitText(view, index))}</p>` : "";
  return `
    <article class="card ${won ? "is-winner" : ""}">
      <h2 class="side-name">${esc(view.sides[index])}</h2>
      <p class="score">${view.runs[index]}</p>
      <p class="caption">${label}${won ? " · won" : ""}</p>
      ${split}
    </article>`;
}

function renderAverages(view) {
  const people = view.averages.players.flat().map((player) => avgCard(player.name, player, false)).join("");
  const teams = view.format === "teams"
    ? `<div class="avg-grid">${view.averages.sides.map((stats, index) => avgCard(view.sides[index], stats, true)).join("")}</div>`
    : "";
  return `
    <section class="averages" aria-label="Averages">
      <h2>Averages</h2>
      ${teams}
      ${view.format === "teams" ? `<h3 class="avg-kicker">Players</h3>` : ""}
      <div class="avg-grid">${people}</div>
    </section>`;
}

function avgCard(name, stats, team) {
  return `
    <article class="avg-card ${team ? "is-team" : ""}">
      <h3>${esc(name)}</h3>
      <p class="avg-line"><span>Runs per visit</span><strong>${formatAverage(stats.runsPerVisit)}</strong></p>
      <p class="avg-line"><span>Wickets per visit</span><strong>${formatAverage(stats.wicketsPerVisit)}</strong></p>
      <p class="avg-note">${plural(stats.battingVisits, "batting visit")} · ${plural(stats.bowlingVisits, "bowling visit")}</p>
    </article>`;
}

function wicketChoice(value) {
  const on = draft.wickets === value;
  return `<button type="button" data-action="wickets" data-wickets="${value}" class="${on ? "is-on" : ""}" aria-pressed="${on}">${value}</button>`;
}

function setupChoice(action, value, name, detail, on) {
  return `
    <button type="button" data-action="${action}" data-${action}="${value}" class="${on ? "is-on" : ""}" aria-pressed="${on}">
      <span class="choice-name">${name}</span>
      <small>${detail}</small>
    </button>`;
}

function batsChoice(index) {
  const on = draft.bats === index;
  return `
    <button type="button" id="bats-${index}" data-action="bats" data-bats="${index}" class="${on ? "is-on" : ""}" aria-pressed="${on}">
      <span class="choice-name">${esc(sideLabel(index))}</span>
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
            <p>Two singles, or two teams of two. In a team, players take turns. Batting and bowling rotate separately, each time a visit is finished. The higher match total wins. Equal runs is a draw.</p>
          </section>
          <section>
            <h3>Innings</h3>
            <p>Each side has one or two batting innings. With two, the side batting first bats, then the other side, then the first side again, then the other side. Runs from each innings are added together.</p>
          </section>
          <section>
            <h3>Wickets</h3>
            <p>The batting side starts with 10 or 11 wickets. At 0 they are all out.</p>
          </section>
          <section>
            <h3>Visits</h3>
            <p>Three darts a visit, or one typed batting total. The batter throws first, then the bowler, then the batter. A typed total counts as one finished visit.</p>
          </section>
          <section>
            <h3>Batter</h3>
            <p>Single scores the number, double twice, triple three times. Add the visit. Only points above 40 are runs. Bulls score 0: the 25 and the 50 are wickets, not points. A typed total uses the same rule, and wickets lost default to 0.</p>
            <ul>
              <li>A visit of 60 scores 20 runs.</li>
              <li>A visit of 41 scores 1 run.</li>
              <li>A visit of 38 scores 0.</li>
              <li>Treble 20, treble 19, treble 18 is 171 and scores 131 runs.</li>
              <li>Outer bull loses 1 wicket. Inner bull loses 2.</li>
              <li>Treble 20, outer bull, treble 19 is 77 runs and 1 wicket.</li>
              <li>Typing 60 with 1 wicket lost scores 20 runs and costs that wicket.</li>
            </ul>
          </section>
          <section>
            <h3>Bowler</h3>
            <p>Only bulls count, and bowling stays dart by dart. Outer bull is 1 wicket, inner bull is 2. Any other number is off target. Miss records a miss.</p>
          </section>
          <section>
            <h3>Declare</h3>
            <p>The batting side may declare to end the current innings. It asks for confirmation. In a two-innings match they may still have another innings later. A declaration does not add an empty visit. Undo puts the innings back.</p>
          </section>
          <section>
            <h3>All out</h3>
            <p>Scoring stops at once. A bull that would take more wickets than are left just ends the innings. Darts not yet thrown are skipped. If the batter is out during their own visit, runs from the darts already thrown are kept, using the 40 rule.</p>
          </section>
          <section>
            <h3>Chase</h3>
            <p>A target is a match-winning target only when the other side has no innings left. Passing them earlier is not yet a win. Once the target is passed, play can continue until all out. End match is there when the result is already decided.</p>
          </section>
          <section>
            <h3>Averages</h3>
            <p>Runs per visit are runs banked divided by finished batting visits. Wickets per visit are wickets taken while bowling, divided by finished bowling visits. A side with no visits of that kind is shown as a dash.</p>
          </section>
          <section>
            <h3>Undo and saving</h3>
            <p>Undo removes the last dart, typed visit, declaration, or early finish, and puts the runs and wickets back. The match stays on this tablet if the screen sleeps or the page is refreshed.</p>
          </section>
        </div>
      </div>
    </div>`;
}

function confirmModal(view) {
  const spec = confirmSpec(view);
  return `
    <div class="overlay">
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title" data-modal>
        <h2 id="confirm-title">${spec.title}</h2>
        <p class="confirm-copy">${spec.copy}</p>
        <div class="confirm-actions">
          <button type="button" class="texty" data-action="${spec.no}">${spec.noLabel}</button>
          <button type="button" class="primary" data-action="${spec.yes}">${spec.yesLabel}</button>
        </div>
      </div>
    </div>`;
}

function confirmSpec(view) {
  if (state.confirm === "replace") {
    return {
      title: "Replace the saved match?",
      copy: "A match is already saved on this tablet. Starting another one replaces it.",
      no: "resume-saved",
      noLabel: "Resume saved",
      yes: "confirm-replace",
      yesLabel: "Replace",
    };
  }
  if (state.confirm === "declare") {
    const later = view && view.sideInnings < view.inningsEach;
    const endsMatch = view && view.opponentInningsLeft === 0;
    let copy = "This ends the current innings. Runs already scored are kept.";
    if (later) copy += " This side still has another innings in the match.";
    if (endsMatch) copy += " The match will then be over.";
    return {
      title: "Declare the innings?",
      copy,
      no: "close-confirm",
      noLabel: "Keep batting",
      yes: "confirm-declare",
      yesLabel: "Declare",
    };
  }
  if (state.confirm === "finish") {
    return {
      title: "End the match?",
      copy: "The winner is already decided. Ending now keeps the current scores and averages.",
      no: "close-confirm",
      noLabel: "Keep playing",
      yes: "confirm-finish",
      yesLabel: "End match",
    };
  }
  return {
    title: "Start a new game?",
    copy: "The current match will be cleared from this tablet.",
    no: "close-confirm",
    noLabel: "Keep playing",
    yes: "confirm-new",
    yesLabel: "New game",
  };
}

function announceChange(before, after) {
  if (after.phase === "break" && before.phase !== "break") {
    const name = after.sides[after.battingSide];
    const next = after.sides[after.bowlingSide];
    if (after.endReason === "declare") return `${name} declared on ${after.inningsRuns}. ${next} will bat.`;
    return `${name} all out for ${after.inningsRuns}. Roles reverse.`;
  }
  if (after.phase === "done" && before.phase !== "done") return resultSentence(after);
  if (after.visit.length === 0 && after.lastVisit?.kind === "typed") {
    const last = after.lastVisit;
    const runs = last.runs === 0 ? "No runs" : plural(last.runs, "run");
    const wickets = last.wickets ? ` ${plural(last.wickets, "wicket")} lost.` : "";
    return `Visit ${last.points}. ${runs} banked.${wickets} ${after.throwingName} to bowl.${chaseSpeech(after)}`;
  }
  const dart = after.visit.at(-1) || after.lastVisit?.darts.at(-1);
  if (!dart) return "";
  let line;
  if (after.visit.length === 0 && after.lastVisit?.role === "batter") {
    const runs = after.lastVisit.runs === 0 ? "No runs" : plural(after.lastVisit.runs, "run");
    line = `${dart.label}. ${runs} banked. ${after.throwingName} to bowl.`;
  } else if (after.visit.length === 0 && after.lastVisit?.role === "bowler") {
    line = `${dart.label}. ${plural(after.lastVisit.wickets, "wicket")}. ${after.throwingName} to bat.`;
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
    const name = view.sides[view.battingSide];
    if (view.endReason === "declare") return `${name} declared on ${view.inningsRuns}.`;
    return `${name} all out for ${view.inningsRuns}. Roles reverse.`;
  }
  const role = view.visitRole === "batter" ? "batting" : "bowling";
  const inningsBit = view.inningsEach === 2 ? ` Innings ${view.sideInnings} of 2.` : "";
  return `${view.sides[0]} ${view.runs[0]}, ${view.sides[1]} ${view.runs[1]}. ${view.throwingName} ${role}, ${view.wicketsRemaining} wickets standing.${inningsBit}`;
}

function nextInningsNumber(view) {
  return view.byInnings[view.bowlingSide].filter((runs) => runs != null).length + 1;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function formatAverage(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function parseTotal(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const points = Number(text);
  if (points > 180) return null;
  return points;
}

function typedPreviewText(points) {
  if (points == null) return "Enter the visit total, from 0 to 180";
  const runs = runsFromVisit(points);
  const runText = runs === 0 ? "no runs" : plural(runs, "run");
  const wicketText = typedWickets > 0 ? ` · ${plural(typedWickets, "wicket")} lost` : "";
  return `${points} − 40 = ${runText}${wicketText}`;
}

function updateTypedPreview() {
  const preview = document.getElementById("typed-preview");
  const button = document.getElementById("bank-visit");
  const points = parseTotal(typedPoints);
  if (preview) preview.textContent = typedPreviewText(points);
  if (button) button.disabled = points == null;
}

function sideLabel(index) {
  if (draft.format === "teams") {
    const team = draft.teams[index];
    const label = clean(team.label);
    if (label) return label;
    return fallbackTeam(index);
  }
  return clean(draft.singles[index]) || `Player ${index + 1}`;
}

function fallbackTeam(index) {
  const team = draft.teams[index];
  const first = clean(team.players[0]) || `Player ${index * 2 + 1}`;
  const second = clean(team.players[1]) || `Player ${index * 2 + 2}`;
  return `${first} & ${second}`;
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

function defaultDraft() {
  return {
    format: "singles",
    inningsEach: 1,
    wickets: 10,
    bats: null,
    battingInput: "darts",
    singles: ["Player 1", "Player 2"],
    teams: [
      { label: "", players: ["Player 1", "Player 2"] },
      { label: "", players: ["Player 3", "Player 4"] },
    ],
  };
}

function loadDraft() {
  const next = defaultDraft();
  try {
    const raw = localStorage.getItem(SETUP_KEY);
    if (!raw) return next;
    const data = JSON.parse(raw);
    if (data.format === "teams") next.format = "teams";
    if (data.inningsEach === 2) next.inningsEach = 2;
    if (data.wickets === 11) next.wickets = 11;
    if (data.battingInput === "total") next.battingInput = "total";
    if (typeof data.side1 === "string") next.singles[0] = data.side1.slice(0, 24);
    if (typeof data.side2 === "string") next.singles[1] = data.side2.slice(0, 24);
    if (Array.isArray(data.singles)) {
      data.singles.slice(0, 2).forEach((name, index) => {
        if (typeof name === "string") next.singles[index] = name.slice(0, 24);
      });
    }
    if (Array.isArray(data.teams)) {
      data.teams.slice(0, 2).forEach((team, index) => {
        if (!team || typeof team !== "object") return;
        if (typeof team.label === "string") next.teams[index].label = team.label.slice(0, 24);
        if (Array.isArray(team.players)) {
          team.players.slice(0, 2).forEach((name, player) => {
            if (typeof name === "string") next.teams[index].players[player] = name.slice(0, 24);
          });
        }
      });
    }
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
      format: draft.format,
      inningsEach: draft.inningsEach,
      wickets: draft.wickets,
      battingInput: draft.battingInput,
      side1: draft.singles[0],
      side2: draft.singles[1],
      singles: draft.singles,
      teams: draft.teams,
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
