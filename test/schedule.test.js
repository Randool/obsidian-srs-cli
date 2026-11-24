import test from "node:test";
import assert from "node:assert/strict";
import { osrSchedule, buildHistogram, noteInitialEase, previewGrades, describeInterval, addDays, daysBetween } from "../src/schedule.js";
import { DEFAULTS } from "../src/vault.js";

const S = DEFAULTS;
const empty = () => new Map();

test("四档：有历史卡（interval 6, ease 230）", () => {
  // 直方图非空，走 loadBalance 取整
  const hist = new Map([[6, 1], [3, 1]]);
  const table = {
    again: { interval: 0, ease: 210 },
    hard: { interval: 3, ease: 210 },
    good: { interval: 14, ease: 230 },
    easy: { interval: 20, ease: 250 },
  };
  for (const [response, want] of Object.entries(table)) {
    const got = osrSchedule(response, 6, 230, 0, S, hist);
    assert.deepEqual(got, want, `${response} 应得 ${JSON.stringify(want)}，实得 ${JSON.stringify(got)}`);
  }
});

test("新卡：Good 2.5 → 3（loadBalance 取整即使直方图为空也执行）", () => {
  assert.deepEqual(osrSchedule("good", 1, 250, 0, S, empty()), { interval: 3, ease: 250 });
  assert.deepEqual(osrSchedule("easy", 1, 250, 0, S, empty()), { interval: 4, ease: 270 });
  assert.deepEqual(osrSchedule("hard", 1, 250, 0, S, empty()), { interval: 1, ease: 230 });
  assert.deepEqual(osrSchedule("again", 1, 250, 0, S, empty()), { interval: 0, ease: 230 });
});

test("ease 下限 130、最大间隔夹紧", () => {
  assert.equal(osrSchedule("again", 5, 140, 0, S, empty()).ease, 130);
  const big = osrSchedule("easy", 40000, 300, 0, { ...S, maximumInterval: 100 }, empty());
  assert.equal(big.interval, 100);
});

test("loadBalance 会在窗口内避开扎堆的那天", () => {
  // 14 天已有一张，13 天空着 → 应挪到 13
  const hist = new Map([[14, 1]]);
  const got = osrSchedule("good", 6, 230, 0, S, hist);
  assert.equal(got.interval, 13);
});

test("关闭 loadBalance 时不做取整/抖动", () => {
  const s = { ...S, loadBalance: false };
  assert.equal(osrSchedule("good", 1, 250, 0, s, empty()).interval, 2.5);
});

test("新卡初始 ease 继承本笔记已排程卡的平均值（log 加权）", () => {
  const cards = [
    { srLine: 1, ease: 250, interval: 6 },
    { srLine: null, ease: null, interval: null },
  ];
  const e = noteInitialEase(cards, S);
  // contrib = log(1.5)/log(64) ≈ 0.097 → 250*0.097 + 250*0.903 = 250
  assert.equal(e, 250);
  const low = noteInitialEase([{ srLine: 1, ease: 130, interval: 6 }], S);
  assert.ok(low > 130 && low < 250, `应被 baseEase 拉高，实得 ${low}`);
  assert.equal(noteInitialEase([{ srLine: null }], S), 250);
});

test("previewGrades 不改动输入", () => {
  const card = { srLine: 3, interval: 6, ease: 230, due: "2026-10-28" };
  const before = JSON.stringify(card);
  const p = previewGrades(card, S, new Map([[6, 1]]), 250);
  assert.deepEqual(Object.keys(p).sort(), ["again", "easy", "good", "hard"]);
  assert.equal(p.good.interval, 14);
  assert.equal(JSON.stringify(card), before);
});

test("日期间隔与描述", () => {
  assert.equal(addDays("2026-10-29", 3), "2026-11-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(daysBetween("2026-10-29", "2026-11-12"), 14);
  assert.equal(daysBetween("2026-10-29", "2026-10-20"), -9);
  assert.equal(describeInterval(0), "马上");
  assert.equal(describeInterval(3), "3 天");
  assert.equal(describeInterval(60), "2 个月");
  assert.equal(describeInterval(800), "2.2 年");
});

test("buildHistogram 的 key 是距今天数（逾期为负）", () => {
  const cards = [
    { srLine: 1, due: "2026-10-29", interval: 1, ease: 250 },
    { srLine: 2, due: "2026-11-02", interval: 4, ease: 250 },
    { srLine: null },
  ];
  const h = buildHistogram(cards, "2026-10-29");
  assert.deepEqual([...h.entries()].sort((a, b) => a[0] - b[0]), [[0, 1], [4, 1]]);
});
