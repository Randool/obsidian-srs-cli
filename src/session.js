/**
 * 库级视图 + 一次复习会话的状态机（不认终端，TUI/逐行模式共用）。
 */
import { cardFiles, loadSettings } from "./vault.js";
import { parseFile } from "./parser.js";
import {
  describeInterval as describeIntervalShort,
  buildHistogram,
  isDue,
  isNew,
  noteInitialEase,
  osrSchedule,
  previewGrades,
  addDays,
  todayStr,
  RESPONSES,
} from "./schedule.js";
import { applySchedule, resync, undo } from "./store.js";
import { t } from "./i18n.js";

/** 读全库卡片 + 解析告警。 */
export function loadLibrary(vault) {
  const { settings, notes } = loadSettings(vault);
  const cards = [];
  const warnings = [...notes];
  for (const [file, text] of cardFiles(vault)) {
    const r = parseFile(file, text, settings);
    cards.push(...r.cards);
    warnings.push(...r.warnings);
  }
  if (settings.burySiblingCards) {
    warnings.push(t("msg.buryUnsupported"));
  }
  return { settings, cards, warnings };
}

/** 按 deck 汇总：到期 / 新卡 / 总数 / 最近到期日。 */
export function deckStats(cards, today) {
  const map = new Map();
  for (const c of cards) {
    const s = map.get(c.deck) || { deck: c.deck, due: 0, new: 0, total: 0, next: null };
    s.total++;
    if (isNew(c)) s.new++;
    else if (isDue(c, today)) s.due++;
    else if (!s.next || c.due < s.next) s.next = c.due;
    map.set(c.deck, s);
  }
  return [...map.values()]
    .map((s) => ({ ...s, todo: s.due + s.new }))
    .sort((a, b) => (a.deck < b.deck ? -1 : a.deck > b.deck ? 1 : 0));
}

export function filterCards(cards, { deck = null, mode = "all" } = {}) {
  let out = cards;
  if (deck) out = out.filter((c) => c.deck === deck || c.deck.startsWith(`${deck}/`));
  if (mode === "new") out = out.filter(isNew);
  if (mode === "due") out = out.filter((c) => !isNew(c));
  return out;
}

/** Fisher-Yates；rng 可注入，方便测试。 */
export function shuffle(a, rng = Math.random) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** 出题方式的中文/英文说法（界面直接显示）。 */
export function orderLabel(order) {
  return t(order === "random" ? "order.random" : "order.plugin");
}

/**
 * 出卡顺序。
 *  order = 'plugin'：照插件的 flashcardDeckOrder / flashcardCardOrder（逐 deck 一组一组出）
 *  order = 'random'：把所有选中的卡整体打散（跨 deck 混排），想换脑子时用
 */
export function buildQueue(cards, settings, today, { limit = null, order = "plugin", rng = Math.random } = {}) {
  if (order === "random") {
    const q = shuffle(cards, rng);
    return limit ? q.slice(0, limit) : q;
  }
  const byDeck = new Map();
  for (const c of cards) {
    if (!byDeck.has(c.deck)) byDeck.set(c.deck, []);
    byDeck.get(c.deck).push(c);
  }
  let names = [...byDeck.keys()];
  names = String(settings.flashcardDeckOrder).endsWith("Random") ? shuffle(names, rng) : names.sort();

  const cardOrder = String(settings.flashcardCardOrder);
  const rand = cardOrder.endsWith("Random");
  const queue = [];
  for (const d of names) {
    let due = byDeck.get(d).filter((c) => !isNew(c) && isDue(c, today));
    let fresh = byDeck.get(d).filter(isNew);
    if (rand) {
      due = shuffle(due, rng);
      fresh = shuffle(fresh, rng);
    }
    if (cardOrder.startsWith("EveryCardRandom")) queue.push(...shuffle([...due, ...fresh], rng));
    else if (cardOrder.startsWith("DueFirst")) queue.push(...due, ...fresh);
    else queue.push(...fresh, ...due);
  }
  return limit ? queue.slice(0, limit) : queue;
}

/**
 * 一次复习会话。所有状态变化都过这里，界面层只负责显示和读键。
 */
