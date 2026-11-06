/**
 * Wickets & Runs — English cricket darts (bat and bowl).
 *
 * Two sides. Each side has one or two batting innings. A visit is three darts,
 * or one typed batting total that stands in for a finished visit.
 * The batter throws first in an innings, then the bowler, then the batter.
 *
 * Batter: face value, doubles and trebles score as usual. Only the points
 * above 40 in that visit become runs. Outer bull costs 1 wicket and scores 0.
 * Inner bull costs 2 wickets and scores 0. A typed visit uses the same 40 rule
 * and can record wickets lost (batter bulls) without adding points.
 *
 * Bowler: only bulls take wickets (outer 1, inner 2). Every other dart is
 * off target. A deliberate miss scores nothing for either side.
 *
 * At 0 wickets the innings ends at once. Extra wickets on that dart are
 * ignored, and any dart not yet thrown is not played. Runs already on the
 * batter's visit are banked with the 40 rule. Declaring ends the innings
 * the same way, without inventing an empty visit.
 *
 * In a two-innings match the order is side A innings 1, side B innings 1,
 * side A innings 2, side B innings 2. Match totals add the innings together.
 * Passing the other side is a win only when that side has no innings left.
 */

export const RUN_THRESHOLD = 40;

const MULT_MARK = { 1: "S", 2: "D", 3: "T" };

export function runsFromVisit(points) {
  if (!Number.isFinite(points) || points <= RUN_THRESHOLD) return 0;
  return points - RUN_THRESHOLD;
}

export function createMatch({
  sides,
  wickets,
  battingFirst,
  toss = "pick",
  inningsEach = 1,
  format = "singles",
  players = null,
  battingInput = "darts",
} = {}) {
  if (wickets !== 10 && wickets !== 11) {
    throw new Error("Wickets must be 10 or 11");
  }
  if (battingFirst !== 0 && battingFirst !== 1) {
    throw new Error("Choose which side bats first");
  }
  if (inningsEach !== 1 && inningsEach !== 2) {
    throw new Error("Each side plays 1 or 2 innings");
  }
  if (format !== "singles" && format !== "teams") {
    throw new Error("Choose singles or teams");
  }
  if (battingInput !== "darts" && battingInput !== "total") {
    throw new Error("Unknown batting input");
  }

  const built = format === "teams"
    ? buildTeams(sides, players)
    : buildSingles(sides);

  return {
    v: 2,
    format,
    inningsEach,
    battingInput,
    sides: built.names,
    labels: built.labels,
    players: built.players,
    wickets,
    battingFirst,
    toss: toss === "random" ? "random" : "pick",
    events: [],
  };
}

export function normaliseDart(input) {
  if (!input || typeof input !== "object") throw new Error("Missing dart");
  if (input.type === "miss" || input.type === "outer" || input.type === "inner") {
    return { type: input.type };
  }
  if (input.type === "number") {
    const multiplier = input.multiplier;
    const value = input.value;
    if (multiplier !== 1 && multiplier !== 2 && multiplier !== 3) {
      throw new Error("Multiplier must be single, double or triple");
    }
    if (!Number.isInteger(value) || value < 1 || value > 20) {
      throw new Error("Score must be from 1 to 20");
    }
    return { type: "number", multiplier, value };
  }
  throw new Error("Unknown dart");
}

export function reviveMatch(data) {
  if (!data || (data.v !== 1 && data.v !== 2)) throw new Error("Unrecognised match");
  const legacy = data.v === 1;
  const format = legacy ? "singles" : data.format === "teams" ? "teams" : "singles";
  const match = createMatch({
    sides: !legacy && format === "teams" && Array.isArray(data.labels) ? data.labels : data.sides,
    players: legacy ? null : data.players,
    wickets: data.wickets,
    battingFirst: data.battingFirst,
    toss: data.toss,
    inningsEach: legacy ? 1 : data.inningsEach === 2 ? 2 : 1,
    format,
    battingInput: !legacy && data.battingInput === "total" ? "total" : "darts",
  });
  if (!Array.isArray(data.events)) throw new Error("Unrecognised match");
  match.events = data.events.map((event) => normaliseEvent(event, legacy));
  return match;
}

