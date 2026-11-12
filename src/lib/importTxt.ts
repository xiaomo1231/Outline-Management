// 把一本 txt 按「第X卷」「第X章」切成卷和章。
const NUM = "[零〇一二两三四五六七八九十百千万0-9０-９]+";
const VOL = new RegExp(`^\\s*(第${NUM}[卷部集]|卷${NUM})(?:[\\s:：·.、]+(.{0,40}))?\\s*$`);
const CHAP = new RegExp(`^\\s*(第${NUM}[章回节]|楔子|序章|序言|尾声|番外[^\\n]{0,10})(?:[\\s:：·.、]+(.{0,60}))?\\s*$`);

export interface ParsedBook {
  vols: { title: string; chapters: { title: string; text: string }[] }[];
  /** 正文前面没归到任何章的文字（例如简介） */
  preface: string;
}

export function parseBook(raw: string): ParsedBook {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const vols: ParsedBook["vols"] = [];
  let pre: string[] = [];
  let ch: { title: string; lines: string[] } | null = null;
  const vol = () => {
    if (!vols.length) vols.push({ title: "第一卷", chapters: [] });
    return vols[vols.length - 1];
  };
  const close = () => {
    if (ch) vol().chapters.push({ title: ch.title, text: ch.lines.join("\n").trim() });
    ch = null;
  };
  for (const line of lines) {
    const v = VOL.exec(line);
    if (v && !CHAP.test(line)) {
      close();
      vols.push({ title: (v[1] + (v[2] ? " " + v[2].trim() : "")).trim(), chapters: [] });
      continue;
    }
    const c = CHAP.exec(line);
    if (c) {
      close();
      // 「第十二章 雾港」只留「雾港」，章号由墨枢自己编；「楔子」「番外」这类保留原样
      const name = (c[2] ?? "").trim();
      ch = { title: /^第/.test(c[1].trim()) ? name : (c[1].trim() + " " + name).trim(), lines: [] };
      continue;
    }
    if (ch) ch.lines.push(line);
    else pre.push(line);
  }
  close();
  // 没有任何章节标题：整本当作一章
  if (!vols.some((v) => v.chapters.length)) {
    const text = pre.join("\n").trim();
    return { vols: text ? [{ title: "第一卷", chapters: [{ title: "", text }] }] : [], preface: "" };
  }
  return { vols: vols.filter((v) => v.chapters.length), preface: pre.join("\n").trim() };
}

/** 纯文本段落转成编辑器用的 HTML */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split("\n")
    .map((p) => p.replace(/^[\s　]+/, "").trimEnd())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join("");
}

export function plainOf(text: string): string {
  return text
    .split("\n")
    .map((p) => p.replace(/^[\s　]+/, "").trimEnd())
    .filter(Boolean)
    .join("\n");
}
