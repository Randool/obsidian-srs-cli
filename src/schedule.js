/**
 * 排程：SM-2-OSR，逐行照搬插件的 osrSchedule / findLeastUsedIntervalOverRange /
 * calculateFlashcardAvgEase。纯函数。
 */
import { t } from "./i18n.js";

export const RESPONSES = ["again", "hard", "good", "easy"];

/** 评分键：只用数字，TUI 与逐行模式共用。 */
export const GRADE_KEYS = Object.fromEntries(RESPONSES.map((r, i) => [String(i + 1), r]));

export const RESPONSE_LABEL = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };

/**
 * 严格的 YYYY-MM-DD 校验：只看形状不够，Date.UTC 会把 2026-02-30
 * 悄悄进位成 3 月 2 日，所以要按原值往返核对；非字符串直接判无效，
 * 避免 daysBetween 里对 null 做 split 而崩溃。
 */
export function isValidDateStr(dateStr) {
  if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * 新卡 = 没有 SR 注释行，或注释行没能解析出合法 due。
 * 后一种是格式损坏的排程注释（如日期位数不对）：parser 会保留 srLine
 * 以便下次作答时原位覆盖，但排程上必须按新卡处理，否则 buildHistogram
 * 等处拿到 due=null 就会崩。
 */
export const isNew = (card) => card == null || card.srLine === null || !isValidDateStr(card.due);

export const isDue = (card, today) => isNew(card) || card.due <= today;

/** 插件 DueDateHistogram：key = 距今天数（负数=逾期）。 */
export function buildHistogram(cards, today) {
  const hist = new Map();
  for (const c of cards) {
    if (isNew(c)) continue;
    const k = daysBetween(today, c.due);
    if (!Number.isFinite(k)) continue;
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  return hist;
}

function findLeastUsedInterval(hist, interval, fuzz) {
  if (!hist.has(interval)) return interval;
  let result = interval;
  outer: for (let k = 1; k <= fuzz; k++) {
    for (const ivl of [interval - k, interval + k]) {
      if (!hist.has(ivl)) {
        result = ivl;
        break outer;
      }
      if (hist.get(ivl) < hist.get(result)) result = ivl;
    }
  }
  return result;
}

/**
 * 一次作答后的新间隔与 ease。
 * 注意：loadBalance 打开时**即使直方图为空也会取整**（插件传的 histogram 对象始终存在），
 * 所以新卡 Good 是 round(2.5)=3 而不是 2.5。
 */
export function osrSchedule(response, interval, ease, delayedDays, settings, hist) {
  let ivl = Math.max(1, Number(interval));
  let e = ease;

  if (response === "easy") {
    e += 20;
    ivl = (((ivl + delayedDays) * e) / 100) * settings.easyBonus;
  } else if (response === "good") {
    ivl = ((ivl + delayedDays / 2) * e) / 100;
  } else if (response === "hard") {
    e = Math.max(130, e - 20);
    ivl = Math.max(1, (ivl + delayedDays / 4) * settings.lapsesIntervalChange);
  } else if (response === "again") {
    e = Math.max(130, e - 20);
    ivl = 0;
  }

  if (settings.loadBalance && hist) {
    ivl = Math.round(ivl);
    if (ivl > 7) {
      let fuzz;
      if (ivl <= 21) fuzz = 1;
      else if (ivl <= 180) fuzz = Math.min(3, Math.floor(ivl * 0.05));
      else fuzz = Math.min(7, Math.floor(ivl * 0.025));
      ivl = findLeastUsedInterval(hist, ivl, fuzz);
    }
  }

  ivl = Math.min(ivl, settings.maximumInterval);
  return { interval: Math.round(ivl * 10) / 10, ease: e };
}

/** 新卡的初始 ease：插件在笔记加载时按已排程卡的平均值算（log 加权）。 */
export function noteInitialEase(cardsInNote, settings) {
  const sched = cardsInNote.filter((c) => !isNew(c) && Number.isFinite(c.ease));
  if (!sched.length) return settings.baseEase;
  const avg = sched.reduce((a, c) => a + c.ease, 0) / sched.length;
  const contrib = Math.min(1, Math.log(sched.length + 0.5) / Math.log(64));
  return Math.round(avg * contrib + settings.baseEase * (1 - contrib));
}

/** 逾期天数：插件 `delayedBeforeReviewDays = max(0, floor((today - due) / 天))`。 */
export function daysLate(card, today) {
  if (isNew(card) || !card.due) return 0;
  return Math.max(0, daysBetween(card.due, today));
}

/** 四档预览：不改数据，只算「如果现在按 X 会怎样」。 */
export function previewGrades(card, settings, hist, noteEase, today = todayStr()) {
  const startInterval = isNew(card) ? 1 : card.interval;
  const startEase = isNew(card) ? noteEase : card.ease;
  const delayed = daysLate(card, today);
  const out = {};
  for (const r of RESPONSES) {
    out[r] = osrSchedule(r, startInterval, startEase, delayed, settings, hist);
  }
  return out;
}

/** 间隔的人话：0 说「马上」，其余按天/月/年（文案走 i18n）。 */
export function describeInterval(days) {
  if (days === 0) return t("ivl.now");
  if (days < 1) return t("ivl.ltDay");
  if (days < 31) return t("ivl.days", { n: trim(days) });
  if (days < 365) return t("ivl.months", { n: trim(days / 30.4) });
  return t("ivl.years", { n: trim(days / 365) });
}

function trim(n) {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : String(r);
}

// ---------------------------------------------------------------- 日期（按本地日历日算）
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${
    String(d.getDate()).padStart(2, "0")
  }`;
}

function dayNumber(dateStr) {
  if (!isValidDateStr(dateStr)) return NaN;
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * 日期间隔。入参不是合法 YYYY-MM-DD 时返回 NaN 而不是崩溃，
 * 调用方（buildHistogram 等）遇到 NaN 应跳过该卡。
 */
export function daysBetween(fromStr, toStr) {
  if (!isValidDateStr(fromStr) || !isValidDateStr(toStr)) return NaN;
  return Math.round((dayNumber(toStr) - dayNumber(fromStr)) / 86400000);
}

export function addDays(dateStr, days) {
  if (!isValidDateStr(dateStr)) throw new Error(`日期格式不对：${dateStr}`);
  const d = new Date(dayNumber(dateStr) + days * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${
    String(d.getUTCDate()).padStart(2, "0")
  }`;
}
