import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beginSecondInnings,
  createMatch,
  declareInnings,
  finishMatch,
  project,
  recordTypedVisit,
  reviveMatch,
  runsFromVisit,
  throwDart,
  undo,
} from "../logic.js";

const MISS = { type: "miss" };
const OUTER = { type: "outer" };
const INNER = { type: "inner" };

function singles(extra = {}) {
  return createMatch({
    sides: ["Jake", "Sam"],
    wickets: 10,
    battingFirst: 0,
    ...extra,
  });
}

function teams(extra = {}) {
  return createMatch({
    format: "teams",
    sides: ["", ""],
    players: [
      ["Alice", "Bob"],
      ["Cara", "Dan"],
    ],
    wickets: 10,
    battingFirst: 0,
    ...extra,
  });
}

function darts(match, ...shots) {
  for (const shot of shots) match = throwDart(match, shot);
  return match;
}

function treble(value) {
  return { type: "number", multiplier: 3, value };
}

function single(value) {
  return { type: "number", multiplier: 1, value };
}

function batterMisses(match) {
  return darts(match, MISS, MISS, MISS);
}

function bowlOut(match) {
  let guard = 0;
  while (project(match).phase === "live" && guard < 80) {
    guard += 1;
    const view = project(match);
    if (view.visitRole === "batter") match = batterMisses(match);
    else {
      while (project(match).phase === "live" && project(match).visitRole === "bowler") {
        match = throwDart(match, INNER);
      }
    }
  }
  return match;
}

describe("runs above 40", () => {
  it("banks only the points above 40", () => {
    assert.equal(runsFromVisit(60), 20);
    assert.equal(runsFromVisit(41), 1);
    assert.equal(runsFromVisit(40), 0);
    assert.equal(runsFromVisit(38), 0);
    assert.equal(runsFromVisit(0), 0);
    assert.equal(runsFromVisit(171), 131);
    assert.equal(runsFromVisit(85), 45);
  });

  it("treats anything that is not a score as no runs", () => {
    assert.equal(runsFromVisit(-5), 0);
    assert.equal(runsFromVisit(Number.NaN), 0);
    assert.equal(runsFromVisit(Number.POSITIVE_INFINITY), 0);
  });
});

describe("batting visits", () => {
  it("scores treble 20, outer bull, treble 19 as 77 runs and 1 wicket", () => {
    let match = singles();
    match = darts(match, treble(20), OUTER, treble(19));
    const view = project(match);
    assert.equal(view.runs[0], 77);
    assert.equal(view.wicketsRemaining, 9);
    assert.equal(view.wicketsDown, 1);
    assert.equal(view.lastVisit.role, "batter");
    assert.equal(view.lastVisit.points, 117);
    assert.equal(view.lastVisit.runs, 77);
    assert.equal(view.lastVisit.wickets, 1);
    assert.equal(view.lastVisit.darts.map((dart) => dart.label).join(" "), "T20 Outer bull T19");
    assert.equal(view.visitRole, "bowler");
    assert.equal(view.phase, "live");
    assert.equal(view.pendingRuns, 0);
  });

  it("gives a batter bull no points", () => {
    let match = singles();
    match = throwDart(match, OUTER);
    let view = project(match);
    assert.equal(view.visitPoints, 0);
    assert.equal(view.pendingRuns, 0);
    assert.equal(view.wicketsRemaining, 9);
    assert.equal(view.visit[0].note, "1 wicket");

    match = singles();
    match = throwDart(match, INNER);
    view = project(match);
    assert.equal(view.visitPoints, 0);
    assert.equal(view.wicketsRemaining, 8);
    assert.equal(view.visit[0].wicketsApplied, 2);
    assert.equal(view.visit[0].note, "2 wickets");
  });

  it("shows the running 40 sum before the visit is banked", () => {
    let match = singles();
    match = throwDart(match, treble(20));
    const view = project(match);
    assert.equal(view.visitPoints, 60);
    assert.equal(view.pendingRuns, 20);
    assert.equal(view.runs[0], 0);
    assert.equal(view.dartsLeft, 2);
  });
});

