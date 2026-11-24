import test from "node:test";
import assert from "node:assert/strict";
import { toText } from "../src/ui/edit.js";

test("编辑缓冲区序列化保留逻辑行之间的换行", () => {
  assert.equal(toText([Array.from("题面"), Array.from("第二行")]), "题面\n第二行");
  assert.equal(toText([Array.from("单行")]), "单行");
});
