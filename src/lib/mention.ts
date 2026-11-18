import type { Character, Scene } from "./types";

/** 人物的所有叫法：名字加别名，太短（单字）的别名不算，免得误认 */
export function namesOf(c: Pick<Character, "name" | "f">): string[] {
  const alias = (c.f?.alias || "").split(/[、，,；;（）()\s/]+/).map((x) => x.trim()).filter((x) => x.length >= 2);
  return [...new Set([c.name.trim(), ...alias].filter(Boolean))];
}

/** 文字里提到了哪些人物（按名字或别名），返回人物表里的正式名字 */
export function mentioned(chars: Pick<Character, "name" | "f">[], text: string): string[] {
  if (!text) return [];
  return chars.filter((c) => c.name.trim() && namesOf(c).some((n) => text.includes(n))).map((c) => c.name.trim());
}

/** 场景卡里算「大纲」的文字 */
export const SCENE_TEXT = ["t", "goal", "conf", "turn", "result", "plant", "pay", "reveal", "note"] as const;
export function sceneText(s: Partial<Scene>): string {
  return SCENE_TEXT.map((k) => (s[k] as string) || "").join("\n");
}

/** 补上新提到的人物：只加不减，作者手动取消勾选的不会被加回来，除非文字里又新提到了他 */
export function addMentioned(who: string[], chars: Pick<Character, "name" | "f">[], before: string, after: string): string[] {
  const old = new Set(mentioned(chars, before));
  const add = mentioned(chars, after).filter((n) => !old.has(n) && !who.includes(n));
  return add.length ? [...who, ...add] : who;
}
