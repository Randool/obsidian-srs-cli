import test from "node:test";
import assert from "node:assert/strict";
import { buildQueue, filterCards, Session } from "../src/session.js";
import { DEFAULTS } from "../src/vault.js";

const S = DEFAULTS;
const TODAY = "2026-10-29";

function card(deck, n, { due = null, interval = null, ease = null } = {}) {
  return {
    deck,
    front: `${deck}#${n}`,
    back: "b",
    file: `/tmp/${deck}.md`,
    srLine: due ? 1 : null,
    due,
    interval,
    ease,
  };
}

const SEQ = {
  ...S,
  flashcardDeckOrder: "PrevDeckComplete_Sequential",
  flashcardCardOrder: "DueFirstSequential",
};

test("plugin 模式：逐 deck 成组，组内到期在前", () => {
  const cards = [
    card("b", 1, { due: "2026-10-29", interval: 1, ease: 250 }),
    card("a", 1, { due: "2026-10-28", interval: 1, ease: 250 }),
    card("b", 2),
    card("a", 2),
  ];
  const q = buildQueue(cards, SEQ, TODAY, { order: "plugin" });
  assert.deepEqual(
    q.map((c) => c.front),
    ["a#1", "a#2", "b#1", "b#2"],
  );
});

test("random 模式：跨 deck 混排（同一 deck 的卡不再成块）", () => {
  const cards = [];
  for (const d of ["a", "b", "c"]) for (let i = 1; i <= 4; i++) cards.push(card(d, i));
  const q = buildQueue(cards, SEQ, TODAY, { order: "random", rng: () => 0.42 });

  assert.equal(q.length, 12);
  assert.deepEqual(new Set(q.map((c) => c.front)).size, 12);
  // 相邻两张几乎不会是同一 deck（成块顺序时必然大半相同）
  const sameNeighbors = q.filter((c, i) => i > 0 && c.deck === q[i - 1].deck).length;
  assert.ok(sameNeighbors <= 4, `同 deck 相邻太多：${sameNeighbors}`);
});

test("random 模式尊重 limit，且不重复", () => {
  const cards = [];
  for (let i = 0; i < 20; i++) cards.push(card("a", i));
  const q = buildQueue(cards, S, TODAY, { order: "random", limit: 5, rng: Math.random });
  assert.equal(q.length, 5);
  assert.equal(new Set(q.map((c) => c.front)).size, 5);
});

test("会话中途重洗：已答部分不动，剩余部分重排", () => {
  const lib = {
    settings: SEQ,
    warnings: [],
    cards: [
      card("a", 1, { due: "2026-10-28", interval: 1, ease: 250 }),
      card("a", 2, { due: "2026-10-28", interval: 1, ease: 250 }),
      card("a", 3, { due: "2026-10-28", interval: 1, ease: 250 }),
      card("a", 4, { due: "2026-10-28", interval: 1, ease: 250 }),
    ],
  };
  const s = new Session({ library: lib, today: TODAY, order: "plugin" });
  const before = s.queue.map((c) => c.front);
  const done = before.slice(0, 2);
  s.index = 2;

  const msg = s.reshuffle(() => 0.9);
  assert.match(msg, /2 张已打乱/);
  assert.deepEqual(
    s.queue.slice(0, 2).map((c) => c.front),
    done,
  );
  assert.deepEqual(new Set(s.queue.slice(2).map((c) => c.front)), new Set(before.slice(2)));
  assert.equal(s.queue.length, before.length);
});

test("random 模式不排出未到期的熟卡", () => {
  const cards = [
    card("a", 1, { due: "2026-10-28", interval: 1, ease: 250 }),
    card("a", 2, { due: "2026-12-01", interval: 30, ease: 250 }),
    card("a", 3, { due: "2027-06-01", interval: 200, ease: 250 }),
    card("a", 4),
  ];
  const q = buildQueue(cards, S, TODAY, { order: "random", rng: () => 0.5 });
  assert.deepEqual(q.map((c) => c.front).sort(), ["a#1", "a#4"]);
});

test("filterCards：all 是到期+新卡，due 只含到期卡", () => {
  const cards = [
    card("a", 1, { due: "2026-10-28", interval: 1, ease: 250 }),
    card("a", 2, { due: "2026-12-01", interval: 30, ease: 250 }),
    card("a", 3),
  ];
  assert.deepEqual(filterCards(cards, { today: TODAY }).map((c) => c.front), ["a#1", "a#3"]);
  assert.deepEqual(filterCards(cards, { today: TODAY, mode: "due" }).map((c) => c.front), ["a#1"]);
  assert.deepEqual(filterCards(cards, { today: TODAY, mode: "new" }).map((c) => c.front), ["a#3"]);
});
