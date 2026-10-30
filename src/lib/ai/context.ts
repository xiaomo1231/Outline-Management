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

export type Ctx = WorkData & { work: Work };

/** 写正文时的去 AI 味规则，所有生成正文的任务都带上 */
export const NATURAL = `写法要求：
- 像这位作者本人在写，不像 AI。不要总结、不要升华、不要在段尾点题，不要排比抒情。
- 情绪不直说，落在动作、物件和对白上。
- 少用这些套话：${PATTERNS.map((p) => p.label).join("、")}。
- 句子长短要有变化，允许不完整的句子和口语。
- 不要替作者推进大纲以外的剧情，不要新增设定。`;

/** 常驻页：有模型班整理过的就用它，没有就现场拼一份 */
export async function resident(c: Ctx): Promise<string> {
  const r = await mem.getResident(c.work.id);
  if (r) return r.text;
  const facts = await mem.items(c.work.id, 1);
  return mem.buildResident(c.work, c.chars, c.vols, c.events, compileStyle(c.style), facts);
}

/** 系统提示的稳定前缀 */
export async function stablePrefix(c: Ctx, role: string): Promise<string> {
  return `${role}\n\n=== 常驻页（这本书的核心信息）===\n${await resident(c)}`;
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
  const rec = await recall(c, keys);
  if (rec.length) {
    parts.push("=== 相关的早前记忆 ===\n" + rec.map((x) => `[第${x.ch}章] ${x.text}`).join("\n"));
    refs.push(`召回记忆 ${rec.length} 条`);
  }
  const prev = allChapters(c.vols).filter((x) => x.no < r.no && x.no >= r.no - 5);
  const sums = prev.filter((x) => x.ch.summary).map((x) => `第${x.no}章：${x.ch.summary}`);
  if (sums.length) {
    parts.push("=== 前几章摘要 ===\n" + sums.join("\n"));
    refs.push("前几章摘要");
  }
  const last = prev[prev.length - 1];
  if (last) {
    const t = await repo.loadText(last.ch.id);
    if (t?.plain) {
      parts.push(`=== 上一章（第${last.no}章）结尾原文 ===\n` + t.plain.slice(-800));
      refs.push(`第${last.no}章结尾`);
    }
  }
  if (r.ch.pl) parts.push(`本章在篇幅规划里属于：${phaseName(c.plan, r.ch.pl)}${c.plan[r.ch.pl.a]?.ph[r.ch.pl.p]?.g ? "，这一阶段的目标：" + c.plan[r.ch.pl.a].ph[r.ch.pl.p].g : ""}`);
  return { text: parts.join("\n\n"), refs };
}

export function outlineOf(_c: Ctx, r: ChRef): string {
  const lines = [`第${r.no}章 ${r.ch.title || "（未命名）"}${r.ch.fn ? "｜本章作用：" + r.ch.fn : ""}${r.ch.hook ? "｜章末钩子：" + r.ch.hook : ""}`];
  r.ch.scenes.forEach((s, i) => {
    const bits = [s.goal && "目标：" + s.goal, s.conf && "冲突：" + s.conf, s.turn && "转折：" + s.turn, s.result && "结果：" + s.result, s.who.length && "人物：" + s.who.join("、"), s.pov && "视角：" + s.pov, s.place && "地点：" + s.place, s.day && `故事时间：第${s.day}天${s.time ? " " + s.time : ""}`, s.plant && "埋伏笔：" + s.plant, s.pay && "收伏笔：" + s.pay, s.reveal && "信息揭示：" + s.reveal, (s.moodA || s.moodB) && `情绪：${s.moodA || "?"}→${s.moodB || "?"}`, s.pace && "节奏：" + s.pace, s.words && `约 ${s.words} 字`].filter(Boolean);
    lines.push(`场景${i + 1}「${s.t}」${bits.join("；")}`);
  });
  return lines.join("\n");
}

export function chapterRef(c: Ctx, id: string | null) {
  return findChapter(c.vols, id);
}
