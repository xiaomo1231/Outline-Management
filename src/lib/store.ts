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
}

const EMPTY: WorkData = { vols: [], chars: [], events: [], plan: [], style: emptySetup(), calls: [], changesets: [] };

const timers = new Map<DataKey, ReturnType<typeof setTimeout>>();
const pending = new Map<DataKey, () => Promise<void>>();
function scheduleSave(key: DataKey) {
  const s = useStore.getState();
  if (!s.work) return;
  const wid = s.work.id;
  const run = async () => {
    timers.delete(key);
    pending.delete(key);
    const cur = useStore.getState();
    if (cur.work?.id !== wid) return;
    await repo.saveDoc(wid, KIND[key], cur[key]);
  };
  clearTimeout(timers.get(key));
  pending.set(key, run);
  timers.set(key, setTimeout(run, 500));
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>((set, get) => ({
  ...EMPTY,
  works: [],
  work: null,
  page: "library",
  chapterId: null,
  toast: null,

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
    repo.saveWork(nw);
  },

  async removeWork(id) {
    await repo.deleteWork(id);
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
    const cs = get().changesets.find((x) => x.id === id);
    if (!cs || cs.undone) return;
    const patch: Partial<WorkData> = {};
    for (const [kind, v] of Object.entries(cs.before)) {
      const key = (Object.keys(KIND) as DataKey[]).find((k) => KIND[k] === kind);
      if (key) (patch as any)[key] = v;
    }
    set({ ...patch, changesets: get().changesets.map((x) => (x.id === id ? { ...x, undone: true } : x)) });
    [...(Object.keys(patch) as DataKey[]), "changesets" as DataKey].forEach(scheduleSave);
    get().flash(`已撤销：${cs.label}`);
  },

  flash(msg) {
    clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = setTimeout(() => set({ toast: null }), 2600);
  },

  async flushSaves() {
    const runs = [...pending.values()];
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    pending.clear();
    for (const r of runs) await r();
  },
}));

function pick(s: State): WorkData {
  return { vols: s.vols, chars: s.chars, events: s.events, plan: s.plan, style: s.style, calls: s.calls, changesets: s.changesets };
}

let touchTimer: ReturnType<typeof setTimeout> | undefined;
function touch() {
  clearTimeout(touchTimer);
  touchTimer = setTimeout(() => useStore.getState().saveWorkInfo({}), 3000);
}

export const toast = (m: string) => useStore.getState().flash(m);
