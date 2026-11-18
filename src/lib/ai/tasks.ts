// 各个 AI 功能的提示词和返回格式。界面拿到结果后用 aiEdit 写入，所以都能整组撤销。
import { chat, chatJson, type Msg } from "./client";
import { type Ctx, NATURAL, NO_REPEAT, atOf, chapterContext, limitsReminder, outlineOf, priorStory, stablePrefix, writtenSoFar } from "./context";
import { activeLimits, applySentenceFixes, badSentences, limitsBlock, type LimitHit } from "../limits";
import { GROUPS, fieldLabel, SIMPLE } from "../charFields";
import type { Character, Scene, StoryEvent, StyleBlock, StyleDims, WriteLimit } from "../types";
import { allChapters, type ChRef } from "../outline";
import { compileStyle, DIMS, leak } from "../style";
import { describe } from "../chars";
import * as repo from "../repo";
import { clip } from "../util";
import { getBible } from "../memory";

const sys = (content: string): Msg => ({ role: "system", content });
const user = (content: string): Msg => ({ role: "user", content });

/* ---------- 人物 ---------- */

/** 补人物的空白项。group 为空时补全部（详细版）或简单版常用项 */
export async function draftCharacter(c: Ctx, ch: Character, scope: "simple" | "all" | string): Promise<Record<string, string>> {
  const keys = scope === "simple" ? SIMPLE.map((x) => x[0]) : scope === "all" ? GROUPS.flatMap((g) => g.fields.map((f) => f.k)) : GROUPS.find((g) => g.id === scope)?.fields.map((f) => f.k) ?? [];
  const empty = keys.filter((k) => !(ch.f[k] || "").trim());
  if (!empty.length && ch.name) return {};
  const others = c.chars.filter((x) => x !== ch && x.name).map((x) => `${x.name}（${x.role}）：${x.f.tag || x.f.core || ""}`).join("\n");
  const filled = Object.entries(ch.f).filter(([, v]) => v).map(([k, v]) => `${fieldLabel(k)}：${v}`).join("\n");
  const r = await chatJson<{ name?: string; fields: Record<string, string> }>(
    [
      sys(await stablePrefix(c, "你是小说作者的人设助手。你只补空白项，不改作者已经写的内容。", "plan")),
      user(`给这个人物补全空白项。
定位：${ch.role}
${ch.name ? "姓名：" + ch.name : "还没有名字，请起一个符合作品气质、不俗套的名字，放在 name 里"}
已经填的：
${filled || "（无）"}

其他人物：
${others || "（无）"}

要补的项（键：名称）：
${empty.map((k) => `${k}：${fieldLabel(k)}`).join("\n")}

要求：
- 把形容词落到读者看得见的行为上。例如「可爱」要写成具体的小动作、说话习惯，而不是重复“可爱”。
- 和已经填的内容、其他人物不矛盾，避免常见网文人设套路。
- 每项一两句话，具体，不空泛。
只返回 JSON：{"name": "...", "fields": {"键": "内容"}}${limitsReminder(c, "plan")}`),
    ],
    { temperature: 1.1 },
  );
  const out: Record<string, string> = {};
  for (const k of empty) if (r.fields?.[k]) out[k] = String(r.fields[k]);
  if (!ch.name && r.name) out.__name = r.name;
  return out;
}

export interface ScanResult {
  updates: { name: string; field: string; value: string; ch: number }[];
  added: { name: string; role: string; fields: Record<string, string>; ch: number }[];
}

/** 从已写章节整理人物：更新已有人物、发现新人物 */
export async function scanCharacters(c: Ctx): Promise<ScanResult> {
  const chs = allChapters(c.vols);
  const texts: string[] = [];
  for (const r of chs) {
    const t = await repo.loadText(r.ch.id);
    if (t?.plain) texts.push(`【第${r.no}章】\n` + (r.ch.summary && t.plain.length > 3000 ? "摘要：" + r.ch.summary : clip(t.plain, 3000)));
  }
  if (!texts.length) return { updates: [], added: [] };
  const known = c.chars.filter((x) => x.name).map((x) => `${x.name}（${x.role}）`).join("、");
  const keys = SIMPLE.map((x) => `${x[0]}：${x[1]}`).join("\n");
  return chatJson<ScanResult>(
    [
      sys("你是小说作者的人设整理助手，从正文里提取人物信息，每条都标来源章节。只写正文里确实出现的内容。"),
      user(`已知人物：${known || "（无）"}

可以填的字段（键：名称）：
${keys}

正文：
${texts.join("\n\n").slice(0, 60000)}

返回 JSON：
{"updates":[{"name":"已知人物名","field":"键","value":"内容","ch":章号}],
 "added":[{"name":"新人物名","role":"配角","fields":{"键":"内容"},"ch":首次出场章号}]}`),
    ],
    { temperature: 0.3 },
  );
}

