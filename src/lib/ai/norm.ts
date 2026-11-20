// AI 返回的 JSON 不可信：字段可能缺、可能是对象或数组、列表可能不是数组。
// 存进作品、显示到界面之前一律先过这里，免得一个怪格式让整页白屏、坏数据存进库里反复白屏。
import type { Chapter, EventType, Scene, StoryEvent, Volume } from "../types";

/** 规整成文字：数字照写，数组、对象取里面的字，其他当成没有 */
export function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join("、");
  if (v && typeof v === "object") return Object.values(v).map(str).filter(Boolean).join("，");
  return "";
}

/** 不是数组就当成空列表，并去掉空项 */
export function arr<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v.filter((x) => x != null) as T[]) : [];
}

/** 对象（不是数组、不是 null） */
export function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** 人名列表：数组、「林舟、苏晚」这样的字符串都认 */
export function names(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.map(str) : typeof v === "string" ? v.split(/[、，,;；/\s]+/) : v && typeof v === "object" ? Object.values(v).map(str) : [];
  return [...new Set(raw.map((x) => x.trim()).filter(Boolean))];
}

/** 数字：「第3天」「3」都认成 3；认不出返回 null */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = typeof v === "string" ? /-?\d+(\.\d+)?/.exec(v) : null;
  return m ? +m[0] : null;
}

export function lv<T extends string>(v: unknown, ok: readonly T[], dflt: T): T {
  const s = str(v) as T;
  return ok.includes(s) ? s : dflt;
}

const TY: readonly EventType[] = ["main", "side", "plant", "pay", "hidden"];
export const eventType = (v: unknown): EventType => lv(v, TY, "main");

/* ---------- 已存数据的整理：老版本、或修复前 AI 写进去的怪格式 ---------- */

const SCENE_STR = ["t", "goal", "conf", "plant", "pay", "pov", "time", "place", "turn", "result", "moodA", "moodB", "pace", "reveal", "st", "note"] as const;

function tidyScene(s: Scene): Scene {
  const bad = SCENE_STR.some((k) => s[k] != null && typeof s[k] !== "string") || !Array.isArray(s.who) || s.who.some((w) => typeof w !== "string") || (s.day != null && typeof s.day !== "number");
  if (!bad) return s;
  const out: any = { ...s, who: names(s.who), t: str(s.t), goal: str(s.goal), conf: str(s.conf), plant: str(s.plant), pay: str(s.pay) };
  for (const k of SCENE_STR) if (s[k] != null) out[k] = str(s[k]);
  if (s.day != null) out.day = num(s.day);
  return out;
}

const CH_STR = ["title", "fn", "ol", "hook", "note", "summary"] as const;

function tidyChapter(c: Chapter): Chapter {
  const scenes = Array.isArray(c.scenes) ? c.scenes.map(tidyScene) : [];
  const badStr = CH_STR.some((k) => (c as any)[k] != null && typeof (c as any)[k] !== "string");
  if (!badStr && Array.isArray(c.scenes) && scenes.every((s, i) => s === c.scenes[i])) return c;
  const out: any = { ...c, scenes };
  for (const k of CH_STR) if ((c as any)[k] != null) out[k] = str((c as any)[k]);
  return out;
}

/** 载入、撤销回来的大纲：场景和章的文字字段规整成字符串，出场人物规整成名字列表 */
export function tidyVols(vols: Volume[]): Volume[] {
  if (!Array.isArray(vols)) return [];
  return vols.map((v) => {
    const chapters = Array.isArray(v.chapters) ? v.chapters.map(tidyChapter) : [];
    return Array.isArray(v.chapters) && chapters.every((c, i) => c === v.chapters[i]) ? v : { ...v, chapters };
  });
}

const EV_STR = ["time", "t", "place", "fore", "cause", "process", "result", "impact", "reveal", "note", "from"] as const;

/** 载入、撤销回来的事件：人物规整成「、」分隔的字符串，天数规整成数字 */
export function tidyEvents(events: StoryEvent[]): StoryEvent[] {
  if (!Array.isArray(events)) return [];
  return events.filter(Boolean).map((e) => {
    const bad = typeof e.who !== "string" || typeof e.day !== "number" || !Number.isFinite(e.day) || EV_STR.some((k) => e[k] != null && typeof e[k] !== "string");
    if (!bad) return e;
    const out: any = { ...e, who: names(e.who).join("、"), day: num(e.day) ?? 1, t: str(e.t), ty: eventType(e.ty) };
    for (const k of EV_STR) if (e[k] != null) out[k] = str(e[k]);
    return out;
  });
}
