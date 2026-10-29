/**
 * 结束小结：本次干了多少、各档分布、下次什么时候有活。
 * 返回 { action: 'home' | 'quit' }
 */
import { C, center, humanDuration } from "./ansi.js";
import { titleBar, box } from "./chrome.js";
import { RESPONSE_LABEL } from "../schedule.js";
import { t } from "../i18n.js";

const COLORS = { again: C.red, hard: C.yellow, good: C.green, easy: C.cyan };

export async function runSummary({ screen, summary, canGoHome }) {
  const draw = () => {
    const W = screen.columns;
    const R = screen.rows;
    const s = summary;
    const lines = [];

    const headline = s.left > 0 ? t("summary.stopTitle") : t("summary.doneTitle");
    lines.push(titleBar(W, `${t("app.bin")} · ${headline}`, s.dryRun ? "dry-run" : ""));
    lines.push("");

    const innerW = Math.min(W - 4, 64);
    const content = [];
    content.push(
      `  ${t("summary.answered", { n: `${C.bold}${s.answered}${C.reset}` })}` +
        (s.skipped ? `  ${C.dim}${t("summary.skipped", { n: s.skipped })}${C.reset}` : "") +
        `  ${C.dim}${t("summary.elapsed", { d: humanDuration(s.elapsed) })}${C.reset}`
    );
    content.push("");
    const cells = Object.keys(s.counts).map((k) => {
      const n = s.counts[k];
      return `${COLORS[k]}${RESPONSE_LABEL[k]} ${n}${C.reset}`;
    });
    content.push(`  ${cells.join(`${C.dim}   ${C.reset}`)}`);
    content.push("");
    if (s.left > 0) {
      content.push(`  ${C.dim}${t("summary.left", { n: s.left })}${C.reset}`);
    } else if (s.nextDue) {
      content.push(
        `  ${C.dim}${t("summary.nextDue", { date: s.nextDue, n: s.nextDueCount || 0 })}${C.reset}`
      );
    } else {
      content.push(`  ${C.dim}${t("summary.noUpcoming")}${C.reset}`);
    }

    for (const l of box(content, innerW + 2, { padding: 0 })) lines.push(center(l, W));

    lines.push("");
    if (canGoHome) {
      lines.push(
        ` ${C.bold}Enter${C.reset} ${C.dim}${t("hint.backHome")}${C.reset}   ` +
          `${C.bold}q${C.reset} ${C.dim}${t("hint.exit")}${C.reset}`
      );
    } else {
      lines.push(` ${C.bold}Enter${C.reset} ${C.dim}${t("hint.exit")}${C.reset}`);
    }
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
