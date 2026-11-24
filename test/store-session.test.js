import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFile } from "../src/parser.js";
import { applySchedule, countSchedules, replaceCardText, undo } from "../src/store.js";
import { loadLibrary, Session, validateCardEdit } from "../src/session.js";
import { DEFAULTS } from "../src/vault.js";

const S = DEFAULTS;

function tmpVault(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "srs-test-"));
  fs.mkdirSync(path.join(dir, "learning"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".obsidian/plugins/obsidian-spaced-repetition"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".obsidian/plugins/obsidian-spaced-repetition/data.json"),
    JSON.stringify({ settings: { ...DEFAULTS } }),
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

test("会话：逾期卡按逾期天数延长间隔（与插件延迟项一致）", () => {
  const dir = tmpVault({ "t.md": "#flashcards/t\n\nA :: 1\n<!--SR:!2026-10-18,6,230-->\n" });
  const library = loadLibrary(dir);
  const session = new Session({ library, today: "2026-10-28", deck: "t", backup: false });

  assert.equal(session.preview().good.interval, 25); // (6 + 10/2) * 230 / 100
  session.grade("good");
  const text = fs.readFileSync(path.join(dir, "learning/t.md"), "utf8");
  assert.match(text, /<!--SR:!2026-11-22,25,230-->/); // today + 25 天
});

test("编辑单行卡：只改正文，SR 注释与条数不变", () => {
  const dir = tmpVault({ "t.md": "#flashcards/t\n\n卡 :: 答\n<!--SR:!2026-10-28,6,230-->\n" });
  const file = path.join(dir, "learning/t.md");
  const card = parseFile(file, fs.readFileSync(file, "utf8"), S).cards[0];
  replaceCardText(card, "新题", "新答", S, { backup: false });

  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /^新题 :: 新答$/m);
  assert.match(text, /<!--SR:!2026-10-28,6,230-->/);
  assert.equal(countSchedules(text), 1);
  assert.equal(card.front, "新题");
  assert.equal(card.back, "新答");
});

test("编辑多行卡：行内 deck 标签与 SR 注释都保留", () => {
  const dir = tmpVault({
    "t.md": "#flashcards/t\n\n#flashcards/sub 题\n?\n答\n<!--SR:!2026-11-01,4,270-->\n",
  });
  const file = path.join(dir, "learning/t.md");
  const card = parseFile(file, fs.readFileSync(file, "utf8"), S).cards[0];
  assert.equal(card.kind, "multi");
  assert.equal(card.ownTag, "#flashcards/sub");

  replaceCardText(card, "题一\n题二", "答一\n答二", S, { backup: false });
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /#flashcards\/sub 题一\n题二\n\?\n答一\n答二\n<!--SR:!2026-11-01,4,270-->/);
  assert.equal(countSchedules(text), 1);
  assert.equal(card.deck, "sub");
});

test("编辑校验：单行卡的换行、分隔符、注释、deck 标签都拦住", () => {
  const dir = tmpVault({ "s.md": "#flashcards/t\n\nA :: 1\n", "m.md": "#flashcards/t\n\nQ\n?\nA\n" });
  const singleFile = path.join(dir, "learning/s.md");
  const multiFile = path.join(dir, "learning/m.md");
  const single = parseFile(singleFile, fs.readFileSync(singleFile, "utf8"), S).cards[0];
  const multi = parseFile(multiFile, fs.readFileSync(multiFile, "utf8"), S).cards[0];
  assert.equal(single.kind, "single");
  assert.equal(multi.kind, "multi");

  assert.equal(validateCardEdit(single, "A", "1", S), "");
  assert.ok(validateCardEdit(single, "", "1", S));
  assert.ok(validateCardEdit(single, "A", " ", S));
  assert.ok(validateCardEdit(single, "A\nB", "1", S));
  assert.ok(validateCardEdit(single, "A :: B", "1", S));
  assert.ok(validateCardEdit(single, "A", "1 ::: x", S), "答案里的反向分隔符会把卡变成反向卡");
  assert.ok(validateCardEdit(single, "#flashcards/x A", "1", S));
  assert.ok(validateCardEdit(single, "<!-- x", "1", S));

  assert.equal(validateCardEdit(multi, "Q", "A", S), "");
  assert.ok(validateCardEdit(multi, "Q", "A\n\nB", S), "答案里的空行会提前结束卡片");
  assert.ok(validateCardEdit(multi, "Q", "A\n<!-- note -->", S), "非 SR 注释会吞掉下一行");
  assert.ok(validateCardEdit(multi, "Q", "A\nx :: y", S), "答案里不能出现单行分隔符");
  assert.ok(validateCardEdit(multi, "Q", "A\n??", S), "反向分隔符会把卡变成反向卡");
  assert.ok(validateCardEdit(multi, "Q", "A\n#flashcards/x", S), "答案里的 deck 标签会影响后续卡片");
  assert.ok(validateCardEdit(multi, "Q\n?", "A", S), "题面里的分隔符会提前切卡");
  assert.ok(validateCardEdit(multi, "Q", "A\n<!--SR:!2026-01-01,1,250-->", S), "不能手写 SR 注释");
});

test("Session.editCard 拒绝会让 parser 错位的编辑，且不落盘", () => {
  const dir = tmpVault({ "m.md": "#flashcards/t\n\nQ\n?\nA\n" });
  const file = path.join(dir, "learning/m.md");
  const before = fs.readFileSync(file, "utf8");
  const library = loadLibrary(dir);
  const session = new Session({ library, today: "2026-10-29", deck: "t", backup: false });

  const r = session.editCard("Q", "A\n\nB");
  assert.equal(r.ok, false);
  assert.match(r.message, /空行/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("编辑时单行卡可改成多行格式，并重排后续卡片行号", () => {
  // A 带到期排程，保证 DueFirst 顺序下它一定在 B 前面
  const dir = tmpVault({
    "t.md": "#flashcards/t\n\nA :: 1\n<!--SR:!2026-01-01,6,230-->\n\nB :: 2\n",
  });
  const library = loadLibrary(dir);
  const session = new Session({ library, today: "2026-10-29", deck: "t", backup: false });

  const r = session.editCard("A1", "A2", "multi");
  assert.equal(r.ok, true);
  assert.equal(session.card.kind, "multi");

  session.skip();
  session.grade("good");
  const text = fs.readFileSync(path.join(dir, "learning/t.md"), "utf8");
  assert.match(text, /^A1\n\?\nA2\n<!--SR:!2026-01-01,6,230-->$/m);
  assert.match(text, /^B :: 2\n<!--SR:![\d-]+,[\d.]+,(\d+)-->$/m);
  assert.equal(countSchedules(text), 2);
});

test("编辑时多行卡可改成单行格式；还有换行时拒绝转换", () => {
  const dir = tmpVault({
    "t.md": "#flashcards/t\n\nQ\n?\nA\n<!--SR:!2026-01-01,6,230-->\n",
  });
  const file = path.join(dir, "learning/t.md");
  const library = loadLibrary(dir);
  const session = new Session({ library, today: "2026-10-29", deck: "t", backup: false });
  assert.equal(validateCardEdit(session.card, "Q", "A", S, "single"), "");

  const bad = session.editCard("Q\nQ2", "A", "single");
  assert.equal(bad.ok, false);
  assert.match(bad.message, /换行|line break/);

  const good = session.editCard("Q", "A", "single");
  assert.equal(good.ok, true);
  assert.equal(session.card.kind, "single");
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /^Q::A\n<!--SR:!2026-01-01,6,230-->$/m);
});