export interface OocIssue {
  lv: "r" | "y" | "g";
  layer: "事实" | "性格";
  who: string;
  quote: string;
  setting: string;
  src: string;
  suggestion: string;
  /** 如果是合理的成长，建议补一条变化 */
  change?: { field: string; to: string; cause: string };
}

/** 第二、三层人设检查（事实和性格） */
export async function checkCharacters(c: Ctx, r: ChRef, text: string): Promise<OocIssue[]> {
  const people = c.chars.filter((x) => x.name && text.includes(x.name));
  if (!people.length) return [];
  const res = await chatJson<{ issues: OocIssue[] }>(
    [
      sys(await stablePrefix(c, "你是严格的人设校对。只指出确实矛盾的地方，不挑文笔。", "check")),
      user(`检查第${r.no}章里的人物有没有前后矛盾。
分两层：
1. 事实：和人物当前状态、知情范围（不该知道的事）、所在位置、标了「锁定」的设定是否矛盾。没标锁定的设定允许随剧情变化，有明确原因的变化不算矛盾。
2. 性格：行为和对白是否符合性格、动机和说话方式。如果是合理的成长，不要报错，给出 change 建议补一条人设变化。

人物在第${r.no}章时的设定：
${people.map((p) => describe(p, c.vols, r.no)).join("\n\n")}

正文：
${text.slice(0, 30000)}

返回 JSON：{"issues":[{"lv":"r|y|g","layer":"事实|性格","who":"人物","quote":"原文引用","setting":"冲突的设定","src":"设定出处，例如人物卡/第3章","suggestion":"一句修改建议","change":{"field":"字段键","to":"新值","cause":"触发事件"}}]}
没有问题就返回 {"issues":[]}`),
    ],
    { model: "write", temperature: 0.2 },
  );
  return res.issues ?? [];
}

export interface ContIssue {
  lv: "r" | "y" | "g";
  kind: string;
  quote: string;
  conflict: string;
  src?: string;
  suggestion: string;
}

/** 设定、时间线、前文剧情、伏笔和写作限制的一致性检查（人物之外的部分） */
export async function checkContinuity(c: Ctx, r: ChRef, text: string): Promise<ContIssue[]> {
  if (!text.trim()) return [];
  const bible = await getBible(c.work.id);
  const prev = allChapters(c.vols)
    .filter((x) => x.no < r.no && x.no >= r.no - 6)
    .map((x) => `第${x.no}章 ${x.ch.title}：${x.ch.summary || x.ch.scenes.map((s) => s.t).join("；") || "（无摘要）"}`);
  const evs = c.events.filter((e) => e.ch === r.ch.id).map((e) => `第${e.day}天${e.time ? " " + e.time : ""}：${e.t}${e.place ? "（" + e.place + "）" : ""}`);
  const res = await chatJson<{ issues: ContIssue[] }>(
    [
      sys(await stablePrefix(c, "你是严格的连载校对。只指出确实和前文、设定矛盾的地方，以及违反本书写作限制的地方，不挑文笔，不评价剧情好坏。", "check")),
      user(`检查第${r.no}章正文有没有和已有内容矛盾。人物性格另有检查，这里只看：
1. 设定：世界观、能力体系、物品、地名、组织，和设定集或核心摘要冲突的。
2. 时间线：和前几章、本章时间线事件对不上的时间、地点、先后顺序。
3. 前文：和前几章已经发生的事冲突，例如已死的人出场、已用掉的东西又出现、重复交代。
4. 伏笔：提前揭开还没到时候的伏笔，或者收了没埋过的伏笔。
5. 写作限制：违反系统提示里「本书写作限制」的地方（用词、内容尺度、情节走向、人物言行、标点）。「一笔带过」的内容写了过程和细节也算；「尽量少用」的只在明显过多时报。

设定集：
${clip(bible.text || "（还没有）", 6000)}

前几章：
${prev.join("\n") || "（没有）"}

本章时间线事件：
${evs.join("\n") || "（没有）"}

本章大纲：
${outlineOf(c, r)}

正文：
${text.slice(0, 30000)}

返回 JSON：{"issues":[{"lv":"r|y|g","kind":"设定|时间线|前文|伏笔|限制","quote":"原文引用","conflict":"和什么冲突","src":"出处，例如设定集/第3章","suggestion":"一句修改建议"}]}
r 是确定矛盾，y 是可能矛盾，g 是提醒。没有问题就返回 {"issues":[]}`),
    ],
    { model: "write", temperature: 0.2 },
  );
  return res.issues ?? [];
}

