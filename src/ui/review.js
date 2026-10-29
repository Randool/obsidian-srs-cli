/**
 * 复习界面：一张卡一屏，翻面与作答分两拍，四档按钮实时显示「按了会排到多久之后」。
 * 返回 { ended: 'finished' | 'quit' }
 */
import { C, pad, clip, wrap, progressBar } from "./ansi.js";
import { titleBar, box, hints, helpScreen } from "./chrome.js";
import { describeInterval, RESPONSE_LABEL, RESPONSES, isNew } from "../schedule.js";
import { t } from "../i18n.js";

const KEY_TO_RESPONSE = {
  "1": "again", a: "again",
  "2": "hard", h: "hard",
  "3": "good", g: "good",
  "4": "easy", e: "easy",
};

export async function runReview({ screen, session, deckLabel }) {
  let revealed = false;
  let scroll = 0;
  let help = false;
  let flash = "";

  const gradeLine = (preview, revealedNow) => {
    const cells = RESPONSES.map((r, i) => {
      const n = i + 1;
      const label = RESPONSE_LABEL[r];
      const ivl = preview ? describeInterval(preview[r].interval) : "—";
      const color = r === "again" ? C.red : r === "hard" ? C.yellow : r === "good" ? C.green : C.cyan;
      const text = `${n} ${label} ${ivl}`;
      return revealedNow ? `${color}${C.bold}${text}${C.reset}` : `${C.dim}${text}${C.reset}`;
    });
    return ` ${cells.join(`${C.dim} · ${C.reset}`)}${revealedNow ? "" : `   ${C.dim}${t("common.revealFirst")}${C.reset}`}`;
  };

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
                ["↑ ↓ / j k", t("help.scroll")],
                ["1-4 / a h g e", t("help.gradeKeys")],
              ],
            ],
            [
              t("help.grade"),
              [
                ["1 / a", t("help.again")],
                ["2 / h", t("help.hard")],
                ["3 / g", t("help.good")],
                ["4 / e", t("help.easy")],
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
        })
      );
      return;
    }

    const lines = [];
    const ratio = session.total ? Math.min(1, session.index / session.total) : 0;
    const barW = Math.max(6, Math.min(28, Math.floor(W * 0.25)));
    lines.push(
      titleBar(
        W,
        `${t("app.bin")} · ${deckLabel || card?.deck || "-"} · ${Math.min(session.index + 1, session.total)}/${session.total}` +
          (session.order === "random" ? ` ${C.yellow}${t("common.random")}${C.reset}${C.bgHi}${C.bold}` : ""),
        `${progressBar(ratio, barW)} ${t("common.answered", { n: session.answered })}`
      )
    );
    lines.push("");

    const contentW = W - 4;
    const body = [];
    if (card) {
      body.push(...wrap(card.front, contentW));
      if (revealed) {
        body.push(`${C.dim}${"─".repeat(Math.max(6, Math.min(contentW, Math.floor(contentW * 0.35))))} ${t("common.answer")}${C.reset}`);
        body.push(...wrap(card.back, contentW));
      }
    }

    const maxBoxH = Math.max(6, R - 5);
    const boxH = Math.min(maxBoxH, Math.max(6, body.length + 2));
    const visible = boxH - 2;
    const maxScroll = Math.max(0, body.length - visible);
    scroll = Math.min(Math.max(0, scroll), maxScroll);
    const view = body.slice(scroll, scroll + visible);
    while (view.length < visible) view.push("");
    // 顶部/底部被裁剪时给个记号
    if (scroll > 0) view[0] = `${C.dim}${t("common.scrollUp")}${C.reset}`;
    if (scroll < maxScroll) view[view.length - 1] = `${C.dim}${t("common.scrollMore")}${C.reset}`;

    lines.push(...box(view, W));

    const meta = card
      ? `${C.dim}${card.file.split("/").pop().replace(/\.md$/, "")} · ${
          isNew(card)
            ? t("common.newCard")
            : `${t("common.dueAt", { date: card.due })} · ${t("common.interval", { n: card.interval })} · ${t("common.ease", { n: card.ease })}`
        }${C.reset}`
      : "";
    lines.push(
      ` ${flash ? `${C.green}${clip(flash, W - 2)}${C.reset}` : clip(meta, W - 2)}`
    );
    lines.push(` ${clip(gradeLine(session.preview(), revealed), W - 2)}`);
    const narrow = W < 60;
    const wideKeys = revealed
      ? [
          ["1-4", t("hint.grade")],
          ["z", t("hint.undo")],
          ["s", t("hint.skip")],
          ["x", t("hint.reshuffle")],
          ["↑↓", t("hint.scroll")],
          ["?", t("hint.help")],
          ["q", t("hint.end")],
        ]
      : [
          ["Space", t("hint.reveal")],
          ["z", t("hint.undo")],
          ["s", t("hint.skip")],
          ["x", t("hint.reshuffle")],
          ["?", t("hint.help")],
          ["q", t("hint.end")],
        ];
    const narrowKeys = revealed
      ? [
          ["1-4", t("hint.grade")],
          ["z", t("hint.undo")],
          ["?", t("hint.help")],
          ["q", t("hint.end")],
        ]
      : [
          ["Space", t("hint.reveal")],
          ["z", t("hint.undo")],
          ["?", t("hint.help")],
          ["q", t("hint.end")],
        ];
    lines.push(hints(narrow ? narrowKeys : wideKeys, W));
    screen.draw(lines.slice(0, R));
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
          continue;
        }
        if (k === "?") {
          help = true;
          draw();
          continue;
        }
        if (k === "q") return { ended: "quit" };
        if (k === "z") {
          flash = session.undoLast();
          revealed = false;
          scroll = 0;
          draw();
          continue;
        }
        if (k === "s") {
          session.skip();
          flash = session.lastMessage;
          draw();
          break;
        }
        if (k === "x") {
          flash = session.reshuffle();
          revealed = false;
          scroll = 0;
          draw();
          continue;
        }

        if (!revealed) {
          if (["space", "enter", "right"].includes(k)) {
            revealed = true;
            draw();
          } else if (k === "down" || k === "j") {
            scroll++;
            draw();
          } else if (k === "up" || k === "k") {
            scroll = Math.max(0, scroll - 1);
            draw();
          } else if (KEY_TO_RESPONSE[k]) {
            // 还没翻面就按了评分键：先翻面，别把人偷答掉
            revealed = true;
            draw();
          }
          continue;
        }

        const response = KEY_TO_RESPONSE[k];
        if (response) {
          flash = session.grade(response);
          break;
        }
        if (k === "down" || k === "j") {
          scroll++;
          draw();
        } else if (k === "up" || k === "k") {
          scroll = Math.max(0, scroll - 1);
          draw();
        }
      }
    }
    return { ended: "finished" };
  } finally {
    screen.leave();
  }
}
