import { create } from "zustand";
import { produce, type Draft } from "immer";
import * as repo from "./repo";
import type { Arc, CallEntry, ChangeSet, Character, DocKind, StoryEvent, StyleSetup, Volume, Work } from "./types";
import { emptySetup } from "./style";
import { uid } from "./util";

export type Page = "library" | "new" | "write" | "outline" | "style" | "memory" | "settings";

/** 作品里按整份保存的数据 */
export interface WorkData {
  vols: Volume[];
  chars: Character[];
  events: StoryEvent[];
  plan: Arc[];
  style: StyleSetup;
  calls: CallEntry[];
  changesets: ChangeSet[];
}
type DataKey = keyof WorkData;
const KIND: Record<DataKey, DocKind> = { vols: "outline", chars: "chars", events: "events", plan: "plan", style: "style", calls: "calls", changesets: "changesets" };

interface State extends WorkData {
  works: Work[];
  work: Work | null;
  page: Page;
  chapterId: string | null;
  toast: string | null;
  loadWorks(): Promise<void>;
  openWork(id: string, page?: Page): Promise<void>;
  createWork(w: Omit<Work, "id" | "created" | "updated">, data: Partial<WorkData>): Promise<string>;
  saveWorkInfo(patch: Partial<Work>): void;
  removeWork(id: string): Promise<void>;
  go(page: Page): void;
  openChapter(id: string | null): void;
  /** 作者手动修改 */
  edit<K extends DataKey>(key: K, recipe: (d: Draft<WorkData[K]>) => void): void;
  /** 一次修改多份数据（例如同步） */
  editMany(keys: DataKey[], recipe: (d: Draft<WorkData>) => void): void;
  /** AI 的修改：直接生效，同时记一个变更集，可以整组撤销 */
  aiEdit(label: string, keys: DataKey[], recipe: (d: Draft<WorkData>) => void): void;
  undoChange(id: string): void;
  flash(msg: string): void;
  flushSaves(): Promise<void>;
  /** 保存状态：正在保存几项、最近一次成功的时间、最近的错误 */
  saving: number;
  savedAt: number;
  saveErr: string | null;
}

const EMPTY: WorkData = { vols: [], chars: [], events: [], plan: [], style: emptySetup(), calls: [], changesets: [] };

const timers = new Map<DataKey, ReturnType<typeof setTimeout>>();
const pending = new Map<DataKey, () => Promise<void>>();
/** 页面自己管的保存（例如正文），关窗和切书时一起冲刷 */
const flushers = new Set<() => Promise<unknown> | unknown>();
export function registerFlush(fn: () => Promise<unknown> | unknown): () => void {
  flushers.add(fn);
  return () => void flushers.delete(fn);
}

/** 还没存进去的各项（正文按章、各份数据按名字分开记）：某一项存成功不能抹掉别的项的失败 */
const saveErrs = new Map<string, string>();
const lastErr = () => [...saveErrs.values()].pop() ?? null;
/** 这一项后来已经存成功了：清掉它早先那次的失败 */
export function clearSaveErr(key: string) {
  if (saveErrs.delete(key)) useStore.setState({ saveErr: lastErr() });
}

/** 包住一次写库：维护保存状态。失败时记下错误并抛出，由调用方决定怎么重试。key 区分是哪一项 */
export async function trackSave<T>(p: () => Promise<T>, key = ""): Promise<T> {
  useStore.setState((s) => ({ saving: s.saving + 1 }));
  try {
    const r = await p();
    saveErrs.delete(key);
    useStore.setState((s) => ({ saving: s.saving - 1, savedAt: Date.now(), saveErr: lastErr() }));
    return r;
  } catch (e: any) {
    const msg = String(e?.message || e);
    const first = !useStore.getState().saveErr;
    saveErrs.set(key, msg);
    useStore.setState((s) => ({ saving: s.saving - 1, saveErr: msg }));
    if (first) useStore.getState().flash("保存失败：" + msg + "。会自动重试，内容先留在本机草稿里");
    throw e;
  }
}

