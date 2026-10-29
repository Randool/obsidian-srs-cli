/**
 * 库定位 + 插件设置读取。
 * 只做 I/O 取数，不含业务判断。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { t } from "./i18n.js";

export const PLUGIN_DIR = ".obsidian/plugins/obsidian-spaced-repetition";

export const DEFAULTS = {
  algorithm: "SM-2-OSR",
  baseEase: 250,
  easyBonus: 1.3,
  lapsesIntervalChange: 0.5,
  loadBalance: true,
  maximumInterval: 36525,
  startOfDay: "00:00:00",
  dataStore: "NOTES",
  flashcardCardOrder: "DueFirstRandom",
  flashcardDeckOrder: "PrevDeckComplete_Random",
  singleLineCardSeparator: "::",
  singleLineReversedCardSeparator: ":::",
  multilineCardSeparator: "?",
  multilineReversedCardSeparator: "??",
  burySiblingCards: false,
};

/** 判定一个目录是不是装过本插件的 Obsidian 库。 */
export function looksLikeVault(dir) {
  return fs.existsSync(path.join(dir, PLUGIN_DIR, "data.json"));
}

/**
 * 校验用户给的库路径（不做「猜」——路径一律由用户提供）。
 * @returns {{ vault?: string, error?: string }}
 */
export function validateVault(raw) {
  if (!raw) return { error: t("msg.notConfigured", { cmd: "srs", file: "" }).split("\n")[0] };
  const dir = String(raw).replace(/^~(?=$|\/)/, os.homedir());
  if (!fs.existsSync(dir)) {
    return { error: t("msg.vaultMissing", { dir, cmd: "srs" }) };
  }
  if (!fs.statSync(dir).isDirectory()) {
    return { error: t("msg.notDir", { dir }) };
  }
  if (!looksLikeVault(dir)) {
    return { error: t("msg.noPlugin", { path: path.join(dir, PLUGIN_DIR) }) };
  }
  return { vault: dir };
}

/** 插件的全部设置（缺字段用默认值兜底）。 */
export function loadSettings(vault) {
  const p = path.join(vault, PLUGIN_DIR, "data.json");
  const settings = { ...DEFAULTS };
  const notes = [];
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    Object.assign(settings, j.settings || {});
  } catch (e) {
    notes.push(`data.json: ${e.message}`);
  }
  if (settings.dataStore !== "NOTES") {
    notes.push(`dataStore=${settings.dataStore}: ${t("msg.dataStore")}`);
  }
  if (settings.algorithm && settings.algorithm !== "SM-2-OSR") {
    notes.push(`插件当前用 ${settings.algorithm} 排程；本工具按 SM-2-OSR 算，注释格式兼容但算法不同`);
  }
  return { settings, notes };
}

/** 含 #flashcards deck 标签行的笔记。 */
export function cardFiles(vault) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(".md")) {
        let txt;
        try {
          txt = fs.readFileSync(p, "utf8");
        } catch {
          continue;
        }
        if (txt.split("\n").some((l) => l.trim().startsWith("#flashcards"))) out.push([p, txt]);
      }
    }
  };
  walk(vault);
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}
