import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { applySchedule, backupRoot, countSchedules } from "../src/store.js";
import { parseFile } from "../src/parser.js";
import { DEFAULTS } from "../src/vault.js";
import { DICT, makeT, resolveLang } from "../src/i18n.js";

function tmpNote(text, mode = 0o644) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "srs-quality-"));
  const file = path.join(dir, "note.md");
  fs.writeFileSync(file, text);
  fs.chmodSync(file, mode);
  return file;
}

function withEnv(patch, fn) {
  const prev = { ...process.env };
  Object.assign(process.env, patch);
  try {
    return fn();
  } finally {
    for (const k of Object.keys(patch)) delete process.env[k];
    Object.assign(process.env, prev);
  }
}

const NOTE = "#flashcards/t\n\n卡 :: 答\n<!--SR:!2026-10-28,6,230-->\n";

test("备份目录：SRS_BACKUP_DIR > XDG_STATE_HOME > ~/.local/state", () => {
  withEnv({ SRS_BACKUP_DIR: "/tmp/custom-backups" }, () => {
    assert.equal(backupRoot(), "/tmp/custom-backups");
  });
  withEnv({ SRS_BACKUP_DIR: "", XDG_STATE_HOME: "/tmp/xdg-state" }, () => {
    assert.equal(backupRoot(), path.join("/tmp/xdg-state", "srs", "backups"));
  });
  withEnv({ SRS_BACKUP_DIR: "", XDG_STATE_HOME: "" }, () => {
    assert.equal(backupRoot(), path.join(os.homedir(), ".local", "state", "srs", "backups"));
  });
  withEnv({ SRS_BACKUP_DIR: "~/bp" }, () => {
    assert.equal(backupRoot(), path.join(os.homedir(), "bp"));
  });
});

test("写回保留 CRLF 换行与文件权限", () => {
  const file = tmpNote("#flashcards/t\r\n\r\n卡 :: 答\r\n<!--SR:!2026-10-28,6,230-->\r\n", 0o600);
  const text = fs.readFileSync(file, "utf8");
  const card = parseFile(file, text, DEFAULTS).cards[0];
  applySchedule(card, "2026-11-12", 14, 230, { backup: false });

  const out = fs.readFileSync(file, "utf8");
  assert.match(out, /<!--SR:!2026-11-12,14,230-->/);
  assert.equal(out.split("\n").length - 1, 4, "行数不变");
  // 每一行结尾都得是 \r\n（不能混进裸 \n）
  const lines = out.split("\r\n");
  assert.equal(lines.length - 1, 4);
  assert.ok(!/[^\r]\n/.test(out), "不应出现裸 \\n 换行");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, "权限保持 0600");
});

test("新卡插入注释也遵循 CRLF", () => {
  const file = tmpNote("#flashcards/t\r\n\r\n卡 :: 答\r\n");
  const card = parseFile(file, fs.readFileSync(file, "utf8"), DEFAULTS).cards[0];
  applySchedule(card, "2026-11-01", 3, 250, { backup: false });
  const out = fs.readFileSync(file, "utf8");
  assert.ok(!/[^\r]\n/.test(out), "插入行也要 CRLF");
  assert.equal(countSchedules(out), 1);
});

test("备份保留上限：超过 SRS_BACKUP_KEEP 的旧备份被清掉", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "srs-backups-"));
  for (const name of ["20200101T000000", "20200102T000000", "20200103T000000"]) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
  }
  const file = tmpNote(NOTE);
  const card = parseFile(file, fs.readFileSync(file, "utf8"), DEFAULTS).cards[0];

  withEnv({ SRS_BACKUP_DIR: root, SRS_BACKUP_KEEP: "2" }, () => {
    applySchedule(card, "2026-11-12", 14, 230);
  });

  const dirs = fs.readdirSync(root).filter((n) => fs.statSync(path.join(root, n)).isDirectory());
  assert.equal(dirs.length, 2, `应只剩 2 份，实得 ${dirs.length}`);
  assert.ok(
    dirs.some((d) => d > "20200103"),
    "新备份要在",
  );
});

test("--no-backup / SRS_NO_BACKUP=1 不写备份", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "srs-nobackup-"));
  const file = tmpNote(NOTE);
  const card = parseFile(file, fs.readFileSync(file, "utf8"), DEFAULTS).cards[0];

  withEnv({ SRS_BACKUP_DIR: root }, () => {
    applySchedule(card, "2026-11-12", 14, 230, { backup: false });
    assert.deepEqual(fs.readdirSync(root), [], "--no-backup 不该留东西");
  });

  const file2 = tmpNote(NOTE);
  const card2 = parseFile(file2, fs.readFileSync(file2, "utf8"), DEFAULTS).cards[0];
  withEnv({ SRS_BACKUP_DIR: root, SRS_NO_BACKUP: "1" }, () => {
    applySchedule(card2, "2026-11-12", 14, 230);
    assert.deepEqual(fs.readdirSync(root), [], "env 也该生效");
  });
});

test("i18n：语言选择与缺键回退", () => {
  assert.equal(resolveLang({ LANG: "en_US.UTF-8" }), "en");
  assert.equal(resolveLang({ LANG: "zh_CN.UTF-8" }), "zh");
  assert.equal(resolveLang({ SRS_LANG: "en" }), "en");
  assert.equal(resolveLang({ LANG: "de_DE.UTF-8" }), "zh", "未知语言默认中文");
  assert.equal(makeT("en")("ivl.now"), "now");
  assert.equal(makeT("zh")("ivl.now"), "马上");
  assert.equal(makeT("en")("no.such.key"), "no.such.key");
});

test("i18n：两种语言的键集合一致（避免漏翻）", () => {
  const zh = Object.keys(DICT.zh).sort();
  const en = Object.keys(DICT.en).sort();
  const missingInEn = zh.filter((k) => !en.includes(k));
  const extraInEn = en.filter((k) => !zh.includes(k));
  assert.deepEqual(missingInEn, [], `英文缺：${missingInEn.join(", ")}`);
  assert.deepEqual(extraInEn, [], `英文多：${extraInEn.join(", ")}`);
});
