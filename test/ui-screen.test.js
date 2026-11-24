import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { Screen } from "../src/ui/screen.js";
import { homeRows } from "../src/ui/home.js";
import { t } from "../src/i18n.js";

test("Screen 缓冲连续按键，粘贴/快输不丢字符", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const screen = new Screen(output, input);
  screen.enter();
  try {
    input.write("ab");
    input.end();
    const first = await screen.rawKey();
    const second = await screen.rawKey();
    assert.equal(first?.key.name, "a");
    assert.equal(second?.key.name, "b");
  } finally {
    screen.leave();
  }
});

test("主页每个 deck 行都显示 deck 名而不是 undefined", () => {
  const card = (deck, srLine = null, due = null) => ({ deck, srLine, due });
  const rows = homeRows([
    card("history"),
    card("cs/networking", 1, "2026-10-28"),
    card("science/biology"),
  ], "2026-10-29");

  assert.equal(rows[0].label, t("common.all"));
  assert.deepEqual(rows.slice(1).map((r) => r.label), ["cs/networking", "history", "science/biology"]);
  for (const r of rows) assert.ok(r.label, `row ${r.deck} has no label`);
});