export function throwDart(match, dart) {
  const view = project(match);
  if (!view.canThrow) throw new Error("No dart can be thrown now");
  const clean = normaliseDart(dart);
  return { ...match, events: [...match.events, { type: "dart", dart: clean }] };
}

export function recordTypedVisit(match, input) {
  const view = project(match);
  if (!view.canTypeVisit) throw new Error("A visit total cannot be entered now");
  const points = input?.points;
  const wickets = input?.wickets ?? 0;
  if (!Number.isInteger(points) || points < 0 || points > 180) {
    throw new Error("Visit total must be from 0 to 180");
  }
  if (!Number.isInteger(wickets) || wickets < 0 || wickets > 6) {
    throw new Error("Wickets lost must be from 0 to 6");
  }
  return { ...match, events: [...match.events, { type: "typedVisit", points, wickets }] };
}

export function declareInnings(match) {
  const view = project(match);
  if (view.phase !== "live") throw new Error("This innings cannot be declared");
  return { ...match, events: [...match.events, { type: "declare" }] };
}

export function finishMatch(match) {
  const view = project(match);
  if (!view.canFinishEarly) throw new Error("The match cannot be ended yet");
  return { ...match, events: [...match.events, { type: "finish" }] };
}

export function setBattingInput(match, mode) {
  if (mode !== "darts" && mode !== "total") throw new Error("Unknown batting input");
  if (match.battingInput === mode) return match;
  return { ...match, battingInput: mode };
}

export function beginNextInnings(match) {
  return beginSecondInnings(match);
}

export function beginSecondInnings(match) {
  const view = project(match);
  if (view.phase !== "break") throw new Error("The second innings has not started");
  return { ...match, events: [...match.events, { type: "secondInnings" }] };
}

export function undo(match) {
  if (match.events.length === 0) return match;
  return { ...match, events: match.events.slice(0, -1) };
}

