/**
 * 写回：排程注释的读改与撤销。
 * 每次写入都校验注释条数；临时文件 + rename 保证原子；保留原换行风格与文件权限；
 * 备份放 XDG state（可用 SRS_BACKUP_DIR 改），默认保留最近 N 份（SRS_BACKUP_KEEP），
 * 可用 --no-backup 或 SRS_NO_BACKUP=1 关掉。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFile, SR_RE } from "./parser.js";

export const SR_ANY_RE = /<!--SR:[^>]*-->/g;

/** 备份目录：$SRS_BACKUP_DIR > $XDG_STATE_HOME/srs/backups > ~/.local/state/srs/backups */
export function backupRoot() {
  if (process.env.SRS_BACKUP_DIR) {
    return process.env.SRS_BACKUP_DIR.replace(/^~(?=$|\/)/, os.homedir());
  }
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(base, "srs", "backups");
}

export function countSchedules(text) {
  return (text.match(SR_ANY_RE) || []).length;
}

/** 读笔记：行数组统一成无 \r，同时记下原换行风格与权限，写回时还原。 */
function readNote(file) {
  const text = fs.readFileSync(file, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const mode = fs.statSync(file).mode & 0o777;
  return { text, eol, mode, lines: text.split(/\r?\n/) };
}

function writeNote(file, lines, eol, mode) {
  const tmp = `${file}.srs-tmp`;
  fs.writeFileSync(tmp, lines.join(eol), "utf8");
  try {
    fs.chmodSync(tmp, mode);
  } catch {
    /* 某些文件系统不支持改权限，忽略 */
  }
  fs.renameSync(tmp, file);
}

function pruneBackups(root, keep) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return;
  }
  if (entries.length <= keep) return;
  const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of sorted.slice(0, entries.length - keep)) {
    try {
      fs.rmSync(path.join(root, e.name), { recursive: true, force: true });
    } catch {
      /* 清理失败不该影响主流程 */
    }
  }
}

function backup(file) {
  const root = backupRoot();
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const dir = path.join(root, ts);
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, path.basename(file));
  if (!fs.existsSync(dst)) fs.copyFileSync(file, dst);
  pruneBackups(root, Number(process.env.SRS_BACKUP_KEEP || 20));
  return dst;
}

/**
 * 把一次作答写回笔记。
 * @returns {{file, srLine, oldLine, inserted, eol, mode, backup?}} 供 undo() 用
 */
export function applySchedule(card, due, interval, ease, { dryRun = false, backup: wantBackup = true } = {}) {
  const { text, eol, mode, lines } = readNote(card.file);
  const comment = `<!--SR:!${due},${interval},${ease}-->`;
  const before = countSchedules(text);
  const snapshot = {
    file: card.file,
    srLine: card.srLine,
    oldLine: card.srLine !== null ? lines[card.srLine] : null,
    inserted: null,
    eol,
    mode,
  };

  let expect = before;
  if (card.srLine !== null) {
    lines[card.srLine] = lines[card.srLine].replace(SR_ANY_RE, comment);
  } else {
    const idx = card.endLine + 1;
    lines.splice(idx, 0, comment);
    snapshot.inserted = idx;
    card.srLine = idx;
    expect = before + 1;
  }

  const after = countSchedules(lines.join(eol));
  if (after !== expect) {
    throw new Error(`排程注释条数不符（${after} != ${expect}），已放弃写入 ${card.file}`);
  }

  if (!dryRun) {
    const skipBackup = !wantBackup || process.env.SRS_NO_BACKUP === "1";
    if (!skipBackup) snapshot.backup = backup(card.file);
    writeNote(card.file, lines, eol, mode);
  }

  card.due = due;
  card.interval = interval;
  card.ease = ease;
  return snapshot;
}

export function undo(snapshot, { dryRun = false } = {}) {
  const { eol, mode, lines } = readNote(snapshot.file);
  if (snapshot.oldLine !== null) lines[snapshot.srLine] = snapshot.oldLine;
  else if (snapshot.inserted !== null) lines.splice(snapshot.inserted, 1);
  if (!dryRun) writeNote(snapshot.file, lines, snapshot.eol || eol, snapshot.mode || mode);
}

/**
 * 写入/撤销后行号会变：按 (deck, 题面) 重新对齐待复习卡片的位置与排程。
 */
export function resync(file, cards, settings) {
  const fresh = new Map();
  for (const c of parseFile(file, fs.readFileSync(file, "utf8"), settings).cards) {
    const key = `${c.deck}\u0000${c.front}`;
    if (!fresh.has(key)) fresh.set(key, []);
    fresh.get(key).push(c);
  }
  const seen = new Map();
  for (const c of cards) {
    if (c.file !== file) continue;
    const key = `${c.deck}\u0000${c.front}`;
    const k = seen.get(key) || 0;
    seen.set(key, k + 1);
    const pool = fresh.get(key) || [];
    if (k < pool.length) {
      const f = pool[k];
      c.firstLine = f.firstLine;
      c.endLine = f.endLine;
      c.srLine = f.srLine;
      c.due = f.due;
      c.interval = f.interval;
      c.ease = f.ease;
    }
  }
}

export { SR_RE };
