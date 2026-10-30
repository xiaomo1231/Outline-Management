import type { StyleMetrics } from "./types";

/** 拆书：从一本小说的 txt 里统计写法特征。只算数字，不保留原文。 */

const CH = /^\s*(第[零〇一二两三四五六七八九十百千万0-9０-９]+[章回节卷]|楔子|序章)[^\n]{0,80}$/gm;
const SENT = /[^。！？!?…]+[。！？!?…]+[”」』]?/g;
const DQ = /[“「『][^”」』]*[”」』]/g;
const SIMILE = ["仿佛", "好像", "似乎", "如同", "宛如", "像是"];

/** 识别 txt 编码：UTF-8 坏字太多就按 GB18030 读 */
export function decode(buf: ArrayBuffer): string {
  const u = new TextDecoder("utf-8").decode(buf);
  const bad = (u.match(/�/g) || []).length;
  if (bad < u.length / 1000) return u;
  try {
    return new TextDecoder("gb18030").decode(buf);
  } catch {
    return u;
  }
}

/** 切章。没有章节标题时按约 3000 字一段切，并标记 pseudo */
export function splitChapters(t: string): { chs: string[]; pseudo: boolean } {
  const ms = [...t.matchAll(CH)];
  const chs: string[] = [];
  ms.forEach((m, i) => {
    const s = m.index! + m[0].length;
    const e = i + 1 < ms.length ? ms[i + 1].index! : t.length;
    const body = t.slice(s, e).trim();
    if (body.length > 300 && body.length < 60000) chs.push(body);
  });
  if (chs.length >= 20) return { chs, pseudo: false };
  const out: string[] = [];
  let cur: string[] = [];
  let n = 0;
  for (const line of t.split("\n")) {
    cur.push(line);
    n += line.length;
    if (n >= 3000) {
      out.push(cur.join("\n"));
      cur = [];
      n = 0;
    }
  }
  if (n > 300) out.push(cur.join("\n"));
  return { chs: out, pseudo: true };
}

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const count = (t: string, w: string) => t.split(w).length - 1;

/** 统计一组章节 */
export function measure(chs: string[], pseudo = false): StyleMetrics {
  const paras: number[] = [];
  const sents: number[] = [];
  let one = 0, tot = 0, dlg = 0, fp = 0, tp = 0, ex = 0, q = 0, ell = 0, sim = 0, endQ = 0, endD = 0, endS = 0;
  const firsts: number[] = [];
  for (const c of chs) {
    const ps = c.split("\n").map((x) => x.replace(/^[\s　]+|[\s　]+$/g, "")).filter(Boolean);
    if (!ps.length) continue;
    for (const p of ps) {
      paras.push(p.length);
      const ss = p.match(SENT) || [];
      if (ss.length <= 1) one++;
      for (const s of ss) sents.push(s.length);
    }
    const txt = ps.join("");
    tot += txt.length;
    const ds = txt.match(DQ) || [];
    dlg += ds.reduce((a, x) => a + x.length, 0);
    const nd = txt.replace(DQ, "");
    fp += count(nd, "我");
    tp += count(nd, "他") + count(nd, "她");
    ex += count(txt, "！") + count(txt, "!");
    q += count(txt, "？") + count(txt, "?");
    ell += count(txt, "……");
    sim += SIMILE.reduce((a, w) => a + count(txt, w), 0);
    const last = ps[ps.length - 1];
    if (/[？?][”」』]?$/.test(last)) endQ++;
    if (/^[“「『]/.test(last)) endD++;
    if (last.length <= 15) endS++;
    const m = txt.search(/[“「『]/);
    firsts.push(m < 0 ? txt.length : m);
  }
  const k = 1000 / Math.max(tot, 1);
  const n = Math.max(chs.length, 1);
  const sl = mean(sents);
  return {
    books: 1,
    sentLen: r(sl, 1),
    sentSd: r(Math.sqrt(mean(sents.map((x) => (x - sl) ** 2))), 1),
    paraLen: r(median(paras), 1),
    paraOne: r(one / Math.max(paras.length, 1), 3),
    dialog: r(dlg / Math.max(tot, 1), 3),
    excl: r(ex * k),
    ques: r(q * k),
    ellip: r(ell * k),
    simile: r(sim * k),
    firstPerson: r(fp / Math.max(fp + tp, 1), 3),
    firstDialog: Math.round(median(firsts)),
    chapLen: pseudo ? null : Math.round(median(chs.map((c) => c.length))),
    endQ: pseudo ? null : r(endQ / n, 3),
    endDialog: pseudo ? null : r(endD / n, 3),
    endShort: pseudo ? null : r(endS / n, 3),
  };
}

/** 整本分析：前 10 章单独算开篇，正文均匀抽 80 章 */
export function analyzeBook(text: string): { chapters: number; pseudo: boolean; opening: StyleMetrics; body: StyleMetrics; samples: string[] } {
  const start = text.indexOf("章节内容开始");
  const t = start >= 0 ? text.slice(start + 6) : text;
  const { chs, pseudo } = splitChapters(t);
  const opening = measure(chs.slice(0, 10), pseudo);
  const rest = chs.slice(10);
  const step = Math.max(1, rest.length / 80);
  const pick: string[] = [];
  for (let i = 0; i < rest.length && pick.length < 80; i += step) pick.push(rest[Math.floor(i)]);
  const body = measure(pick.length ? pick : chs, pseudo);
  // 给 AI 看的样本：开头、中段、后段各一段，每段截 1500 字
  const at = (f: number) => (chs.length ? chs[Math.min(chs.length - 1, Math.floor(chs.length * f))].slice(0, 1500) : "");
  return { chapters: chs.length, pseudo, opening, body, samples: [at(0.02), at(0.4), at(0.75)].filter(Boolean) };
}

