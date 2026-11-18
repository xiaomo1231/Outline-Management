// 章节归档：每章写完、改过之后，AI 在后台给这一章做摘要，记下章末状态、新事实和人设变化。
// 生成大纲和正文时的“前文”就读这些归档，不用每次现场翻正文。
// 触发：正文保存后停手 2 分钟、离开这一章、状态改成「已写」、手动点「归档本章」、每日整理时补漏。
// 每次先和上次归档时的正文比对，只改了几个字就不重新归档，省钱。
import DiffMatchPatch from "diff-match-patch";
import { chatJson } from "./client";
import type { Ctx } from "./context";
import { useStore } from "../store";
import * as repo from "../repo";
import * as mem from "../memory";
import { allChapters, findChapter, type ChRef } from "../outline";
import { fieldLabel, isLocked } from "../charFields";
import { uid } from "../util";
import { getSecret } from "../secret";
import type { CharChange, Id } from "../types";

/** 正文少于这么多字的章不自动归档（手动点按钮不受限） */
export const MIN_WORDS = 500;
/** 和上次归档相比改动少于这么多字，不重新归档 */
export const MIN_DIFF = 50;
/** 停手多久后检查 */
export const IDLE_MS = 2 * 60 * 1000;

export interface Archive {
  /** 150–200 字的章节摘要 */
  summary: string;
  /** 章末状态：每个在场人物在哪、和谁在一起、处境如何，正在进行中的事 */
  end: string;
  /** 这一章确立的事实 */
  facts: string[];
  /** 归档时这一章是第几章（章号会因为插章变化，只做参考） */
  no: number;
}

export interface Ripple {
  id: Id;
  at: number;
  /** 改动的是哪一章 */
  ch: Id;
  /** 改了什么，一两句 */
  what: string;
}

/** 两段正文相差多少字（新增加删除） */
export function diffSize(a: string, b: string): number {
  if (a === b) return 0;
  const d = new DiffMatchPatch();
  d.Diff_Timeout = 0.5;
  let n = 0;
  for (const [op, t] of d.diff_main(a, b)) if (op !== 0) n += t.length;
  return n;
}

export function parseArchive(row: repo.ArchiveRow | null): Archive | null {
  if (!row) return null;
  try {
    return JSON.parse(row.data) as Archive;
  } catch {
    return null;
  }
}

export async function getArchive(ch: Id): Promise<Archive | null> {
  return parseArchive(await repo.loadArchive(ch));
}

/** 全书各章的归档，按章 id */
export async function archiveMap(work: Id): Promise<Map<Id, Archive & { at: number; plain: string }>> {
  const out = new Map<Id, Archive & { at: number; plain: string }>();
  for (const r of await repo.allArchives(work)) {
    const a = parseArchive(r);
    if (a) out.set(r.id, { ...a, at: r.at, plain: r.plain });
  }
  return out;
}

export type Need = "none" | "short" | "same" | "new" | "changed";

/** 这一章要不要归档 */
export async function need(ch: Id, force = false): Promise<{ need: Need; plain: string; diff: number }> {
  const t = await repo.loadText(ch);
  const plain = t?.plain ?? "";
  if (!plain.trim()) return { need: "none", plain, diff: 0 };
  const row = await repo.loadArchive(ch);
  if (!row) return { need: force || (t?.words ?? 0) >= MIN_WORDS ? "new" : "short", plain, diff: plain.length };
  const diff = diffSize(row.plain ?? "", plain);
  if (force) return { need: diff ? "changed" : "same", plain, diff };
  return { need: diff >= MIN_DIFF ? "changed" : "same", plain, diff };
}

interface Digest {
  summary: string;
  end: string;
  facts: string[];
  changes: { name: string; field: string; to: string; cause: string; quote: string }[];
  /** 重新归档时：这次修改有没有改掉会影响后文的东西 */
  ripple?: string;
}

const KEYS = ["id", "class", "power", "clothes", "acc", "want", "rel", "core", "look", "hair", "fear", "values"];

