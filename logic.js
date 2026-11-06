/**
 * Wickets & Runs — English cricket darts (bat and bowl).
 *
 * Two sides. One batting innings each. A visit is three darts.
 * The batter throws first in an innings, then the bowler, then the batter.
 *
 * Batter: face value, doubles and trebles score as usual. Only the points
 * above 40 in that visit become runs. Outer bull costs 1 wicket and scores 0.
 * Inner bull costs 2 wickets and scores 0.
 *
 * Bowler: only bulls take wickets (outer 1, inner 2). Every other dart is
 * off target. A deliberate miss scores nothing for either side.
 *
 * At 0 wickets the innings ends at once. Extra wickets on that dart are
 * ignored, and any dart not yet thrown is not played. Runs already on the
 * batter's visit are banked with the 40 rule.
 */

export const RUN_THRESHOLD = 40;

const MULT_MARK = { 1: "S", 2: "D", 3: "T" };

export function runsFromVisit(points) {
  if (!Number.isFinite(points) || points <= RUN_THRESHOLD) return 0;
  return points - RUN_THRESHOLD;
}

export function createMatch({ sides, wickets, battingFirst, toss = "pick" }) {
  if (wickets !== 10 && wickets !== 11) {
    throw new Error("Wickets must be 10 or 11");
  }
  if (battingFirst !== 0 && battingFirst !== 1) {
    throw new Error("Choose which side bats first");
  }
  if (!Array.isArray(sides) || sides.length !== 2) {
    throw new Error("Two sides are required");
  }
  return {
    v: 1,
    sides: [clipName(sides[0], "Player 1"), clipName(sides[1], "Player 2")],
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
  if (!data || data.v !== 1) throw new Error("Unrecognised match");
  const match = createMatch({
    sides: data.sides,
    wickets: data.wickets,
    battingFirst: data.battingFirst,
    toss: data.toss,
  });
  if (!Array.isArray(data.events)) throw new Error("Unrecognised match");
  match.events = data.events.map((event) => {
    if (event?.type === "secondInnings") return { type: "secondInnings" };
    if (event?.type === "dart") return { type: "dart", dart: normaliseDart(event.dart) };
    throw new Error("Unrecognised match");
  });
  return match;
}

export function throwDart(match, dart) {
  const view = project(match);
  if (!view.canThrow) throw new Error("No dart can be thrown now");
  const clean = normaliseDart(dart);
  return { ...match, events: [...match.events, { type: "dart", dart: clean }] };
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
  const runs = [0, 0];
  let innings = 1;
  let phase = "live";
  let battingSide = match.battingFirst;
  let wicketsRemaining = match.wickets;
  let visitRole = "batter";
  let visit = [];
  let lastVisit = null;

  for (const event of match.events) {
    if (event.type === "secondInnings") {
      if (phase !== "break") continue;
      innings = 2;
      battingSide = 1 - match.battingFirst;
      wicketsRemaining = match.wickets;
      visitRole = "batter";
      visit = [];
      lastVisit = null;
      phase = "live";
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
    if (ended || visit.length === 3) {
      lastVisit = bankAndMaybeSwitch(ended);
    }
  }

  const visitPoints = sum(visit, "points");
  const pendingRuns =
    phase === "live" && visitRole === "batter" ? runsFromVisit(visitPoints) : 0;

  return {
    sides: match.sides,
    wicketsSetting: match.wickets,
    battingFirst: match.battingFirst,
    toss: match.toss === "random" ? "random" : "pick",
    innings,
    phase,
    battingSide,
    bowlingSide: 1 - battingSide,
    runs,
    wicketsRemaining: phase === "live" ? wicketsRemaining : 0,
    wicketsDown: match.wickets - (phase === "live" ? wicketsRemaining : 0),
    visitRole,
    throwingSide: visitRole === "batter" ? battingSide : 1 - battingSide,
    visit,
    visitPoints,
    pendingRuns,
    wicketsThisVisit: sum(visit, "wicketsApplied"),
    dartsThrown: visit.length,
    dartsLeft: 3 - visit.length,
    lastVisit,
    closingVisit: phase === "live" ? null : lastVisit,
    chase: innings === 2 ? chaseFor(runs, battingSide) : null,
    result: phase === "done" ? resultFor(runs) : null,
    canUndo: match.events.length > 0,
    canThrow: phase === "live",
  };

  function bankAndMaybeSwitch(inningsOver) {
    const points = sum(visit, "points");
    const added = visitRole === "batter" ? runsFromVisit(points) : 0;
    runs[battingSide] += added;
    const snapshot = {
      role: visitRole,
      side: visitRole === "batter" ? battingSide : 1 - battingSide,
      darts: visit.map((dart) => ({ ...dart })),
      points,
      runs: added,
      wickets: sum(visit, "wicketsApplied"),
    };
    if (inningsOver) {
      phase = innings === 1 ? "break" : "done";
      return snapshot;
    }
    visit = [];
    visitRole = visitRole === "batter" ? "bowler" : "batter";
    return snapshot;
  }
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