describe("bowling visits", () => {
  it("counts only bulls and ignores numbers and misses", () => {
    let match = batterMisses(singles());
    match = darts(match, single(20), MISS, OUTER);
    const view = project(match);
    assert.equal(view.lastVisit.role, "bowler");
    assert.equal(view.lastVisit.wickets, 1);
    assert.equal(view.lastVisit.runs, 0);
    assert.equal(view.lastVisit.darts[0].kind, "offtarget");
    assert.equal(view.lastVisit.darts[0].note, "Off target");
    assert.equal(view.lastVisit.darts[1].kind, "miss");
    assert.equal(view.wicketsRemaining, 9);
    assert.equal(view.runs[0], 0);
    assert.equal(view.visitRole, "batter");
  });

  it("gives the bowler two wickets for an inner bull", () => {
    let match = batterMisses(singles());
    match = throwDart(match, INNER);
    const view = project(match);
    assert.equal(view.wicketsThisVisit, 2);
    assert.equal(view.visit[0].label, "Inner bull");
    assert.equal(view.runs[1], 0);
  });
});

describe("end of an innings", () => {
  it("ignores extra wickets and refuses darts after all out", () => {
    let match = singles({ wickets: 10 });
    match = darts(match, OUTER, MISS, MISS);
    match = darts(match, INNER, INNER, OUTER);
    match = darts(match, OUTER, MISS, MISS);
    match = darts(match, INNER, MISS, MISS);
    assert.equal(project(match).wicketsRemaining, 1);
    assert.equal(project(match).visitRole, "batter");
    match = throwDart(match, INNER);
    const view = project(match);
    assert.equal(view.phase, "break");
    assert.equal(view.wicketsRemaining, 0);
    assert.equal(view.closingVisit.darts.length, 1);
    assert.equal(view.closingVisit.darts[0].wicketsApplied, 1);
    assert.equal(view.closingVisit.darts[0].note, "All out");
    assert.throws(() => throwDart(match, MISS), /No dart can be thrown now/);
  });

  it("banks the batter's runs when the last wicket falls during their visit", () => {
    let match = singles({ wickets: 10 });
    match = darts(match, OUTER, MISS, MISS);
    match = darts(match, INNER, INNER, OUTER);
    match = darts(match, OUTER, MISS, MISS);
    match = darts(match, INNER, MISS, MISS);
    assert.equal(project(match).wicketsRemaining, 1);
    match = throwDart(match, treble(20));
    match = throwDart(match, OUTER);
    const view = project(match);
    assert.equal(view.phase, "break");
    assert.equal(view.runs[0], 20);
    assert.equal(view.inningsRuns, 20);
    assert.equal(view.closingVisit.runs, 20);
    assert.equal(view.closingVisit.wickets, 1);
    assert.equal(view.wicketsRemaining, 0);
  });

  it("opens the chase in the second innings and does not end it when the target is passed", () => {
    let match = darts(singles(), treble(20), MISS, MISS);
    match = bowlOut(match);
    assert.equal(project(match).phase, "break");
    assert.equal(project(match).chase, null);
    assert.equal(project(match).runs[0], 20);
    match = beginSecondInnings(match);
    let view = project(match);
    assert.equal(view.innings, 2);
    assert.equal(view.battingSide, 1);
    assert.equal(view.phase, "live");
    assert.equal(view.chase.target, 21);
    assert.equal(view.chase.needed, 21);
    assert.equal(view.chase.status, "behind");

    match = recordTypedVisit(match, { points: 60, wickets: 0 });
    view = project(match);
    assert.equal(view.runs[1], 20);
    assert.equal(view.chase.status, "level");
    assert.equal(view.phase, "live");
    assert.equal(view.canFinishEarly, false);

    match = batterMisses(match);
    match = recordTypedVisit(match, { points: 41, wickets: 0 });
    view = project(match);
    assert.equal(view.runs[1], 21);
    assert.equal(view.chase.status, "ahead");
    assert.equal(view.chase.aheadBy, 1);
    assert.equal(view.phase, "live");
    assert.equal(view.canFinishEarly, true);
  });

  it("draws level totals and wins by the margin after both sides are out", () => {
    let match = bowlOut(singles());
    match = beginSecondInnings(match);
    match = bowlOut(match);
    let view = project(match);
    assert.equal(view.phase, "done");
    assert.deepEqual(view.result, { type: "draw", side: null, margin: 0 });

    match = darts(singles(), treble(20), MISS, MISS);
    match = bowlOut(match);
    match = beginSecondInnings(match);
    match = bowlOut(match);
    view = project(match);
    assert.equal(view.runs[0], 20);
    assert.equal(view.runs[1], 0);
    assert.deepEqual(view.result, { type: "win", side: 0, margin: 20 });
  });
});

