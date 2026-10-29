/**
 * 终端绘制的底层：颜色、显示宽度、折行、进度条、边框。
 * 全部是纯函数，方便单独测。
 */
import { t } from "../i18n.js";

export const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  grey: "\x1b[90m",
  white: "\x1b[97m",
  bgHi: "\x1b[48;5;238m",
};

export function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

const WIDE = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff],
];

function charWidth(cp) {
  if (cp >= 0x20000) return 2;
  for (const [lo, hi] of WIDE) if (cp >= lo && cp <= hi) return 2;
  return 1;
}

/** 显示宽度：CJK / 全角 / emoji 记 2 格。 */
export function strWidth(s) {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charWidth(ch.codePointAt(0));
  return w;
}

export function pad(s, width) {
  return s + " ".repeat(Math.max(0, width - strWidth(s)));
}

export function padStart(s, width) {
  return " ".repeat(Math.max(0, width - strWidth(s))) + s;
}

/** 超宽截断（保留颜色闭包交给调用方），末尾加省略号。 */
export function clip(s, width) {
  if (strWidth(s) <= width) return s;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0));
    if (w + cw > Math.max(0, width - 1)) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

/** 按显示宽度折行，保留原文换行。 */
export function wrap(text, width) {
  const lines = [];
  for (const para of String(text).split("\n")) {
    if (!para) {
      lines.push("");
      continue;
    }
    let line = "";
    let w = 0;
    for (const ch of para) {
      const cw = charWidth(ch.codePointAt(0));
      if (w + cw > width) {
        lines.push(line);
        line = "";
        w = 0;
      }
      line += ch;
      w += cw;
    }
    lines.push(line);
  }
  return lines;
}

export function progressBar(ratio, width) {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return `${C.cyan}${"█".repeat(filled)}${C.dim}${"░".repeat(Math.max(0, width - filled))}${C.reset}`;
}

export function humanDuration(sec) {
  if (sec < 60) return t("dur.sec", { n: sec });
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? t("dur.minSec", { m, s }) : t("dur.min", { m });
  const h = Math.floor(m / 60);
  return t("dur.hour", { h, m: m % 60 });
}

export function center(text, width) {
  const w = strWidth(text);
  const left = Math.max(0, Math.floor((width - w) / 2));
  return " ".repeat(left) + text;
}
