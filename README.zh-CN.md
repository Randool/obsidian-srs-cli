# obsrs

![obsrs — 在终端复习 Obsidian 闪卡](assets/banner.svg)

[English](README.md) · **简体中文**

在终端复习 [obsidian-spaced-repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) 的闪卡。
和插件共用同一份数据（笔记里的 `<!--SR:!日期,间隔,ease-->` 注释），两边可以交替复习，进度不打架。

上游插件没有命令行接口，这是照它 v1.15.4 的实现（SM-2-OSR 算法 + 行级 parser + 设置项）移植的。
Node.js（≥18）、零依赖；核心逻辑与界面分层，带 `node:test` 测试。

> 下面截图里的库名、deck 和卡片内容都是虚构的示例。

## 安装

```bash
npm i -g obsidian-srs-cli    # 装出来的命令叫 obsrs
obsrs --version
```

- 包名 `obsidian-srs-cli`（npm 上搜得到），命令名 `obsrs`（少打字）——同 `ripgrep` → `rg` 的分法。
- `npx obsidian-srs-cli` 也能直接跑；想要三字母可以 `alias srs=obsrs`（`srs` 太通用，不去占）。
- 不装也行：`node /path/to/obsidian-srs-cli/srs.js`。

## 配置库路径（第一次用先做这一步）

程序不认识任何硬编码路径，库在哪由你告诉它。三种方式，按优先级：

```bash
obsrs config --vault ~/Documents/Notes   # 写进配置文件，配一次长期有效
export SRS_VAULT=~/Documents/Notes       # 只对当前 shell 生效
obsrs --vault /path/to/your/vault        # 只对这一次生效
```

- 第一次在终端里直接跑、又没配过库时，它会**当场问一句「库路径？」**并记住，不用去翻文档。
- `obsrs config` 不带参数 → 看配置文件位置、记了哪个库、当前生效的是哪个、来源是什么；`--unset` 清掉。
- 写入前会校验目录里确实有 `.obsidian/plugins/obsidian-spaced-repetition/data.json`，写错直接报错不落地。
- 配置文件位置：`$SRS_CONFIG` > `$XDG_CONFIG_HOME/srs/config.json` > `~/.config/srs/config.json`
  （Windows 用 `%APPDATA%\srs\config.json`）。

## 主页

```
 obsrs · 终端复习 Obsidian 闪卡                                        Notes
 今天 2026-05-12   12 张到期 · 34 张新卡 · 共 96 张
 ▸ 全部                                       12 到期    34 新卡     96 共
   science/biology                            5 到期    18 新卡     40 共
   cs/networking                              4 到期    10 新卡     31 共
   history                                    3 到期     6 新卡     25 共
 ↑↓ 选择  Enter 开始  n 新卡  d 到期  m 出题·插件顺序  r 刷新  ? 帮助  q 退出
 选中：全部 · 12 到期 / 34 新卡 · 出题方式：按插件设置（逐 deck 出）
```

有活儿的 deck 排在上面。`Enter` 开始（到期 + 新卡），`n` 只新卡，`d` 只有到期。

## 复习界面

```
 obsrs · science/biology · 3/40                       ██████░░░░░░░░ 已答 2
┌──────────────────────────────────────────────────────────────────────┐
│ 线粒体内膜的 ATP 合成靠什么驱动？                                     │
│ ────────────────────────── 答案                                      │
│ 质子梯度：H+ 顺浓度差回流，带动 ATP 合酶转动                          │
└──────────────────────────────────────────────────────────────────────┘
 biology-srs · 到期 2026-05-10 · 间隔 6 天 · ease 230
 1 Again 马上 · 2 Hard 3 天 · 3 Good 14 天 · 4 Easy 20 天
 1-4 打分  z 撤销  s 跳过  x 重洗  ↑↓ 滚动  ? 帮助  q 结束
```

**每档都写着按了会排到多久之后**，不用凭感觉猜。翻面只翻面（按 1-4 不会把题偷答掉）；
答完自动到下一张，长答案按 `↑↓` 翻；`x` 把还没看到的部分重新打乱。

## 小结

```
 obsrs · 这一轮复习完成
       ┌────────────────────────────────────────────────┐
       │  作答 12 张  用时 4 分 32 秒                   │
       │  Again 2   Hard 3   Good 5   Easy 2            │
       │  下次有活：2026-05-13（8 张）                  │
       └────────────────────────────────────────────────┘
 Enter 回主页   q 退出
```

## 命令

```bash
obsrs                          # 主页（选 deck → 复习 → 小结）
obsrs review                   # 直接进复习，跳过主页
obsrs review -d science -n 20  # 指定 deck、限张数
obsrs review --new-only        # 只过新卡（--due-only 只过到期卡）
obsrs review --dry-run         # 空跑一遍，不写笔记
obsrs review --shuffle         # 跨 deck 随机混排出题（换换脑子）
obsrs review --no-backup       # 这次不留笔记备份
obsrs status [--json]          # 文本概览（脚本/CI 用）
obsrs list [-d deck]           # 列卡片与排程
obsrs config [--vault <目录>|--unset]   # 看/写/清库路径
obsrs --version                # 版本号
```