describe("undo, names, and saved matches", () => {
  it("undoes a dart, a whole visit, and the start of the second innings", () => {
    let match = darts(singles(), treble(20), MISS, MISS);
    assert.equal(project(match).runs[0], 20);
    match = undo(match);
    let view = project(match);
    assert.equal(view.runs[0], 0);
    assert.equal(view.visitPoints, 60);
    assert.equal(view.pendingRuns, 20);
    assert.equal(view.dartsThrown, 2);

    match = bowlOut(singles());
    match = beginSecondInnings(match);
    assert.equal(project(match).innings, 2);
    match = undo(match);
    view = project(match);
    assert.equal(view.phase, "break");
    assert.equal(view.innings, 1);
    assert.throws(() => beginSecondInnings(singles()), /second innings/);
  });

  it("trims names to 24 characters and revives a version 1 save", () => {
    const match = createMatch({
      sides: [`  ${"A".repeat(30)}  `, "  Sam  "],
      wickets: 11,
      battingFirst: 1,
      toss: "random",
    });
    assert.equal(match.v, 2);
    assert.equal(match.sides[0], "A".repeat(24));
    assert.equal(match.sides[1], "Sam");
    assert.equal(match.players[1][0], "Sam");
    assert.equal(match.inningsEach, 1);
    assert.equal(match.format, "singles");
    assert.equal(match.toss, "random");
    assert.equal(project(match).battingSide, 1);

    const revived = reviveMatch({
      v: 1,
      sides: ["Jake", "Sam"],
      wickets: 10,
      battingFirst: 0,
      toss: "pick",
      events: [
        { type: "dart", dart: { type: "number", multiplier: 3, value: 20 } },
        { type: "dart", dart: { type: "miss" } },
        { type: "dart", dart: { type: "miss" } },
      ],
    });
    assert.equal(revived.v, 2);
    assert.equal(project(revived).runs[0], 20);
    assert.throws(() => reviveMatch({ v: 1, sides: ["Jake", "Sam"], wickets: 10, battingFirst: 0, events: [{ type: "declare" }] }), /Unrecognised/);
    assert.throws(() => reviveMatch({ v: 3, events: [] }), /Unrecognised/);
    assert.throws(() => reviveMatch(null), /Unrecognised/);
    assert.throws(() => createMatch({ sides: ["A", "B"], wickets: 9, battingFirst: 0 }), /10 or 11/);
  });
});

describe("two innings each", () => {
  it("plays A1, B1, A2, B2 and adds the innings into the match totals", () => {
    let match = singles({ inningsEach: 2 });
    const order = [];
    for (let i = 0; i < 4; i += 1) {
      const before = project(match);
      order.push(before.battingSide);
      assert.equal(before.phase, "live");
      assert.equal(before.sideInnings, i < 2 ? 1 : 2);
      match = recordTypedVisit(match, { points: 40 + (i + 1) * 10, wickets: 0 });
      match = declareInnings(match);
      const closed = project(match);
      if (i < 3) {
        assert.equal(closed.phase, "break");
        match = beginSecondInnings(match);
      } else {
        assert.equal(closed.phase, "done");
      }
    }
    assert.deepEqual(order, [0, 1, 0, 1]);
    const view = project(match);
    assert.deepEqual(view.runs, [10 + 30, 20 + 40]);
    assert.deepEqual(view.byInnings, [
      [10, 30],
      [20, 40],
    ]);
    assert.equal(view.result.side, 1);
    assert.equal(view.result.margin, 20);
  });

  it("does not treat a lead as a win while the opponent still has an innings", () => {
    let match = singles({ inningsEach: 2 });
    match = recordTypedVisit(match, { points: 140, wickets: 0 });
    let view = project(match);
    assert.equal(view.runs[0], 100);
    assert.equal(view.chase, null);
    assert.equal(view.canFinishEarly, false);
    assert.equal(view.phase, "live");

    match = declareInnings(match);
    match = beginSecondInnings(match);
    match = recordTypedVisit(match, { points: 180, wickets: 0 });
    view = project(match);
    assert.equal(view.battingSide, 1);
    assert.equal(view.sideInnings, 1);
    assert.equal(view.runs[1], 140);
    assert.ok(view.runs[1] > view.runs[0]);
    assert.equal(view.chase, null);
    assert.equal(view.canFinishEarly, false);

    match = declareInnings(match);
    match = beginSecondInnings(match);
    view = project(match);
    assert.equal(view.battingSide, 0);
    assert.equal(view.sideInnings, 2);
    assert.equal(view.opponentInningsLeft, 1);
    assert.equal(view.canFinishEarly, false);
    assert.throws(() => finishMatch(match), /cannot be ended/);
  });

  it("reverses the order when the other side bats first", () => {
    let match = singles({ inningsEach: 2, battingFirst: 1 });
    const order = [];
    for (let i = 0; i < 3; i += 1) {
      order.push(project(match).battingSide);
      match = declareInnings(match);
      match = beginSecondInnings(match);
    }
    order.push(project(match).battingSide);
    assert.deepEqual(order, [1, 0, 1, 0]);
  });
});

