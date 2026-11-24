/**
 * 复习界面：一张卡一屏，翻面与作答分两拍，四档按钮实时显示「按了会排到多久之后」。
 * 返回 { ended: 'finished' | 'quit' }
 */
import { C, clip, progressBar, wrap } from "./ansi.js";
import { box, helpScreen, hints, titleBar } from "./chrome.js";
import { describeInterval, GRADE_KEYS, isNew, RESPONSE_LABEL, RESPONSES } from "../schedule.js";
import { t } from "../i18n.js";
import { editCard } from "./edit.js";

const GRADE_COLOR = { again: C.red, hard: C.yellow, good: C.green, easy: C.cyan };

export async function runReview({ screen, session, deckLabel }) {
  let revealed = false;
  let scroll = 0;
  let help = false;
  let flash = "";

  const draw = () => {
    const W = screen.columns;
    const R = screen.rows;
    const card = session.card;
    if (help) {
      screen.draw(
        helpScreen(W, R, {
          title: t("help.title"),
          sections: [
            [
              t("help.card"),
              [
                ["Space / Enter", t("help.reveal")],
                ["e", t("help.editCard")],
                ["↑ ↓ / j k", t("help.scroll")],
                ["1-4", t("help.gradeKeys")],
              ],
            ],
            [
              t("help.grade"),
              [
                ["1", t("help.again")],
                ["2", t("help.hard")],
                ["3", t("help.good")],
                ["4", t("help.easy")],
              ],
            ],
            [
              t("help.other"),
              [
                ["z", t("help.undo")],
                ["s", t("help.skip")],
                ["x", t("help.reshuffle")],
                ["q", t("help.quit")],
                ["?", t("help.help")],
              ],
            ],
          ],
        }),
      );
      return;
    }

    const ratio = session.total ? Math.min(1, session.index / session.total) : 0;
    const barW = Math.max(6, Math.min(28, Math.floor(W * 0.25)));
    const at = Math.min(session.index + 1, session.total);
    const random = session.order === "random"
      ? ` ${C.yellow}${t("common.random")}${C.reset}${C.bgHi}${C.bold}`
      : "";
    const lines = [
      titleBar(
        W,
        `${t("app.bin")} · ${deckLabel || card?.deck || "-"} · ${at}/${session.total}${random}`,
        `${progressBar(ratio, barW)} ${t("common.answered", { n: session.answered })}`,
      ),
      "",
    ];

    const contentW = W - 4;
    const body = [];
    if (card) {
      body.push(...wrap(card.front, contentW));
      if (revealed) {
        const rule = "─".repeat(Math.max(6, Math.min(contentW, Math.floor(contentW * 0.35))));
        body.push(`${C.dim}${rule} ${t("common.answer")}${C.reset}`, ...wrap(card.back, contentW));
      }
    }

    const maxBoxH = Math.max(6, R - 5);
    const boxH = Math.min(maxBoxH, Math.max(6, body.length + 2));
    const visible = boxH - 2;
    const maxScroll = Math.max(0, body.length - visible);
    scroll = Math.min(Math.max(0, scroll), maxScroll);
    const view = body.slice(scroll, scroll + visible);
    while (view.length < visible) view.push("");
    if (scroll > 0) view[0] = `${C.dim}${t("common.scrollUp")}${C.reset}`;
    if (scroll < maxScroll) view[view.length - 1] = `${C.dim}${t("common.scrollMore")}${C.reset}`;
    lines.push(...box(view, W));

    const meta = card
      ? `${C.dim}${card.file.split("/").pop().replace(/\.md$/, "")} · ${
        isNew(card)
          ? t("common.newCard")
          : `${t("common.dueAt", { date: card.due })} · ${t("common.interval", { n: card.interval })} · ${
            t("common.ease", { n: card.ease })
          }`
      }${C.reset}`
      : "";
    const preview = session.preview();
    const grades = RESPONSES.map((r, i) => {
      const text = `${i + 1} ${RESPONSE_LABEL[r]} ${preview ? describeInterval(preview[r].interval) : "—"}`;
      return revealed ? `${GRADE_COLOR[r]}${C.bold}${text}${C.reset}` : `${C.dim}${text}${C.reset}`;
    });
    const gradeLine = ` ${grades.join(`${C.dim} · ${C.reset}`)}` +
      (revealed ? "" : `   ${C.dim}${t("common.revealFirst")}${C.reset}`);
    lines.push(` ${flash ? `${C.green}${clip(flash, W - 2)}` : clip(meta, W - 2)}${C.reset}`);
    lines.push(` ${clip(gradeLine, W - 2)}`);

    const keys = revealed
      ? [
        ["1-4", t("hint.grade")],
        ["e", t("hint.edit")],
        ["z", t("hint.undo")],
        ["s", t("hint.skip")],
        ["x", t("hint.reshuffle")],
        ["↑↓", t("hint.scroll")],
        ["?", t("hint.help")],
        ["q", t("hint.end")],
      ]
      : [
        ["Space", t("hint.reveal")],
        ["e", t("hint.edit")],
        ["z", t("hint.undo")],
        ["s", t("hint.skip")],
        ["x", t("hint.reshuffle")],
        ["?", t("hint.help")],
        ["q", t("hint.end")],
      ];
    lines.push(hints(W < 60 ? keys.filter(([k]) => !["s", "x", "↑↓"].includes(k)) : keys, W));
    screen.draw(lines.slice(0, R));
  };

  const scrollBy = (d) => {
    scroll = Math.max(0, scroll + d);
    draw();
  };
  const redo = () => {
    revealed = false;
    scroll = 0;
    draw();
  };

  screen.enter();
  try {
    while (!session.finished) {
      revealed = false;
      scroll = 0;
      flash = "";
      draw();
      for (;;) {
        const k = await screen.key();
        if (k === "ctrl-c" || k === "eof") return { ended: "quit" };
        if (help) {
          help = false;
          draw();
        } else if (k === "?") {
          help = true;
          draw();
        } else if (k === "q") {
          return { ended: "quit" };
        } else if (k === "z") {
          flash = session.undoLast();
          redo();
        } else if (k === "s") {
          session.skip();
          flash = session.lastMessage;
          draw();
          break;
        } else if (k === "x") {
          flash = session.reshuffle();
          redo();
        } else if (k === "e") {
          if (session.dryRun) {
            flash = t("edit.dryRun");
            draw();
          } else {
            flash = await editCard({ screen, session });
            scroll = 0;
            draw();
          }
        } else if (!revealed) {
          if (["space", "enter", "right"].includes(k) || GRADE_KEYS[k]) revealed = true;
          else if (k === "down" || k === "j") scroll++;
          else if (k === "up" || k === "k") scroll = Math.max(0, scroll - 1);
          else continue;
          draw();
        } else if (GRADE_KEYS[k]) {
          flash = session.grade(GRADE_KEYS[k]);
          break;
        } else if (k === "down" || k === "j" || k === "up" || k === "k") {
          scrollBy(k === "down" || k === "j" ? 1 : -1);
        }
      }
    }
    return { ended: "finished" };
  } finally {
    screen.leave();
  }
}