const pct = (x: number) => Math.round(x * 100) + "%";

/** 写进提示词的量化参考 */
export function metricsText(m: StyleMetrics, src: string): string {
  const parts = [
    `平均句长约 ${Math.round(m.sentLen)} 字`,
    `单句成段的段落约占 ${pct(m.paraOne)}，段落中位长度约 ${Math.round(m.paraLen)} 字`,
    `对白约占全文 ${pct(m.dialog)}`,
    `感叹号每千字约 ${m.excl.toFixed(1)} 个、问号 ${m.ques.toFixed(1)} 个、省略号 ${m.ellip.toFixed(1)} 个`,
    `一章开头约 ${m.firstDialog} 字内出现第一句对白`,
  ];
  if (m.chapLen) parts.push(`章长约 ${m.chapLen} 字`);
  if (m.endShort != null) parts.push(`约 ${pct(m.endShort)} 的章以 15 字内的短句收尾，${pct(m.endQ ?? 0)} 以问句收尾`);
  if (m.firstPerson > 0.3) parts.push("以第一人称叙述为主");
  return `量化参考（${src}，只作方向，不必逐项凑数）：${parts.join("；")}。`;
}

/** 表格里展示的项目 */
export const METRIC_ROWS: [keyof StyleMetrics, string, (v: number) => string][] = [
  ["sentLen", "平均句长", (v) => v.toFixed(1) + " 字"],
  ["paraLen", "段落长度", (v) => Math.round(v) + " 字"],
  ["paraOne", "单句成段", pct],
  ["dialog", "对白占比", pct],
  ["excl", "感叹号/千字", (v) => v.toFixed(1)],
  ["ques", "问号/千字", (v) => v.toFixed(1)],
  ["ellip", "省略号/千字", (v) => v.toFixed(1)],
  ["simile", "比喻词/千字", (v) => v.toFixed(1)],
  ["firstPerson", "第一人称", pct],
  ["firstDialog", "开章到首句对白", (v) => Math.round(v) + " 字"],
  ["chapLen", "章长", (v) => Math.round(v) + " 字"],
  ["endShort", "短句收尾", pct],
  ["endQ", "问句收尾", pct],
];

/** 不调 AI，按数字写一份写法描述 */
export function dimsFromMetrics(m: StyleMetrics) {
  const sent = m.sentLen < 24 ? "短句为主" : m.sentLen > 30 ? "句子偏长，叙述绵密" : "句子长短适中";
  const vary = m.sentSd > 20 ? "，长短交错明显" : m.sentSd < 14 ? "，句子长度很匀" : "";
  const para = m.paraOne > 0.93 ? "几乎一句一段" : m.paraOne < 0.75 ? `段落较长（约 ${Math.round(m.paraLen)} 字），一段写完一个完整的动作或景` : "一段一两句";
  const dlg = m.dialog > 0.33 ? "对白多，约占三分之一以上" : m.dialog < 0.22 ? "对白偏少，以叙述推进" : `对白约占 ${Math.round(m.dialog * 100)}%`;
  const end = m.endShort != null && m.endShort > 0.33 ? "，常用一句短句收章" : m.endQ != null && m.endQ > 0.12 ? "，常以问句收章" : "";
  const open = m.firstDialog < 55 ? "开章很快让人物开口" : m.firstDialog > 100 ? "开章先用叙述铺开，再进对白" : "开章先交代几句再进对白";
  const tone = m.excl > 5.5 ? "情绪外放，感叹句多" : m.excl < 3 ? "情绪收着写，感叹句少" : "";
  return {
    pov: m.firstPerson > 0.3 ? "第一人称" : "第三人称为主",
    lang: sent + vary + (m.simile > 1.3 ? "，比喻用得多" : ""),
    vocab: "",
    rhythm: `${para}；${open}${end}`,
    dialog: dlg + (m.ques > 5.5 ? "，问句多" : ""),
    tone,
    avoid: m.ellip > 2.5 ? "" : "省略号堆叠",
  };
}

/** 和一组参照比，找最接近的（各项按量纲缩放后算距离） */
export function nearest<T extends { metrics?: StyleMetrics }>(m: StyleMetrics, list: T[]): T | undefined {
  const keys: [keyof StyleMetrics, number][] = [["sentLen", 5], ["paraLen", 8], ["paraOne", 0.1], ["dialog", 0.05], ["excl", 1.5], ["ques", 1.5], ["ellip", 1], ["firstDialog", 30]];
  let best: T | undefined;
  let bd = Infinity;
  for (const x of list) {
    if (!x.metrics) continue;
    const d = keys.reduce((a, [k, s]) => a + (((m[k] as number) - (x.metrics![k] as number)) / s) ** 2, 0);
    if (d < bd) {
      bd = d;
      best = x;
    }
  }
  return best;
}