## 按键

| 界面 | 键 | 作用 |
|---|---|---|
| 主页 | `↑↓` / `k j` | 换 deck |
| | `Enter` / `a` | 开始（到期 + 新卡） |
| | `n` / `d` | 只新卡 / 只有到期 |
| | `m` | 切换出题方式：按插件设置（逐 deck 出）↔ 随机混排（跨 deck 打散） |
| | `r` | 重新读库（外部改过笔记） |
| 复习 | `Space` / `Enter` | 翻面 |
| | `1-4` 或 `a h g e` | Again / Hard / Good / Easy |
| | `z` | 撤销上一张（回到那张卡） |
| | `s` | 跳过（不写排程） |
| | `x` | 重洗剩下的卡（已答的不动） |
| | `↑↓` / `j k` | 滚动长答案 |
| 任何界面 | `?` | 键盘帮助 |
| | `q` | 返回 / 结束 |

输出被重定向或用管道时自动退化成逐行问答（`--plain` 可强制），所以脚本里也能跑。

## 出题顺序

主页按 `m` 切换（复习中按 `x` 可随时重洗剩下的卡）：

- **按插件设置**（默认，与插件完全一致）：照 `data.json` 的 `flashcardDeckOrder` / `flashcardCardOrder`，逐 deck 一组一组出——一个 deck 里打乱，但 deck 之间不混。
- **随机混排**：把选中的卡整体打散，一个 deck 的卡后面可能紧跟另一个 deck 的卡。`--shuffle` 等价于直接进这个模式。

## 与插件的一致性

- 设置全部读插件自己的 `data.json`：分隔符、`baseEase`、`easyBonus`、`lapsesIntervalChange`、`loadBalance`、`maximumInterval`、卡片/卡组排序。
- 排程照 `osrSchedule()`：Good = 间隔×ease；Easy 额外 +20 ease 且乘 easyBonus；Hard 间隔乘 lapsesIntervalChange 且 ease−20；Again 归零并挪到本次末尾重出。开 loadBalance 时按全库到期直方图抖动间隔（照抄 `findLeastUsedIntervalOverRange`），**即使直方图为空也取整**（所以新卡 Good 是 3 天不是 2.5）。
- 新卡的初始 ease 用「笔记加载时」已排程卡的平均值（log 加权），与插件同口径。
- 卡集与插件 deck tree 逐 deck 对齐过（开 Obsidian 读插件内部的 deck tree 与 `status --json` 对照）。

## 安全 / 备份 / 退出码

- 写入是原子的（临时文件 + rename），保留原换行风格（LF/CRLF）与文件权限。
- 写前校验 `<!--SR:` 条数，会变就放弃写入；每篇笔记先备份到 `<state>/srs/backups/<时间戳>/`，
  其中 `<state>` = `$XDG_STATE_HOME`（默认 `~/.local/state`）。
- 备份只保留最近 20 份（`SRS_BACKUP_KEEP` 可调）；`--no-backup` 或 `SRS_NO_BACKUP=1` 可关掉。
- 复习前最好让 Obsidian 把笔记存盘 / 关掉那篇笔记：编辑器里的缓冲区不会随磁盘改动同步，
  下次保存可能把工具的写入覆盖回去。
- 退出码：`0` 正常，`2` 参数或配置问题（库路径、deck 名、dataStore 不支持），`1` 未预期异常。

## 语言

界面有中英文两套，默认跟随 `$LANG`（`en*` → 英文，其余中文），也可以用 `SRS_LANG=en` / `SRS_LANG=zh` 强制。
卡片内容不会翻译——那是你自己的笔记。

## 结构

```
srs.js              入口：参数、命令分发、主页↔复习↔小结的流程
src/config.js       库路径（--vault > $SRS_VAULT > 配置文件）
src/vault.js        库校验 + 插件设置读取
src/parser.js       卡片解析（逐行，含插件的历史行为）
src/schedule.js     SM-2-OSR + 四档预览 + 日期
src/store.js        写回、备份/清理、撤销、行号重排
src/session.js      队列与一次复习的状态机（不认终端）
src/i18n.js         中英文案
src/plain.js        非 TTY 的逐行模式
src/ui/*.js         备择屏、绘制零件、主页/复习/小结三个界面
test/*.test.js      node:test：解析、排程、队列/随机、写回/撤销、配置、i18n、打包约束
```

```bash
npm test        # 45 个用例
```

## 不支持

反向卡（`:::` / `??`）、cloze（`==`）、整篇笔记复习、`burySiblingCards`、FSRS 排程。遇到会提示并跳过。

## 许可证

MIT，见 [LICENSE](LICENSE)。