export interface ChangeOut {
  name: string;
  field: string;
  from: string;
  to: string;
  cause: string;
  quote: string;
}

/* ---------- 大纲 ---------- */

export async function splitScenes(c: Ctx, sentence: string, r: ChRef): Promise<Scene[]> {
  const prior = await priorStory(c, r.no);
  const res = await chatJson<{ scenes: { t: string; goal: string; conf: string; who: string[]; plant?: string; pay?: string }[] }>(
    [
      sys(await stablePrefix(c, "你是小说大纲助手。只给结构，不写正文和对白。", "plan")),
      user(`${prior.text ? prior.text + "\n\n" : ""}把这一句拆成 2–4 个场景，放进第${r.no}章。
一句话：${sentence}

本章现有大纲：
${outlineOf(c, r)}

每个场景给标题、目标、冲突、出场人物；如果顺带埋或收伏笔就写上。不要写具体对白和描写。${prior.text ? "\n第一个场景要从上一章结束时的局面接着开始，出场人物要包括上一章结尾还和主角在一起的人（除非这一句明确写了他们离开）。" : ""}
返回 JSON：{"scenes":[{"t":"","goal":"","conf":"","who":[""],"plant":"","pay":""}]}${limitsReminder(c, "plan")}`),
    ],
    { temperature: 1.0 },
  );
  return (res.scenes ?? []).map((s) => ({ id: "", t: s.t, goal: s.goal || "", conf: s.conf || "", who: s.who || [], plant: s.plant || "", pay: s.pay || "", ai: true }));
}

export interface SplitChapter {
  t: string;
  ol: string;
  hook?: string;
  scenes: { t: string; goal: string; conf: string; who: string[]; plant?: string; pay?: string; day?: number | null; place?: string }[];
}

/** 把一卷（或一段剧情）的大纲拆成逐章大纲，每章再给 2–4 个场景 */
export async function splitVolume(c: Ctx, v: number, n: number): Promise<SplitChapter[]> {
  const vol = c.vols[v];
  const chs = allChapters(c.vols).filter((r) => r.v === v);
  const firstNo = chs[0]?.no ?? allChapters(c.vols).filter((r) => r.v < v).length + 1;
  const prior = await priorStory(c, firstNo);
  const res = await chatJson<{ chapters: SplitChapter[] }>(
    [
      sys(await stablePrefix(c, "你是小说大纲助手。只给结构和情节走向，不写正文和对白。", "plan")),
      user(`把下面这一卷的大纲拆成 ${n} 章，按顺序给出每章的章名、本章大纲（2–4 句，写清这一章发生什么、推进了什么）、章末钩子，以及 2–4 个场景（标题、目标、冲突、出场人物，顺带埋或收的伏笔，能确定的话给故事里的第几天和地点）。
节奏要有起伏：铺垫、推进、转折、高潮分布开，不要每章都是高潮。只用卷大纲和已有设定里的人物和事，不要编造重大新设定。
${prior.text ? "第一章要从下面「前文」最后的局面接着开始，不要跳过或重置前文留下的处境。\n\n" + prior.text + "\n" : ""}
卷名：${vol?.title ?? ""}
卷大纲：
${vol?.outline ?? ""}
${chs.some((r) => r.ch.title || r.ch.ol || r.ch.scenes.length) ? "\n这一卷已经有的章（作者写的，要保留它们的意思，接着补全）：\n" + chs.map((r) => outlineOf(c, r)).join("\n") : ""}

返回 JSON：{"chapters":[{"t":"章名","ol":"本章大纲","hook":"章末钩子","scenes":[{"t":"","goal":"","conf":"","who":[""],"plant":"","pay":"","day":null,"place":""}]}]}${limitsReminder(c, "plan")}`),
    ],
    { temperature: 0.9 },
  );
  return (res.chapters ?? []).slice(0, Math.max(n, 1) + 2).map((x) => ({
    t: String(x.t ?? ""),
    ol: String(x.ol ?? ""),
    hook: x.hook ? String(x.hook) : "",
    scenes: (Array.isArray(x.scenes) ? x.scenes : []).map((s) => ({ t: String(s.t ?? "场景"), goal: s.goal || "", conf: s.conf || "", who: Array.isArray(s.who) ? s.who.filter(Boolean) : [], plant: s.plant || "", pay: s.pay || "", day: typeof s.day === "number" && s.day > 0 ? s.day : null, place: s.place || "" })),
  }));
}