describe("declare", () => {
  it("ends only the current innings and does not add an empty visit", () => {
    let match = singles({ inningsEach: 2 });
    match = declareInnings(match);
    let view = project(match);
    assert.equal(view.phase, "break");
    assert.equal(view.endReason, "declare");
    assert.equal(view.runs[0], 0);
    assert.equal(view.averages.sides[0].battingVisits, 0);
    assert.equal(view.averages.sides[0].runsPerVisit, null);
    assert.equal(view.closingVisit, null);

    match = undo(match);
    view = project(match);
    assert.equal(view.phase, "live");
    assert.equal(view.canThrow, true);

    match = throwDart(match, treble(20));
    match = declareInnings(match);
    view = project(match);
    assert.equal(view.phase, "break");
    assert.equal(view.runs[0], 20);
    assert.equal(view.inningsRuns, 20);
    assert.equal(view.averages.sides[0].battingVisits, 1);
    assert.equal(view.averages.sides[0].runs, 20);
    assert.equal(view.closingVisit.darts.length, 1);

    match = undo(match);
    view = project(match);
    assert.equal(view.phase, "live");
    assert.equal(view.runs[0], 0);
    assert.equal(view.visitPoints, 60);
    assert.equal(view.averages.sides[0].battingVisits, 0);

    match = declareInnings(darts(match, MISS, MISS));
    match = beginSecondInnings(match);
    assert.equal(project(match).battingSide, 1);
    assert.equal(project(match).sideInnings, 1);
    match = declareInnings(match);
    assert.equal(project(match).phase, "break");
    match = beginSecondInnings(match);
    const again = project(match);
    assert.equal(again.battingSide, 0);
    assert.equal(again.sideInnings, 2);
    assert.equal(again.runs[0], 20);
  });

  it("finishes the match when the last innings is declared", () => {
    let match = declareInnings(singles());
    match = beginSecondInnings(match);
    match = recordTypedVisit(match, { points: 50, wickets: 0 });
    match = declareInnings(match);
    const view = project(match);
    assert.equal(view.phase, "done");
    assert.equal(view.endReason, "declare");
    assert.equal(view.result.side, 1);
    assert.equal(view.result.margin, 10);
  });
});

