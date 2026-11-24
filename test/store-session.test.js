import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFile } from "../src/parser.js";
import { countSchedules, applySchedule, undo } from "../src/store.js";
import { Session, loadLibrary } from "../src/session.js";
import { DEFAULTS } from "../src/vault.js";

const S = DEFAULTS;

function tmpVault(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "srs-test-"));
  fs.mkdirSync(path.join(dir, "learning"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".obsidian/plugins/obsidian-spaced-repetition"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".obsidian/plugins/obsidian-spaced-repetition/data.json"),
    JSON.stringify({ settings: { ...DEFAULTS } })
  );
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, "learning", name), text);
  return dir;
}

test("有排程的卡：原位替换，条数不变", () => {
  const dir = tmpVault({ "t.md": "#flashcards/t\n\n卡 :: 答\n<!--SR:!2026-10-28,6,230-->\n" });
  const file = path.join(dir, "learning/t.md");
  const { cards } = parseFile(file, fs.readFileSync(file, "utf8"), S);
  applySchedule(cards[0], "2026-11-12", 14, 230);
  const text = fs.readFileSync(file, "utf8");
  assert.equal(countSchedules(text), 1);
  assert.match(text, /<!--SR:!2026-11-12,14,230-->/);
  assert.match(text, /^卡 :: 答$/m);
});

test("新卡：注释插在卡片块之后，多行卡插在答案末行", () => {
  const dir = tmpVault({ "t.md": "#flashcards/t\n\n题\n?\n答一\n答二\n" });
  const file = path.join(dir, "learning/t.md");
  const { cards } = parseFile(file, fs.readFileSync(file, "utf8"), S);
  applySchedule(cards[0], "2026-11-01", 3, 250);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  assert.equal(lines[6], "<!--SR:!2026-11-01,3,250-->");
  assert.equal(countSchedules(lines.join("\n")), 1);
});

test("撤销：替换型恢复原行，插入型删掉那一行", () => {
  const dir = tmpVault({ "t.md": "#flashcards/t\n\nA :: 1\n<!--SR:!2026-10-28,6,230-->\n\nB :: 2\n" });
  const file = path.join(dir, "learning/t.md");
  const before = fs.readFileSync(file, "utf8");

  const { cards } = parseFile(file, before, S);
  const snapA = applySchedule(cards[0], "2026-11-12", 14, 230);
  const snapB = applySchedule(cards[1], "2026-11-01", 3, 250);
  undo(snapB);
  undo(snapA);
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("dryRun 完全不落盘", () => {
  const dir = tmpVault({ "t.md": "#flashcards/t\n\nA :: 1\n" });
  const file = path.join(dir, "learning/t.md");
  const before = fs.readFileSync(file, "utf8");
  const { cards } = parseFile(file, before, S);
  applySchedule(cards[0], "2026-11-01", 3, 250, { dryRun: true });
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("会话：作答推进、撤销回滚指针与统计、跳过不写盘", () => {
  const dir = tmpVault({
    "t.md": [
      "#flashcards/t",
      "",
      "A :: 1",
      "<!--SR:!2026-10-28,6,230-->",
      "",
      "B :: 2",
      "",
      "C :: 3",
      "",
    ].join("\n"),
  });
  const library = loadLibrary(dir);
  const session = new Session({ library, today: "2026-10-29", deck: "t" });
  assert.equal(session.total, 3);

  const first = session.card;
  const msg = session.grade("good");
  assert.match(msg, /Good/);
  assert.equal(session.index, 1);
  assert.equal(session.counts.good, 1);

  const msg2 = session.undoLast();
  assert.match(msg2, /撤销/);
  assert.equal(session.index, 0);
  assert.equal(session.counts.good, 0);
  assert.equal(session.card, first);

  session.skip();
  assert.equal(session.skipped, 1);
  assert.equal(session.index, 1);

  const s = session.summary();
  assert.equal(s.answered, 0);
  assert.equal(s.skipped, 1);
  assert.equal(s.left, 2);
});

test("Again 会把卡挪到本次末尾重出（最多 3 次）", () => {
  const dir = tmpVault({ "t.md": "#flashcards/t\n\nA :: 1\n\n<!--SR:!2026-10-28,6,230-->\n" });
  const library = loadLibrary(dir);
  const session = new Session({ library, today: "2026-10-29", deck: "t" });
  const before = session.total;
  session.grade("again");
  assert.equal(session.total, before + 1);
  assert.equal(session.counts.again, 1);
});