/**
 * 给一章做归档。会写入：章节摘要（大纲里的 AI 摘要）、归档表、记忆里的事实、人物卡的变化。
 * 重新归档时，这一章旧的事实和 AI 记的人设变化会被替换。
 */
export async function archiveChapter(c: Ctx, r: ChRef, plain: string): Promise<{ archive: Archive; ripple: string; changes: number; conflicts: number }> {
  const workId = c.work.id;
  const old = await getArchive(r.ch.id);
  const prevRef = allChapters(c.vols).filter((x) => x.no < r.no).pop();
  const prevArc = prevRef ? await getArchive(prevRef.ch.id) : null;
  const people = c.chars.filter((x) => x.name && (plain.includes(x.name) || (x.f.alias || "").split(/[、,，\s]+/).some((a) => a.length >= 2 && plain.includes(a))));
  const body = plain.length > 30000 ? plain.slice(0, 12000) + "\n……（中间省略）……\n" + plain.slice(-18000) : plain;
  const d = await chatJson<Digest>(
    [
      { role: "system", content: "你是小说的记忆整理员。只记录正文里确实写到的内容，不推测、不补充。" },
      {
        role: "user",
        content: `第${r.no}章「${r.ch.title || "未命名"}」正文：
${body}

${prevArc?.end ? `上一章（第${prevRef!.no}章）的章末状态，供你对照人物从哪里接着来：\n${prevArc.end}\n\n` : ""}出场人物现有设定：
${people.map((p) => `${p.name}：` + KEYS.filter((k) => p.f[k]).map((k) => `${k}(${fieldLabel(k)})=${p.f[k]}`).join("；")).join("\n") || "无"}
${old ? `\n这一章之前归档过，旧的归档是：\n摘要：${old.summary}\n章末状态：\n${old.end}\n事实：\n${old.facts.map((f) => "- " + f).join("\n")}\n` : ""}
返回 JSON：
{"summary":"200 字以内的章节摘要，写清发生了什么、推进了什么",
 "end":"章末状态：本章结束那一刻，每个在场人物一行，写清 在哪、和谁在一起、在做什么、处境（受伤、被押、被困、持有的关键物品、知道了什么）；最后一行写还在进行中、下一章要接着处理的事",
 "facts":["这一章确立的、以后要记住的事实，每条一句，最多 8 条"],
 "changes":[{"name":"人物","field":"字段键（从上面的键里选）","to":"新值","cause":"触发事件","quote":"原文短引用"}]${old ? `,
 "ripple":"和旧的归档比，这次修改有没有改掉会影响后面章节的东西（人物去向、生死、关系、关键物品、章末局面）。有就用一两句写清改了什么，没有就返回空字符串"` : ""}}
人设变化只记真正改变了的（身份、处境、关系、外观、能力、动机等），没有就空数组。`,
      },
    ],
    { temperature: 0.2 },
  );
  const archive: Archive = { summary: String(d.summary ?? "").trim(), end: String(d.end ?? "").trim(), facts: (Array.isArray(d.facts) ? d.facts : []).map(String).filter(Boolean).slice(0, 8), no: r.no };
  // 中途换了书，就不写了
  if (useStore.getState().work?.id !== workId) throw new Error("已经切换到别的书，归档取消");
  await repo.saveArchive(workId, r.ch.id, plain, archive);

  const now = Date.now();
  // 摘要写进大纲：不进撤销记录，后台改动太频繁
  useStore.getState().edit("vols", (vols) => {
    const at = findChapter(vols as any, r.ch.id);
    if (!at) return;
    const ch = vols[at.v].chapters[at.c];
    ch.summary = archive.summary;
    ch.summaryAt = now;
  });

  // 人设变化：先去掉这一章旧的 AI 记录，再加新的；有变化才进「AI 变更记录」，可以撤销
  let changes = 0;
  let conflicts = 0;
  const list = (Array.isArray(d.changes) ? d.changes : []).filter((x) => x && x.name && x.field && x.to);
  const hadOld = useStore.getState().chars.some((p) => (p.changes ?? []).some((x) => x.ch === r.ch.id && x.by === "ai"));
  if (list.length || hadOld) {
    useStore.getState().aiEdit(`第${r.no}章归档：人设变化`, ["chars"], (dr) => {
      for (const p of dr.chars) if (p.changes?.length) p.changes = p.changes.filter((x) => !(x.ch === r.ch.id && x.by === "ai"));
      for (const x of list) {
        const p = dr.chars.find((y) => y.name === x.name);
        if (!p) continue;
        const lock = isLocked(p, x.field);
        const cc: CharChange = { id: uid("cc"), ch: r.ch.id, field: x.field, from: p.f[x.field] || "", to: x.to, cause: x.cause || "", quote: x.quote, by: "ai", at: now, status: lock ? "conflict" : "applied" };
        (p.changes ??= []).push(cc);
        if (lock) conflicts++;
        else changes++;
      }
    });
  }

  // 记忆里的事实：替换这一章旧的
  await mem.replaceChapterFacts(workId, r.ch.id, r.no, archive.facts);

  // 改的是前文，而且改掉了会影响后文的东西：提醒对齐后面的大纲
  const ripple = old ? String(d.ripple ?? "").trim() : "";
  const hasLater = allChapters(useStore.getState().vols).some((x) => x.no > r.no);
  if (ripple && hasLater) await addRipple(workId, { id: uid("rp"), at: now, ch: r.ch.id, what: ripple });
  return { archive, ripple, changes, conflicts };
}