describe("typed visits", () => {
  it("applies the 40 rule and optional wickets lost, as one visit", () => {
    let match = singles();
    match = recordTypedVisit(match, { points: 60, wickets: 1 });
    let view = project(match);
    assert.equal(view.runs[0], 20);
    assert.equal(view.wicketsRemaining, 9);
    assert.equal(view.lastVisit.kind, "typed");
    assert.equal(view.lastVisit.points, 60);
    assert.equal(view.lastVisit.runs, 20);
    assert.equal(view.lastVisit.wickets, 1);
    assert.equal(view.visitRole, "bowler");
    assert.equal(view.averages.sides[0].battingVisits, 1);
    assert.equal(view.averages.sides[0].runsPerVisit, 20);
    assert.equal(view.averages.sides[1].wickets, 0);
    assert.equal(view.averages.sides[1].bowlingVisits, 0);

    match = batterMisses(match);
    match = recordTypedVisit(match, { points: 38, wickets: 0 });
    view = project(match);
    assert.equal(view.lastVisit.runs, 0);
    assert.equal(view.runs[0], 20);

    match = batterMisses(match);
    match = recordTypedVisit(match, { points: 85 });
    view = project(match);
    assert.equal(view.lastVisit.runs, 45);
    assert.equal(view.runs[0], 65);
    assert.equal(view.averages.sides[0].battingVisits, 3);

    const fresh = singles();
    assert.throws(() => recordTypedVisit(fresh, { points: 181, wickets: 0 }), /0 to 180/);
    assert.throws(() => recordTypedVisit(fresh, { points: 10, wickets: 7 }), /0 to 6/);
    assert.throws(() => recordTypedVisit(fresh, { points: 10.5, wickets: 0 }), /0 to 180/);
    const bowling = batterMisses(singles());
    assert.equal(project(bowling).visitRole, "bowler");
    assert.throws(() => recordTypedVisit(bowling, { points: 60, wickets: 0 }), /cannot be entered/);
  });

  it("ends the innings when the typed wickets are the last ones, and still banks the runs", () => {
    let match = singles({ wickets: 11 });
    match = recordTypedVisit(match, { points: 60, wickets: 6 });
    match = batterMisses(match);
    match = recordTypedVisit(match, { points: 100, wickets: 6 });
    const view = project(match);
    assert.equal(view.phase, "break");
    assert.equal(view.endReason, "allout");
    assert.equal(view.wicketsRemaining, 0);
    assert.equal(view.runs[0], 20 + 60);
    assert.equal(view.averages.sides[0].battingVisits, 2);
    assert.equal(view.averages.sides[1].wickets, 0);
  });
});

describe("early finish", () => {
  it("is available only when the batting side is ahead and the opponent is out of innings", () => {
    let match = recordTypedVisit(singles(), { points: 60, wickets: 0 });
    match = declareInnings(match);
    match = beginSecondInnings(match);
    assert.equal(project(match).canFinishEarly, false);
    match = recordTypedVisit(match, { points: 41, wickets: 0 });
    assert.equal(project(match).runs[1], 1);
    assert.equal(project(match).canFinishEarly, false);

    match = batterMisses(match);
    match = throwDart(match, treble(20));
    let view = project(match);
    assert.equal(view.runs[1], 1);
    assert.equal(view.pendingRuns, 20);
    assert.equal(view.canFinishEarly, false);

    match = darts(match, MISS, MISS);
    view = project(match);
    assert.equal(view.runs[1], 21);
    assert.equal(view.canFinishEarly, true);
    const visits = view.averages.sides[1].battingVisits;
    const bowlingVisits = view.averages.sides[0].bowlingVisits;
    match = throwDart(match, treble(19));
    assert.equal(project(match).visitRole, "bowler");
    assert.equal(project(match).dartsThrown, 1);
    match = finishMatch(match);
    view = project(match);
    assert.equal(view.phase, "done");
    assert.equal(view.endReason, "finish");
    assert.equal(view.runs[1], 21);
    assert.equal(view.averages.sides[1].battingVisits, visits);
    assert.equal(view.averages.sides[1].runs, 21);
    assert.equal(view.averages.sides[0].bowlingVisits, bowlingVisits);
    assert.equal(view.result.side, 1);
    assert.equal(view.result.margin, 1);

    match = undo(match);
    view = project(match);
    assert.equal(view.phase, "live");
    assert.equal(view.visitRole, "bowler");
    assert.equal(view.dartsThrown, 1);
    assert.equal(view.visit[0].label, "T19");
    assert.equal(view.runs[1], 21);
  });
});

