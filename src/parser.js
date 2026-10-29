/**
 * 卡片解析 —— 照搬 obsidian-spaced-repetition v1.15.4 的 parser（src/parser.ts）。
 * 纯函数：输入笔记全文 + 设置，输出卡片数组，不碰文件系统。
 */
const TAG_RE = /#flashcards(?:\/[^\s#]*)?/;
const SR_RE = /<!--SR:!(\d{4}-\d{2}-\d{2}),([\d.]+),(\d+)-->/;

/** 卡片正文里混进来的 markdown / 工具元数据，在解析边界就洗干净。 */
export function cleanText(s) {
  return String(s)
    .split("\n")
    .filter((l) => !l.trim().startsWith("<!--SR:"))
    .join("\n")
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
      backRaw = body.slice(k + 1).join("\n").trim();
    } else {
      const sep = settings.singleLineCardSeparator;
      const idx = ct.indexOf(sep);
      if (idx < 0) continue;
      frontRaw = ct.slice(0, idx).trim();
      backRaw = ct.slice(idx + sep.length).trim();
    }

    let deck = null;
    for (const [lineNo, d] of tags) if (lineNo < firstLine) deck = d;
    const own = frontRaw.split("\n")[0].match(TAG_RE);
    if (own && own[0].startsWith("#flashcards")) {
      deck = deckOf(own[0]);
      frontRaw = frontRaw.replace(own[0], "").trim();
    }
    if (deck === null) continue;

    const front = cleanText(frontRaw);
    const back = cleanText(backRaw);
    if (!front || !back) continue;

    const card = {
      file,
      deck,
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
      if (m) {
        card.due = m[1];
        card.interval = Number(m[2]);
        card.ease = Number(m[3]);
      }
    }
    cards.push(card);
  }

  const warnings = [];
  if (swallowed) {
    warnings.push(
      `${file.split("/").pop()}：${swallowed} 处 <!-- --> 注释后面紧跟内容行，` +
        "插件的 parser 会把那一行吞掉（在注释后补一个空行即可修）"
    );
  }
  for (const s of skipped) {
    warnings.push(`${file.split("/").pop()}:${s.line} 是反向卡（::: / ??），暂不支持，已跳过`);
  }

  return { cards, warnings, skipped };
}

export { TAG_RE, SR_RE };
