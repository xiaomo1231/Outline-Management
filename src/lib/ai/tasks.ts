// 各个 AI 功能的提示词和返回格式。界面拿到结果后用 aiEdit 写入，所以都能整组撤销。
import { chat, chatJson, type Msg } from "./client";
import { type Ctx, NATURAL, chapterContext, outlineOf, stablePrefix } from "./context";
import { GROUPS, fieldLabel, SIMPLE } from "../charFields";
import type { Character, Scene, StoryEvent, StyleBlock, StyleDims } from "../types";
import { allChapters, type ChRef } from "../outline";
import { compileStyle, DIMS, leak } from "../style";
import { describe } from "../chars";
import * as repo from "../repo";
import { clip } from "../util";

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
      sys(await stablePrefix(c, "你是小说作者的人设助手。你只补空白项，不改作者已经写的内容。")),
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
只返回 JSON：{"name": "...", "fields": {"键": "内容"}}`),
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
      sys(await stablePrefix(c, "你是严格的人设校对。只指出确实矛盾的地方，不挑文笔。")),
      user(`检查第${r.no}章里的人物有没有前后矛盾。
分两层：
1. 事实：和人物当前状态、知情范围（不该知道的事）、所在位置、锁定外貌是否矛盾。
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
  const res = await chatJson<{ scenes: { t: string; goal: string; conf: string; who: string[]; plant?: string; pay?: string }[] }>(
    [
      sys(await stablePrefix(c, "你是小说大纲助手。只给结构，不写正文和对白。")),
      user(`把这一句拆成 2–4 个场景，放进第${r.no}章。
一句话：${sentence}

本章现有大纲：
${outlineOf(c, r)}

每个场景给标题、目标、冲突、出场人物；如果顺带埋或收伏笔就写上。不要写具体对白和描写。
返回 JSON：{"scenes":[{"t":"","goal":"","conf":"","who":[""],"plant":"","pay":""}]}`),
    ],
    { temperature: 1.0 },
  );
  return (res.scenes ?? []).map((s) => ({ id: "", t: s.t, goal: s.goal || "", conf: s.conf || "", who: s.who || [], plant: s.plant || "", pay: s.pay || "", ai: true }));
}

export async function fillScene(c: Ctx, r: ChRef, s: Scene): Promise<{ goal?: string; conf?: string }> {
  return chatJson(
    [
      sys(await stablePrefix(c, "你是小说大纲助手。只补空白，不改作者写的。")),
      user(`第${r.no}章的场景「${s.t}」缺目标或冲突，请补上。
本章大纲：
${outlineOf(c, r)}
返回 JSON：{"goal":"${s.goal ? "（已有，返回空字符串）" : ""}","conf":"${s.conf ? "（已有，返回空字符串）" : ""}"}`),
    ],
    { temperature: 0.9 },
  );
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
  return allChapters(c.vols)
    .map((r) => `第${r.no}章 ${r.ch.title || "（未命名）"} [${r.ch.status}]` + (r.ch.scenes.length ? "\n" + r.ch.scenes.map((s) => `  - ${s.t}｜目标:${s.goal || "无"}｜冲突:${s.conf || "无"}｜人物:${s.who.join("、") || "无"}${s.plant ? "｜埋:" + s.plant : ""}${s.pay ? "｜收:" + s.pay : ""}`).join("\n") : ""))
    .join("\n");
}

export async function tidyOutline(c: Ctx): Promise<TidyIssue[]> {
  const res = await chatJson<{ issues: TidyIssue[] }>(
    [
      sys(await stablePrefix(c, "你是小说结构编辑。指出大纲里的问题，按严重度排序，不超过 8 条。")),
      user(`检查这份大纲：断线、人物长期缺席、伏笔埋了没收、空章、重复的场景、节奏拖沓。
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

返回 JSON：{"events":[{"day":第几天,"time":"时刻，可空","t":"一句话事件","who":"人物，用顿号分隔","ty":"main|side|plant|pay","place":"地点","fore":"如果是伏笔，写伏笔名"}]}`),
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
export async function suggestNext(c: Ctx, r: ChRef, before: string): Promise<{ t: string; d: string }[]> {
  const ctx = await chapterContext(c, r);
  const res = await chatJson<{ options: { t: string; d: string }[] }>(
    [
      sys((await stablePrefix(c, "你是作者的写作搭子。只给接下来的一两句，三个方向要明显不同。")) + "\n\n" + compileStyle(c.style) + "\n\n" + NATURAL),
      user(`${ctx.text}

本章大纲：
${outlineOf(c, r)}

光标前的正文：
${before.slice(-1500)}

给三个接下来的写法，每个一到两句，紧接光标处。d 写这个方向的思路（不超过 15 字）。
返回 JSON：{"options":[{"t":"正文","d":"方向"}]}`),
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

export async function selectionOp(c: Ctx, r: ChRef | undefined, op: string, sel: string, before: string, onDelta: (t: string) => void, signal?: AbortSignal): Promise<string> {
  const ctx = r ? await chapterContext(c, r) : { text: "" };
  const res = await chat(
    [
      sys((await stablePrefix(c, "你是作者的写作搭子。直接输出正文，不加任何说明、引号或标题。")) + "\n\n" + compileStyle(c.style) + "\n\n" + NATURAL),
      user(`${ctx.text}\n\n前文：\n${before.slice(-1200)}\n\n要处理的段落：\n${sel}\n\n任务：${SEL_OPS[op] ?? op}`),
    ],
    { model: "write", onDelta, signal, temperature: op === "润色" ? 0.6 : 1.0 },
  );
  return res.content.trim();
}

/** 按大纲填充一章：逐个场景写，每个场景接着上一个 */
export async function fillChapter(c: Ctx, r: ChRef, onScene: (i: number, title: string) => void, onDelta: (t: string) => void, signal?: AbortSignal): Promise<string[]> {
  const ctx = await chapterContext(c, r);
  const prefix = (await stablePrefix(c, "你是作者的代笔。按大纲写正文，直接输出正文段落，不加标题和说明。")) + "\n\n=== 文风 ===\n" + compileStyle(c.style) + "\n\n" + NATURAL;
  const out: string[] = [];
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

${out.length ? "本章已经写好的部分（接着写，不要重复）：\n" + out.join("\n\n").slice(-2500) : "这是本章开头。"}

现在只写场景${i + 1}「${s.t}」，约 ${s.words || per} 字。写到这个场景的结果为止，不要写下一个场景。`),
      ],
      { model: "write", onDelta, signal, temperature: 1.0 },
    );
    out.push(res.content.trim());
    onDelta("\n\n");
  }
  return out;
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

export { leak };