describe("teams of two", () => {
  it("rotates batting and bowling separately and keeps both averages", () => {
    let match = teams();
    assert.deepEqual(project(match).sides, ["Alice & Bob", "Cara & Dan"]);
    assert.equal(project(match).batterName, "Alice");
    assert.equal(project(match).bowlerName, "Cara");

    match = recordTypedVisit(match, { points: 60, wickets: 0 });
    assert.equal(project(match).throwingName, "Cara");
    match = darts(match, INNER, MISS, MISS);
    assert.equal(project(match).throwingName, "Bob");
    assert.equal(project(match).batterName, "Bob");
    assert.equal(project(match).bowlerName, "Dan");

    match = recordTypedVisit(match, { points: 80, wickets: 0 });
    assert.equal(project(match).throwingName, "Dan");
    match = darts(match, MISS, MISS, MISS);
    assert.equal(project(match).throwingName, "Alice");
    assert.equal(project(match).batterName, "Alice");

    match = declareInnings(match);
    let view = project(match);
    assert.equal(view.averages.sides[0].battingVisits, 2);
    assert.equal(view.averages.sides[0].runsPerVisit, 30);
    assert.equal(view.averages.players[0][0].name, "Alice");
    assert.equal(view.averages.players[0][0].runsPerVisit, 20);
    assert.equal(view.averages.players[0][1].runsPerVisit, 40);
    assert.equal(view.averages.players[1][0].wicketsPerVisit, 2);
    assert.equal(view.averages.players[1][1].wicketsPerVisit, 0);
    assert.equal(view.averages.sides[1].wicketsPerVisit, 1);
    assert.equal(view.averages.sides[0].bowlingVisits, 0);
    assert.equal(view.averages.sides[0].wicketsPerVisit, null);
    assert.equal(Number.isNaN(view.averages.sides[0].wicketsPerVisit), false);

    match = beginSecondInnings(match);
    view = project(match);
    assert.equal(view.batterName, "Cara");
    assert.equal(view.bowlerName, "Alice");
    match = recordTypedVisit(match, { points: 40, wickets: 0 });
    assert.equal(project(match).throwingName, "Alice");
    match = batterMisses(match);
    view = project(match);
    assert.equal(view.throwingName, "Dan");
    assert.equal(view.batterName, "Dan");
    assert.equal(view.bowlerName, "Bob");
    assert.equal(view.averages.players[0][0].bowlingVisits, 1);
    assert.equal(view.averages.players[0][0].wickets, 0);
  });

  it("uses a team label when one is given and clips every entered name", () => {
    const match = createMatch({
      format: "teams",
      sides: ["  The Oaks  ", ""],
      players: [
        [` ${"N".repeat(30)} `, "Bo"],
        ["Cara", "   "],
      ],
      wickets: 10,
      battingFirst: 0,
    });
    assert.equal(match.sides[0], "The Oaks");
    assert.equal(match.sides[1], "Cara & Player 4");
    assert.equal(match.players[0][0], "N".repeat(24));
    assert.equal(match.labels[0], "The Oaks");
    assert.equal(match.labels[1], "");

    const revived = reviveMatch(JSON.parse(JSON.stringify(match)));
    assert.equal(revived.sides[1], "Cara & Player 4");
    assert.equal(revived.players[0][1], "Bo");
    assert.throws(() => reviveMatch({ ...JSON.parse(JSON.stringify(match)), events: [{ type: "nope" }] }), /Unrecognised/);
  });
});

describe("averages", () => {
  it("counts a finished dart visit and a typed visit, and stays finite with no visits", () => {
    let match = darts(singles(), treble(20), MISS, MISS);
    match = darts(match, OUTER, MISS, MISS);
    match = recordTypedVisit(match, { points: 40, wickets: 0 });
    const view = project(match);
    assert.equal(view.averages.sides[0].battingVisits, 2);
    assert.equal(view.averages.sides[0].runs, 20);
    assert.equal(view.averages.sides[0].runsPerVisit, 10);
    assert.equal(view.averages.players[0][0].runsPerVisit, 10);
    assert.equal(view.averages.sides[1].bowlingVisits, 1);
    assert.equal(view.averages.sides[1].wickets, 1);
    assert.equal(view.averages.sides[1].wicketsPerVisit, 1);
    assert.equal(view.averages.sides[0].wicketsPerVisit, null);
    assert.equal(view.averages.players[1][0].battingVisits, 0);
    assert.equal(view.averages.players[1][0].runsPerVisit, null);

    const declared = project(declareInnings(singles()));
    assert.equal(declared.averages.sides[0].battingVisits, 0);
    assert.equal(declared.averages.sides[0].bowlingVisits, 0);
    assert.equal(declared.averages.sides[1].battingVisits, 0);
    assert.equal(Object.is(declared.averages.sides[0].runsPerVisit, Number.NaN), false);
  });
});