export function project(match) {
  const inningsEach = match.inningsEach === 2 ? 2 : 1;
  const totalInnings = inningsEach * 2;
  const format = match.format === "teams" ? "teams" : "singles";
  const battingInput = match.battingInput === "total" ? "total" : "darts";
  const roster = normalRoster(match);
  const runs = [0, 0];
  const byInnings = [emptyInnings(inningsEach), emptyInnings(inningsEach)];
  const batCount = [0, 0];
  const bowlCount = [0, 0];
  const playerStats = roster.map((list) => list.map(() => ({
    battingVisits: 0,
    runs: 0,
    bowlingVisits: 0,
    wickets: 0,
  })));

  let inningsIndex = 0;
  let phase = "live";
  let battingSide = sideFor(0);
  let wicketsRemaining = match.wickets;
  let visitRole = "batter";
  let visit = [];
  let lastVisit = null;
  let currentInningsRuns = 0;
  let endReason = null;
  let showClosing = false;

  openCurrent();

  for (const event of match.events) {
    if (event.type === "secondInnings" || event.type === "nextInnings") {
      if (phase !== "break") continue;
      inningsIndex += 1;
      battingSide = sideFor(inningsIndex);
      wicketsRemaining = match.wickets;
      visitRole = "batter";
      visit = [];
      lastVisit = null;
      phase = "live";
      endReason = null;
      showClosing = false;
      openCurrent();
      continue;
    }
    if (event.type === "declare") {
      if (phase !== "live") continue;
      if (visit.length > 0) closeVisit(true, "declare");
      else finishInnings("declare", false);
      continue;
    }
    if (event.type === "finish") {
      if (phase !== "live") continue;
      if (!chaseIsLive() || runs[battingSide] <= runs[1 - battingSide]) continue;
      phase = "done";
      endReason = "finish";
      showClosing = false;
      continue;
    }
    if (event.type === "typedVisit") {
      if (phase !== "live" || visitRole !== "batter" || visit.length > 0) continue;
      const applied = Math.min(event.wickets, wicketsRemaining);
      const ended = applied > 0 && applied === wicketsRemaining;
      visit = [{
        kind: applied > 0 ? "wicket" : "score",
        label: String(event.points),
        note: typedNote(applied, ended),
        points: event.points,
        wickets: applied,
        wicketsApplied: applied,
        multiplier: null,
        value: null,
      }];
      wicketsRemaining -= applied;
      closeVisit(ended, "allout", "typed");
      continue;
    }
    if (event.type !== "dart" || phase !== "live") continue;

    const spec = describeSegment(visitRole, event.dart);
    const applied = Math.min(spec.wickets, wicketsRemaining);
    const ended = applied > 0 && applied === wicketsRemaining;
    visit.push({
      ...spec,
      wicketsApplied: applied,
      note: spec.wickets > 0 ? wicketNote(applied, ended) : spec.note,
    });
    wicketsRemaining -= applied;
    if (ended || visit.length === 3) closeVisit(ended, "allout");
  }

  const visitPoints = sum(visit, "points");
  const pendingRuns = phase === "live" && visitRole === "batter" ? runsFromVisit(visitPoints) : 0;
  const opponentLeft = inningsLeft(1 - battingSide);
  const chase = opponentLeft === 0 ? chaseFor(runs, battingSide) : null;
  const names = displayNames(match, roster);

  return {
    sides: names,
    players: roster,
    format,
    inningsEach,
    battingInput,
    wicketsSetting: match.wickets,
    battingFirst: match.battingFirst,
    toss: match.toss === "random" ? "random" : "pick",
    innings: inningsIndex + 1,
    inningsIndex,
    sideInnings: Math.floor(inningsIndex / 2) + 1,
    byInnings,
    inningsRuns: currentInningsRuns,
    endReason: phase === "live" ? null : endReason,
    phase,
    battingSide,
    bowlingSide: 1 - battingSide,
    runs,
    wicketsRemaining,
    wicketsDown: match.wickets - wicketsRemaining,
    visitRole,
    throwingSide: visitRole === "batter" ? battingSide : 1 - battingSide,
    batterName: personName(battingSide, "batter"),
    bowlerName: personName(1 - battingSide, "bowler"),
    throwingName: personName(
      visitRole === "batter" ? battingSide : 1 - battingSide,
      visitRole === "batter" ? "batter" : "bowler",
    ),
    visit,
    visitPoints,
    pendingRuns,
    wicketsThisVisit: sum(visit, "wicketsApplied"),
    dartsThrown: visit.length,
    dartsLeft: 3 - visit.length,
    lastVisit,
    closingVisit: phase === "live" || !showClosing ? null : lastVisit,
    chase,
    opponentInningsLeft: opponentLeft,
    canFinishEarly: phase === "live" && opponentLeft === 0 && runs[battingSide] > runs[1 - battingSide],
    canDeclare: phase === "live",
    canTypeVisit: phase === "live" && visitRole === "batter" && visit.length === 0,
    result: phase === "done" ? resultFor(runs) : null,
    averages: averagesFor(),
    canUndo: match.events.length > 0,
    canThrow: phase === "live",
  };

  function openCurrent() {
    currentInningsRuns = 0;
    const slot = Math.floor(inningsIndex / 2);
    byInnings[battingSide][slot] = 0;
  }

  function sideFor(index) {
    return index % 2 === 0 ? match.battingFirst : 1 - match.battingFirst;
  }

  function inningsLeft(side) {
    let left = 0;
    for (let i = 0; i < totalInnings; i += 1) {
      if (sideFor(i) !== side) continue;
      const completed = i < inningsIndex || (i === inningsIndex && phase !== "live");
      if (!completed) left += 1;
    }
    return left;
  }

  function chaseIsLive() {
    return phase === "live" && inningsLeft(1 - battingSide) === 0;
  }

  function finishInnings(reason, fromVisit) {
    endReason = reason;
    showClosing = !!fromVisit;
    phase = inningsIndex + 1 < totalInnings ? "break" : "done";
  }

  function closeVisit(endInnings, reason, entryKind = "darts") {
    const points = sum(visit, "points");
    const added = visitRole === "batter" ? runsFromVisit(points) : 0;
    const wickets = sum(visit, "wicketsApplied");
    const side = visitRole === "batter" ? battingSide : 1 - battingSide;
    const completed = visitRole === "batter" ? batCount[side] : bowlCount[side];
    const playerIndex = indexOf(side, completed);

    if (visitRole === "batter") {
      runs[battingSide] += added;
      currentInningsRuns += added;
      byInnings[battingSide][Math.floor(inningsIndex / 2)] = currentInningsRuns;
      batCount[side] += 1;
      const stats = playerStats[side][playerIndex];
      stats.battingVisits += 1;
      stats.runs += added;
    } else {
      bowlCount[side] += 1;
      const stats = playerStats[side][playerIndex];
      stats.bowlingVisits += 1;
      stats.wickets += wickets;
    }

    lastVisit = {
      role: visitRole,
      side,
      darts: visit.map((dart) => ({ ...dart })),
      points,
      runs: added,
      wickets,
    };
    if (entryKind === "typed") lastVisit.kind = "typed";
    visit = [];
    if (endInnings) {
      finishInnings(reason, true);
      return;
    }
    visitRole = visitRole === "batter" ? "bowler" : "batter";
  }

  function indexOf(side, count) {
    const list = roster[side];
    if (!list || list.length === 0) return 0;
    return count % list.length;
  }

  function personName(side, role) {
    const count = role === "batter" ? batCount[side] : bowlCount[side];
    return roster[side][indexOf(side, count)];
  }

  function averagesFor() {
    const players = roster.map((list, side) => list.map((name, index) => ({
      name,
      ...summarise(playerStats[side][index]),
    })));
    const sides = players.map((list) => summarise(list.reduce((total, player) => ({
      runs: total.runs + player.runs,
      wickets: total.wickets + player.wickets,
      battingVisits: total.battingVisits + player.battingVisits,
      bowlingVisits: total.bowlingVisits + player.bowlingVisits,
    }), { runs: 0, wickets: 0, battingVisits: 0, bowlingVisits: 0 })));
    return { sides, players };
  }
}

