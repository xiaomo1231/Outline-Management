// 把一本 txt 按「第X卷」「第X章」切成卷和章。
const NUM = "[零〇一二两三四五六七八九十百千万0-9０-９]+";
const VOL = new RegExp(`^\\s*(第${NUM}[卷部集]|卷${NUM})(?:[\\s:：·.、]+(.{0,40}))?\\s*$`);
const CHAP = new RegExp(`^\\s*(第${NUM}[章回节]|楔子|引子|序章|序言|序|前言|尾声|番外[^\\n]{0,10})(?:[\\s:：·.、]+(.{0,100}))?\\s*$`);
// 「第一章雾港」：章号后面直接接章名，章名要短、不带句读，免得把正文句子当成标题
const CHAP_TIGHT = new RegExp(`^\\s*(第${NUM}[章回节])([^\\s:：·.、，。！？；…,!?;“”"「」]{1,20})\\s*$`);

/** 认章节标题：返回章号部分和章名 */
function chapOf(line: string): { head: string; name: string } | null {
  const m = CHAP.exec(line) ?? CHAP_TIGHT.exec(line);
  return m ? { head: m[1].trim(), name: (m[2] ?? "").trim() } : null;
}

export interface ParsedBook {
  vols: { title: string; chapters: { title: string; text: string }[] }[];
  /** 正文前面没归到任何章的文字（例如简介） */
  preface: string;
}

export function parseBook(raw: string): ParsedBook {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const vols: ParsedBook["vols"] = [];
  let pre: string[] = [];
  let ch: { title: string; lines: string[]; num: boolean } | null = null;
  // 卷标题和本卷第一章之间的文字（卷首语等），并进本卷第一章开头
  let volPre: string[] | null = null;
  // 第一个卷标题前只有引子、楔子这类章时临时建的卷，遇到第一个卷标题就改用它的名字
  let autoVol = false;
  const vol = () => {
    if (!vols.length) {
      vols.push({ title: "第一卷", chapters: [] });
      autoVol = true;
    }
    return vols[vols.length - 1];
  };
  const close = () => {
    if (ch) {
      vol().chapters.push({ title: ch.title, text: ch.lines.join("\n").trim() });
      // 卷标题前已经有「第X章」：那是正经的一卷，不能并进后面的卷
      if (ch.num) autoVol = false;
    }
    ch = null;
  };
  // 卷里没有章、只有卷首文字时，单独成一章，不丢
  const flushVolPre = () => {
    const t = (volPre ?? []).join("\n").trim();
    if (t) vol().chapters.push({ title: "", text: t });
    volPre = null;
  };
  for (const line of lines) {
    const v = VOL.exec(line);
    const c = chapOf(line);
    if (v && !c) {
      close();
      flushVolPre();
      const title = (v[1] + (v[2] ? " " + v[2].trim() : "")).trim();
      if (autoVol && vols.length === 1) vols[0].title = title;
      else vols.push({ title, chapters: [] });
      autoVol = false;
      volPre = [];
      continue;
    }
    if (c) {
      close();
      // 「第十二章 雾港」只留「雾港」，章号由墨枢自己编；「楔子」「番外」这类保留原样
      const num = /^第/.test(c.head);
      ch = { title: num ? c.name : (c.head + " " + c.name).trim(), lines: volPre ?? [], num };
      volPre = null;
      continue;
    }
    if (ch) ch.lines.push(line);
    else if (volPre) volPre.push(line);
    else pre.push(line);
  }
  close();
  flushVolPre();
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

/** 从 txt 开头猜书名、作者、简介。rest 是开头没归到任何章的文字（去掉书名、作者行），不截断 */
export function guessMeta(raw: string, preface: string): { name: string; author: string; intro: string; rest: string } {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  // 只看第一个卷章标题之前的行，免得把正文里的《某书》当成书名
  const stop = lines.findIndex((l) => chapOf(l) || VOL.test(l));
  const head = (stop < 0 ? lines : lines.slice(0, stop)).slice(0, 15).map((x) => x.trim()).filter(Boolean);
  let name = "";
  let nameLine = "";
  const bqLine = head.find((l) => /^(?:书名[:：]\s*)?《[^》]{1,40}》/.test(l));
  if (bqLine) {
    name = /《([^》]{1,40})》/.exec(bqLine)![1].trim();
    nameLine = bqLine;
  } else {
    const first = head[0] ?? "";
    if (first && first.length <= 30 && !/[，。！？]/.test(first) && !/作者|简介/.test(first)) {
      name = first.replace(/^书名[:：]\s*/, "");
      nameLine = first;
    }
  }
  const au = head.map((l) => /作者[:：\s]\s*([^\s，,]{1,30})/.exec(l)).find(Boolean);
  // 只去掉书名那一行，提到书名的简介句子要留着
  const rest = preface
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x && x !== nameLine && !/^作者[:：\s]/.test(x) && !/^书名[:：]/.test(x))
    .join("\n")
    .replace(/^(内容)?简介[:：]?\s*/, "");
  return { name, author: au ? au[1] : "", intro: rest.slice(0, 300), rest };
}
