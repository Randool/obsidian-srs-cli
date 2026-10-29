/**
 * 界面零件：顶栏、方框、键位提示、帮助浮层。
 * 每个函数都只吃字符串、吐字符串，便于肉眼和测试同时检查。
 */
import { C, pad, padStart, stripAnsi, strWidth, clip, wrap, center } from "./ansi.js";

/** 反色高亮的一行（整行铺满，像 TUI 的标题栏）。 */
export function titleBar(width, left, right = "") {
  const l = ` ${left}`;
  const r = right ? `${right} ` : "";
  const fill = Math.max(1, width - strWidth(l) - strWidth(r));
  return `${C.bgHi}${C.bold}${l}${" ".repeat(fill)}${r}${C.reset}`;
}

/** 圆角/直角方框，输入为内容行（已按宽度折好）。 */
export function box(lines, width, { padding = 1 } = {}) {
  const inner = width - 2;
  const contentWidth = inner - padding * 2;
  const out = [];
  out.push(`${C.grey}┌${"─".repeat(inner)}┐${C.reset}`);
  for (const line of lines) {
    const body = padding ? `${" ".repeat(padding)}${pad(line, contentWidth)}${" ".repeat(padding)}` : pad(line, inner);
    out.push(`${C.grey}│${C.reset}${body}${C.grey}│${C.reset}`);
  }
  out.push(`${C.grey}└${"─".repeat(inner)}┘${C.reset}`);
  return out;
}

/**
 * 键位提示：`Space 翻面  z 撤销 …`，键名加粗。
 * 放不下时从尾部丢条目（留「…」提示还有），而不是把字切一半——切口比少提示难看得多。
 */
export function hints(pairs, width) {
  const limit = width - 2;
  const render = (list) =>
    list.map(([k, label]) => `${C.bold}${k}${C.reset} ${C.dim}${label}${C.reset}`).join("  ");

  let list = pairs.slice();
  while (list.length > 1 && strWidth(render(list)) > limit) list.pop();
  const text = render(list);
  const more = list.length < pairs.length ? `${C.dim} …${C.reset}` : "";
  return ` ${clip(text, limit - strWidth(more))}${more}`;
}

/** 一行「到期 / 新卡 / 共」的紧凑统计。 */
export function statLine({ due, fresh, total }, width) {
  const parts = [
    due ? `${C.yellow}${due} 到期${C.reset}` : null,
    fresh ? `${C.cyan}${fresh} 新卡${C.reset}` : null,
    `${C.dim}共 ${total}${C.reset}`,
  ].filter(Boolean);
  return ` ${clip(parts.join(` ${C.dim}·${C.reset} `), width - 2)}`;
}

/**
 * 居中帮助浮层。返回整屏内容（替换主界面），任意键返回。
 */
export function helpScreen(width, rows, { title = "键盘操作", sections }) {
  const innerW = Math.min(width - 4, 72);
  const lines = [];
  lines.push("");
  for (const [head, items] of sections) {
    lines.push(`  ${C.bold}${head}${C.reset}`);
    for (const [keys, desc] of items) {
      lines.push(`    ${pad(keys, 16)}${C.dim}${desc}${C.reset}`);
    }
    lines.push("");
  }
  const framed = box(lines, innerW + 2, { padding: 0 });
  const out = [titleBar(width, title), ""];
  for (const l of framed) out.push(centerStr(l, width));
  out.push("");
  out.push(` ${C.dim}任意键返回${C.reset}`);
  while (out.length < rows) out.push("");
  return out.slice(0, rows);
}

function centerStr(line, width) {
  const w = strWidth(line);
  const left = Math.max(0, Math.floor((width - w) / 2));
  return " ".repeat(left) + line;
}

export { C, pad, padStart, stripAnsi, strWidth, clip, wrap, center };
