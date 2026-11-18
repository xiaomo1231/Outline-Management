// 给 AI 组装上下文。原则：稳定的内容放前面（命中 DeepSeek 的缓存，便宜），每次只带需要的。
import type { WorkData } from "../store";
import type { MemItem, Work } from "../types";
import { compileStyle } from "../style";
import { allChapters, findChapter, plants, type ChRef } from "../outline";
import { describe } from "../chars";
import * as mem from "../memory";
import * as repo from "../repo";
import { phaseName } from "../plan";
import { PATTERNS, parseBans } from "../aiscan";
import { archiveMap } from "./archive";
import { clip } from "../util";
import { residentLimitOf, type MemPrefs } from "../hooks";

export type Ctx = WorkData & { work: Work };

/** 写正文时的去 AI 味规则，所有生成正文的任务都带上 */
export const NATURAL = `写法要求：
- 像这位作者本人在写，不像 AI。不要总结、不要升华、不要在段尾点题，不要排比抒情。
- 情绪不直说，落在动作、物件和对白上。
- 少用这些套话：${PATTERNS.map((p) => p.label).join("、")}。
- 句子长短要有变化，允许不完整的句子和口语。
- 不要替作者推进大纲以外的剧情，不要新增设定。`;

/** 核心摘要：有AI 整理整理过的就用它，没有就现场拼一份 */
export async function resident(c: Ctx): Promise<string> {
  const r = await mem.getResident(c.work.id);
  if (r) return r.text;
  const facts = await mem.items(c.work.id, 1);
  const limit = residentLimitOf(await repo.getSetting<Partial<MemPrefs>>("memory", {}));
  return mem.buildResident(c.work, c.chars, c.vols, c.events, compileStyle(c.style), facts, limit);
}

/** 系统提示的稳定前缀 */
export async function stablePrefix(c: Ctx, role: string): Promise<string> {
  return `${role}\n\n=== 核心摘要（这本书的核心信息）===\n${await resident(c)}${bansText(c)}`;
}

/** 作者的禁用清单，所有任务都带上 */
export function bansText(c: Pick<Ctx, "style">): string {
  const { all } = parseBans(c.style?.bans);
  if (!all.length) return "";
  return "\n\n=== 禁用清单（作者明确不要的，任何时候都不能写，也不能换个说法写）===\n" + all.map((x) => "- " + x).join("\n");
}

function words(s: string): string[] {
  return s.split(/[\s，。、；：“”‘’！？,.;:!?()（）]+/).filter((w) => w.length >= 2);
}

/** 按关键词从记忆里召回，并投命中票 */
export async function recall(c: Ctx, keys: string[], limit = 12): Promise<MemItem[]> {
  const all = await mem.items(c.work.id);
  const ks = [...new Set(keys.filter((k) => k && k.length >= 2))];
  const hit = all.filter((it) => it.layer > 1 && ks.some((k) => it.text.includes(k))).slice(0, limit);
  await mem.voteHit(c.work.id, hit.map((x) => x.id));
  return hit;
}

