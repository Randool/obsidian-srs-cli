/**
 * 卡片编辑模式：就地改题面/答案，不离开复习界面。
 * Tab 切字段，Ctrl-T 切单行/多行，Ctrl-S 保存，Esc 取消。
 */
import { C, clip, strWidth } from "./ansi.js";
import { box, hints, titleBar } from "./chrome.js";
import { t } from "../i18n.js";

const printable = (s) => Array.from(s).filter((ch) => ch === "\n" || !/[\x00-\x1f\x7f]/.test(ch));

/** 把一行按显示宽度切成多行；返回每段的起点（码点下标）。 */
function layoutLine(chars, width) {
  const rows = [];
  let text = "";
  let used = 0;
  let start = 0;
  for (let i = 0; i < chars.length; i++) {
    const w = Math.max(1, strWidth(chars[i]));
    if (text && used + w > width) {
      rows.push({ text, start });
      text = "";
      used = 0;
      start = i;
    }
    text += chars[i];
    used += w;
  }
  rows.push({ text, start });
  return rows;
}

const fieldAt = (text) => ({ chars: Array.from(text), cur: Array.from(text).length, top: 0 });
const lineStart = (a, i) => (i <= 0 ? 0 : a.lastIndexOf("\n", i - 1) + 1);
const lineEnd = (a, i) => {
  const j = a.indexOf("\n", i);
  return j < 0 ? a.length : j;
};
const splitLines = (chars) => {
  const lines = [[]];
  for (const ch of chars) {
    if (ch === "\n") lines.push([]);
    else lines[lines.length - 1].push(ch);
  }
  return lines;
};

