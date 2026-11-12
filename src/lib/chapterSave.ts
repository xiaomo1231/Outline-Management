// 正文保存：写库、骤降拦截、自动快照、失败时留本机草稿并重试。
import * as repo from "./repo";
import { trackSave, toast } from "./store";
import { isShrink, needSnapshot } from "./versions";

export interface Snap {
  html: string;
  plain: string;
  words: number;
  ai: number;
}

export interface SaveResult {
  delta: number;
  /** 字数骤降时少掉的字数（已经留了快照） */
  shrunk?: number;
}

const DRAFT = "moshu-draft:";
const seq = new Map<string, number>();

function ls(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 保存失败时把本章内容先放进本机草稿 */
export function writeDraft(ch: string, snap: Snap) {
  try {
    ls()?.setItem(DRAFT + ch, JSON.stringify({ ...snap, at: Date.now() }));
  } catch {
    /* 本机存储满了也没办法 */
  }
}
export function readDraft(ch: string): (Snap & { at: number }) | null {
  try {
    const v = ls()?.getItem(DRAFT + ch);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
export function clearDraft(ch: string) {
  try {
    ls()?.removeItem(DRAFT + ch);
  } catch {
    /* 忽略 */
  }
}

/** 留一份快照（内容和最新一份相同就不留） */
export async function snapshot(work: string, ch: string, snap: Snap, reason: string): Promise<boolean> {
  if (!snap.words && !snap.plain.trim()) return false;
  const last = await repo.latestVersion(ch);
  if (last && last.html === snap.html) return false;
  await repo.addVersion(work, ch, snap.html, snap.plain, snap.words, reason);
  return true;
}

/** 保存一章正文。失败时抛错之前已经留好本机草稿，并在 5 秒后自动重试 */
export async function persistChapter(work: string, ch: string, snap: Snap): Promise<SaveResult> {
  const my = (seq.get(ch) ?? 0) + 1;
  seq.set(ch, my);
  try {
    return await trackSave(async () => {
      const old = await repo.loadText(ch);
      let shrunk: number | undefined;
      if (old && isShrink(old.words, snap.words)) {
        await snapshot(work, ch, { html: old.html, plain: old.plain, words: old.words, ai: old.ai_chars }, "字数骤降前");
        shrunk = old.words - snap.words;
      }
      const delta = await repo.saveText(work, ch, snap.html, snap.plain, snap.words, snap.ai);
      const last = await repo.latestVersion(ch);
      if (needSnapshot(last, Date.now(), snap)) await repo.addVersion(work, ch, snap.html, snap.plain, snap.words, "自动");
      clearDraft(ch);
      return { delta, shrunk };
    });
  } catch (e) {
    writeDraft(ch, snap);
    setTimeout(() => {
      // 期间有更新的保存就不用重试这一份了
      if (seq.get(ch) === my) persistChapter(work, ch, snap).catch(() => {});
    }, 5000);
    throw e;
  }
}

export function shrinkToast(n: number) {
  toast(`本章少了 ${n.toLocaleString()} 字，已经留了快照，可以在「历史」里找回`);
}
