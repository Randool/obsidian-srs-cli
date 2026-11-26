/**
 * 卡片解析 —— 照搬 obsidian-spaced-repetition v1.15.4 的 parser（src/parser.ts）。
 * 纯函数：输入笔记全文 + 设置，输出卡片数组，不碰文件系统。
 */
import { isValidDateStr } from "./schedule.js";

const TAG_RE = /#flashcards(?:\/[^\s#]*)?/;
const SR_RE = /<!--SR:!(\d{4}-\d{2}-\d{2}),([\d.]+),(\d+)-->/;

/** 去掉卡片正文里混进来的 SR 注释行。 */
function withoutSchedules(s) {
  return String(s)
    .split("\n")
    .filter((l) => !l.trim().startsWith("<!--SR:"))
    .join("\n");
}

/** 卡片正文里混进来的 markdown / 工具元数据，在解析边界就洗干净。 */
export function cleanText(s) {
  return withoutSchedules(s)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/==/g, "")
    .trim();
}

function deckOf(line) {
  const m = line.match(TAG_RE);
  if (!m) return null;
  return m[0].slice("#flashcards".length).replace(/^\/+/, "");
}

/**
 * 逐行扫描。要点（都与插件一致）：
 *  - 单行卡：一行里出现单行分隔符就是一张卡，不要求空行隔开
 *  - 多行卡：一行只有 `?`（或 `??`），答案延续到空行
 *  - 非 SR 的 `<!-- -->` 注释会连同后面一行被吞掉（插件的历史行为，照抄以免卡集错位）
 *  - 反向卡 / cloze 不解析，记进 skipped 里给上层提示
 *
 * @returns {{cards: Array, warnings: string[], skipped: Array<{line:number,kind:string}>}}
 */
export function parseFile(file, text, settings) {
  const inline = [
    [settings.singleLineReversedCardSeparator, "rev"],
    [settings.singleLineCardSeparator, "single"],
  ].sort((a, b) => b[0].length - a[0].length);
  const multi = settings.multilineCardSeparator;
  const multiRev = settings.multilineReversedCardSeparator;

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const parsed = [];
  const tags = [];
  let cardText = "";
  let cardType = null;
  let first = 0;
  let swallowed = 0;

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const trim = cur.trim();

    if (cur.startsWith("<!--") && !cur.startsWith("<!--SR:")) {
      if (i + 1 < lines.length && lines[i + 1].trim()) swallowed++;
      i += 1; // 插件这里多跳一行：注释后的内容行会被吞掉
      continue;
    }

    if (trim.startsWith("#flashcards")) {
      const d = deckOf(trim);
      if (d !== null) tags.push([i, d]);
    }

    if (trim === "") {
      if (cardType === "multi" || cardType === "multi_rev") {
        parsed.push([cardType, cardText.trimEnd(), first, i - 1]);
      }
      cardType = null;
      cardText = "";
      first = i + 1;
      continue;
    }

    cardText = cardText.length ? `${cardText}\n${cur.trimEnd()}` : cur.trimEnd();

    let hit = null;
    for (const [sep, kind] of inline) {
      if (sep && cur.includes(sep)) {
        hit = kind;
        break;
      }
    }

    if (hit !== null) {
      cardText = cur.trimEnd();
      first = i;
      if (i + 1 < lines.length && lines[i + 1].startsWith("<!--SR:")) {
        cardText += `\n${lines[i + 1]}`;
        i++;
      }
      parsed.push([hit, cardText, first, i]);
      cardType = null;
      cardText = "";
    } else if (trim === multi && cardText.length > 1) {
      cardType = "multi";
    } else if (trim === multiRev && cardText.length > 1) {
      cardType = "multi_rev";
    }
  }
  if ((cardType === "multi" || cardType === "multi_rev") && cardText) {
    parsed.push([cardType, cardText.trimEnd(), first, lines.length - 1]);
  }

  const cards = [];
  const skipped = [];
  const badSrLines = [];

  for (const [kind, ct, firstLine, lastLine] of parsed) {
    let srLine = null;
    for (const cand of [lastLine, lastLine + 1]) {
      if (lines[cand] && lines[cand].startsWith("<!--SR:")) {
        srLine = cand;
        break;
      }
    }
    if (kind === "rev" || kind === "multi_rev") {
      skipped.push({ line: firstLine + 1, kind: "reversed" });
      continue;
    }

    let frontRaw;
    let backRaw;
    if (kind === "multi") {
      const body = ct.split("\n");
      const k = body.findIndex((x) => x.trim() === multi);
      if (k < 0) continue;
      frontRaw = body.slice(0, k).join("\n").trim();
      backRaw = body
        .slice(k + 1)
        .join("\n")
        .trim();
    } else {
      const sep = settings.singleLineCardSeparator;
      const idx = ct.indexOf(sep);
      if (idx < 0) continue;
      frontRaw = ct.slice(0, idx).trim();
      backRaw = ct.slice(idx + sep.length).trim();
    }
    frontRaw = withoutSchedules(frontRaw).trim();
    backRaw = withoutSchedules(backRaw).trim();

    let deck = null;
    for (const [lineNo, d] of tags) if (lineNo < firstLine) deck = d;
    let ownTag = null;
    const own = frontRaw.split("\n")[0].match(TAG_RE);
    if (own && own[0].startsWith("#flashcards")) {
      ownTag = own[0];
      deck = deckOf(ownTag);
      frontRaw = frontRaw.replace(ownTag, "").trim();
    }
    if (deck === null) continue;

    const front = cleanText(frontRaw);
    const back = cleanText(backRaw);
    if (!front || !back) continue;

    const card = {
      file,
      deck,
      kind: kind === "multi" ? "multi" : "single",
      ownTag,
      front,
      back,
      frontRaw,
      backRaw,
      firstLine,
      endLine: lastLine,
      srLine,
      due: null,
      interval: null,
      ease: null,
    };
    if (srLine !== null) {
      const m = lines[srLine].match(SR_RE);
      const interval = m ? Number(m[2]) : NaN;
      const ease = m ? Number(m[3]) : NaN;
      // 格式不对（正则不匹配、日期不存在、间隔/ease 不是有限数）时：
      // due/interval/ease 保持 null，排程上按新卡处理；srLine 照常保留，
      // 这样下次作答时 applySchedule 能原位覆盖这行坏注释，而不是另插一行
      // 造成同一张卡出现两条排程注释。坏行只记行号进告警，不回显原文。
      if (m && isValidDateStr(m[1]) && Number.isFinite(interval) && Number.isFinite(ease)) {
        card.due = m[1];
        card.interval = interval;
        card.ease = ease;
      } else {
        badSrLines.push(srLine + 1);
      }
    }
    cards.push(card);
  }

  const warnings = [];
  for (const line of badSrLines) {
    warnings.push(
      `${file.split("/").pop()}:${line} 的排程注释格式不对，已按新卡处理` +
        "（应为 <!--SR:!YYYY-MM-DD,间隔,ease-->，改对日期后重新排程即可）",
    );
  }
  if (swallowed) {
    warnings.push(
      `${file.split("/").pop()}：${swallowed} 处 <!-- --> 注释后面紧跟内容行，` +
        "插件的 parser 会把那一行吞掉（在注释后补一个空行即可修）",
    );
  }
  for (const s of skipped) {
    warnings.push(`${file.split("/").pop()}:${s.line} 是反向卡（::: / ??），暂不支持，已跳过`);
  }

  return { cards, warnings, skipped };
}

export { TAG_RE };
