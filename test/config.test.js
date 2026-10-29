import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pickVault, readConfig, writeConfig, configPath, SOURCE_LABEL } from "../src/config.js";
import { validateVault, DEFAULTS } from "../src/vault.js";

function tmpFile(name = "config.json") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "srs-conf-"));
  return path.join(dir, name);
}

/** 造一个「像库」的目录：只要 .obsidian/plugins/<plugin>/data.json 在就算。 */
function fakeVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "srs-vault-"));
  fs.mkdirSync(path.join(dir, ".obsidian/plugins/obsidian-spaced-repetition"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".obsidian/plugins/obsidian-spaced-repetition/data.json"),
    JSON.stringify({ settings: { ...DEFAULTS } })
  );
  return dir;
}

test("优先级：--vault > $SRS_VAULT > 配置文件", () => {
  const file = tmpFile();
  writeConfig({ vault: "/from/config" }, file);

  assert.equal(pickVault({ flag: "/from/flag", env: { SRS_VAULT: "/from/env" }, file }).value, "/from/flag");
  assert.equal(pickVault({ flag: "/from/flag", env: { SRS_VAULT: "/from/env" }, file }).source, "flag");

  assert.equal(pickVault({ env: { SRS_VAULT: "/from/env" }, file }).value, "/from/env");
  assert.equal(pickVault({ env: { SRS_VAULT: "/from/env" }, file }).source, "env");

  assert.equal(pickVault({ env: {}, file }).value, "/from/config");
  assert.equal(pickVault({ env: {}, file }).source, "config");
});

test("什么都没配：返回 null，不当成任何来源", () => {
  const file = tmpFile();
  const r = pickVault({ env: {}, file });
  assert.equal(r.value, null);
  assert.equal(r.source, null);
  assert.equal(r.file, file);
});

test("配置写读往返；坏掉的 JSON 当没配并带上原因", () => {
  const file = tmpFile();
  writeConfig({ vault: "/a/b" }, file);
  assert.equal(readConfig(file).config.vault, "/a/b");

  fs.writeFileSync(file, "{ 不是 json");
  const bad = readConfig(file);
  assert.equal(bad.config.vault, undefined);
  assert.match(bad.error, /解析失败/);
  // 坏文件也不能让 pickVault 抛异常
  assert.equal(pickVault({ env: {}, file }).value, null);
});

test("配置文件位置受 SRS_CONFIG / XDG_CONFIG_HOME 影响", () => {
  const prev = { ...process.env };
  try {
    process.env.SRS_CONFIG = "/tmp/x/srs.json";
    assert.equal(configPath(), "/tmp/x/srs.json");
    delete process.env.SRS_CONFIG;
    process.env.XDG_CONFIG_HOME = "/tmp/xdg";
    assert.equal(configPath(), path.join("/tmp/xdg", "srs/config.json"));
  } finally {
    process.env = prev;
  }
});

test("validateVault：不存在的路径 / 不是库 / 正常库", () => {
  assert.match(validateVault("/definitely/not/here").error, /不存在/);
  assert.match(validateVault(os.tmpdir()).error, /没有 Spaced Repetition 插件的配置/);
  const v = fakeVault();
  assert.deepEqual(validateVault(v), { vault: v });

  // ~ 展开：在真实 home 下开个临时库验证，用完删掉
  const underHome = fs.mkdtempSync(path.join(os.homedir(), ".srs-test-vault-"));
  fs.mkdirSync(path.join(underHome, ".obsidian/plugins/obsidian-spaced-repetition"), { recursive: true });
  fs.writeFileSync(path.join(underHome, ".obsidian/plugins/obsidian-spaced-repetition/data.json"), "{}");
  try {
    assert.deepEqual(validateVault(`~/${path.basename(underHome)}`), { vault: underHome });
  } finally {
    fs.rmSync(underHome, { recursive: true, force: true });
  }
});

test("SOURCE_LABEL 覆盖三种来源", () => {
  assert.deepEqual(Object.keys(SOURCE_LABEL).sort(), ["config", "env", "flag"]);
});