export async function editCard({ screen, session }) {
  const card = session.card;
  if (!card) return t("edit.noCard");
  const original = `${card.frontRaw}\x00${card.backRaw}\x00${card.kind}`;
  const fields = [
    { label: t("edit.front"), ...fieldAt(card.frontRaw) },
    { label: t("edit.back"), ...fieldAt(card.backRaw) },
  ];
  let active = 0;
  let multiline = card.kind === "multi";
  let error = "";
  let confirmDiscard = false;

  const dirty = () =>
    multiline !== (card.kind === "multi") ||
    `${fields[0].chars.join("")}\x00${fields[1].chars.join("")}\x00${multiline ? "multi" : "single"}` !==
      original;

  const insert = (f, text) => {
    const s = (multiline ? text : text.replace(/[\r\n]+/g, " ")).replace(/\r\n?/g, "\n").replace(/\t/g, "  ");
    const chars = printable(s);
    f.chars.splice(f.cur, 0, ...chars);
    f.cur += chars.length;
  };

  const up = (f) => {
    const start = lineStart(f.chars, f.cur);
    if (start === 0) return;
    const prevStart = lineStart(f.chars, start - 1);
    f.cur = Math.min(prevStart + (f.cur - start), start - 1);
  };
  const down = (f) => {
    const end = lineEnd(f.chars, f.cur);
    if (end === f.chars.length) return;
    const nextStart = end + 1;
    f.cur = Math.min(nextStart + (f.cur - lineStart(f.chars, f.cur)), lineEnd(f.chars, nextStart));
  };

  const draw = () => {
    const W = screen.columns;
    const R = screen.rows;
    const contentW = Math.max(8, W - 4);
    const height = Math.max(3, R - 7);
    const f = fields[active];
    const lines = splitLines(f.chars);
    const row = f.chars.slice(0, f.cur).filter((ch) => ch === "\n").length;
    const col = f.cur - lineStart(f.chars, f.cur);
    const rows = [];
    let cursorRow = 0;
    let cursorCol = 0;
    lines.forEach((line, i) => {
      const segs = layoutLine(line, contentW);
      if (i < row) cursorRow += segs.length;
      else if (i === row) {
        let seg = segs[0];
        for (const s of segs) if (s.start <= col) seg = s;
        cursorRow += segs.indexOf(seg);
        cursorCol = strWidth(Array.from(seg.text).slice(0, col - seg.start).join(""));
      }
      rows.push(...segs.map((s) => s.text));
    });

    if (cursorRow < f.top) f.top = cursorRow;
    if (cursorRow >= f.top + height) f.top = cursorRow - height + 1;
    f.top = Math.max(0, Math.min(f.top, Math.max(0, rows.length - height)));
    const view = rows.slice(f.top, f.top + height);
    while (view.length < height) view.push("");

    const title = `${t("app.bin")} · ${t("edit.title")} · ${f.label} · ${
      multiline ? t("edit.multi") : t("edit.single")
    }`;
    const pos = t("edit.lineInfo", { row: row + 1, n: lines.length });
    const linesOut = [
      titleBar(W, title, `${Math.min(session.index + 1, session.total)}/${session.total}`),
      "",
      ...box(view, W),
      ` ${
        error ? `${C.red}${clip(error, W - 2)}` : `${C.dim}${f.label} · ${pos}${dirty() ? " · *" : ""}`
      }${C.reset}`,
      hints(
        [
          ["Tab", t("edit.switch")],
          ["Ctrl-T", t("edit.toggle")],
          ["Ctrl-S", t("edit.save")],
          ["Esc", t("edit.cancel")],
          ["←↑↓→", t("edit.move")],
        ],
        W,
      ),
    ];
    screen.draw(linesOut.slice(0, R));
    screen.moveCursor(4 + cursorRow - f.top, 3 + cursorCol);
    screen.showCursor();
  };

  const save = () => {
    if (!dirty()) return t("edit.noChange");
    try {
      const r = session.editCard(
        fields[0].chars.join(""),
        fields[1].chars.join(""),
        multiline ? "multi" : "single",
      );
      if (r.ok) return r.message;
      error = r.message;
    } catch (err) {
      error = t("edit.saveFailed", { err: err?.message || String(err) });
    }
    confirmDiscard = false;
    draw();
    return null;
  };

  draw();
  try {
    for (;;) {
      const raw = await screen.rawKey();
      if (!raw) return t("edit.canceled");
      const { str, key } = raw;
      const name = key?.name;
      const f = fields[active];

      if (key?.ctrl) {
        if (name === "s") {
          const msg = save();
          if (msg) return msg;
        } else if (name === "t") {
          if (multiline && fields.some((x) => x.chars.includes("\n"))) {
            error = t("edit.toSingleBlocked");
            draw();
          } else {
            multiline = !multiline;
            error = "";
            draw();
          }
        } else if (name === "c") return t("edit.canceled");
        continue;
      }
      if (name === "escape") {
        if (dirty() && !confirmDiscard) {
          confirmDiscard = true;
          error = t("edit.discard");
          draw();
          continue;
        }
        return t("edit.canceled");
      }
      if (key?.meta) continue;
      confirmDiscard = false;
      error = "";

      const lineStartNow = lineStart(f.chars, f.cur);
      switch (name) {
        case "tab":
          active = 1 - active;
          break;
        case "return":
        case "enter":
          if (!multiline) multiline = true;
          insert(f, "\n");
          break;
        case "backspace":
          if (f.cur > 0) f.chars.splice(--f.cur, 1);
          break;
        case "delete":
          f.chars.splice(f.cur, 1);
          break;
        case "left":
          f.cur = Math.max(0, f.cur - 1);
          break;
        case "right":
          f.cur = Math.min(f.chars.length, f.cur + 1);
          break;
        case "up":
          up(f);
          break;
        case "down":
          down(f);
          break;
        case "home":
          f.cur = lineStartNow;
          break;
        case "end":
          f.cur = lineEnd(f.chars, f.cur);
          break;
        case "pageup":
          for (let i = 0; i < 8; i++) up(f);
          break;
        case "pagedown":
          for (let i = 0; i < 8; i++) down(f);
          break;
        default:
          if (str && !String(str).startsWith("\x1b")) insert(f, str);
      }
      draw();
    }
  } finally {
    screen.hideCursor();
  }
}
