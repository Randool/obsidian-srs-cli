/**
 * 主页：选 deck、看今天有多少活、决定从哪开始。
 * 返回 { action: 'review', deck, mode } 或 { action: 'refresh' | 'quit' }
 */
import { C, pad, padStart, clip, strWidth } from "./ansi.js";
import { titleBar, box, hints, helpScreen } from "./chrome.js";
import { deckStats, filterCards, orderLabel } from "../session.js";
import { t } from "../i18n.js";
import { isNew, isDue } from "../schedule.js";

export async function runHome({ screen, library, today, vaultName }) {
  let cursor = 0;
  let help = false;
  let flash = "";
  let order = "plugin";

  const buildRows = () => {
    const stats = deckStats(library.cards, today);
    const totalDue = stats.reduce((a, s) => a + s.due, 0);
    const totalNew = stats.reduce((a, s) => a + s.new, 0);
    const rows = [
      { deck: null, label: t("common.all"), due: totalDue, new: totalNew, total: library.cards.length, todo: totalDue + totalNew },
      ...stats.map((s) => ({ deck: s.deck, label: s.deck, ...s })),
    ];
    // 有活儿的排前面，其余按名字
    rows.sort((a, b) => {
      if (a.deck === null) return -1;
      if (b.deck === null) return 1;
      if (Boolean(a.todo) !== Boolean(b.todo)) return b.todo - a.todo; // 有活的排前面
      if (a.todo !== b.todo) return b.todo - a.todo;                   // 积压多的更靠上
      return a.label < b.label ? -1 : 1;
    });
    return rows;
  };

  const draw = () => {
    const W = screen.columns;
    const R = screen.rows;
    if (help) {
      screen.draw(
        helpScreen(W, R, {
          title: t("help.title"),
          sections: [
            [
              t("help.browse"),
              [
                ["↑ ↓ / k j", t("help.deckUpDown")],
                ["Enter", t("help.deckEnter")],
              ],
            ],
            [
              t("help.startModes"),
              [
                ["n", t("help.deckN")],
                ["d", t("help.deckD")],
                ["a", t("help.deckA")],
              ],
            ],
            [
              t("help.other"),
              [
                ["m", t("help.deckM")],
                ["r", t("help.deckR")],
                ["?", t("help.help")],
                ["q", t("help.quit")],
              ],
            ],
          ],
        })
      );
      return;
    }

    const rows = buildRows();
    cursor = Math.min(cursor, rows.length - 1);
    const totalDue = rows[0].due;
    const totalNew = rows[0].new;

    const lines = [];
    lines.push(titleBar(W, t("home.title"), vaultName));
    lines.push("");
    lines.push(
      ` ${C.dim}${t("common.today")}${C.reset} ${today}   ` +
        `${C.yellow}${t("home.segDue", { n: totalDue })}${C.reset} ${C.dim}·${C.reset} ` +
        `${C.cyan}${t("home.segNew", { n: totalNew })}${C.reset} ${C.dim}·${C.reset} ` +
        `${C.dim}${t("home.segTotal", { n: rows[0].total })}${C.reset}`
    );
    lines.push("");

    const bodyRows = Math.max(3, R - 9);
    const start = Math.max(0, Math.min(cursor - Math.floor(bodyRows / 2), rows.length - bodyRows));
    const shown = rows.slice(start, start + bodyRows);

    const nameW = Math.max(12, Math.min(38, W - 26));
    shown.forEach((row, i) => {
      const idx = start + i;
      const selected = idx === cursor;
      const pointer = selected ? `${C.cyan}▸${C.reset}` : " ";
      const name = pad(clip(row.label, nameW), nameW);
      const counting =
        `${row.due ? C.yellow : C.dim}${padStart(String(row.due), 4)}${C.reset}${C.dim} ${t("common.due")}${C.reset}  ` +
        `${row.new ? C.cyan : C.dim}${padStart(String(row.new), 4)}${C.reset}${C.dim} ${t("common.new")}${C.reset}  ` +
        `${C.dim}${padStart(String(row.total), 5)} ${t("common.total")}${C.reset}`;
      const label = row.todo ? name : `${C.dim}${name}${C.reset}`;
      const line = ` ${pointer} ${selected ? `${C.bold}${label}${C.reset}` : label}   ${counting}`;
      lines.push(selected ? `${C.bgHi}${line}${C.reset}` : line);
    });
    while (lines.length < R - 3) lines.push("");

    lines.push(
      hints(
        [
          ["↑↓", t("hint.select")],
          ["Enter", t("hint.start")],
          ["n", t("hint.newOnly")],
          ["d", t("hint.dueOnly")],
          ["m", t(order === "random" ? "hint.order.random" : "hint.order.plugin")],
          ["r", t("hint.refresh")],
          ["?", t("hint.help")],
          ["q", t("hint.quit")],
        ],
        W
      )
    );
    const info = rows[cursor].todo
      ? t("home.selected", {
          deck: rows[cursor].label,
          due: rows[cursor].due,
          new: rows[cursor].new,
          order: orderLabel(order),
        })
      : t("home.selectedEmpty", { deck: rows[cursor].label });
    lines.push(` ${flash ? `${C.yellow}${clip(flash, W - 2)}${C.reset}` : `${C.dim}${clip(info, W - 2)}${C.reset}`}`);
    screen.draw(lines.slice(0, R));
  };

  screen.enter();
  try {
    draw();
    for (;;) {
      const k = await screen.key();
      if (k === "ctrl-c" || k === "eof") return { action: "quit" };
      if (help) {
        help = false;
        draw();
        continue;
      }
      if (k === "q") return { action: "quit" };
      if (k === "?") {
        help = true;
        draw();
        continue;
      }
      if (k === "r") {
        draw();
        return { action: "refresh" };
      }
      if (k === "m") {
        order = order === "random" ? "plugin" : "random";
        flash = t("home.orderChanged", { order: orderLabel(order) });
        draw();
        continue;
      }
      if (k === "up" || k === "k") {
        cursor = Math.max(0, cursor - 1);
        draw();
      } else if (k === "down" || k === "j") {
        cursor = Math.min(buildRows().length - 1, cursor + 1);
        draw();
      } else if (k === "enter" || k === "space" || k === "a" || k === "n" || k === "d") {
        const rows = buildRows();
        const row = rows[cursor];
        const mode = k === "n" ? "new" : k === "d" ? "due" : "all";
        if (!row || row.todo === 0) {
          flash = t("home.emptyDeck");
          draw();
          continue;
        }
        return { action: "review", deck: row.deck, mode, order };
      }
      // 其它键忽略
    }
  } finally {
    screen.leave();
  }
}

export { filterCards, isNew, isDue };