function normaliseEvent(event, legacy) {
  if (!event || typeof event !== "object") throw new Error("Unrecognised match");
  if (event.type === "secondInnings" || event.type === "nextInnings") {
    return { type: "secondInnings" };
  }
  if (event.type === "dart") return { type: "dart", dart: normaliseDart(event.dart) };
  if (legacy) throw new Error("Unrecognised match");
  if (event.type === "declare" || event.type === "finish") return { type: event.type };
  if (event.type === "typedVisit") {
    const points = event.points;
    const wickets = event.wickets;
    if (!Number.isInteger(points) || points < 0 || points > 180) throw new Error("Unrecognised match");
    if (!Number.isInteger(wickets) || wickets < 0 || wickets > 6) throw new Error("Unrecognised match");
    return { type: "typedVisit", points, wickets };
  }
  throw new Error("Unrecognised match");
}

function buildSingles(sides) {
  if (!Array.isArray(sides) || sides.length !== 2) throw new Error("Two sides are required");
  const names = [clipName(sides[0], "Player 1"), clipName(sides[1], "Player 2")];
  return { names, labels: names, players: [[names[0]], [names[1]]] };
}

function buildTeams(sides, players) {
  if (!Array.isArray(players) || players.length !== 2) throw new Error("Two teams are required");
  const roster = [0, 1].map((side) => {
    const list = players[side];
    if (!Array.isArray(list) || list.length !== 2) throw new Error("Each team needs two players");
    return [0, 1].map((index) => clipName(list[index], `Player ${side * 2 + index + 1}`));
  });
  const given = Array.isArray(sides) ? sides : [];
  const labels = [0, 1].map((side) => (typeof given[side] === "string" ? clipName(given[side], "") : ""));
  const names = [0, 1].map((side) => labels[side] || `${roster[side][0]} & ${roster[side][1]}`);
  return { names, labels, players: roster };
}

