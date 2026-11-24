/**
 * 卡片编辑模式：就地改题面/答案，不离开复习界面。
 * Tab 切字段，Ctrl-S 保存（走 Session.editCard 的校验与写回），Esc 取消。
 */
import { C, clip, strWidth } from "./ansi.js";
import { box, hints, titleBar } from "./chrome.js";
import { t } from "../i18n.js";

const toLines = (text) =>
  String(text)
    .split("\n")
    .map((line) => Array.from(line));

export const toText = (lines) => lines.map((line) => line.join("")).join("\n");

const printable = (text) => Array.from(text).filter((ch) => !/[\x00-\x1f\x7f]/.test(ch));

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

function fieldAt(text) {
  const lines = toLines(text);
  const row = lines.length - 1;
  return { lines, row, col: lines[row].length, top: 0 };
}

export async function editCard({ screen, session }) {
  const card = session.card;
  if (!card) return t("edit.noCard");

  const original = { front: card.frontRaw, back: card.backRaw };
  const originalKind = card.kind;
  let multiline = card.kind === "multi";
  const fields = [
    { label: t("edit.front"), ...fieldAt(card.frontRaw) },
    { label: t("edit.back"), ...fieldAt(card.backRaw) },
  ];
  let active = 0;
  let error = "";
  let confirmDiscard = false;

  const contentDirty = () =>
    toText(fields[0].lines) !== original.front || toText(fields[1].lines) !== original.back;
  const dirty = () => multiline !== (originalKind === "multi") || contentDirty();

  const insert = (f, text) => {
    const source = (multiline ? String(text) : String(text).replace(/\r\n?|\n/g, " "))
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, "  ");
    const parts = source.split("\n");
    const cur = f.lines[f.row];
    if (parts.length === 1) {
      const chars = printable(parts[0]);
      cur.splice(f.col, 0, ...chars);
      f.col += chars.length;
      return;
    }
    const rest = cur.splice(f.col);
    const first = printable(parts[0]);
    cur.push(...first);
    const middle = parts.slice(1, -1).map(printable);
    const last = printable(parts[parts.length - 1]);
    f.lines.splice(f.row + 1, 0, ...middle, last.concat(rest));
    f.row += parts.length - 1;
    f.col = last.length;
  };

  const draw = () => {
    const W = screen.columns;
    const R = screen.rows;
    const contentW = Math.max(8, W - 4);
    const height = Math.max(3, R - 7);
    const f = fields[active];

    const rows = [];
    let cursorRow = 0;
    let cursorCol = 0;
    for (let i = 0; i < f.lines.length; i++) {
      const segs = layoutLine(f.lines[i], contentW);
      if (i < f.row) cursorRow += segs.length;
      else if (i === f.row) {
        let segIdx = 0;
        for (let j = 0; j < segs.length; j++) if (segs[j].start <= f.col) segIdx = j;
        const seg = segs[segIdx];
        cursorRow += segIdx;
        cursorCol = strWidth(Array.from(seg.text).slice(0, f.col - seg.start).join(""));
      }
      for (const seg of segs) rows.push(seg.text);
    }

    if (cursorRow < f.top) f.top = cursorRow;
    if (cursorRow >= f.top + height) f.top = cursorRow - height + 1;
    f.top = Math.max(0, Math.min(f.top, Math.max(0, rows.length - height)));

    const view = rows.slice(f.top, f.top + height);
    while (view.length < height) view.push("");

    const lines = [
      titleBar(
        W,
        `${t("app.bin")} · ${t("edit.title")} · ${f.label} · ${multiline ? t("edit.multi") : t("edit.single")}`,
        `${Math.min(session.index + 1, session.total)}/${session.total}`,
      ),
      "",
      ...box(view, W),
    ];
    const pos = t("edit.lineInfo", { row: f.row + 1, n: f.lines.length });
    lines.push(
      ` ${
        error
          ? `${C.red}${clip(error, W - 2)}${C.reset}`
          : `${C.dim}${f.label} · ${pos}${dirty() ? " · *" : ""}${C.reset}`
      }`,
    );
    lines.push(
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
    );
    screen.draw(lines.slice(0, R));
    screen.moveCursor(4 + (cursorRow - f.top), 3 + cursorCol);
    screen.showCursor();
  };

  const moveRow = (f, delta) => {
    f.row = Math.max(0, Math.min(f.lines.length - 1, f.row + delta));
    f.col = Math.min(f.col, f.lines[f.row].length);
  };

  const backspace = (f) => {
    const cur = f.lines[f.row];
    if (f.col > 0) {
      cur.splice(f.col - 1, 1);
      f.col--;
    } else if (f.row > 0) {
      const prev = f.lines[f.row - 1];
      const [line] = f.lines.splice(f.row, 1);
      f.col = prev.length;
      prev.push(...line);
      f.row--;
    }
  };

  const del = (f) => {
    const cur = f.lines[f.row];
    if (f.col < cur.length) cur.splice(f.col, 1);
    else if (f.row < f.lines.length - 1) {
      const [next] = f.lines.splice(f.row + 1, 1);
      cur.push(...next);
    }
  };

  const save = () => {
    if (!dirty()) return t("edit.noChange");
    try {
      const r = session.editCard(
        toText(fields[0].lines),
        toText(fields[1].lines),
        multiline ? "multi" : "single",
      );
      if (r.ok) return r.message;
      error = r.message;
    } catch (err) {
      error = t("edit.saveFailed", { err: err && err.message ? err.message : String(err) });
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
      const name = key && key.name;

      if (key && key.ctrl) {
        if (name === "s") {
          const msg = save();
          if (msg) return msg;
          continue;
        }
        if (name === "t") {
          if (multiline && fields.some((f) => f.lines.length > 1)) {
            error = t("edit.toSingleBlocked");
            draw();
            continue;
          }
          multiline = !multiline;
          error = "";
          draw();
          continue;
        }
        if (name === "c") return t("edit.canceled");
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
      if (key && key.meta) continue;

      confirmDiscard = false;
      const f = fields[active];
      let handled = true;
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
          backspace(f);
          break;
        case "delete":
          del(f);
          break;
        case "left":
          if (f.col > 0) f.col--;
          else if (f.row > 0) {
            f.row--;
            f.col = f.lines[f.row].length;
          }
          break;
        case "right":
          if (f.col < f.lines[f.row].length) f.col++;
          else if (f.row < f.lines.length - 1) {
            f.row++;
            f.col = 0;
          }
          break;
        case "up":
          moveRow(f, -1);
          break;
        case "down":
          moveRow(f, 1);
          break;
        case "home":
          f.col = 0;
          break;
        case "end":
          f.col = f.lines[f.row].length;
          break;
        case "pageup":
          moveRow(f, -8);
          break;
        case "pagedown":
          moveRow(f, 8);
          break;
        default:
          handled = false;
      }

      if (!handled && str && !String(str).startsWith("\x1b")) {
        insert(f, str);
      }
      error = "";
      draw();
    }
  } finally {
    screen.hideCursor();
  }
}
