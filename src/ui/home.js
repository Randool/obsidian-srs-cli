/**
 * 主页：选 deck、看今天有多少活、决定从哪开始。
 * 返回 { action: 'review', deck, mode } 或 { action: 'refresh' | 'quit' }
 */
import { C, clip, pad, padStart } from "./ansi.js";
import { helpScreen, hints, titleBar } from "./chrome.js";
import { deckStats, orderLabel } from "../session.js";
import { t } from "../i18n.js";

export async function runHome({ screen, library, today, vaultName }) {
  let cursor = 0;
  let help = false;
  let flash = "";
  let order = "plugin";

  const rows = () => {
    const stats = deckStats(library.cards, today);
    const total = (key) => stats.reduce((a, s) => a + s[key], 0);
    return [
      {
        deck: null,
        label: t("common.all"),
        due: total("due"),
        new: total("new"),
        total: library.cards.length,
      },
      ...stats,
    ]
      .map((r) => ({ ...r, todo: r.due + r.new }))
      .sort((a, b) => {
        if (a.deck === null) return -1;
        if (b.deck === null) return 1;
        if (Boolean(a.todo) !== Boolean(b.todo)) return b.todo - a.todo;
        return b.todo - a.todo || (a.label < b.label ? -1 : 1);
      });
  };

  const draw = () => {
    const W = screen.columns;
    const R = screen.rows;
    if (help) {
      screen.draw(
        helpScreen(W, R, {
          title: t("help.title"),
          sections: [
            [t("help.browse"), [["↑ ↓ / k j", t("help.deckUpDown")], ["Enter", t("help.deckEnter")]]],
            [t("help.startModes"), [["n", t("help.deckN")], ["d", t("help.deckD")], ["a", t("help.deckA")]]],
            [t("help.other"), [["m", t("help.deckM")], ["r", t("help.deckR")], ["?", t("help.help")], [
              "q",
              t("help.quit"),
            ]]],
          ],
        }),
      );
      return;
    }

    const list = rows();
    cursor = Math.min(cursor, list.length - 1);
    const all = list[0];
    const lines = [
      titleBar(W, t("home.title"), vaultName),
      "",
      ` ${C.dim}${t("common.today")}${C.reset} ${today}   ` +
      `${C.yellow}${t("home.segDue", { n: all.due })}${C.reset} ${C.dim}·${C.reset} ` +
      `${C.cyan}${t("home.segNew", { n: all.new })}${C.reset} ${C.dim}·${C.reset} ` +
      `${C.dim}${t("home.segTotal", { n: all.total })}${C.reset}`,
      "",
    ];

    const bodyRows = Math.max(3, R - 9);
    const start = Math.max(0, Math.min(cursor - Math.floor(bodyRows / 2), list.length - bodyRows));
    const nameW = Math.max(12, Math.min(38, W - 26));
    const count = (n, label, color) =>
      `${n ? color : C.dim}${padStart(String(n), 4)}${C.reset}${C.dim} ${label}${C.reset}`;

    list.slice(start, start + bodyRows).forEach((row, i) => {
      const selected = start + i === cursor;
      const name = pad(clip(row.label, nameW), nameW);
      const label = row.todo ? name : `${C.dim}${name}${C.reset}`;
      const line =
        ` ${selected ? `${C.cyan}▸${C.reset}` : " "} ${selected ? `${C.bold}${label}${C.reset}` : label}   ` +
        `${count(row.due, t("common.due"), C.yellow)}  ${count(row.new, t("common.new"), C.cyan)}  ` +
        `${C.dim}${padStart(String(row.total), 5)} ${t("common.total")}${C.reset}`;
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
        W,
      ),
    );
    const row = list[cursor];
    const info = row.todo
      ? t("home.selected", { deck: row.label, due: row.due, new: row.new, order: orderLabel(order) })
      : t("home.selectedEmpty", { deck: row.label });
    lines.push(` ${flash ? `${C.yellow}${clip(flash, W - 2)}` : `${C.dim}${clip(info, W - 2)}`}${C.reset}`);
    screen.draw(lines.slice(0, R));
  };

  const move = (delta) => {
    cursor = Math.max(0, Math.min(cursor + delta, rows().length - 1));
    draw();
  };

  screen.enter();
  try {
    draw();
    for (;;) {
      const k = await screen.key();
      if (k === "ctrl-c" || k === "eof" || k === "q") return { action: "quit" };
      if (k === "?") {
        help = !help;
        draw();
      } else if (k === "r") {
        return { action: "refresh" };
      } else if (k === "m") {
        order = order === "random" ? "plugin" : "random";
        flash = t("home.orderChanged", { order: orderLabel(order) });
        draw();
      } else if (k === "up" || k === "k") {
        move(-1);
      } else if (k === "down" || k === "j") {
        move(1);
      } else if (["enter", "space", "a", "n", "d"].includes(k)) {
        const row = rows()[cursor];
        if (!row || !row.todo) {
          flash = t("home.emptyDeck");
          draw();
          continue;
        }
        return {
          action: "review",
          deck: row.deck,
          mode: k === "n" ? "new" : k === "d" ? "due" : "all",
          order,
        };
      }
    }
  } finally {
    screen.leave();
  }
}