export async function fillScene(c: Ctx, r: ChRef, s: Scene): Promise<{ goal?: string; conf?: string }> {
  const prior = await priorStory(c, r.no, { n: 3, bible: false });
  return chatJson(
    [
      sys(await stablePrefix(c, "你是小说大纲助手。只补空白，不改作者写的。", "plan")),
      user(`${prior.text ? prior.text + "\n\n" : ""}第${r.no}章的场景「${s.t}」缺目标或冲突，请补上。
本章大纲：
${outlineOf(c, r)}
返回 JSON：{"goal":"${s.goal ? "（已有，返回空字符串）" : ""}","conf":"${s.conf ? "（已有，返回空字符串）" : ""}"}${limitsReminder(c, "plan")}`),
    ],
    { temperature: 0.9 },
  );
}

export interface AlignFix {
  no: number;
  /** 新的本章大纲，不用改就空 */
  ol?: string;
  /** 要改的场景：i 是场景序号（从 0 开始） */
  scenes?: { i: number; goal?: string; conf?: string; who?: string[] }[];
  why: string;
}

/** 前文改了：检查后面还没写正文的章，大纲哪里和新的前文对不上，给出最小改动 */
export async function alignOutlines(c: Ctx, changedNo: number, what: string, written: Set<string>): Promise<AlignFix[]> {
  const later = allChapters(c.vols).filter((r) => r.no > changedNo && !written.has(r.ch.id)).slice(0, 10);
  if (!later.length) return [];
  const prior = await priorStory(c, later[0].no);
  const res = await chatJson<{ chapters: AlignFix[] }>(
    [
      sys(await stablePrefix(c, "你是小说大纲助手。作者改了前文，你帮他把后面的大纲对齐。只做必要的最小改动，保留作者原来的意图和写法。", "plan")),
      user(`作者刚改了第${changedNo}章，改动是：${what}

${prior.text}

后面还没写正文的章的大纲：
${later.map((r) => outlineOf(c, r).replace(/场景(\d+)「/g, (_m, n) => `场景${n}（i=${+n - 1}）「`)).join("\n\n")}

逐章检查：哪些地方和新的前文对不上（人物去向、在不在场、处境、关键物品、已经发生过的事）。只列需要改的章，不用改的不要列。
返回 JSON：{"chapters":[{"no":章号,"ol":"改后的本章大纲，不用改就空字符串","scenes":[{"i":场景序号,"goal":"","conf":"","who":["人物"]}],"why":"一句话说为什么改"}]}
scenes 里只放要改的场景和要改的字段，不改的字段不要写。${limitsReminder(c, "plan")}`),
    ],
    { temperature: 0.4 },
  );
  const nos = new Set(later.map((r) => r.no));
  return (res.chapters ?? []).filter((x) => x && nos.has(+x.no)).map((x) => ({ no: +x.no, ol: x.ol ? String(x.ol) : "", scenes: Array.isArray(x.scenes) ? x.scenes.filter((y) => y && typeof y.i === "number") : [], why: String(x.why ?? "") }));
}

export interface TidyIssue {
  lv: "r" | "y" | "g";
  text: string;
  /** 可以一键加的场景 */
  add?: { chapter: number; scene: { t: string; goal: string; conf: string; who: string[]; plant?: string; pay?: string } };
  /** 定位到第几章 */
  goto?: number;
}

function outlineDigest(c: Ctx): string {
  let lastV = -1;
  return allChapters(c.vols)
    .map((r) => {
      const head = r.v !== lastV ? `【${c.vols[r.v].title}】${c.vols[r.v].outline?.trim() ? "卷大纲：" + c.vols[r.v].outline!.trim() : ""}\n` : "";
      lastV = r.v;
      return head + chLine(r);
    })
    .join("\n");
}