export class Session {
  constructor({ library, today = todayStr(), deck = null, mode = "all", limit = null, dryRun = false, order = "plugin", backup = true }) {
    this.settings = library.settings;
    this.allCards = library.cards;
    this.warnings = library.warnings;
    this.today = today;
    this.deck = deck;
    this.mode = mode;
    this.dryRun = dryRun;
    this.backup = backup;

    this.order = order;
    const pool = filterCards(this.allCards, { deck, mode });
    this.queue = buildQueue(pool, this.settings, today, { limit, order });
    this.hist = buildHistogram(this.allCards, today);

    // 插件在笔记加载时就固定了每篇笔记的 ease；这里同样取开头快照
    this.noteEase = new Map();
    const byFile = new Map();
    for (const c of this.allCards) {
      if (!byFile.has(c.file)) byFile.set(c.file, []);
      byFile.get(c.file).push(c);
    }
    for (const [file, list] of byFile) this.noteEase.set(file, noteInitialEase(list, this.settings));

    this.index = 0;
    this.answered = 0;
    this.skipped = 0;
    this.counts = { again: 0, hard: 0, good: 0, easy: 0 };
    this.history = [];
    this.startedAt = Date.now();
    this.againRequeued = 0;
    this.lastMessage = "";
  }

  get card() {
    return this.queue[this.index] || null;
  }

  get total() {
    return this.queue.length;
  }

  get finished() {
    return this.index >= this.queue.length;
  }

  /** 四档「现在按会怎样」的预览，只算不写。 */
  preview() {
    const c = this.card;
    if (!c) return null;
    const noteEase = this.noteEase.get(c.file) ?? this.settings.baseEase;
    return previewGrades(c, this.settings, this.hist, noteEase);
  }

  /** 评分。返回给用户看的一句话。 */
  grade(response) {
    const card = this.card;
    if (!card) return "";
    const noteEase = this.noteEase.get(card.file) ?? this.settings.baseEase;
    const startInterval = isNew(card) ? 1 : card.interval;
    const startEase = isNew(card) ? noteEase : card.ease;
    const { interval, ease } = osrSchedule(response, startInterval, startEase, 0, this.settings, this.hist);
    const due = addDays(this.today, Math.round(interval));
    const snap = applySchedule(card, due, interval, ease, { dryRun: this.dryRun, backup: this.backup });
    const bucket = Math.round(interval);
    this.hist.set(bucket, (this.hist.get(bucket) || 0) + 1);
    this.history.push({ index: this.index, card, snap, bucket, response });
    this.answered++;
    this.counts[response]++;
    if (!this.dryRun) resync(card.file, this.queue, this.settings);

    const label = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" }[response];
    const msg = t("review.graded", { label, ivl: describeIntervalShort(interval), due });
    this.lastMessage = msg;

    if (response === "again" && this.againRequeued < 3) {
      this.againRequeued++;
      this.queue.push(card);
    }
    this.index++;
    return msg;
  }

  /** 把「还没看到的部分」重新打乱（已答的不动）。 */
  reshuffle(rng = Math.random) {
    const done = this.queue.slice(0, this.index);
    const rest = this.queue.slice(this.index);
    this.queue = done.concat(shuffle(rest, rng));
    this.lastMessage = t("review.reshuffled", { n: rest.length });
    return this.lastMessage;
  }

  /** 跳过这张（本次不再出，不写盘）。 */
  skip() {
    this.skipped++;
    this.index++;
    this.lastMessage = t("review.skipped");
  }

  /** 撤销上一张：数据、指针、直方图一起回滚。 */
  undoLast() {
    const last = this.history.pop();
    if (!last) return t("review.undoNothing");
    const left = (this.hist.get(last.bucket) || 0) - 1;
    if (left <= 0) this.hist.delete(last.bucket);
    else this.hist.set(last.bucket, left);
    undo(last.snap, { dryRun: this.dryRun });
    if (!this.dryRun) resync(last.card.file, this.queue, this.settings);
    this.answered--;
    this.counts[last.response] = Math.max(0, this.counts[last.response] - 1);
    this.index = last.index;
    this.lastMessage = t("review.undone", { front: last.card.front.slice(0, 24) });
    return this.lastMessage;
  }

  summary() {
    const elapsed = Math.round((Date.now() - this.startedAt) / 1000);
    const upcoming = [...this.allCards]
      .filter((c) => !isNew(c) && !isDue(c, this.today))
      .map((c) => c.due)
      .sort();
    return {
      answered: this.answered,
      skipped: this.skipped,
      left: Math.max(0, this.queue.length - this.index),
      counts: this.counts,
      elapsed,
      dryRun: this.dryRun,
      nextDue: upcoming[0] || null,
      nextDueCount: upcoming.filter((d) => d === upcoming[0]).length,
      total: this.queue.length,
    };
  }
}

export { RESPONSES, isDue, isNew };