/** 写某一章需要的全部材料：按大纲提前召回 */
export async function chapterContext(c: Ctx, r: ChRef): Promise<{ text: string; refs: string[] }> {
  const refs: string[] = [];
  const parts: string[] = [];
  const names = new Set<string>();
  r.ch.scenes.forEach((s) => s.who.forEach((w) => names.add(w)));
  if (r.ch.scenes.some((s) => s.pov)) r.ch.scenes.forEach((s) => s.pov && names.add(s.pov));
  const people = c.chars.filter((x) => x.name && names.has(x.name));
  if (people.length) {
    parts.push("=== 本章出场人物（第" + r.no + "章时的状态）===\n" + people.map((p) => describe(p, c.vols, r.no, { forProse: true })).join("\n\n"));
    refs.push(...people.map((p) => p.name + "人物卡"));
  }
  const pl = plants(c.vols, c.events);
  const due = pl.filter((p) => r.ch.scenes.some((s) => (s.pay && s.pay.includes(p.name)) || (s.plant && s.plant.includes(p.name))));
  if (due.length) {
    parts.push("=== 本章要埋或要收的伏笔 ===\n" + due.map((p) => `${p.name}：第${p.plantNo ?? "?"}章埋${p.payNo ? `，计划第${p.payNo}章收` : ""}`).join("\n"));
    refs.push(...due.map((p) => "伏笔：" + p.name));
  }
  const keys = [...names, ...r.ch.scenes.flatMap((s) => [s.plant, s.pay, s.place || ""]), ...r.ch.scenes.flatMap((s) => words(s.t))];
  const prior = await priorStory(c, r.no, { n: 5, tail: 800, names: keys });
  if (prior.text) {
    parts.push(prior.text);
    refs.push(...prior.refs);
  }
  const vol = c.vols[r.v];
  if (vol?.outline?.trim()) {
    parts.push(`=== 本卷大纲（${vol.title}）===\n` + vol.outline.trim() + [vol.goal && "\n本卷目标：" + vol.goal, vol.climax && "\n本卷高潮：" + vol.climax, vol.hook && "\n卷末钩子：" + vol.hook].filter(Boolean).join(""));
    refs.push("卷大纲");
  }
  if (r.ch.pl) parts.push(`本章在篇幅规划里属于：${phaseName(c.plan, r.ch.pl)}${c.plan[r.ch.pl.a]?.ph[r.ch.pl.p]?.g ? "，这一阶段的目标：" + c.plan[r.ch.pl.a].ph[r.ch.pl.p].g : ""}`);
  return { text: parts.join("\n\n"), refs };
}

/** 大纲和正文都要遵守的“接上前文”规则 */
export const CONTINUE_RULE = `接上前文的硬性要求：
- 新内容必须从上一章的章末状态接着往下走：每个人物此刻在哪、和谁在一起、在做什么、处境如何（受伤、被押送、被困、手里有什么），都要延续。
- 例如上一章结尾主角正被两个人押送，下一章开头主角就仍在押送途中、押送他的人仍在身边；要改变这个局面，必须写出是怎么改变的（逃脱、被救、到达目的地等），不能当作没发生过。
- 已经发生的事不要重写一遍，已经死去、离开的人不要无故出场，已经用掉的东西不要再出现。`;

/**
 * 写在某一章之前的“前文”：给大纲和正文任务用。
 * 读章节归档（摘要、章末状态），没归档的章退回用大纲和正文结尾；再加上最近一章正文的原文结尾、相关记忆和设定集。
 */
