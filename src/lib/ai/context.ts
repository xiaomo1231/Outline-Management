// 给 AI 组装上下文。原则：稳定的内容放前面（命中 DeepSeek 的缓存，便宜），每次只带需要的。
import type { WorkData } from "../store";
import type { MemItem, Work } from "../types";
import { compileStyle } from "../style";
import { allChapters, findChapter, plants, type ChRef } from "../outline";
import { describe } from "../chars";
import * as mem from "../memory";
import * as repo from "../repo";
import { phaseName } from "../plan";
import { PATTERNS } from "../aiscan";
import { limitsBlock, limitsTail, type LimitAt, type LimitTask } from "../limits";
import { mentioned } from "../mention";
import { archiveMap, ensureFresh } from "./archive";
import { clip } from "../util";
import { residentLimitOf, type MemPrefs } from "../hooks";
import { olText } from "../chapterOutline";

export type Ctx = WorkData & { work: Work };

/** 写正文时的去 AI 味规则，所有生成正文的任务都带上 */
export const NATURAL = `写法要求：
- 像这位作者本人在写，不像 AI。不要总结、不要升华、不要在段尾点题，不要排比抒情。
- 情绪不直说，落在动作、物件和对白上。
- 少用这些套话：${PATTERNS.map((p) => p.label).join("、")}。
- 句子长短要有变化，允许不完整的句子和口语。
- 不要替作者推进大纲以外的剧情，不要新增设定。`;

/**
 * 核心摘要：有AI 整理整理过的就用它，没有就现场拼一份。
 * 存好的摘要里带着当时的写作规范：风格或「我的规则」改过以后就过期了，也现场拼一份，
 * 免得同一份提示词里新旧两套规范互相矛盾。下次每日整理或作者重新拼过保存后恢复用存的。
 */
export async function resident(c: Ctx): Promise<string> {
  const r = await mem.getResident(c.work.id);
  const style = compileStyle(c.style);
  if (r && (!r.style || r.style === mem.styleSig(style))) return r.text;
  const facts = await mem.items(c.work.id, 1);
  const limit = residentLimitOf(await repo.getSetting<Partial<MemPrefs>>("memory", {}));
  return mem.buildResident(c.work, c.chars, c.vols, c.events, style, facts, limit);
}

/**
 * 系统提示的稳定前缀。task 决定带哪些写作限制：
 * prose 写正文和聊天（全部）、plan 排大纲和人设（情节、尺度、人物）、check 校对（全部，当检查项）
 */
export async function stablePrefix(c: Ctx, role: string, task: LimitTask = "prose", at?: LimitAt): Promise<string> {
  const lim = limitsBlock(c.style?.limits, task, at);
  return `${role}\n\n=== 核心摘要（这本书的核心信息）===\n${await resident(c)}${lim ? "\n\n" + lim : ""}`;
}

/** 正在写的这一章在哪一卷、有哪些人物：按卷生效、「只管这些人」的限制据此筛选 */
export function atOf(c: Pick<Ctx, "vols" | "chars">, r: ChRef | undefined): LimitAt | undefined {
  if (!r) return undefined;
  const text = [olText(r.ch), ...r.ch.scenes.map((s) => [s.t, s.goal, s.conf, s.pov ?? "", ...s.who].join("\n"))].join("\n");
  const names = new Set([...mentioned(c.chars, text), ...r.ch.scenes.flatMap((s) => [...s.who, s.pov ?? ""]).filter(Boolean)]);
  return { vol: c.vols[r.v]?.id, names: [...names] };
}