function chLine(r: ChRef): string {
  return `第${r.no}章 ${r.ch.title || "（未命名）"} [${r.ch.status}]${r.ch.ol ? "｜大纲：" + r.ch.ol : ""}` + (r.ch.scenes.length ? "\n" + r.ch.scenes.map((s) => `  - ${s.t}｜目标:${s.goal || "无"}｜冲突:${s.conf || "无"}｜人物:${s.who.join("、") || "无"}${s.plant ? "｜埋:" + s.plant : ""}${s.pay ? "｜收:" + s.pay : ""}`).join("\n") : "");
}

export async function tidyOutline(c: Ctx): Promise<TidyIssue[]> {
  const res = await chatJson<{ issues: TidyIssue[] }>(
    [
      sys(await stablePrefix(c, "你是小说结构编辑。指出大纲里的问题，按严重度排序，不超过 8 条。", "check")),
      user(`检查这份大纲：断线、人物长期缺席、伏笔埋了没收、空章、重复的场景、节奏拖沓${activeLimits(c.style?.limits, "plan").length ? "，以及违反本书写作限制的情节（情节走向、内容尺度、人物言行）" : ""}。
人物：${c.chars.filter((x) => x.name).map((x) => `${x.name}（${x.role}）`).join("、")}

大纲：
${outlineDigest(c).slice(0, 40000)}

返回 JSON：{"issues":[{"lv":"r|y|g","text":"问题和理由","goto":章号,"add":{"chapter":章号,"scene":{"t":"","goal":"","conf":"","who":[""],"plant":"","pay":""}}}]}
lv：r 必改，y 建议，g 可选。add 只在补一个场景就能解决时给。`),
    ],
    { temperature: 0.4 },
  );
  return res.issues ?? [];
}

/* ---------- 事件 ---------- */

export async function extractEvents(c: Ctx, r: ChRef, text: string): Promise<Omit<StoryEvent, "id">[]> {
  const known = c.events.filter((e) => e.ch === r.ch.id).map((e) => e.t);
  const res = await chatJson<{ events: { day: number; time?: string; t: string; who: string; ty: StoryEvent["ty"]; place?: string; fore?: string }[] }>(
    [
      sys("你从小说正文里提取故事内的事件，按故事内时间推算第几天。只提取确实发生的事。"),
      user(`第${r.no}章正文：
${text.slice(0, 30000)}

已经记录的事件（不要重复）：${known.join("；") || "无"}
上一章大致在故事第 ${Math.max(1, ...c.events.filter((e) => e.ch && allChapters(c.vols).find((x) => x.ch.id === e.ch && x.no < r.no)).map((e) => e.day))} 天。

返回 JSON：{"events":[{"day":第几天,"time":"时刻，可空","t":"一句话事件","who":"人物，用顿号分隔","ty":"main|side|plant|pay|hidden（hidden 是读者暂时看不到的暗线、幕后发生的事）","place":"地点","fore":"如果是伏笔，写伏笔名"}]}`),
    ],
    { temperature: 0.3 },
  );
  return (res.events ?? []).map((e) => ({ ...e, ch: r.ch.id, ai: true }));
}

export async function checkTimeline(c: Ctx): Promise<{ lv: "r" | "y"; text: string }[]> {
  const evs = c.events.map((e) => `第${e.day}天${e.time ? " " + e.time : ""}｜${allChapters(c.vols).find((x) => x.ch.id === e.ch)?.no ?? "?"}章｜${e.t}｜${e.who}${e.place ? "｜" + e.place : ""}${e.pre ? "｜前置:" + (c.events.find((x) => x.id === e.pre)?.t ?? "") : ""}`);
  const res = await chatJson<{ issues: { lv: "r" | "y"; text: string }[] }>(
    [
      sys("你检查小说时间线的矛盾：先后顺序、同一人同时出现在两地、前置事件晚于后续事件、伏笔埋了没收。"),
      user(`事件表：
${evs.join("\n")}

章节摘要：
${allChapters(c.vols).filter((r) => r.ch.summary).map((r) => `第${r.no}章：${r.ch.summary}`).join("\n") || "（无）"}

返回 JSON：{"issues":[{"lv":"r|y","text":"问题"}]}，没有问题返回空数组。`),
    ],
    { temperature: 0.2 },
  );
  return res.issues ?? [];
}

/* ---------- 正文 ---------- */

