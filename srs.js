#!/usr/bin/env node
/**
 * obsrs — 终端复习 obsidian-spaced-repetition 的闪卡。
 *
 *   obsrs                  打开主页（选 deck → 复习 → 小结）
 *   obsrs review [-d deck] 直接开复习
 *   obsrs status [--json]  文本概览（脚本用）
 *   obsrs list [-d deck]   列卡片与排程
 *
 * 数据与插件共用：直接读写笔记里的 `<!--SR:!日期,间隔,ease-->`，算法照插件 v1.15.4。
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { validateVault, loadSettings } from "./src/vault.js";
import { t, resolveLang } from "./src/i18n.js";
import { pickVault, writeConfig, readConfig, configPath, notConfiguredMessage, SOURCE_LABEL } from "./src/config.js";
import { loadLibrary, deckStats, Session } from "./src/session.js";
import { todayStr } from "./src/schedule.js";
import { Screen } from "./src/ui/screen.js";
import { runHome } from "./src/ui/home.js";
import { runReview } from "./src/ui/review.js";
import { runSummary } from "./src/ui/summary.js";
import { runPlainReview } from "./src/plain.js";
import { C, pad, padStart, clip, strWidth } from "./src/ui/ansi.js";

/** npm 包安装出来的命令名（包名见 package.json）。 */
const CMD = "obsrs";

const HELP_ZH = `
obsrs — 终端复习 Obsidian Spaced Repetition 闪卡

  obsrs                       打开主页：选 deck、看今天多少活、开始复习
  obsrs review                直接进复习（跳过主页）
  obsrs review -d science     只复习某个 deck（前缀匹配）
  obsrs review --new-only     只过新卡；--due-only 只过到期卡
  obsrs review -n 20          最多 20 张
  obsrs review --dry-run      空跑一遍，不写笔记
  obsrs review --shuffle      跨 deck 随机混排出题（默认照插件设置逐 deck 出）
  obsrs status [--json]       文本概览
  obsrs list [-d deck]        列卡片与排程
  obsrs config                看当前库路径配置
  obsrs config --vault <库目录>  把库路径写进配置（配一次，以后直接 obsrs）
  obsrs config --unset        清掉配置

选项
  -d, --deck <名>   deck（前缀匹配，如 science 或 science/biology）
  -n, --limit <N>   本次最多复习几张
  --shuffle         整体打散：跨 deck 混排（主页里按 m 也能切）
  --plain           不开整屏界面，逐行问答（管道里会自动切到这种）
  --no-backup       这次不往磁盘留笔记备份
  --vault <路径>    Obsidian 库目录（只对这一次生效；长期配置用 obsrs config）
  -v, --version     版本号
  -h, --help        这个帮助

复习界面按键
  Space/Enter 翻面       1-4 或 a/h/g/e 打分（Again/Hard/Good/Easy）
  z 撤销上一张          s 跳过这张           x 重洗剩下的卡
  ↑↓ 滚动长答案          ? 帮助               q 结束并看小结

分档含义
  1 Again 没想起来，重来         2 Hard 想起来了但很吃力
  3 Good  正常想起来了           4 Easy 秒答

退出码：0 正常；2 参数/配置问题；1 未预期错误
会用插件同一份数据改你的笔记：写前默认备份（备份在 ~/.local/state/srs/backups，可用 SRS_BACKUP_DIR 改，--no-backup 关闭）。
`;

