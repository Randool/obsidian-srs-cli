/**
 * 库路径的用户配置。
 * 不猜、不硬编码任何机器上的路径：只认用户明确给的三处，按优先级取。
 *   1. 命令行 --vault
 *   2. 环境变量 SRS_VAULT
 *   3. 配置文件（默认 ~/.config/srs/config.json，可用 SRS_CONFIG 指到别处）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { t } from "./i18n.js";

export function configPath() {
  if (process.env.SRS_CONFIG) return process.env.SRS_CONFIG.replace(/^~(?=$|\/)/, os.homedir());
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "srs", "config.json");
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "srs", "config.json");
}

/** 读配置；文件不存在或坏掉都当「没配」，把原因带出去给命令显示。 */
export function readConfig(file = configPath()) {
  if (!fs.existsSync(file)) return { file, exists: false, config: {} };
  try {
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    return { file, exists: true, config: config && typeof config === "object" ? config : {} };
  } catch (e) {
    return { file, exists: true, config: {}, error: t("msg.configBroken", { err: e.message }) };
  }
}

export function writeConfig(patch, file = configPath()) {
  const cur = readConfig(file);
  const next = { ...cur.config, ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

/**
 * 解析出本次要用的库路径（只做优先级选择，不做存在性校验）。
 * @returns {{ value: string|null, source: 'flag'|'env'|'config'|null, file: string, error?: string }}
 */
export function pickVault({ flag = null, env = process.env, file = configPath() } = {}) {
  const cfg = readConfig(file);
  if (flag) return { value: flag, source: "flag", file: cfg.file };
  if (env.SRS_VAULT) return { value: env.SRS_VAULT, source: "env", file: cfg.file };
  if (cfg.config.vault) return { value: cfg.config.vault, source: "config", file: cfg.file, error: cfg.error };
  return { value: null, source: null, file: cfg.file, error: cfg.error };
}

export const SOURCE_LABEL = {
  flag: "--vault 参数",
  env: "$SRS_VAULT",
  config: "配置文件",
};

/** 「还没配置」时的引导文案。 */
export function notConfiguredMessage(file) {
  return t("msg.notConfigured", { cmd: "srs", file });
}