export async function priorStory(c: Ctx, no: number, opts: { n?: number; tail?: number; bible?: boolean; names?: string[] } = {}): Promise<{ text: string; refs: string[]; names: string[] }> {
  const n = opts.n ?? 10;
  const tail = opts.tail ?? 800;
  const refs: string[] = [];
  const parts: string[] = [];
  const all = allChapters(c.vols);
  const before = all.filter((x) => x.no < no);
  if (!before.length) return { text: "", refs, names: [] };
  const arcs = await archiveMap(c.work.id);
  const texts = new Map((await repo.allTexts(c.work.id)).map((t) => [t.id, t]));
  const prev = before.slice(-n);
  const lines = prev.map((x) => {
    const a = arcs.get(x.ch.id);
    const t = texts.get(x.ch.id);
    const head = `第${x.no}章 ${x.ch.title || "（未命名）"}`;
    if (a?.summary) return `${head}：${a.summary}`;
    if (x.ch.summary) return `${head}：${x.ch.summary}`;
    const ol = [x.ch.ol, x.ch.scenes.map((s) => s.t + (s.result ? "（" + s.result + "）" : "")).join("；")].filter(Boolean).join("｜");
    if (t?.plain?.trim()) return `${head}（还没归档，只有大纲）：${ol || "（无大纲）"}`;
    return `${head}（还没写正文，按大纲）：${ol || "（无大纲）"}`;
  });
  parts.push(`=== 前文：第${prev[0].no}–${prev[prev.length - 1].no}章发生了什么 ===\n` + lines.join("\n"));
  refs.push(`前文第${prev[0].no}–${prev[prev.length - 1].no}章`);
  // 最近一章已写正文：章末状态 + 原文结尾
  const lastWritten = [...before].reverse().find((x) => texts.get(x.ch.id)?.plain?.trim());
  const names = new Set<string>(opts.names ?? []);
  if (lastWritten) {
    const a = arcs.get(lastWritten.ch.id);
    const t = texts.get(lastWritten.ch.id)!;
    // 归档之后又改过结尾，就不用旧的章末状态，以原文为准
    const fresh = a && a.plain.slice(-300) === t.plain.slice(-300);
    if (a?.end && fresh) {
      parts.push(`=== 第${lastWritten.no}章结束时的局面（章末状态）===\n${a.end}`);
      refs.push(`第${lastWritten.no}章章末状态`);
    }
    parts.push(`=== 第${lastWritten.no}章正文结尾原文 ===\n` + t.plain.slice(-tail));
    refs.push(`第${lastWritten.no}章结尾`);
    if (lastWritten.no < no - 1) parts.push(`（第${lastWritten.no + 1}–${no - 1}章还没写正文，以上面的大纲为准。）`);
    const endText = (a?.end ?? "") + t.plain.slice(-tail);
    c.chars.forEach((p) => p.name && endText.includes(p.name) && names.add(p.name));
  }
  prev.slice(-2).forEach((x) => x.ch.scenes.forEach((s) => s.who.forEach((w) => names.add(w))));
  const rec = await recall(c, [...names], 10);
  if (rec.length) {
    parts.push("=== 相关的早前记忆 ===\n" + rec.map((x) => `[第${x.ch}章] ${x.text}`).join("\n"));
    refs.push(`召回记忆 ${rec.length} 条`);
  }
  if (opts.bible !== false) {
    const b = await mem.getBible(c.work.id);
    if (b.text.trim()) {
      parts.push("=== 设定集（已经定下、不能推翻的）===\n" + clip(b.text, 3000));
      refs.push("设定集");
    }
  }
  parts.push(CONTINUE_RULE);
  return { text: parts.join("\n\n"), refs, names: [...names] };
}

export function outlineOf(_c: Ctx, r: ChRef): string {
  const lines = [`第${r.no}章 ${r.ch.title || "（未命名）"}${r.ch.ol ? "｜本章大纲：" + r.ch.ol : ""}${r.ch.fn ? "｜本章作用：" + r.ch.fn : ""}${r.ch.hook ? "｜章末钩子：" + r.ch.hook : ""}`];
  r.ch.scenes.forEach((s, i) => {
    const bits = [s.goal && "目标：" + s.goal, s.conf && "冲突：" + s.conf, s.turn && "转折：" + s.turn, s.result && "结果：" + s.result, s.who.length && "人物：" + s.who.join("、"), s.pov && "视角：" + s.pov, s.place && "地点：" + s.place, s.day != null && `故事时间：第${s.day}天${s.time ? " " + s.time : ""}`, s.plant && "埋伏笔：" + s.plant, s.pay && "收伏笔：" + s.pay, s.reveal && "信息揭示：" + s.reveal, (s.moodA || s.moodB) && `情绪：${s.moodA || "?"}→${s.moodB || "?"}`, s.pace && "节奏：" + s.pace, s.words && `约 ${s.words} 字`].filter(Boolean);
    lines.push(`场景${i + 1}「${s.t}」${bits.join("；")}`);
  });
  return lines.join("\n");
}

export function chapterRef(c: Ctx, id: string | null) {
  return findChapter(c.vols, id);
}