const HELP_EN = `
obsrs — review Obsidian Spaced Repetition flashcards in your terminal

  obsrs                       home screen: pick a deck, see today's load, start
  obsrs review                jump straight into a session
  obsrs review -d science     only that deck (prefix match)
  obsrs review --new-only     new cards only; --due-only due only
  obsrs review -n 20          at most 20 cards
  obsrs review --dry-run      run through without writing anything
  obsrs review --shuffle      shuffle across decks (default follows plugin order)
  obsrs status [--json]       text summary
  obsrs list [-d deck]        list cards and schedules
  obsrs config                show the configured vault
  obsrs config --vault <dir>  remember a vault (one-time setup)
  obsrs config --unset        forget it

Options
  -d, --deck <name>   deck (prefix match, e.g. science or science/biology)
  -n, --limit <N>     max cards this session
  --shuffle           shuffle the whole selection across decks (m on home too)
  --plain             line-by-line mode (automatic when piped)
  --no-backup         don't write a note backup this run
  --vault <path>      vault for this run only (use obsrs config for the default)
  -v, --version       print version
  -h, --help          this help

Keys
  Space/Enter reveal      1-4 or a/h/g/e grade (Again/Hard/Good/Easy)
  z undo                  s skip                x reshuffle the rest
  ↑↓ scroll               ? help                q finish and show the summary

Grades
  1 Again  no recall, start over          2 Hard  recalled with effort
  3 Good   normal recall                  4 Easy  instant

Exit codes: 0 ok; 2 bad argument/configuration; 1 unexpected error
This tool edits your notes (same data as the plugin). Backups are written by default
to ~/.local/state/srs/backups (override with SRS_BACKUP_DIR, disable with --no-backup).
`;

function helpText() {
  return resolveLang() === "en" ? HELP_EN : HELP_ZH;
}

function parseArgs(argv) {
  const args = {
    cmd: null,
    vault: null,
    deck: null,
    limit: null,
    dryRun: false,
    plain: false,
    json: false,
    mode: "all",
    order: "plugin",
    unset: false,
    help: false,
    version: false,
    backup: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["status", "list", "review", "config"].includes(a) && !args.cmd) args.cmd = a;
    else if (a === "--vault") args.vault = argv[++i];
    else if (a === "-d" || a === "--deck") args.deck = argv[++i];
    else if (a === "-n" || a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--plain") args.plain = true;
    else if (a === "--json") args.json = true;
    else if (a === "--unset") args.unset = true;
    else if (a === "--no-backup") args.backup = false;
    else if (a === "-v" || a === "--version") args.version = true;
    else if (a === "--new-only") args.mode = "new";
    else if (a === "--shuffle" || a === "--random") args.order = "random";
    else if (a === "--due-only") args.mode = "due";
    else if (a === "-h" || a === "--help") args.help = true;
    else if (!args.deck && !a.startsWith("-")) args.deck = a;
  }
  return args;
}

