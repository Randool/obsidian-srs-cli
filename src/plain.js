/**
 * 逐行模式：stdin/stdout 任一不是 TTY，或用户显式 --plain 时走这里。
 * 一个 readline 异步迭代器贯穿全程（不要每问一句就 rl.question）。
 */
import readline from "node:readline";
import { C } from "./ui/ansi.js";
import { describeInterval, GRADE_KEYS, isNew, RESPONSE_LABEL, RESPONSES } from "./schedule.js";
import { t } from "./i18n.js";

const ACTIONS = new Set(["z", "s", "x", "q"]);

export async function runPlainReview({ session, deckLabel, out = process.stdout, input = process.stdin }) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const it = rl[Symbol.asyncIterator]();
  const ask = async (q) => {
    out.write(q);
    const { value, done } = await it.next();
    return done ? null : String(value);
  };
  const paint = (s, c) => (out.isTTY ? c + s + C.reset : s);
  const rule = `${"─".repeat(60)}\n`;

  while (!session.finished) {
    const card = session.card;
    out.write(`\n${rule}  ${deckLabel || card.deck}   [${session.index + 1}/${session.total}]\n${rule}\n`);
    out.write(`  ${card.front.replace(/\n/g, "\n  ")}\n`);
    const meta = isNew(card)
      ? t("common.newCard")
      : `${t("common.dueAt", { date: card.due })} · ${t("common.interval", { n: card.interval })} · ${
        t("common.ease", { n: card.ease })
      }`;
    out.write(`\n  ${paint(`${card.file.split("/").pop().replace(/\.md$/, "")} · ${meta}`, C.dim)}\n`);

    const flip = await ask(t("plain.flip"));
    if (flip === null || flip.trim().toLowerCase().startsWith("q")) break;
    out.write(`\n  ${paint(`── ${t("common.answer")} ──`, C.dim)}\n  ${card.back.replace(/\n/g, "\n  ")}\n`);

    const preview = session.preview();
    out.write(
      "\n  " +
        RESPONSES.map((r, i) => `[${i + 1}] ${RESPONSE_LABEL[r]} ${describeInterval(preview[r].interval)}`)
          .join("   ") +
        "\n",
    );

    let key;
    for (;;) {
      const line = await ask(t("plain.grade"));
      if (line === null) {
        key = "q";
        break;
      }
      key = line.trim().slice(0, 1).toLowerCase();
      if (key === "e") out.write(`  ${paint(t("edit.plainUnavailable"), C.yellow)}\n`);
      else if (GRADE_KEYS[key] || ACTIONS.has(key)) break;
    }
    if (key === "q") break;
    if (key === "z") out.write(`  ${paint(session.undoLast(), C.yellow)}\n`);
    else if (key === "s") {
      session.skip();
      out.write(`  ${paint(session.lastMessage, C.dim)}\n`);
    } else if (key === "x") out.write(`  ${paint(session.reshuffle(), C.dim)}\n`);
    else out.write(`  ${paint(session.grade(GRADE_KEYS[key]), C.green)}\n`);
  }

  rl.close();
  const s = session.summary();
  const warn = `${s.skipped ? ` ${t("summary.skipped", { n: s.skipped })}` : ""}${
    s.dryRun ? " (dry-run)" : ""
  }`;
  const counts = Object.keys(s.counts)
    .map((k) => `${RESPONSE_LABEL[k]} ${s.counts[k]}`)
    .join("   ");
  out.write(
    `\n${t("plain.done", { n: s.answered, warn })}\n  ${counts}` +
      (s.nextDue ? `\n  ${t("summary.nextDue", { date: s.nextDue, n: s.nextDueCount || 0 })}\n` : "\n"),
  );
  return 0;
}
