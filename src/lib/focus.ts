// 本章写作重点：作者告诉 AI 这一章笔墨往哪里放。大纲管「发生什么」，重点管「多写什么、怎么写」。
// 和写作限制一样在请求里出现两次：紧跟本章大纲一段完整版，请求最后一句再提醒。
import type { Chapter, Scene } from "./types";
import { uid } from "./util";

/** 章卡上的常用重点：点一下把 text 插进写作重点框。作者可以增删改，存在全局设置里 */
export interface FocusChip {
  id: string;
  label: string;
  text: string;
}

export const FOCUS_CHIPS_KEY = "focusChips";

export const DEFAULT_FOCUS_CHIPS: FocusChip[] = [
  { id: "fight", label: "战斗场面", text: "战斗场面写细：招式、距离、力道和负伤交代清楚，一来一回有实感，不要一句话打完" },
  { id: "mind", label: "心理活动", text: "多写人物的心理活动：犹豫、算计和情绪变化落在具体的念头和小动作上" },
  { id: "talk", label: "人物对白", text: "多用对白推进，每个人说话要有自己的口吻，少用旁白概括" },
  { id: "mood", label: "氛围环境", text: "多写氛围和环境：声音、光线、气味和旁观者的反应，让场面有压迫感" },
  { id: "love", label: "感情戏", text: "感情戏写足：眼神、距离、没说出口的话，情绪慢慢推上去" },
  { id: "cool", label: "爽点打脸", text: "爽点写足：先压一压，再让主角翻盘，旁人的震惊和前后反差要写出来" },
  { id: "tense", label: "悬念紧张", text: "保持紧张感：信息一点点放出来，段落短，节奏紧，章末留悬念" },
  { id: "slow", label: "节奏放慢", text: "节奏放慢：关键时刻拉长来写，细节和停顿多一些，不要急着交代结果" },
];

export const newChip = (): FocusChip => ({ id: uid(), label: "", text: "" });

/** 作者编辑过的列表去掉空项；一个都没有时（全删光）保持为空，不偷偷恢复默认 */
export function cleanChips(list: FocusChip[] | undefined): FocusChip[] {
  if (!Array.isArray(list)) return DEFAULT_FOCUS_CHIPS;
  return list.filter((c) => c && (c.label ?? "").trim()).map((c) => ({ id: c.id || uid(), label: c.label.trim(), text: (c.text ?? "").trim() || c.label.trim() }));
}

/** 点了常用重点：追加一句到写作重点；已经有这句就不重复加 */
export function addChip(focus: string | undefined, chip: FocusChip): string {
  const cur = (focus ?? "").trim();
  const t = chip.text.trim() || chip.label.trim();
  if (!t || cur.includes(t)) return cur;
  return cur ? cur.replace(/[。；;，,\s]*$/, "") + "；" + t : t;
}

/** 这个常用重点是否已经写进写作重点里（按钮显示为选中） */
export const chipOn = (focus: string | undefined, chip: FocusChip) => !!(focus ?? "").includes(chip.text.trim() || chip.label.trim());

/** 从写作重点里去掉这一句（再点一次已选中的按钮），顺手收拾多出来的分号 */
export function removeChip(focus: string | undefined, chip: FocusChip): string {
  const t = chip.text.trim() || chip.label.trim();
  return (focus ?? "")
    .split(t)
    .join("")
    .replace(/[；;]\s*([；;]\s*)+/g, "；")
    .replace(/^[；;，,。\s]+|[；;，,\s]+$/g, "");
}

type ChLike = Pick<Chapter, "focus" | "scenes">;

export const hasFocus = (ch: ChLike) => !!ch.focus?.trim() || ch.scenes.some((s) => s.key);

const keyScenes = (ch: ChLike) => ch.scenes.map((s, i) => ({ s, i })).filter((x) => x.s.key);

/** 请求里紧跟本章大纲的一段。没有写作重点也没有重点场景时为空 */
export function focusBlock(ch: ChLike): string {
  if (!hasFocus(ch)) return "";
  const lines = ["=== 本章写作重点（作者指定）==="];
  if (ch.focus?.trim()) lines.push(ch.focus.trim());
  const ks = keyScenes(ch);
  if (ks.length) lines.push("重点场景：" + ks.map((x) => `场景${x.i + 1}「${x.s.t}」`).join("、"));
  lines.push(`怎么落实：
- 重点部分占本章一半以上的篇幅，写过程和细节，不要一两句交代结果。
- 非重点部分简洁推进，大纲里的情节仍要写到，但不要平均用力。
- 只改变笔墨分配，不增加大纲以外的情节。和本书写作限制冲突时以限制为准。`);
  return lines.join("\n");
}

/** 请求最后一句的提醒。brief 给 Ctrl+Enter 这类只写一两句的 */
export function focusTail(ch: ChLike): string {
  if (!hasFocus(ch)) return "";
  const bits = [ch.focus?.trim(), keyScenes(ch).length ? "重点场景：" + keyScenes(ch).map((x) => `「${x.s.t}」`).join("、") : ""].filter(Boolean);
  return "\n\n写之前再核对一遍本章写作重点：" + bits.join("；").replace(/[。；;\s]*$/, "") + "。";
}

/** 只写一两句时的简版：一句话提醒，不带篇幅规则 */
export function focusHint(ch: ChLike): string {
  const f = ch.focus?.trim();
  return f ? `\n\n本章写作重点（作者指定，接下来的写法往这边靠）：${f}` : "";
}

/** 按场景写时每个场景约多少字。没有重点场景时和以前一样平分；有的话，作者填过字数的不动，重点场景按两份分剩下的字数，其余按一份 */
export function sceneWords(scenes: Pick<Scene, "words" | "key">[], total: number): number[] {
  const per = Math.round(total / Math.max(1, scenes.length));
  if (!scenes.some((s) => s.key)) return scenes.map((s) => s.words || per);
  const free = scenes.filter((s) => !s.words);
  const fixed = scenes.reduce((n, s) => n + (s.words || 0), 0);
  // 手填的字数已经占满全章时，没填的场景按以前平分的份额来分
  const left = total - fixed > 0 ? total - fixed : per * free.length;
  const unit = left / Math.max(1, free.reduce((n, s) => n + (s.key ? 2 : 1), 0));
  return scenes.map((s) => s.words || Math.round(unit * (s.key ? 2 : 1)));
}

/** 生成结果面板顶部那行：这次照着的重点。没有就空 */
export function focusSummary(ch: ChLike): string {
  const ks = keyScenes(ch);
  return [ch.focus?.trim(), ks.length ? "重点场景 " + ks.map((x) => `「${x.s.t}」`).join("") : ""].filter(Boolean).join("；");
}