/** 单行提问（只用于首次配置引导）。 */
function promptLine(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function printWarnings(warnings) {
  for (const w of warnings) process.stderr.write(`${C.yellow}!${C.reset} ${w}\n`);
}

function statusLines({ library, today, deck }) {
  const cards = deck ? library.cards.filter((c) => c.deck === deck || c.deck.startsWith(`${deck}/`)) : library.cards;
  return { cards, stats: deckStats(cards, today) };
}

/** 文本概览：机器可读(--json)与给人看两种。 */
function printStatus({ library, today, deck, json, vault }) {
  const { cards, stats } = statusLines({ library, today, deck });

  if (json) {
    const decks = {};
    for (const s of stats) decks[s.deck] = { due: s.due, new: s.new, total: s.total, next: s.next };
    const due = stats.reduce((a, s) => a + s.due, 0);
    const fresh = stats.reduce((a, s) => a + s.new, 0);
    console.log(JSON.stringify({ today, vault, totals: { due, new: fresh, total: cards.length }, decks }, null, 2));
    return 0;
  }

  const due = stats.reduce((a, s) => a + s.due, 0);
  const fresh = stats.reduce((a, s) => a + s.new, 0);
  const nameW = Math.max(...stats.map((s) => strWidth(s.deck)), 4);
  console.log(`\n${C.dim}${t("common.today")} ${today} · ${vault}${C.reset}`);
  console.log(
    `${C.yellow}${due} ${t("common.due")}${C.reset}${C.dim} · ${C.reset}${C.cyan}${fresh} ${t("common.new")}${C.reset}${C.dim} · ${t("common.total")} ${cards.length}${C.reset}\n`
  );
  console.log(
    `${C.bold}${pad(t("common.deck"), nameW)}   ${t("common.due")}   ${t("common.new")}   ${t("common.total")}   ${t("common.next")}${C.reset}`
  );
  for (const s of stats) {
    console.log(
      `${pad(s.deck, nameW)}   ${s.due ? C.yellow : C.dim}${padStart(String(s.due), 4)}${C.reset}   ` +
        `${padStart(String(s.new), 4)}  ${padStart(String(s.total), 5)}   ${C.dim}${s.next || "-"}${C.reset}`
    );
  }
  console.log(`\n${C.dim}${t("msg.hint.start", { cmd: CMD })}${C.reset}`);
  return 0;
}

function printList({ library, today, deck }) {
  const { cards } = statusLines({ library, today, deck });
  for (const c of cards) {
    const st = c.srLine === null ? t("common.newCard") : c.due <= today ? t("common.dueAt", { date: c.due }) : c.due;
    console.log(`${pad(c.deck, 22)} ${pad(st, 13)} ${clip(c.front.replace(/\n/g, " "), 70)}`);
  }
  console.log(`\n${t("common.total")} ${cards.length}`);
  return 0;
}

/** 库路径配置的查看/写入。 */
function runConfig(args) {
  const file = configPath();
  if (args.vault || args.unset) {
    if (args.unset) {
      writeConfig({ vault: undefined }, file);
      console.log(t("msg.unset", { file }));
      return 0;
    }
    const target = String(args.vault).replace(/^~(?=$|\/)/, process.env.HOME || "");
    const { vault, error } = validateVault(target);
    if (error) {
      process.stderr.write(`${error}\n`);
      return 2;
    }
    writeConfig({ vault }, file);
    const cfg = loadSettings(vault);
    console.log(t("msg.written", { file }));
    console.log(t("msg.configSaved", { vault }));
    if (cfg.notes.length) for (const n of cfg.notes) process.stderr.write(`${C.yellow}!${C.reset} ${n}\n`);
    console.log(`\n${t("msg.nowJust", { cmd: CMD })}`);
    return 0;
  }

  const picked = pickVault({ flag: null, file });
  const cfg = readConfig(file);
  console.log(t("msg.configFile", { file, missing: cfg.exists ? "" : t("msg.configMissing") }));
  if (cfg.error) console.log(`  ${C.yellow}!${C.reset} ${cfg.error}`);
  if (cfg.config.vault) console.log(t("msg.configSaved", { vault: cfg.config.vault }));
  if (picked.source) {
    console.log(t("msg.configEffective", { vault: picked.value, source: SOURCE_LABEL[picked.source] }));
    const v = validateVault(picked.value);
    if (v.error) console.log(`  ${C.yellow}!${C.reset} ${v.error.split("\n")[0]}`);
  } else {
    console.log(`\n${notConfiguredMessage(file)}`);
  }
  return 0;
}

/** 「今天没活」的友好交代。 */
function emptyState({ library, deck, mode }) {
  if (deck) {
    const known = [...new Set(library.cards.map((c) => c.deck))];
    const hit = known.some((d) => d === deck || d.startsWith(`${deck}/`));
    if (!hit) {
      console.log(t("msg.unknownDeck", { deck }) + "\n" + known.map((d) => `  · ${d}`).join("\n"));
      return 0;
    }
  }
  const { stats } = statusLines({ library, today: todayStr(), deck });
  const due = stats.reduce((a, s) => a + s.due, 0);
  const fresh = stats.reduce((a, s) => a + s.new, 0);
  const nexts = stats.filter((s) => s.next).map((s) => s.next).sort();
  if (due + fresh === 0) {
    if (nexts.length) {
      const n = nexts.filter((d) => d === nexts[0]).length;
      console.log(t("msg.nothingDue", { date: nexts[0], n }));
    } else {
      console.log(t("msg.noCards"));
    }
  } else {
    console.log(t("msg.filtered", { due, fresh }));
  }
  return 0;
}

async function runInteractive({ args, vault, screen }) {
  let library = { ...loadLibrary(vault), vault };
  const vaultName = path.basename(vault);
  const direct = Boolean(args.deck) || args.mode !== "all" || args.limit || args.cmd === "review" || args.order === "random";

  for (;;) {
    let start;
    if (direct) {
      start = { deck: args.deck, mode: args.mode, order: args.order };
    } else {
      const r = await runHome({ screen, library, today: todayStr(), vaultName });
      if (r.action === "quit") return 0;
      if (r.action === "refresh") {
        library = { ...loadLibrary(vault), vault };
        continue;
      }
      start = { deck: r.deck, mode: r.mode, order: r.order };
    }

    const session = new Session({
      library,
      deck: start.deck,
      mode: start.mode,
      order: start.order || args.order,
      limit: args.limit,
      dryRun: args.dryRun,
      backup: args.backup,
    });

    if (!session.total) {
      screen.leave();
      return emptyState({ library, deck: start.deck, mode: start.mode });
    }

    const r = await runReview({ screen, session, deckLabel: start.deck || "全部" });
    const after = await runSummary({ screen, summary: session.summary(), canGoHome: !direct });
    if (after.action === "quit") return 0;
    if (r.ended === "finished" && direct) return 0;
    library = { ...loadLibrary(vault), vault };
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(helpText().replace(/^\n/, ""));
    return 0;
  }
  if (args.version) {
    const pkg = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"));
    console.log(pkg.version);
    return 0;
  }

  if (args.cmd === "config") return runConfig(args);

  let picked = pickVault({ flag: args.vault });
  if (!picked.value) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      // 第一次跑：直接问一句，省得用户去翻文档
      process.stderr.write(`${notConfiguredMessage(picked.file)}\n`);
      const answer = await promptLine(t("msg.askVault"));
      if (!answer || !answer.trim() || answer.trim().toLowerCase().startsWith("q")) {
        process.stderr.write(`\n${notConfiguredMessage(picked.file)}\n`);
        return 2;
      }
      const v = validateVault(answer.trim());
      if (v.error) {
        process.stderr.write(`${v.error}\n`);
        return 2;
      }
      writeConfig({ vault: v.vault }, picked.file);
      process.stderr.write(`${t("msg.vaultSaved", { vault: v.vault })}\n`);
      picked = { value: v.vault, source: "config", file: picked.file };
    } else {
      process.stderr.write(`${notConfiguredMessage(picked.file)}\n`);
      return 2;
    }
  }
  const { vault, error } = validateVault(picked.value);
  if (error) {
    process.stderr.write(`${error}\n`);
    return 2;
  }

  const settings = loadSettings(vault).settings;
  if (settings.dataStore !== "NOTES") {
    process.stderr.write(`${t("msg.dataStore")}\n`);
    return 2;
  }

  const library = { ...loadLibrary(vault), vault };
  printWarnings(library.warnings);

  if (args.cmd === "status" || (args.cmd === null && !process.stdout.isTTY)) {
    return printStatus({ library, today: todayStr(), deck: args.deck, json: args.json, vault });
  }
  if (args.cmd === "list") {
    return printList({ library, today: todayStr(), deck: args.deck });
  }

  const interactive = process.stdin.isTTY && process.stdout.isTTY && !args.plain;
  if (!interactive) {
    const session = new Session({
      library,
      deck: args.deck,
      mode: args.mode,
      order: args.order,
      limit: args.limit,
      dryRun: args.dryRun,
      backup: args.backup,
    });
    if (!session.total) return emptyState({ library, deck: args.deck, mode: args.mode });
    return runPlainReview({ session, deckLabel: args.deck || t("common.all") });
  }

  const screen = new Screen(process.stdout, process.stdin);
  let exiting = false;
  const restore = () => {
    if (exiting) return;
    exiting = true;
    screen.leave();
    process.exit(130);
  };
  process.on("SIGINT", restore);
  process.on("SIGTERM", restore);
  try {
    return await runInteractive({ args, vault, screen });
  } finally {
    screen.leave();
    process.removeListener("SIGINT", restore);
    process.removeListener("SIGTERM", restore);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    process.stderr.write(t("msg.err", { err: err && err.stack ? err.stack : err }) + "\n");
    process.exit(1);
  }
);