function scheduleSave(key: DataKey, delay = 500) {
  const s = useStore.getState();
  if (!s.work) return;
  const wid = s.work.id;
  const run = async () => {
    timers.delete(key);
    pending.delete(key);
    const cur = useStore.getState();
    if (cur.work?.id !== wid) return;
    try {
      await trackSave(() => repo.saveDoc(wid, KIND[key], cur[key]), "doc:" + key);
    } catch {
      // 5 秒后再试；期间又有修改会自然合并成一次
      if (useStore.getState().work?.id === wid && !timers.has(key)) scheduleSave(key, 5000);
    }
  };
  clearTimeout(timers.get(key));
  pending.set(key, run);
  timers.set(key, setTimeout(run, delay));
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>((set, get) => ({
  ...EMPTY,
  works: [],
  work: null,
  page: "library",
  chapterId: null,
  toast: null,
  saving: 0,
  savedAt: 0,
  saveErr: null,

  async loadWorks() {
    set({ works: await repo.listWorks() });
  },

  async openWork(id, page = "write") {
    await get().flushSaves();
    const w = (await repo.listWorks()).find((x) => x.id === id);
    if (!w) return;
    const data: WorkData = { ...EMPTY };
    for (const k of Object.keys(KIND) as DataKey[]) (data as any)[k] = await repo.loadDoc(id, KIND[k], (EMPTY as any)[k]);
    data.style = { ...emptySetup(), ...data.style };
    data.chars = tidyChars(data.chars);
    const first = data.vols[0]?.chapters[0]?.id ?? null;
    const last = await repo.getSetting<string | null>("lastChapter:" + id, null);
    set({ ...data, work: w, page, chapterId: last ?? first });
    await repo.setSetting("lastWork", id);
  },

  async createWork(info, data) {
    const now = Date.now();
    const w: Work = { ...info, id: uid("w"), created: now, updated: now };
    await repo.saveWork(w);
    const full = { ...EMPTY, ...data };
    for (const k of Object.keys(KIND) as DataKey[]) await repo.saveDoc(w.id, KIND[k], full[k]);
    await get().loadWorks();
    return w.id;
  },

  saveWorkInfo(patch) {
    const w = get().work;
    if (!w) return;
    const nw = { ...w, ...patch, updated: Date.now() };
    set({ work: nw, works: get().works.map((x) => (x.id === nw.id ? nw : x)) });
    trackSave(() => repo.saveWork(nw), "work").catch(() => {});
  },

  async removeWork(id) {
    await repo.softDeleteWork(id);
    if (get().work?.id === id) set({ ...EMPTY, work: null, page: "library" });
    await get().loadWorks();
  },

  go(page) {
    set({ page });
  },

  openChapter(id) {
    set({ chapterId: id, page: "write" });
    const w = get().work;
    if (w) repo.setSetting("lastChapter:" + w.id, id);
  },

  edit(key, recipe) {
    set({ [key]: produce(get()[key], recipe as any) } as any);
    scheduleSave(key);
    touch();
  },

  editMany(keys, recipe) {
    const cur = pick(get());
    const next = produce(cur, recipe);
    set(next);
    keys.forEach(scheduleSave);
    touch();
  },

  aiEdit(label, keys, recipe) {
    const cur = pick(get());
    const before: ChangeSet["before"] = {};
    for (const k of keys) before[KIND[k]] = cur[k];
    const next = produce(cur, recipe);
    const cs: ChangeSet = { id: uid("cs"), at: Date.now(), label, before };
    set({ ...next, changesets: [cs, ...get().changesets].slice(0, 50) });
    [...keys, "changesets" as DataKey].forEach(scheduleSave);
    touch();
  },

  undoChange(id) {
    const all = get().changesets;
    const idx = all.findIndex((x) => x.id === id);
    const cs = all[idx];
    if (!cs || cs.undone) return;
    // 之后动过同一份数据的组会被一起回退，也要标成已撤销，否则再撤销它们会把这一组的改动复活。
    // changesets 新的在前（下标越大越早）；每份数据退回这批里最早那组的 before。
    // 只拉进「改动会被这次回退盖掉」的组：它动过的某份数据，要退回到比它更早的 before
    const group = new Set([id]);
    const oldest = new Map<string, number>(Object.keys(cs.before).map((k) => [k, idx]));
    for (let grew = true; grew; ) {
      grew = false;
      all.slice(0, idx).forEach((x, i) => {
        if (group.has(x.id) || x.undone || !Object.keys(x.before).some((k) => (oldest.get(k) ?? -1) > i)) return;
        group.add(x.id);
        for (const k of Object.keys(x.before)) if ((oldest.get(k) ?? -1) < i) oldest.set(k, i);
        grew = true;
      });
    }
    const patch: Partial<WorkData> = {};
    for (const [kind, i] of oldest) {
      const key = (Object.keys(KIND) as DataKey[]).find((k) => KIND[k] === kind);
      if (key) (patch as any)[key] = all[i].before[kind as keyof ChangeSet["before"]];
    }
    if (patch.chars) patch.chars = tidyChars(patch.chars);
    set({ ...patch, changesets: all.map((x) => (group.has(x.id) ? { ...x, undone: true } : x)) });
    [...(Object.keys(patch) as DataKey[]), "changesets" as DataKey].forEach(scheduleSave);
    get().flash(`已撤销：${cs.label}`);
  },

  flash(msg) {
    clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = setTimeout(() => set({ toast: null }), 2600);
  },

  async flushSaves() {
    for (const f of [...flushers]) {
      try {
        await f();
      } catch {
        /* 错误已经记进保存状态 */
      }
    }
    const runs = [...pending.values()];
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    pending.clear();
    for (const r of runs) await r();
  },
}));

/** 字段值规整成文字：老版本存进去的 AI 人设变化里可能有对象，渲染时会让整页白屏 */
function text(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (typeof v !== "object") return String(v);
  return (Array.isArray(v) ? v : Object.values(v)).map(text).filter(Boolean).join("，");
}

/** 载入、撤销回来的人物卡：把人设变化各字段规整成字符串 */
export function tidyChars(chars: Character[]): Character[] {
  if (!Array.isArray(chars)) return [];
  return chars.map((p) =>
    p.changes?.some((x) => [x.field, x.from, x.to, x.cause].some((v) => typeof v !== "string") || (x.quote != null && typeof x.quote !== "string"))
      ? { ...p, changes: p.changes.map((x) => ({ ...x, field: text(x.field), from: text(x.from), to: text(x.to), cause: text(x.cause), ...(x.quote != null ? { quote: text(x.quote) } : {}) })) }
      : p,
  );
}

function pick(s: State): WorkData {
  return { vols: s.vols, chars: s.chars, events: s.events, plan: s.plan, style: s.style, calls: s.calls, changesets: s.changesets };
}

let touchTimer: ReturnType<typeof setTimeout> | undefined;
function touch() {
  clearTimeout(touchTimer);
  touchTimer = setTimeout(() => useStore.getState().saveWorkInfo({}), 3000);
}

export const toast = (m: string) => useStore.getState().flash(m);
