import test from "node:test";
import assert from "node:assert/strict";
import { parseFile, cleanText } from "../src/parser.js";
import { DEFAULTS } from "../src/vault.js";

const S = DEFAULTS;

test("单行卡：一行一张，不需要空行隔开", () => {
  const text = [
    "#flashcards/demo/kana",
    "",
    "あ :: a",
    "い :: i",
    "う :: u",
    "<!--SR:!2026-10-28,6,230-->",
    "え :: e",
    "",
  ].join("\n");
  const { cards } = parseFile("t.md", text, S);
  assert.equal(cards.length, 4);
  assert.deepEqual(cards.map((c) => c.front), ["あ", "い", "う", "え"]);
  // 注释属于紧邻的上一张（う）
  assert.equal(cards[2].due, "2026-10-28");
  assert.equal(cards[2].interval, 6);
  assert.equal(cards[2].ease, 230);
  assert.equal(cards[0].srLine, null);
});

test("单行卡：答案里不会混进 SR 注释", () => {
  const text = ["#flashcards/x", "", "Q :: A", "<!--SR:!2026-10-28,6,230-->", ""].join("\n");
  const { cards } = parseFile("t.md", text, S);
  assert.equal(cards[0].back, "A");
  assert.ok(!cards[0].back.includes("<!--SR:"));
});

test("多行卡：单独一行 ? 收答案，答案可跨行", () => {
  const text = [
    "#flashcards/x",
    "",
    "问一句",
    "第二行题面",
    "?",
    "答一",
    "答二",
    "<!--SR:!2026-11-01,4,270-->",
    "",
  ].join("\n");
  const { cards } = parseFile("t.md", text, S);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].front, "问一句\n第二行题面");
  assert.equal(cards[0].back, "答一\n答二");
  assert.equal(cards[0].due, "2026-11-01");
  assert.equal(cards[0].srLine, 7);
  assert.equal(cards[0].endLine, 7); // 注释行也算卡片块的尾巴（与插件一致）
});

test("非 SR 的 HTML 注释会吞掉后面一行（复刻插件行为）", () => {
  const text = [
    "#flashcards/x",
    "",
    "<!-- 分组标题 -->",
    "a :: 1",
    "i :: 2",
    "",
  ].join("\n");
  const { cards, warnings } = parseFile("t.md", text, S);
  assert.deepEqual(cards.map((c) => c.front), ["i"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /吞掉/);

  // 注释后补一个空行就救回来了
  const fixed = parseFile("t.md", ["#flashcards/x", "", "<!-- 分组标题 -->", "", "a :: 1", "i :: 2", ""].join("\n"), S);
  assert.deepEqual(fixed.cards.map((c) => c.front), ["a", "i"]);
  assert.equal(fixed.warnings.length, 0);
});

test("反向卡跳过并告警，cloze 标签不误判", () => {
  const text = ["#flashcards/x", "", "A ::: B", "", "C :: D", ""].join("\n");
  const { cards, warnings } = parseFile("t.md", text, S);
  assert.deepEqual(cards.map((c) => c.front), ["C"]);
  assert.match(warnings.join("\n"), /反向卡/);
});

test("deck 由最近的 #flashcards 标签决定，卡前无标签则忽略", () => {
  const text = [
    "前言的 A :: B",
    "",
    "#flashcards/one",
    "",
    "Q1 :: A1",
    "",
    "#flashcards/two/sub",
    "",
    "Q2 :: A2",
    "",
  ].join("\n");
  const { cards } = parseFile("t.md", text, S);
  assert.deepEqual(cards.map((c) => c.deck), ["one", "two/sub"]);
});

test("cleanText 去掉 markdown 装饰与工具元数据", () => {
  assert.equal(cleanText("**粗** [[a|显示]] [[b]] &nbsp;==x=="), "粗 显示 b  x");
  assert.equal(cleanText("行一\n<!--SR:!2026-01-01,1,250-->\n行二"), "行一\n行二");
});