/** Ctrl+Enter：给三个不同方向的下一句 */
export async function suggestNext(c: Ctx, r: ChRef, before: string, after = ""): Promise<{ t: string; d: string }[]> {
  const ctx = await chapterContext(c, r);
  const res = await chatJson<{ options: { t: string; d: string }[] }>(
    [
      sys((await stablePrefix(c, "你是作者的写作搭子。只给接下来的一两句，三个方向要明显不同。", "prose", atOf(c, r))) + "\n\n" + compileStyle(c.style) + "\n\n" + NATURAL),
      user(`${ctx.text}

本章大纲：
${outlineOf(c, r)}

本章已经写好的正文（光标前）：
${writtenSoFar(before)}
${after.trim() ? "\n光标后面已经写好的正文（不要写到它前面去重复）：\n" + after.slice(0, 800) + "\n" : ""}
${NO_REPEAT}

给三个接下来的写法，每个一到两句，紧接光标处。d 写这个方向的思路（不超过 15 字）。
返回 JSON：{"options":[{"t":"正文","d":"方向"}]}${limitsReminder(c, "prose", atOf(c, r))}`),
    ],
    { model: "write", temperature: 1.2 },
  );
  return res.options ?? [];
}

export const SEL_OPS: Record<string, string> = {
  续写: "接着这段往下写一段（150–300 字），衔接自然。",
  扩写: "把这段扩写到原来的一倍半到两倍，补动作、细节和对白，不改情节。",
  改写: "换一种写法重写这段，意思不变。",
  润色: "只做轻度润色：理顺不通的句子、去掉重复和套话，保留作者的用词习惯。改动越少越好。",
  改对白口吻: "只改对白，让每个人说话更符合他的人设和说话方式，叙述部分不动。",
};

/** 作者给这次续写、扩写等的额外要求；不填就按上下文和大纲来 */
export function noteLine(note?: string): string {
  const n = (note ?? "").trim();
  return n ? `作者对这一次的要求（风格、走向等），优先照着做，但不能违反本书写作限制：${n}` : "作者没有额外要求：按前文、本章大纲和人物设定自然地写。";
}

export async function selectionOp(c: Ctx, r: ChRef | undefined, op: string, sel: string, before: string, onDelta: (t: string) => void, signal?: AbortSignal, note?: string, after = ""): Promise<string> {
  const ctx = r ? await chapterContext(c, r) : { text: "" };
  const res = await chat(
    [
      sys((await stablePrefix(c, "你是作者的写作搭子。直接输出正文，不加任何说明、引号或标题。", "prose", atOf(c, r))) + "\n\n" + compileStyle(c.style) + "\n\n" + NATURAL),
      user(`${ctx.text}\n\n本章前文：\n${writtenSoFar(before)}\n\n要处理的段落：\n${sel}${after.trim() ? `\n\n这段后面已经写好的正文（不要提前写掉，也不要重复）：\n${after.slice(0, 800)}` : ""}\n\n任务：${SEL_OPS[op] ?? op}\n${noteLine(note)}\n\n${NO_REPEAT}${limitsReminder(c, "prose", atOf(c, r))}`),
    ],
    { model: "write", onDelta, signal, temperature: op === "润色" ? 0.6 : 1.0 },
  );
  return res.content.trim();
}