/** 生成请求的最后一行：再提醒一遍写作限制，没有限制时为空 */
export function limitsReminder(c: Pick<Ctx, "style">, task: LimitTask = "prose", at?: LimitAt): string {
  const t = limitsTail(c.style?.limits, task, at);
  return t ? "\n\n" + t : "";
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
export async function chapterContext(c: Ctx, r: ChRef, opts: { full?: boolean; onStep?: (s: string) => void } = {}): Promise<{ text: string; refs: string[] }> {
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
  // 整章生成、续写：先补齐前几章归档，上一章给多一些原文；Ctrl+Enter 这类快操作不等
  const prior = await priorStory(c, r.no, { n: 5, tail: opts.full ? 6000 : 1500, names: keys, ensure: opts.full, onStep: opts.onStep });
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

/** 本章已经写好的正文：短章给全文，长章保留开头和最近的大段，中间标出省略 */
export function writtenSoFar(text: string, max = 6000): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const head = Math.round(max * 0.3);
  return t.slice(0, head) + "\n……（中间省略）……\n" + t.slice(-(max - head));
}

/** 同一章里不许重复的硬规定 */
export const NO_REPEAT = `同一章不重复的硬性要求：
- 上面「本章已经写好的正文」里发生过的情节、说过的话、做过的动作，一律不要再写一遍，也不要换个说法再写一遍。
- 人物在本章里已经见过面、认出过、介绍过、问过的事，后面就按已经知道来写，不能再像第一次见面那样重新问、重新介绍。
- 只写还没写到的部分，从已有正文停下的地方自然往下接。`;

/** 大纲和正文都要遵守的“接上前文”规则 */
export const CONTINUE_RULE = `接上前文的硬性要求：
- 新内容必须从上一章的章末状态接着往下走：每个人物此刻在哪、和谁在一起、在做什么、处境如何（受伤、被押送、被困、手里有什么），都要延续。
- 例如上一章结尾主角正被两个人押送，下一章开头主角就仍在押送途中、押送他的人仍在身边；要改变这个局面，必须写出是怎么改变的（逃脱、被救、到达目的地等），不能当作没发生过。
- 已经发生的事不要重写一遍，已经死去、离开的人不要无故出场，已经用掉的东西不要再出现。
- 「前几章已经做过、说过的事」里列的事，一律不要再写一遍，也不要换个说法、换个场合再写一遍。前几章定下的安排，后文只能往后推进（例如说好两日后去取，后文就写去取、取回来之后），不能再安排一遍。
- 前几章人物之间已经问过、答过、交代过的话，后文按已经知道来写，不能再问一遍、再交代一遍。`;

/**
 * 写在某一章之前的“前文”：给大纲和正文任务用。
 * 读章节归档（摘要、章末状态），没归档的章退回用大纲和正文结尾；再加上最近一章正文的原文结尾、相关记忆和设定集。
 */
export async function priorStory(c: Ctx, no: number, opts: { n?: number; tail?: number; bible?: boolean; names?: string[]; ensure?: boolean; onStep?: (s: string) => void } = {}): Promise<{ text: string; refs: string[]; names: string[] }> {
  const n = opts.n ?? 10;
  const tail = opts.tail ?? 1500;
  if (opts.ensure) await ensureFresh(c.work.id, no, 3, opts.onStep).catch(() => 0);
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
    const ol = [olText(x.ch), x.ch.scenes.map((s) => s.t + (s.result ? "（" + s.result + "）" : "")).join("；")].filter(Boolean).join("｜");
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
    const whole = t.plain.trim().length <= tail;
    parts.push(`=== 第${lastWritten.no}章正文${whole ? "全文" : "（开头和后面的大段）"} ===\n` + (tail >= 3000 ? writtenSoFar(t.plain, tail) : t.plain.slice(-tail)));
    refs.push(`第${lastWritten.no}章结尾`);
    if (lastWritten.no < no - 1) parts.push(`（第${lastWritten.no + 1}–${no - 1}章还没写正文，以上面的大纲为准。）`);
    const endText = (a?.end ?? "") + t.plain.slice(-tail);
    c.chars.forEach((p) => p.name && endText.includes(p.name) && names.add(p.name));
  }
  // 最近 3 章已经做过、说过的事和新事实：跨章不重复全靠它
  const recent = before.slice(-3).filter((x) => arcs.get(x.ch.id));
  const doneLines = recent.flatMap((x) => {
    const a = arcs.get(x.ch.id)!;
    return [...(a.done ?? []), ...(a.facts ?? [])].map((d) => `[第${x.no}章] ${d}`);
  });
  if (doneLines.length) {
    parts.push("=== 前几章已经做过、说过的事（不要再写一遍）===\n" + [...new Set(doneLines)].join("\n"));
    refs.push(`第${recent[0].no}–${recent[recent.length - 1].no}章已做过的事`);
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
  const lines = [`第${r.no}章 ${r.ch.title || "（未命名）"}${olText(r.ch) ? "｜本章大纲：" + olText(r.ch) : ""}${r.ch.fn ? "｜本章作用：" + r.ch.fn : ""}${r.ch.hook ? "｜章末钩子：" + r.ch.hook : ""}`];
  r.ch.scenes.forEach((s, i) => {
    const bits = [s.goal && "目标：" + s.goal, s.conf && "冲突：" + s.conf, s.turn && "转折：" + s.turn, s.result && "结果：" + s.result, s.who.length && "人物：" + s.who.join("、"), s.pov && "视角：" + s.pov, s.place && "地点：" + s.place, s.day != null && `故事时间：第${s.day}天${s.time ? " " + s.time : ""}`, s.plant && "埋伏笔：" + s.plant, s.pay && "收伏笔：" + s.pay, s.reveal && "信息揭示：" + s.reveal, (s.moodA || s.moodB) && `情绪：${s.moodA || "?"}→${s.moodB || "?"}`, s.pace && "节奏：" + s.pace, s.words && `约 ${s.words} 字`].filter(Boolean);
    lines.push(`场景${i + 1}「${s.t}」${bits.join("；")}`);
  });
  return lines.join("\n");
}

export function chapterRef(c: Ctx, id: string | null) {
  return findChapter(c.vols, id);
}