/* ---------- 提醒：前文改了，后面的大纲可能对不上 ---------- */

export async function ripples(work: Id): Promise<Ripple[]> {
  return repo.loadDoc<Ripple[]>(work, "ripples", []);
}
async function addRipple(work: Id, r: Ripple) {
  const list = (await ripples(work)).filter((x) => x.ch !== r.ch);
  list.unshift(r);
  await repo.saveDoc(work, "ripples", list.slice(0, 20));
  bump();
}
export async function dismissRipple(work: Id, id: Id) {
  await repo.saveDoc(work, "ripples", (await ripples(work)).filter((x) => x.id !== id));
  bump();
}

/* ---------- 后台队列 ---------- */

type Listener = () => void;
const listeners = new Set<Listener>();
/** 归档和提醒有变化时通知界面刷新 */
export function onChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
function bump() {
  listeners.forEach((f) => {
    try {
      f();
    } catch {
      /* 忽略 */
    }
  });
}

const timers = new Map<Id, ReturnType<typeof setTimeout>>();
let chain: Promise<unknown> = Promise.resolve();
const queued = new Set<Id>();
/** 正在后台归档的章 */
export const busy = new Set<Id>();

async function hasKey(): Promise<boolean> {
  try {
    return !!(await getSecret("deepseek"));
  } catch {
    return false;
  }
}

function ctxNow(): Ctx | null {
  const s = useStore.getState();
  if (!s.work) return null;
  return { work: s.work, vols: s.vols, chars: s.chars, events: s.events, plan: s.plan, style: s.style, calls: s.calls, changesets: s.changesets };
}

/** 排队检查一章；同一章已经在排队就不重复排 */
export function check(ch: Id, opts: { force?: boolean } = {}): Promise<Need | "error"> {
  const t = timers.get(ch);
  if (t) {
    clearTimeout(t);
    timers.delete(ch);
  }
  if (queued.has(ch) && !opts.force) return Promise.resolve("same");
  queued.add(ch);
  const p = chain.then(async (): Promise<Need | "error"> => {
    queued.delete(ch);
    const c = ctxNow();
    if (!c) return "none";
    const r = findChapter(c.vols, ch);
    if (!r) return "none";
    const n = await need(ch, opts.force);
    if (n.need !== "new" && n.need !== "changed") return n.need;
    if (!(await hasKey())) {
      if (opts.force) throw new Error("还没有填 DeepSeek 密钥，请到「设置」里填写。");
      return "none";
    }
    busy.add(ch);
    bump();
    try {
      await archiveChapter(c, r, n.plain);
      return n.need;
    } catch (e) {
      if (opts.force) throw e;
      console.warn("归档失败", e);
      return "error";
    } finally {
      busy.delete(ch);
      bump();
    }
  });
  chain = p.catch(() => {});
  return p;
}