/** 按大纲填充一章：逐个场景写，每个场景接着上一个 */
export async function fillChapter(c: Ctx, r: ChRef, onScene: (i: number, title: string) => void, onDelta: (t: string) => void, signal?: AbortSignal, existing = ""): Promise<string[]> {
  const ctx = await chapterContext(c, r);
  const at = atOf(c, r);
  const prefix = (await stablePrefix(c, "你是作者的代笔。按大纲写正文，直接输出正文段落，不加标题和说明。", "prose", at)) + "\n\n=== 文风 ===\n" + compileStyle(c.style) + "\n\n" + NATURAL;
  const out: string[] = [];
  // 本章已经有正文：从正文结尾接着写大纲里还没写到的部分，不从头再来
  if (existing.trim()) {
    onScene(0, "接着已有正文");
    const left = Math.max(500, (c.work.chapWords || 3000) - existing.trim().length);
    const res = await chat(
      [
        sys(prefix),
        user(`${ctx.text}

本章大纲：
${outlineOf(c, r)}

本章已经写好的正文：
${writtenSoFar(existing)}

${NO_REPEAT}

先对照本章大纲，找出已经写到哪里；然后从已有正文的最后一句接着往下写，只写大纲里还没写到的部分，约 ${left} 字，写到本章结束为止。如果大纲已经全部写完，就只写一小段收尾。${limitsReminder(c, "prose", at)}`),
      ],
      { model: "write", onDelta, signal, temperature: 1.0 },
    );
    out.push(res.content.trim());
    return out;
  }
  // 没拆场景、只有一段章大纲时，按整章大纲一次写完
  if (!r.ch.scenes.length) {
    if (!r.ch.ol?.trim()) return out;
    onScene(0, "整章");
    const res = await chat(
      [
        sys(prefix),
        user(`${ctx.text}

本章大纲：
${outlineOf(c, r)}

这是本章开头。按上面的本章大纲写完整一章，约 ${c.work.chapWords || 3000} 字。大纲里的情节都要写到，写到本章结束为止，不要写下一章。${limitsReminder(c, "prose", at)}`),
      ],
      { model: "write", onDelta, signal, temperature: 1.0 },
    );
    out.push(res.content.trim());
    return out;
  }
  const per = Math.round((c.work.chapWords || 3000) / Math.max(1, r.ch.scenes.length));
  for (let i = 0; i < r.ch.scenes.length; i++) {
    if (signal?.aborted) break;
    const s = r.ch.scenes[i];
    onScene(i, s.t);
    const res = await chat(
      [
        sys(prefix),
        user(`${ctx.text}

本章大纲：
${outlineOf(c, r)}

${out.length ? "本章已经写好的正文：\n" + writtenSoFar(out.join("\n\n")) + "\n\n" + NO_REPEAT : "这是本章开头。"}

现在只写场景${i + 1}「${s.t}」，约 ${s.words || per} 字。写到这个场景的结果为止，不要写下一个场景。${limitsReminder(c, "prose", at)}`),
      ],
      { model: "write", onDelta, signal, temperature: 1.0 },
    );
    out.push(res.content.trim());
    onDelta("\n\n");
  }
  return out;
}

/** 只改违反写作限制的句子：把这些句子发给 AI 按限制重写，其余字原样保留 */
export async function fixLimits(c: Ctx, text: string, hits: LimitHit[], signal?: AbortSignal): Promise<string> {
  const bad = badSentences(text, hits);
  if (!bad.length) return text;
  const limits = c.style?.limits ?? [];
  const why = (i: number) => {
    const hs = hits.filter((h) => h.from < bad[i].to && h.to > bad[i].from);
    return [...new Set(hs.map((h) => `「${h.word}」违反「${limits.find((l) => l.id === h.id)?.text ?? ""}」`))].join("，");
  };
  const res = await chatJson<{ fixes: { i: number; t: string }[] }>(
    [
      sys("你帮小说作者改句子：只改下面这几句里违反写作限制的地方，意思、情节结果、人物和语气都不变，长短接近原句，其余不要动。\n\n" + limitsBlock(limits)),
      user(`要改的句子：
${bad.map((s, i) => `${i}. ${s.t.trim()}\n   问题：${why(i)}`).join("\n")}

前后文（只用来理解，不要改）：
${text.slice(0, 2000)}

返回 JSON：{"fixes":[{"i":序号,"t":"改好的整句"}]}`),
    ],
    { model: "write", temperature: 0.5, signal },
  );
  // 保留原句的首尾空白，免得段落粘在一起
  const fixes = (res.fixes ?? []).filter((f) => bad[f.i]).map((f) => {
    const o = bad[f.i].t;
    return { i: f.i, t: o.match(/^\s*/)![0] + String(f.t).trim() + o.match(/\s*$/)![0] };
  });
  return applySentenceFixes(text, bad, fixes);
}

/** 「帮我列词」：按限制的说明、例子和本书题材，列一批检查用的词，作者再勾掉不要的 */
export async function suggestLimitWords(c: Ctx, l: WriteLimit): Promise<string[]> {
  const res = await chatJson<{ words: string[] }>(
    [
      sys("你帮小说作者整理检查词表：作者给这本书定了一条写作限制，你列出正文里可能违反它的具体词语或短语，用来自动检查。只列确实属于这一类、在这类小说里常见的写法；不要列本书题材必需的正常词（例如修仙小说的「道友」「灵气」不算文绉绉）。"),
      user(`本书：${c.work.name}${c.work.intro ? "｜" + c.work.intro : ""}
限制：${l.text}（${l.type}）${l.examples ? "\n作者给的例子：" + l.examples : ""}${l.want ? "\n作者想要的写法：" + l.want : ""}
已经有的词（不要重复）：${l.words.join("、") || "（无）"}

列 30–50 个，每个 1–6 个字，尽量是正文里会原样出现的写法。
返回 JSON：{"words":["",""]}`),
    ],
    { temperature: 0.6 },
  );
  const have = new Set([...l.words, ...l.except]);
  return [...new Set((res.words ?? []).map((w) => String(w).trim()).filter((w) => w && w.length <= 8 && !have.has(w)))];
}