function normalRoster(match) {
  if (Array.isArray(match.players) && match.players.length === 2) {
    return [0, 1].map((side) => {
      const list = match.players[side];
      if (!Array.isArray(list) || list.length === 0) {
        const fallback = Array.isArray(match.sides) ? match.sides[side] : `Player ${side + 1}`;
        return [String(fallback || `Player ${side + 1}`)];
      }
      return list.map((name) => String(name));
    });
  }
  const names = Array.isArray(match.sides) ? match.sides : ["Player 1", "Player 2"];
  return [0, 1].map((side) => [String(names[side] ?? `Player ${side + 1}`)]);
}

function displayNames(match, roster) {
  if (Array.isArray(match.sides) && match.sides.length === 2 && typeof match.sides[0] === "string") {
    return [match.sides[0], match.sides[1]];
  }
  return [0, 1].map((side) => roster[side].join(" & "));
}

function emptyInnings(count) {
  return Array.from({ length: count }, () => null);
}

function summarise(stats) {
  return {
    runs: stats.runs,
    wickets: stats.wickets,
    battingVisits: stats.battingVisits,
    bowlingVisits: stats.bowlingVisits,
    runsPerVisit: stats.battingVisits === 0 ? null : stats.runs / stats.battingVisits,
    wicketsPerVisit: stats.bowlingVisits === 0 ? null : stats.wickets / stats.bowlingVisits,
  };
}

function chaseFor(runs, battingSide) {
  const opponentRuns = runs[1 - battingSide];
  const battingRuns = runs[battingSide];
  const target = opponentRuns + 1;
  let status = "behind";
  if (battingRuns === opponentRuns) status = "level";
  if (battingRuns > opponentRuns) status = "ahead";
  return {
    opponentRuns,
    battingRuns,
    target,
    needed: Math.max(0, target - battingRuns),
    aheadBy: battingRuns - opponentRuns,
    status,
  };
}

function resultFor(runs) {
  if (runs[0] === runs[1]) return { type: "draw", side: null, margin: 0 };
  const side = runs[0] > runs[1] ? 0 : 1;
  return { type: "win", side, margin: Math.abs(runs[0] - runs[1]) };
}

function describeSegment(role, dart) {
  if (dart.type === "miss") {
    return base("miss", "Miss", "No score", 0, 0, null, null);
  }
  if (dart.type === "outer") {
    return base("wicket", "Outer bull", "", 0, 1, null, 25);
  }
  if (dart.type === "inner") {
    return base("wicket", "Inner bull", "", 0, 2, null, 50);
  }
  const label = `${MULT_MARK[dart.multiplier]}${dart.value}`;
  if (role === "bowler") {
    return base("offtarget", label, "Off target", 0, 0, dart.multiplier, dart.value);
  }
  const points = dart.multiplier * dart.value;
  return base("score", label, String(points), points, 0, dart.multiplier, dart.value);
}

function base(kind, label, note, points, wickets, multiplier, value) {
  return { kind, label, note, points, wickets, multiplier, value };
}

function wicketNote(applied, ended) {
  if (ended) return "All out";
  if (applied === 1) return "1 wicket";
  return "2 wickets";
}

function typedNote(applied, ended) {
  if (ended) return "All out";
  if (applied === 0) return "Visit total";
  if (applied === 1) return "1 wicket";
  return `${applied} wickets`;
}

function sum(list, key) {
  let total = 0;
  for (const item of list) total += item[key];
  return total;
}

function clipName(value, fallback) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  return text || fallback;
}