/** 正文保存后调用：停手 2 分钟再检查 */
export function noteEdit(ch: Id) {
  const t = timers.get(ch);
  if (t) clearTimeout(t);
  timers.set(
    ch,
    setTimeout(() => {
      timers.delete(ch);
      check(ch).catch(() => {});
    }, IDLE_MS),
  );
}

/** 关窗、切书时：把还在等的检查取消（下次打开会由每日整理补上） */
export function cancelPending() {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
}

/** 哪些章还没归档，或者归档后改动较大 */
export async function stale(work: Id, vols = useStore.getState().vols): Promise<ChRef[]> {
  const texts = new Map((await repo.allTexts(work)).map((t) => [t.id, t]));
  const arcs = new Map((await repo.allArchives(work)).map((a) => [a.id, a]));
  const out: ChRef[] = [];
  for (const r of allChapters(vols)) {
    const t = texts.get(r.ch.id);
    if (!t || t.words < MIN_WORDS) continue;
    const a = arcs.get(r.ch.id);
    if (!a) out.push(r);
    else if (a.plain !== t.plain && diffSize(a.plain ?? "", t.plain) >= MIN_DIFF) out.push(r);
  }
  return out;
}

/** 粗估费用（元）：按 DeepSeek 价格，输入每百万 token 2 元、输出 8 元，中文约 1 字 0.6 token */
export function estimateCost(words: number[]): number {
  const inTok = words.reduce((a, w) => a + Math.min(w, 30000) * 0.6 + 600, 0);
  const outTok = words.length * 600;
  return (inTok * 2 + outTok * 8) / 1e6;
}

/** 补归档：几章一起并行跑，可以中途停 */
export async function archiveMany(list: ChRef[], onProgress: (done: number, total: number, cur: string) => void, signal?: AbortSignal, parallel = 3): Promise<{ ok: number; failed: number; err?: string }> {
  let i = 0;
  let ok = 0;
  let failed = 0;
  let err: string | undefined;
  const total = list.length;
  const worker = async () => {
    while (i < list.length && !signal?.aborted) {
      const r = list[i++];
      const c = ctxNow();
      if (!c) return;
      const cur = findChapter(c.vols, r.ch.id);
      if (!cur) continue;
      onProgress(ok + failed, total, `第${cur.no}章`);
      try {
        const t = await repo.loadText(r.ch.id);
        if (!t?.plain.trim()) continue;
        busy.add(r.ch.id);
        bump();
        await archiveChapter(c, cur, t.plain);
        ok++;
      } catch (e: any) {
        failed++;
        err = String(e?.message || e);
        // 密钥没填、额度用完这类错，后面的章也会失败，直接停
        if (e?.code === "nokey" || e?.code === "limit") return;
      } finally {
        busy.delete(r.ch.id);
        bump();
        onProgress(ok + failed, total, "");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, parallel) }, worker));
  return { ok, failed, err };
}

/** 打开书时：最近改过但还没归档的几章，补上（上次关窗前没来得及的） */
export async function catchUpRecent(work: Id, n = 5): Promise<void> {
  if (!(await hasKey())) return;
  const list = await stale(work);
  if (!list.length) return;
  const upd = new Map((await repo.allTexts(work)).map((t) => [t.id, t.updated]));
  list.sort((a, b) => (upd.get(b.ch.id) ?? 0) - (upd.get(a.ch.id) ?? 0));
  for (const r of list.slice(0, n)) await check(r.ch.id).catch(() => {});
}