/** 只查写作限制：情节走向、人物言行这些词表查不出来的，交给 AI 看 */
export async function checkLimits(c: Ctx, r: ChRef, text: string): Promise<ContIssue[]> {
  if (!text.trim() || !activeLimits(c.style?.limits).length) return [];
  const res = await chatJson<{ issues: ContIssue[] }>(
    [
      sys(await stablePrefix(c, "你是严格的校对，只查正文有没有违反作者给这本书定的写作限制，别的都不管。", "check", atOf(c, r))),
      user(`检查第${r.no}章正文有没有违反本书写作限制。重点看词表查不出来的：情节走向、人物言行、内容尺度（「一笔带过」的写了过程和细节也算）。有人物例外的，例外人物的对白不算违反。

正文：
${text.slice(0, 30000)}

返回 JSON：{"issues":[{"lv":"r|y|g","kind":"限制","quote":"原文引用","conflict":"违反了哪条限制","suggestion":"一句修改建议"}]}
r 是明确违反，y 是可能违反，g 是提醒。没有问题就返回 {"issues":[]}`),
    ],
    { model: "write", temperature: 0.2 },
  );
  return res.issues ?? [];
}

/* ---------- 风格 ---------- */

export interface StyleDraft {
  name: string;
  desc: string;
  dims: StyleDims;
  reply: string;
}

export async function styleChat(history: { role: "user" | "assistant"; content: string }[]): Promise<StyleDraft> {
  const dimList = DIMS.map(([k, l]) => `${k}：${l}`).join("\n");
  const res = await chatJson<StyleDraft>(
    [
      sys(`你帮小说作者把想要的“写法”整理成风格块。风格块只描述怎么写（视角、语言、词汇质感、节奏、对白、基调、避免什么），绝不包含人物、情节、桥段、设定名词和套路。
用户提到具体情节时，把它翻译成写法，或者说明风格块不放这些。
维度：
${dimList}
返回 JSON：{"name":"风格名","desc":"适用场景","dims":{"pov":"","lang":"","vocab":"","rhythm":"","dialog":"","tone":"","avoid":""},"reply":"给作者的一两句说明，以及可以怎么调"}`),
      ...history.map((m) => ({ role: m.role, content: m.content }) as Msg),
    ],
    { temperature: 0.9 },
  );
  return res;
}

export async function fuseStyles(blocks: StyleBlock[], note: string): Promise<StyleDraft> {
  return chatJson<StyleDraft>(
    [
      sys("你把几个小说风格块融合成一个新的风格块。只写怎么写，不写内容。冲突的地方要做取舍并说明。返回 JSON：{name, desc, dims:{pov,lang,vocab,rhythm,dialog,tone,avoid}, reply}"),
      user(`要融合的风格：\n${blocks.map((b) => `【${b.name}】${b.desc}\n` + DIMS.filter(([k]) => b.dims[k]).map(([k, l]) => `${l}：${b.dims[k]}`).join("\n")).join("\n\n")}\n\n作者的要求：${note || "以第一个为主"}`),
    ],
    { temperature: 0.8 },
  );
}

/** 拆书：根据统计数字和三段样本，描述这本书的写法（不复述情节） */
export async function describeStyle(title: string, metricsLine: string, samples: string[]): Promise<StyleDraft> {
  return chatJson<StyleDraft>(
    [
      sys(`你是小说编辑，帮作者把一本书的“写法”提炼成风格块。只描述怎么写：视角、语言质感、词汇质感、节奏、对白、基调、避免什么。
绝不写人物名、情节、设定名词、桥段和套路，也不要引用原文句子。描述要具体到能照着写，比如“动作句多用单字动词”“心理活动借一个小动作带过”。
返回 JSON：{"name":"风格名（不用书名，用写法特点命名，6 字内）","desc":"适用场景","dims":{"pov":"","lang":"","vocab":"","rhythm":"","dialog":"","tone":"","avoid":""},"reply":"一两句说明这本书写法最值得学的地方"}`),
      user(`书名：${title}\n${metricsLine}\n\n下面是从书里抽的三段（开头、中段、后段），只用来观察写法：\n\n${samples.map((x, i) => `【片段${i + 1}】\n${x}`).join("\n\n")}`),
    ],
    { temperature: 0.6 },
  );
}

export { leak };
