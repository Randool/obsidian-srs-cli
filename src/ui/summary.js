/**
 * 结束小结：本次干了多少、各档分布、下次什么时候有活。
 * 返回 { action: 'home' | 'quit' }
 */
import { C, center, humanDuration } from "./ansi.js";
import { box, titleBar } from "./chrome.js";
import { RESPONSE_LABEL } from "../schedule.js";
import { t } from "../i18n.js";

const COLORS = { again: C.red, hard: C.yellow, good: C.green, easy: C.cyan };

export async function runSummary({ screen, summary: s, canGoHome }) {
  const draw = () => {
    const W = screen.columns;
    const R = screen.rows;
    const lines = [
      titleBar(
        W,
        `${t("app.bin")} · ${s.left > 0 ? t("summary.stopTitle") : t("summary.doneTitle")}`,
        s.dryRun ? "dry-run" : "",
      ),
      "",
    ];
    const counts = Object.keys(s.counts)
      .map((k) => `${COLORS[k]}${RESPONSE_LABEL[k]} ${s.counts[k]}${C.reset}`)
      .join(`${C.dim}   ${C.reset}`);
    const content = [
      `  ${t("summary.answered", { n: `${C.bold}${s.answered}${C.reset}` })}` +
      (s.skipped ? `  ${C.dim}${t("summary.skipped", { n: s.skipped })}${C.reset}` : "") +
      `  ${C.dim}${t("summary.elapsed", { d: humanDuration(s.elapsed) })}${C.reset}`,
      "",
      `  ${counts}`,
      "",
      `  ${C.dim}${
        s.left > 0
          ? t("summary.left", { n: s.left })
          : s.nextDue
          ? t("summary.nextDue", { date: s.nextDue, n: s.nextDueCount || 0 })
          : t("summary.noUpcoming")
      }${C.reset}`,
    ];
    lines.push(...box(content, Math.min(W - 4, 64) + 2, { padding: 0 }).map((l) => center(l, W)), "");
    lines.push(
      canGoHome
        ? ` ${C.bold}Enter${C.reset} ${C.dim}${t("hint.backHome")}${C.reset}   ${C.bold}q${C.reset} ${C.dim}${
          t("hint.exit")
        }${C.reset}`
        : ` ${C.bold}Enter${C.reset} ${C.dim}${t("hint.exit")}${C.reset}`,
    );
    while (lines.length < R) lines.push("");
    screen.draw(lines.slice(0, R));
  };

  screen.enter();
  try {
    draw();
    for (;;) {
      const k = await screen.key();
      if (k === "ctrl-c" || k === "eof" || k === "q") return { action: "quit" };
      if (k === "enter" || k === "space") return { action: canGoHome ? "home" : "quit" };
    }
  } finally {
    screen.leave();
  }
}
