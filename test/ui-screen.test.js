import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { Screen } from "../src/ui/screen.js";

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
