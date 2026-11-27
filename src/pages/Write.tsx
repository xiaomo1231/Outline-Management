import { mentioned } from "../lib/mention";
import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { AiEdit, AiText, AiTracker, AI_META, aiChars } from "../components/aiMarks";
import { ScanHighlight, scanKey, setLimitScan } from "../components/scanDeco";
import { AiResult, BanModal, NoteConflicts, marked } from "../components/LimitBits";
import { scanLimits, splitLimitNote, type LimitHit, type ScanOpts } from "../lib/limits";
import { namesOf } from "../lib/mention";
import type { WriteLimit } from "../lib/types";
import { KeepCaret } from "../components/keepCaret";
import { SelectionUi, keepSelKey } from "../components/selectionUi";
import { AiRangeTrack, aiRangeNow, markAiRange } from "../components/aiRange";
import { Guide } from "../components/Guide";
import { useStore, toast, registerFlush } from "../lib/store";
import { persistChapter, readDraft, clearDraft, snapshot, shrinkToast, writeDraft, type Snap } from "../lib/chapterSave";
import { changeOf, diffText } from "../lib/diff";
import { loadInto, publishText, setDoc } from "../lib/editorText";
import * as repo from "../lib/repo";
import { allChapters, findChapter, newChapter, plants } from "../lib/outline";
import { countWords, debounce, fmtHM, fmtTime, htmlToText, today, uid } from "../lib/util";
import { scan, sentenceLengths } from "../lib/aiscan";
import { EDITOR_DEFAULT, useSetting, type EditorPrefs } from "../lib/hooks";
import { importFont, loadSavedFonts, SYSTEM_FONTS } from "../lib/fonts";
import { ruleCheck } from "../lib/chars";
import { Issue, AsyncButton, Empty, Seg } from "../components/ui";
import { countIn, findInDoc, replaceInHtml, snippets, type Hit } from "../lib/findReplace";
import { isTauri } from "../lib/db";
import { ExportPanel } from "./DataPanels";
import * as T from "../lib/ai/tasks";
import { CONT_LENS, DEFAULT_CONT_LEN, SHORT_RATIO } from "../lib/ai/length";
import { errText } from "../lib/ai/client";
import { atOf, type Ctx } from "../lib/ai/context";
import { phaseName } from "../lib/plan";
import * as arc from "../lib/ai/archive";
import { olText } from "../lib/chapterOutline";
import { OlView } from "../components/OlEditor";

/** skip：这一次暂时关掉的写作限制 */
function ctx(skip: string[] = []): Ctx {
  const s = useStore.getState();
  const style = skip.length ? { ...s.style, limits: (s.style.limits ?? []).filter((l) => !skip.includes(l.id)) } : s.style;
  return { work: s.work!, vols: s.vols, chars: s.chars, events: s.events, plan: s.plan, style, calls: s.calls, changesets: s.changesets };
}

/** 改写作限制（例外词、新词）：作者的修改，不进 AI 变更集 */
function setLimits(v: WriteLimit[]) {
  useStore.getState().edit("style", (d) => void (d.limits = v as any));
}
function addExcept(id: string, word: string) {
  const ls = useStore.getState().style.limits ?? [];
  setLimits(ls.map((l) => (l.id === id ? { ...l, except: [...new Set([...l.except, word])] } : l)));
  toast(`「${word}」以后不算违反这条限制`);
}

/** 编辑器当前内容 */
function snapOf(ed: Editor): Snap {
  const plain = ed.getText({ blockSeparator: "\n" });
  const [a, e] = aiChars(ed.state.doc);
  return { html: ed.getHTML(), plain, words: countWords(plain), ai: a + e };
}

/** 润色、改写这类替换：只把真正改动的字标成 AI，原样保留的字还是作者的 */
function diffParas(orig: string, next: string) {
  const paras: { type: string; content: any[] }[] = [{ type: "paragraph", content: [] }];
  let added = 0;
  for (const [op, t] of diffText(orig, next.trim())) {
    if (op < 0) continue;
    t.split(/(\n+)/).forEach((seg) => {
      if (!seg) return;
      if (/^\n+$/.test(seg)) return void paras.push({ type: "paragraph", content: [] });
      if (op > 0) added += seg.replace(/\s/g, "").length;
      paras[paras.length - 1].content.push(op > 0 ? { type: "text", text: seg, marks: [{ type: "aitext" }] } : { type: "text", text: seg });
    });
  }
  return { content: paras.filter((p) => p.content.length), added };
}

/** 把一段 AI 文字变成带 AI 标记的段落 */
function aiParas(text: string) {
  return text
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((t) => ({ type: "paragraph", content: [{ type: "text", text: t, marks: [{ type: "aitext" }] }] }));
}

type Panel =
  | { kind: "none" }
  | { kind: "sugg"; loading: boolean; opts: { t: string; d: string }[]; err?: string }
  // noSel：续写时没选中文字（取的是光标所在段落作上下文），结果只能插进去，不能「替换选中」
  // orig：送去处理的原文，用来和结果对照、判断 AI 有没有改
  // len：续写的目标字数
  | { kind: "sel"; op: string; noSel: boolean; orig: string; text: string; done: boolean; err?: string; note: string; skip: string[]; len?: number }
  // target：这次草稿的目标字数
  | { kind: "fill"; scene: string; text: string; done: boolean; err?: string; cont?: boolean; target?: number }
  | { kind: "check"; loading: boolean; rule: ReturnType<typeof ruleCheck>; ai: T.OocIssue[]; cont: T.ContIssue[]; err?: string }
  | { kind: "hist"; list: repo.Version[]; sel: repo.VersionFull | null }
  | { kind: "find"; replace: boolean }
  | { kind: "keys" }
  | { kind: "export" };

export default function Write() {
  const work = useStore((s) => s.work)!;
  const vols = useStore((s) => s.vols);
  const chars = useStore((s) => s.chars);
  const events = useStore((s) => s.events);
  const plan = useStore((s) => s.plan);
  const calls = useStore((s) => s.calls);
  const chapterId = useStore((s) => s.chapterId);
  const openChapter = useStore((s) => s.openChapter);
  const edit = useStore((s) => s.edit);
  const [prefs, setPrefs, prefsReady] = useSetting<EditorPrefs>("editor", EDITOR_DEFAULT);
  const [focus, setFocus] = useState(false);
  const [scanOn, setScanOn] = useState(false);
  /** 右键「以后别这样写」选中的文字 */
  const [ban, setBan] = useState<string | null>(null);
  /** 选中文字后右键弹出的 AI 菜单 */
  const [menu, setMenu] = useState<{ x: number; y: number; sel: boolean } | null>(null);
  // 目录里右键某一章弹出的菜单
  const [tocMenu, setTocMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [words, setWords] = useState<Record<string, number>>({});
  const [todayWords, setTodayWords] = useState(0);
  const [todayExtra, setTodayExtra] = useState({ pasted: 0, ai: 0 });
  const style = useStore((s) => s.style);
  const saving = useStore((s) => s.saving);
  const savedAt = useStore((s) => s.savedAt);
  const saveErr = useStore((s) => s.saveErr);
  const [plain, setPlain] = useState("");
  const [ai, setAi] = useState<[number, number]>([0, 0]);
  const [panel, setPanel] = useState<Panel>({ kind: "none" });
  /** 续写长度（短中长），记住上次选的 */
  const [contLen, setContLen] = useSetting<number>("contLen", DEFAULT_CONT_LEN);
  /** 「按大纲生成草稿」这次写多少字；空着用默认值，切章清空 */
  const [fillWords, setFillWords] = useState("");
  const abort = useRef<AbortController | null>(null);
  /** 编辑器里正在显示的是哪一章（切章读取期间仍是上一章，打的字存回上一章） */
  const loadedFor = useRef<string | null>(null);
  /** 每次切章加一，读取回来时对不上就是过时的结果，直接丢掉 */
  const loadSeq = useRef(0);
  /** 有改动在排队等保存（状态栏不能显示「已保存」） */
  const [dirty, setDirty] = useState(false);

  const chs = useMemo(() => allChapters(vols), [vols]);
  const [fold, setFold] = useSetting<Record<string, number>>("tocFold", {});
  const [tocQ, setTocQ] = useState("");
  const tocHits = useMemo(() => {
    const q = tocQ.trim();
    if (!q) return chs;
    const n = /^\d+$/.test(q) ? +q : /^第?([0-9]+)章?$/.test(q) ? +q.replace(/\D/g, "") : 0;
    return chs.filter((r) => (n && r.no === n) || r.ch.title.includes(q));
  }, [chs, tocQ]);
  const cur = findChapter(vols, chapterId) ?? chs[0];
  // 换了一章：这次写多少字回到默认
  useEffect(() => setFillWords(""), [cur?.ch.id]);

  useEffect(() => {
    if (prefsReady) loadSavedFonts(prefs.fonts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsReady]);

  /** 「今日」字数属于哪一天：过了午夜要从库里重读，不能接着昨天的累加 */
  const day = useRef("");
  const loadToday = () => {
    const d0 = (day.current = today());
    repo.dailyWords(work.id, 1).then((d) => {
      const t = d.find((x) => x.day === d0);
      setTodayWords(t?.words ?? 0);
      setTodayExtra({ pasted: t?.pasted ?? 0, ai: t?.ai ?? 0 });
    });
  };
  /** 正文写库后把字数变化记到「今日」 */
  const addToday = (delta: number) => {
    if (today() !== day.current) loadToday();
    else if (delta) setTodayWords((x) => x + delta);
  };

  // 全书字数
  useEffect(() => {
    repo.allTexts(work.id).then((ts) => setWords(Object.fromEntries(ts.map((t) => [t.id, t.words]))));
    loadToday();
  }, [work.id]);

  // 写作限制：本章在哪一卷、有哪些人物、谁的视角，用来认对白归属和筛选限制
  const limits = useMemo(() => style.limits ?? [], [style.limits]);
  const scanOpts = useMemo<ScanOpts>(() => {
    const r = findChapter(vols, chapterId) ?? allChapters(vols)[0];
    const povs = [...new Set((r?.ch.scenes ?? []).map((s) => s.pov).filter(Boolean))] as string[];
    return { at: atOf({ vols, chars }, r), people: chars.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), names: namesOf(c) })), pov: povs.length === 1 ? povs[0] : undefined };
  }, [vols, chars, chapterId]);

  const extra = (kind: "pasted" | "ai", n: number) => {
    if (!n) return;
    setTodayExtra((x) => ({ ...x, [kind]: x[kind] + n }));
    repo
      .addDailyExtra(work.id, kind, n)
      .then(() => today() !== day.current && loadToday())
      .catch(() => {});
  };

  /** 立刻存一份（编辑器内容先同步取出，之后切章也不会串） */
  const saveNow = async (id: string, snap: Snap) => {
    if (!save.pending()) setDirty(false);
    try {
      const r = await persistChapter(work.id, id, snap);
      arc.noteEdit(id);
      setWords((m) => ({ ...m, [id]: snap.words }));
      addToday(r.delta);
      if (r.shrunk) shrinkToast(r.shrunk);
    } catch {
      /* 已经留了本机草稿，状态栏会显示失败并自动重试 */
    }
  };
  const save = useMemo(() => debounce((id: string, ed: Editor) => saveNow(id, snapOf(ed)), 700), [work.id]);

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, codeBlock: false, code: false, horizontalRule: false }), Placeholder.configure({ placeholder: "从这里开始写。Ctrl+Enter 让 AI 给三个接下来的写法。" }), AiText, AiEdit, AiTracker, ScanHighlight, KeepCaret, SelectionUi, AiRangeTrack],
    content: "",
    editorProps: {
      // Ctrl+Enter 留给「接下来怎么写」，不让编辑器插换行
      handleKeyDown: (_view, e) => e.key === "Enter" && (e.ctrlKey || e.metaKey),
      handlePaste: (_view, event) => {
        const t = event.clipboardData?.getData("text/plain") ?? "";
        extra("pasted", countWords(t));
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (!loadedFor.current) return;
      setPlain(ed.getText({ blockSeparator: "\n" }));
      setAi(aiChars(ed.state.doc));
      save(loadedFor.current, ed);
      setDirty(true);
      // 有字了，「大纲」状态自动变「写作中」
      const st = useStore.getState();
      const at = findChapter(st.vols, loadedFor.current);
      if (at && at.ch.status === "大纲" && ed.getText().trim().length >= 20) st.edit("vols", (d) => void (d[at.v].chapters[at.c].status = "写作中"));
    },
  });

  /** 立刻存掉排队中的正文（按编辑器里正在显示的那一章存，切章读取期间也不会存错章） */
  const flushNow = (): Promise<unknown> => (editor && loadedFor.current && save.pending() ? save.flush(loadedFor.current, editor) : Promise.resolve());
  // 编辑器里的写作限制高亮：限制或本章人物变了就重算
  useEffect(() => {
    setLimitScan((text) => scanLimits(text, limits, scanOpts).hits.map((h) => ({ ...h, title: "写作限制：" + (limits.find((l) => l.id === h.id)?.text ?? "") + (h.unsure ? "（在对白里，认不出是谁说的，你来判断）" : "") })));
    if (editor && scanOn) editor.view.dispatch(editor.state.tr.setMeta(scanKey, true));
  }, [editor, limits, scanOpts, scanOn]);

  // 切换章节：先存上一章，再加载
  useEffect(() => {
    if (!editor || !cur) return;
    const id = cur.ch.id;
    const my = ++loadSeq.current;
    if (loadedFor.current === id) return;
    const prev = loadedFor.current;
    if (prev) {
      const snap = snapOf(editor);
      const p = flushNow();
      p.then(() => snapshot(work.id, prev, snap, "离开本章"))
        .catch(() => {})
        // 离开这一章：不等 2 分钟，马上看要不要归档
        .then(() => arc.check(prev))
        .catch(() => {});
    }
    repo.loadText(id).then((t) => {
      // 读取期间又切了章：这份结果已经过时
      if (my !== loadSeq.current || editor.isDestroyed) return;
      const draft = readDraft(id);
      const useDraft = !!draft && draft.at > (t?.updated ?? 0) && draft.html !== t?.html && confirm(`这一章有一份没来得及存进数据库的草稿（${fmtTime(draft.at)}，${draft.words} 字）。要恢复它吗？\n选「取消」会丢掉草稿，保留库里的版本。`);
      if (draft && !useDraft) clearDraft(id);
      // 装进新章之前，把读取期间在上一章打的字先按上一章存掉，不能串进新章
      const shown = loadedFor.current;
      if (shown && save.pending()) save.flush(shown, editor);
      loadInto(editor, useDraft ? draft!.html : t?.html || "");
      loadedFor.current = id;
      if (useDraft) saveNow(id, snapOf(editor));
      setPlain(editor.getText({ blockSeparator: "\n" }));
      setAi(aiChars(editor.state.doc));
      setPanel((p) => (p.kind === "find" || p.kind === "keys" || p.kind === "export" ? p : { kind: "none" }));
    });
  }, [editor, cur?.ch.id]);

  useEffect(() => () => void flushNow(), [editor]);

  // 关窗那一瞬间来不及写库：先同步留一份本机草稿，下次打开会提示恢复。
  // 网页版：App 先冲刷过（排队状态已清），写进浏览器库还要 0.4 秒，所以总是留一份；和库里一样的草稿下次打开会自动丢掉
  useEffect(() => {
    const f = () => {
      if (editor && loadedFor.current && (save.pending() || !isTauri)) writeDraft(loadedFor.current, snapOf(editor));
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [editor, save]);

  // 关窗、切书时由 store 统一冲刷正文
  useEffect(
    () =>
      registerFlush(() => flushNow()),
    [editor, save],
  );

  // 右键菜单开着时保留选中底色（焦点在菜单输入框里，浏览器会收起正文的选中显示）
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const on = !!menu;
    if (keepSelKey.getState(editor.state) !== on) editor.view.dispatch(editor.state.tr.setMeta(keepSelKey, on).setMeta("addToHistory", false));
  }, [editor, menu]);

  // Ctrl+Enter
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      // 焦点在正文以外的输入框里（AI 助手、查找框等），Ctrl+Enter 是那个框自己的，不触发「接下来怎么写」
      const t = e.target instanceof HTMLElement ? e.target : null;
      const elsewhere = !!t?.closest("input, textarea, select, [contenteditable]") && !editor?.view.dom.contains(t);
      if (e.key === "Enter" && mod && !elsewhere) {
        e.preventDefault();
        suggest();
      }
      if (e.altKey && !mod && (e.key === "ArrowUp" || e.key === "ArrowDown") && cur) {
        e.preventDefault();
        const i = chs.findIndex((r) => r.ch.id === cur.ch.id) + (e.key === "ArrowUp" ? -1 : 1);
        if (chs[i]) openChapter(chs[i].ch.id);
        else toast(e.key === "ArrowUp" ? "已经是第一章" : "已经是最后一章");
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        addChapter();
      }
      if (mod && !e.shiftKey && (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "h")) {
        e.preventDefault();
        setPanel({ kind: "find", replace: e.key.toLowerCase() === "h" });
      }
      if (mod && e.key === "/") {
        e.preventDefault();
        setPanel({ kind: "keys" });
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveVersion("手动存档");
      }
      if (e.key === "Escape") {
        setMenu(null);
        setPanel({ kind: "none" });
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  if (!cur) {
    return (
      <div className="view">
        <div className="panel" style={{ maxWidth: 520 }}>
          <h3>还没有章节</h3>
          <button className="btn primary" type="button" onClick={() => addChapter()}>
            新建第一章
          </button>
        </div>
      </div>
    );
  }

  // vi 给了：加在那一卷末尾；afterId 给了：加在那一章后面；都没给：加在当前章后面
  function addChapter(vi?: number, afterId?: string) {
    const c = newChapter("");
    const at = afterId ? findChapter(vols, afterId) : cur;
    edit("vols", (d) => {
      if (!d.length) d.push({ id: uid("v"), title: "第一卷", chapters: [] });
      const v = vi ?? (at ? at.v : d.length - 1);
      d[v].chapters.splice(at && vi == null ? at.c + 1 : d[v].chapters.length, 0, c);
    });
    openChapter(c.id);
  }

  function before(): string {
    if (!editor) return "";
    const { from } = editor.state.selection;
    return editor.state.doc.textBetween(0, from, "\n");
  }

  function after(pos?: number): string {
    if (!editor) return "";
    const end = editor.state.doc.content.size;
    const at = Math.min(pos ?? editor.state.selection.to, end);
    return editor.state.doc.textBetween(at, end, "\n");
  }

  async function suggest() {
    if (!editor || !cur) return;
    // 结果回来时已经切到别的章，就不再显示（否则点一下会把上一章的续写插进新章）
    const id = loadedFor.current;
    const seq = loadSeq.current;
    const stale = () => loadedFor.current !== id || loadSeq.current !== seq;
    setPanel({ kind: "sugg", loading: true, opts: [] });
    try {
      const opts = await T.suggestNext(ctx(), cur, before(), after());
      if (!stale()) setPanel({ kind: "sugg", loading: false, opts });
    } catch (e) {
      if (!stale()) setPanel({ kind: "sugg", loading: false, opts: [], err: errText(e) });
    }
  }

  /** 手动存一版：立刻保存，并在历史里留一份 */
  async function saveVersion(reason: string) {
    if (!editor || !loadedFor.current) return;
    const id = loadedFor.current;
    const snap = snapOf(editor);
    // 先留这一版再写库，免得自动快照抢先存了同样的内容
    const ok = await snapshot(work.id, id, snap, reason);
    if (save.pending()) await save.flush(id, editor);
    else await saveNow(id, snap);
    toast(ok ? "已存一版，可以在「历史」里找到" : "已保存（和上一版一样，没有重复存）");
    if (panel.kind === "hist") setPanel({ kind: "hist", list: await repo.listVersions(id), sel: null });
  }

  /** AI 改正文之前先留一份快照 */
  function beforeAi() {
    if (editor && loadedFor.current) snapshot(work.id, loadedFor.current, snapOf(editor), "AI 修改前").catch(() => {});
  }

  function insertInline(raw: string) {
    const text = splitLimitNote(raw).body;
    beforeAi();
    extra("ai", countWords(text));
    editor
      ?.chain()
      .focus()
      .command(({ tr }) => {
        tr.setMeta(AI_META, true);
        return true;
      })
      .insertContent({ type: "text", text, marks: [{ type: "aitext" }] })
      .run();
    setPanel({ kind: "none" });
    toast("已插入。浅黄底是 AI 写的，你改过以后会变成虚线");
  }

  async function selOp(op: string, note = "", range?: { from: number; to: number; noSel: boolean }, skip: string[] = [], len = contLen) {
    if (!editor || !cur) return;
    let { from, to } = range ?? editor.state.selection;
    let noSel = range?.noSel ?? false;
    // 续写不用先选中：取光标所在的这一段（光标在空行就取上一段）
    if (!range && from === to && op === "续写") {
      const p = continueRange(editor.state.doc, from);
      if (p) ({ from, to } = p);
      noSel = true;
    }
    const sel = editor.state.doc.textBetween(from, to, "\n");
    if (!sel.trim()) {
      toast(op === "续写" ? "正文还是空的，先写几句" : "先在正文里选中一段");
      return;
    }
    abort.current?.abort();
    abort.current = new AbortController();
    // 记下原文位置，之后正文的每次改动都会把它挪到对的地方
    editor.view.dispatch(markAiRange(editor.state, from, to));
    setPanel({ kind: "sel", op, noSel, orig: sel, text: "", done: false, note, skip, len: op === "续写" ? len : undefined });
    try {
      await T.selectionOp(ctx(skip), cur, op, sel, editor.state.doc.textBetween(0, from, "\n"), (d) => setPanel((p) => (p.kind === "sel" ? { ...p, text: p.text + d } : p)), abort.current.signal, note, after(to), len);
      setPanel((p) => (p.kind === "sel" ? { ...p, done: true } : p));
    } catch (e) {
      setPanel((p) => (p.kind === "sel" ? { ...p, done: true, err: errText(e) } : p));
    }
  }

  function applySel(mode: "replace" | "after") {
    if (panel.kind !== "sel" || !editor) return;
    const body = splitLimitNote(panel.text).body;
    // AI 只回了空白：不能拿空白去替换，原文一个字都不动
    if (!body.trim()) return void toast("AI 这次没有写出内容，原文没动");
    // 续写没选中文字，选区只是上下文，不能替换
    if (mode === "replace" && panel.noSel) return;
    // 生成期间作者可能改过正文：位置已经跟着挪过；原文被改了就不动，免得改到别处
    const r = aiRangeNow(editor.state);
    if (!r) return void toast("原来选中的文字在生成期间被改动了，没有应用。请重新选中再试");
    beforeAi();
    // 替换时按改动算：只改了几个词，就只有这几个词算 AI
    const orig = editor.state.doc.textBetween(r.from, r.to, "\n");
    const d = mode === "replace" ? diffParas(orig, body) : null;
    extra("ai", d ? d.added : countWords(body));
    const content = d ? d.content : aiParas(body);
    const chain = editor.chain().focus().command(({ tr }) => {
      tr.setMeta(AI_META, true);
      return true;
    });
    if (mode === "replace") {
      // 选中的是整段就整段换掉；选中段落中间的一截、AI 只回了一段，就原地换文字，不再多出空段
      const doc = editor.state.doc;
      let { from, to } = r;
      const $f = doc.resolve(from);
      const $t = doc.resolve(to);
      const whole = $f.parentOffset === 0 && $t.parentOffset === $t.parent.content.size;
      if (content.length === 1 && !whole) chain.insertContentAt({ from, to }, content[0].content).run();
      else {
        if ($f.parentOffset === 0 && $f.depth > 0) from = $f.before($f.depth);
        if ($t.parentOffset === $t.parent.content.size && $t.depth > 0) to = $t.after($t.depth);
        chain.insertContentAt({ from, to }, content).run();
      }
    } else {
      // 插在原文所在段落后面（全选时位置在最外层，就直接接在末尾）
      const $t = editor.state.doc.resolve(r.to);
      chain.insertContentAt($t.depth >= 1 ? $t.after(1) : r.to, content).run();
    }
    setPanel({ kind: "none" });
  }

  async function fill() {
    if (!editor || !cur) return;
    if (!cur.ch.scenes.length && !olText(cur.ch)) {
      toast("这一章还没有大纲，先到大纲页写本章大纲或拆场景");
      return;
    }
    abort.current?.abort();
    abort.current = new AbortController();
    const existing = editor.getText({ blockSeparator: "\n" });
    const cont = !!existing.trim();
    const typed = Math.round(+fillWords);
    const target = typed >= 100 ? typed : T.fillTarget({ work }, cur, existing);
    setPanel({ kind: "fill", scene: "", text: "", done: false, cont, target });
    try {
      await T.fillChapter(ctx(), cur, (_i, t) => setPanel((p) => (p.kind === "fill" ? { ...p, scene: t } : p)), (d) => setPanel((p) => (p.kind === "fill" ? { ...p, text: p.text + d } : p)), abort.current.signal, existing, target);
      setPanel((p) => (p.kind === "fill" ? { ...p, done: true } : p));
    } catch (e) {
      setPanel((p) => (p.kind === "fill" ? { ...p, done: true, err: errText(e) } : p));
    }
  }

  function applyFill(mode: "end" | "replace") {
    if (panel.kind !== "fill" || !editor) return;
    beforeAi();
    const body = splitLimitNote(panel.text).body;
    extra("ai", countWords(body));
    const content = aiParas(body);
    const chain = editor.chain().focus().command(({ tr }) => {
      tr.setMeta(AI_META, true);
      return true;
    });
    if (mode === "replace") chain.setContent(content as any, true).run();
    else chain.insertContentAt(editor.state.doc.content.size, content).run();
    setPanel({ kind: "none" });
    // 已写字数变了，下次的默认字数跟着变，不沿用这次填的
    setFillWords("");
    toast("草稿已进正文，浅黄底的都是 AI 写的");
  }

  /** 「只改这几处」：只把违反限制的句子交给 AI 改，改好后替换面板里的文字 */
  async function fixPanel(body: string, hits: LimitHit[]) {
    const skip = panel.kind === "sel" ? panel.skip : [];
    const fixed = await T.fixLimits(ctx(skip), body, hits);
    setPanel((p) => (p.kind === "sel" || p.kind === "fill" ? { ...p, text: fixed } : p));
    toast("只改了违反限制的句子，其余没动");
  }

  async function check() {
    if (!cur) return;
    const id = loadedFor.current;
    const seq = loadSeq.current;
    const rule = ruleCheck(plain, chars, calls, vols, cur.no);
    setPanel({ kind: "check", loading: true, rule, ai: [], cont: [] });
    const [a, b] = await Promise.allSettled([T.checkCharacters(ctx(), cur, plain), T.checkContinuity(ctx(), cur, plain)]);
    // 已经切到别的章：检查结果是上一章的，不显示
    if (loadedFor.current !== id || loadSeq.current !== seq) return;
    const err = [a, b].find((x): x is PromiseRejectedResult => x.status === "rejected");
    setPanel({ kind: "check", loading: false, rule, ai: a.status === "fulfilled" ? a.value : [], cont: b.status === "fulfilled" ? b.value : [], err: err ? errText(err.reason) : undefined });
  }

  async function openHistory() {
    if (!cur) return;
    if (editor && loadedFor.current && save.pending()) await save.flush(loadedFor.current, editor);
    setPanel({ kind: "hist", list: await repo.listVersions(cur.ch.id), sel: null });
  }

  async function restoreVersion(v: repo.VersionFull) {
    if (!editor || !loadedFor.current) return;
    if (!confirm(`用 ${fmtTime(v.at)} 的版本（${v.words} 字）替换本章？当前内容会先留一份快照。`)) return;
    const kept = await snapshot(work.id, loadedFor.current, snapOf(editor), "恢复旧版前");
    setDoc(editor, v.html, true);
    await save.flush(loadedFor.current, editor);
    setPanel({ kind: "hist", list: await repo.listVersions(loadedFor.current), sel: null });
    toast(kept ? "已恢复。想反悔的话，历史里有一份「恢复旧版前」" : "已恢复");
  }

  async function copyPublish() {
    try {
      await navigator.clipboard.writeText(publishText(plain));
      toast("已复制本章，可以直接贴到作者后台");
    } catch {
      toast("复制失败，请手动选中复制");
    }
  }

  function addChange(i: T.OocIssue) {
    if (!i.change || !cur) return;
    useStore.getState().aiEdit(`为「${i.who}」补一条人设变化`, ["chars"], (d) => {
      const p = d.chars.find((x) => x.name === i.who);
      if (!p) return;
      (p.changes ??= []).push({ id: uid("cc"), ch: cur.ch.id, field: i.change!.field, from: p.f[i.change!.field] || "", to: i.change!.to, cause: i.change!.cause, by: "ai", at: Date.now(), status: "applied" });
    });
    toast("已补到人设时间轴");
  }

  const total = Object.values(words).reduce((a, b) => a + b, 0);
  const chWords = countWords(plain);
  const fillDefault = cur ? T.fillTarget({ work }, cur, plain) : 0;
  const scanRows = scanOn ? scan(plain) : [];
  const limStats = scanOn ? scanLimits(plain, limits, scanOpts).stats : [];
  const limOn = limits.filter((l) => !l.off).length;
  const rhythm = sentenceLengths(plain).slice(-80);
  const maxR = Math.max(10, ...rhythm);
  const olWho = mentioned(chars, plain + "\n" + olText(cur.ch));
  const people = chars.filter((c) => c.name && (olWho.includes(c.name.trim()) || cur.ch.scenes.some((s) => s.who.includes(c.name))));
  const open = plants(vols, events).filter((p) => p.plantNo && !p.payNo && p.plantNo <= cur.no);
  const aiTotal = ai[0] + ai[1];
  const fontList = [...SYSTEM_FONTS, ...prefs.fonts.map((f) => [`"${f.name}"`, f.name] as [string, string])];
  // 网页版字体存不进 IndexedDB 时没有路径，不进 prefs.fonts；这次打开期间已经装上的也列出来
  const webFont = /^"(导入·.+)"$/.exec(prefs.font)?.[1];
  if (webFont && !fontList.some(([v]) => v === prefs.font) && [...((document as any).fonts ?? [])].some((f: FontFace) => f.family.replace(/^["']|["']$/g, "") === webFont)) fontList.push([prefs.font, webFont]);
  // 记着的字体已经不在列表里（网页版刷新后导入的字体没了）：按默认字体显示，和下拉框一致
  const font = fontList.some(([v]) => v === prefs.font) ? prefs.font : EDITOR_DEFAULT.font;
  const set = (p: Partial<EditorPrefs>) => setPrefs({ ...prefs, ...p });

  return (
    <section id="write" className={"view" + (focus ? " focus-on" : "")}>
      <div className="grid3">
        <nav className="panel toc" aria-label="目录">
          <h3>目录</h3>
          <input className="toc-q" value={tocQ} placeholder="搜章名或章号，回车跳过去" aria-label="搜索章节" onChange={(e) => setTocQ(e.target.value)} onKeyDown={(e) => {
            if (e.key === "Enter" && tocHits[0]) {
              openChapter(tocHits[0].ch.id);
              setTocQ("");
            }
          }} />
          <ul>
            {vols.map((v, vi) => {
              const list = chs.filter((r) => r.v === vi && (!tocQ.trim() || tocHits.includes(r)));
              if (tocQ.trim() && !list.length) return null;
              const shut = !tocQ.trim() && !!fold[v.id] && v.chapters.every((c) => c.id !== cur.ch.id);
              return (
                <li key={v.id} style={{ display: "contents" }}>
                  <div className="vol-t">
                    <button type="button" className="fold" aria-expanded={!shut} title={shut ? "展开这一卷" : "收起这一卷"} onClick={() => setFold({ ...fold, [v.id]: fold[v.id] ? 0 : 1 })}>
                      {shut ? "▸" : "▾"} {v.title}
                      {shut && <small> · {v.chapters.length} 章</small>}
                    </button>
                    <button className="x" type="button" title="在这一卷末尾加一章" onClick={() => addChapter(vi)}>
                      ＋
                    </button>
                  </div>
                  {!shut &&
                    list.map((r) => (
                      <button
                        key={r.ch.id}
                        type="button"
                        className={"toc-i" + (r.ch.id === cur.ch.id ? " cur" : "")}
                        onClick={() => openChapter(r.ch.id)}
                        onContextMenu={(e) => {
                          // 按住 Shift 右键还是系统菜单
                          if (e.shiftKey) return;
                          e.preventDefault();
                          setTocMenu({ x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 80), id: r.ch.id });
                        }}
                      >
                        <span>
                          第{r.no}章 {r.ch.title}
                        </span>
                        <small>{words[r.ch.id] ? (words[r.ch.id] < 1000 ? words[r.ch.id] : (words[r.ch.id] / 1000).toFixed(1) + "k") : r.ch.status === "大纲" ? "纲" : ""}</small>
                      </button>
                    ))}
                </li>
              );
            })}
          </ul>
          <div className="addrow">
            <button className="btn" type="button" onClick={() => addChapter()}>
              在当前章后加一章
            </button>
          </div>
          {tocMenu && (
            <TocMenu
              at={tocMenu}
              close={() => setTocMenu(null)}
              add={() => {
                setTocMenu(null);
                addChapter(undefined, tocMenu.id);
              }}
            />
          )}
        </nav>

        <div className="stack">
          {!focus && (
            <Guide
              id="write"
              title="写作页怎么用"
              steps={[
                "直接在纸上写，自动保存。左边是目录，右边是本章大纲、出场人物和 AI 面板。",
                "卡住了按 Ctrl+Enter（或点「接下来怎么写」），AI 给三个接下来的写法，选一个插进去。",
                "选中一段文字后点右键，可以让 AI 续写、扩写、改写、润色或改对白口吻。菜单顶上可以写一句要求（比如节奏放慢、多写心理），不写就按前文和大纲来。结果先出现在右边，确认后才写进正文。",
                "本章写了大纲（拆不拆场景都行）时，可以点「按大纲生成草稿」先铺一版，再自己改。",
                "浅黄底是 AI 写的字；每章都有「历史」，误删了能找回。",
              ]}
            />
          )}
          <div className="toolbar" role="toolbar" aria-label="排版">
            <label className="hide-focus">
              字体
              <select value={prefs.font} onChange={(e) => set({ font: e.target.value })}>
                {fontList.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn hide-focus"
              type="button"
              onClick={async () => {
                try {
                  const f = await importFont();
                  if (f) {
                    set({ fonts: [...prefs.fonts.filter((x) => x.name !== f.name), ...(f.path ? [f] : [])], font: `"${f.name}"` });
                    toast("已导入字体：" + f.name);
                  }
                } catch (e: any) {
                  toast("字体导入失败：" + (e?.message || e));
                }
              }}
            >
              导入字体
            </button>
            <label className="hide-focus">
              字号
              <input type="range" min={14} max={26} value={prefs.size} onChange={(e) => set({ size: +e.target.value })} />
            </label>
            <label className="hide-focus">
              行距
              <input type="range" min={1.4} max={2.4} step={0.1} value={prefs.lineHeight} onChange={(e) => set({ lineHeight: +e.target.value })} />
            </label>
            <label className="hide-focus">
              纸色
              <select value={prefs.paper} onChange={(e) => set({ paper: e.target.value as EditorPrefs["paper"] })}>
                <option value="plain">白纸</option>
                <option value="warm">米黄</option>
                <option value="night">夜间</option>
              </select>
            </label>
            <label className="hide-focus">
              <input type="checkbox" checked={prefs.indent} onChange={(e) => set({ indent: e.target.checked })} />
              首行缩进
            </label>
            <span className="sep hide-focus" />
            <button className="btn" type="button" aria-pressed={focus} onClick={() => setFocus(!focus)}>
              {focus ? "退出专注" : "专注模式"}
            </button>
            <button
              className="btn hide-focus"
              type="button"
              aria-pressed={scanOn}
              onClick={() => {
                const v = !scanOn;
                setScanOn(v);
                editor?.view.dispatch(editor.state.tr.setMeta(scanKey, v));
              }}
            >
              {scanOn ? "关闭扫描高亮" : "扫描 AI 腔和限制"}
            </button>
            <button
              className="btn hide-focus lim-badge"
              type="button"
              title="本书的写作限制：AI 在所有任务里遵守，写完自动检查。点这里去设置"
              onClick={() => {
                useStore.setState({ styleTab: "limits" });
                useStore.getState().go("style");
              }}
            >
              限制 {limOn}
            </button>
            <span className="sep hide-focus" />
            <select className="btn hide-focus" value="" aria-label="AI 处理选中的文字" onChange={(e) => e.target.value && selOp(e.target.value)}>
              <option value="">AI 处理选中…</option>
              {Object.keys(T.SEL_OPS).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <button className="btn hide-focus" type="button" onClick={suggest} title="Ctrl+Enter">
              接下来怎么写
            </button>
            <span className="sep hide-focus" />
            <button className="btn hide-focus" type="button" onClick={openHistory} title="本章的历史版本">
              历史
            </button>
            <button className="btn hide-focus" type="button" onClick={() => saveVersion("手动存档")} title="Ctrl+S：立刻保存，并在历史里留一版">
              存一版
            </button>
            <button className="btn hide-focus" type="button" onClick={copyPublish} title="首行两个全角空格、段间空行，去掉 AI 标记">
              复制发文格式
            </button>
            <button className="btn hide-focus" type="button" onClick={() => setPanel({ kind: "export" })} title="导出 Word / TXT">
              导出
            </button>
            <button className="btn hide-focus" type="button" onClick={() => setPanel({ kind: "find", replace: false })} title="Ctrl+F 查找，Ctrl+H 替换">
              查找
            </button>
            <button className="btn hide-focus" type="button" onClick={() => setPanel({ kind: "keys" })} title="Ctrl+/">
              快捷键
            </button>
          </div>

          <article className={"sheet" + (prefs.paper === "warm" ? " paper-warm" : prefs.paper === "night" ? " paper-night" : "")}>
            <div className="chap-title-row">
              <span className="chap-no">第{cur.no}章</span>
              <input className="chap-title" value={cur.ch.title} placeholder="章名" aria-label="章名" onChange={(e) => edit("vols", (d) => void (d[cur.v].chapters[cur.c].title = e.target.value))} />
              <select
                className="btn"
                value={cur.ch.status}
                aria-label="状态"
                onChange={(e) => {
                  const v = e.target.value as any;
                  edit("vols", (d) => void (d[cur.v].chapters[cur.c].status = v));
                  // 标成「已写」：存完马上归档
                  if (v === "已写") {
                    const id = cur.ch.id;
                    flushNow()
                      .then(() => arc.check(id))
                      .catch(() => {});
                  }
                }}
              >
                <option>大纲</option>
                <option>写作中</option>
                <option>已写</option>
              </select>
              <ArchiveBtn id={cur.ch.id} flush={flushNow} />
            </div>
            <div className="chap-meta">
              {cur.ch.scenes.length} 个场景{cur.ch.pl ? " · " + phaseName(plan, cur.ch.pl) : ""} · 本章 {chWords} 字
            </div>
            <div
              id="editor"
              className={prefs.aiMark ? undefined : "ai-off"}
              style={{ fontFamily: font, fontSize: prefs.size, lineHeight: prefs.lineHeight, ["--indent" as any]: prefs.indent ? "2em" : "0" }}
              onContextMenu={(e) => {
                // 按住 Shift 右键还是系统菜单
                if (e.shiftKey || !editor) return;
                e.preventDefault();
                setMenu({ x: Math.min(e.clientX, window.innerWidth - 260), y: Math.min(e.clientY, window.innerHeight - 380), sel: !editor.state.selection.empty });
              }}
            >
              <EditorContent editor={editor} />
            </div>
            {menu && (
              <SelMenu
                at={menu}
                close={() => {
                  setMenu(null);
                  // 关掉菜单后把焦点和原来的选区还给正文
                  editor?.commands.focus(null, { scrollIntoView: false });
                }}
                run={(op, note, skip, len) => {
                  setMenu(null);
                  if (len) setContLen(len);
                  selOp(op, note, undefined, skip, len ?? contLen);
                }}
                len={contLen}
                limits={limits}
                ban={() => {
                  setMenu(null);
                  if (!editor) return;
                  const { from, to } = editor.state.selection;
                  const t = editor.state.doc.textBetween(from, to, "\n").trim();
                  if (t) setBan(t);
                }}
                next={() => {
                  setMenu(null);
                  suggest();
                }}
                copy={async (cut) => {
                  setMenu(null);
                  if (!editor) return;
                  const { from, to } = editor.state.selection;
                  try {
                    await navigator.clipboard.writeText(editor.state.doc.textBetween(from, to, "\n"));
                    if (cut) editor.chain().focus().deleteSelection().run();
                    else editor.commands.focus();
                  } catch {
                    toast("复制失败，可以用 Ctrl+C");
                  }
                }}
              />
            )}
          </article>
          {ban !== null && (
            <BanModal
              sel={ban}
              limits={limits}
              close={() => setBan(null)}
              save={(v, msg) => {
                setLimits(v);
                setBan(null);
                if (!scanOn) {
                  setScanOn(true);
                  editor?.view.dispatch(editor.state.tr.setMeta(scanKey, true));
                }
                toast(msg + "。正文里同样的写法已标出");
              }}
            />
          )}

          <div className="status" aria-live="polite">
            <SaveState saving={saving + (dirty ? 1 : 0)} savedAt={savedAt} err={saveErr} retry={() => useStore.getState().flushSaves()} />
            <span>
              本章 <b>{chWords}</b> 字
            </span>
            <span>
              全书 <b>{total.toLocaleString()}</b> 字
            </span>
            <span className="goal">
              今日 <b>{Math.max(0, todayWords)}</b> / {work.goal}
              {(todayExtra.pasted > 0 || todayExtra.ai > 0) && (
                <small title="今天粘贴进来的字数和 AI 写进正文的字数（全书合计），已经算在今日字数里">
                  （今天粘贴 {todayExtra.pasted} 字、AI 写入 {todayExtra.ai} 字）
                </small>
              )}
              <i>
                <span style={{ width: Math.min(100, (Math.max(0, todayWords) / Math.max(1, work.goal)) * 100) + "%" }} />
              </i>
            </span>
            <span title="本章正文里浅黄底（AI 原样）和虚线（AI 写后你改过）的字，占本章字数的比例。润色只算真正改动的字。">
              本章 AI 占比 <b>{chWords ? Math.min(100, Math.round((aiTotal / chWords) * 100)) : 0}%</b>
              {ai[1] ? `（其中 ${Math.min(100, Math.round((ai[1] / Math.max(1, chWords)) * 100))}% 你改过）` : ""}
            </span>
            <label className="ai-mark-tg" title="关掉只是不显示浅黄底和虚线，AI 写的字照样记录，AI 占比照常计算">
              <input type="checkbox" checked={prefs.aiMark} onChange={(e) => set({ aiMark: e.target.checked })} /> 显示 AI 标记
            </label>
          </div>
        </div>

        <aside className="stack side">
          {panel.kind === "hist" ? (
            <HistoryPanel
              panel={panel}
              current={plain}
              close={() => setPanel({ kind: "none" })}
              pick={async (id) => setPanel({ ...panel, sel: await repo.getVersion(id) })}
              restore={restoreVersion}
            />
          ) : panel.kind === "find" ? (
            <FindPanel
              editor={editor}
              workId={work.id}
              curId={cur.ch.id}
              chs={chs}
              replace={panel.replace}
              open={openChapter}
              close={() => setPanel({ kind: "none" })}
              refreshWords={() => repo.allTexts(work.id).then((ts) => setWords(Object.fromEntries(ts.map((t) => [t.id, t.words]))))}
              addToday={addToday}
            />
          ) : panel.kind === "keys" ? (
            <KeysPanel close={() => setPanel({ kind: "none" })} />
          ) : panel.kind === "export" ? (
            <div className="panel-wrap">
              <ExportPanel />
              <button className="btn" type="button" onClick={() => setPanel({ kind: "none" })}>
                收起导出
              </button>
            </div>
          ) : (
            <AiPanel panel={panel} setPanel={setPanel} insertInline={insertInline} applySel={applySel} applyFill={applyFill} addChange={addChange} stop={() => abort.current?.abort()} redoSel={(note, skip) => {
              if (panel.kind !== "sel" || !editor) return;
              // 按原文现在的位置重新生成；原文已被改动就让作者重新选
              const r = aiRangeNow(editor.state);
              if (!r) return void toast("原来选中的文字已经改动了，请重新选中再生成");
              selOp(panel.op, note, { ...r, noSel: panel.noSel }, skip, panel.len ?? contLen);
            }} limits={limits} scanOpts={scanOpts} fix={fixPanel} checkLim={async (text) => (cur ? T.checkLimits(ctx(), cur, splitLimitNote(text).body) : [])} />
          )}

          <div className="panel">
            <h3 className="h3-act">
              <span>本章大纲</span>
              <button
                className="btn sm"
                type="button"
                title="到大纲页，直接定位到这一章"
                onClick={() => {
                  useStore.setState({ chapterId: cur.ch.id });
                  useStore.getState().go("outline");
                }}
              >
                在大纲中编辑
              </button>
            </h3>
            {olText(cur.ch) && <OlView ch={cur.ch} />}
            {cur.ch.scenes.length ? (
              <ol className="scene-list">
                {cur.ch.scenes.map((s) => (
                  <li key={s.id}>
                    <b>{s.t}</b>
                    {s.goal && <p>目标：{s.goal}</p>}
                    {s.conf && <p>冲突：{s.conf}</p>}
                    {(s.plant || s.pay) && (
                      <p>
                        {s.plant && <span className="ty plant">埋 {s.plant}</span>} {s.pay && <span className="ty pay">收 {s.pay}</span>}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>{olText(cur.ch) ? "这一章还没拆场景，生成草稿会按上面的本章大纲整章写。想分场景写，到「大纲」页拆场景。" : "这一章还没有场景。到「大纲」页拆场景后，这里会列出来。"}</Empty>
            )}
            <label className="fill-len">
              这次写约
              <input
                type="number"
                min={100}
                step={100}
                value={fillWords}
                placeholder={String(fillDefault)}
                aria-label="这次生成多少字，空着用默认值"
                onChange={(e) => setFillWords(e.target.value)}
              />
              字
              <small>{chWords ? `本章已写 ${chWords} 字，接着写` : cur.ch.scenes.length ? "按场景预估字数分配" : "默认是「风格与限制」里的每章字数"}</small>
            </label>
            <div className="addrow">
              <button className="btn primary" type="button" onClick={fill} disabled={!cur.ch.scenes.length && !olText(cur.ch)}>
                按大纲生成草稿
              </button>
              <button className="btn" type="button" onClick={check} title="人物、设定、时间线、前文、伏笔、禁用清单">
                一致性检查
              </button>
            </div>
          </div>

          <div className="panel">
            <h3>出场人物</h3>
            {people.length ? (
              people.map((c) => (
                <div className="char" key={c.id}>
                  <b>{c.name}</b> <span className="chip">{c.role}</span>
                  {[c.f.tag, c.f.look, c.f.voice].filter(Boolean).map((x, i) => (
                    <p key={i}>{x}</p>
                  ))}
                </div>
              ))
            ) : (
              <Empty>正文、本章大纲或场景里提到的人物会出现在这里。</Empty>
            )}
            {open.length > 0 && (
              <>
                <h3 style={{ marginTop: 12 }}>还没收的伏笔</h3>
                <ul className="scan-list">
                  {open.slice(0, 8).map((p) => (
                    <li key={p.name}>
                      <span>{p.name}</span>
                      <span>第{p.plantNo}章埋</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="panel">
            <h3>句子节奏</h3>
            <div id="rhythm" aria-label="最近 80 句的长度">
              {rhythm.map((n, i) => (
                <i key={i} style={{ height: (n / maxR) * 100 + "%" }} title={n + " 字"} />
              ))}
            </div>
            <div className="legend">柱子越高句子越长。连续一样高说明节奏单调。</div>
            {scanOn && (
              <ul className="scan-list">
                {scanRows.length ? scanRows.map((r) => (
                  <li key={r.label}>
                    <span>{r.label}</span>
                    <span>{r.n} 处</span>
                  </li>
                )) : <li className="empty">没有发现常见套话。</li>}
                {limStats.filter((r) => r.n > 0).map((r) => (
                  <li key={r.limit.id} title={r.words.join("、") + (r.exempt ? `；人物例外 ${r.exempt} 处没算` : "") + (r.unsure ? `；${r.unsure} 处认不出是谁说的` : "")}>
                    <span>限制：{r.limit.text}</span>
                    <span style={r.over ? undefined : { color: "var(--muted)" }}>
                      {r.n} 处{r.limit.level === "less" ? ` / 上限 ${r.allowed}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

/** 在原文上改的操作：结果要和原文对照，一字没改要告诉作者 */
const REWRITE_OPS = ["润色", "改写", "换说法", "缩写", "改对白口吻"];

/** 结果和原文一样时，「改得更明显些」带上的要求 */
const STRONGER: Record<string, string> = {
  润色: "上一次一处都没改。这次请主动找出可以更精炼、更顺、更有画面感的句子，至少改几处，但不改变情节、人物动作和对白的意思",
  改对白口吻: "上一次一处都没改。这次请让每句对白更有这个人的口吻，至少改几句",
};

/** 结果和原文的对照：删掉的划线，新加的标绿 */
function SelDiff({ parts, n, open: open0 }: { parts: [number, string][]; n: number; open: boolean }) {
  const [open, setOpen] = useState(open0);
  return (
    <div className="sel-diff">
      <div className="row">
        <span className="legend" style={{ margin: 0 }}>和原文比改了 {n} 处</span>
        <button className="btn sm" type="button" onClick={() => setOpen(!open)}>
          {open ? "收起对照" : "看改了哪里"}
        </button>
      </div>
      {open && (
        <div className="diff-text">
          {parts.map(([op, t], i) => (op < 0 ? <del key={i}>{t}</del> : op > 0 ? <ins key={i}>{t}</ins> : <span key={i}>{t}</span>))}
        </div>
      )}
    </div>
  );
}

function RedoNote({ note, skip: skip0, redo, limits }: { note: string; skip: string[]; redo: (n: string, skip: string[]) => void; limits: WriteLimit[] }) {
  const [v, setV] = useState(note);
  const [skip, setSkip] = useState(skip0);
  return (
    <>
      <div className="addrow" style={{ marginTop: 6 }}>
        <input value={v} placeholder="不满意？写个要求再来一次（可选）" aria-label="重新生成的要求" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && redo(v, skip)} />
        <button className="btn" type="button" onClick={() => redo(v, skip)}>
          重新生成
        </button>
      </div>
      <NoteConflicts note={v} limits={limits} skip={skip} setSkip={setSkip} />
    </>
  );
}

function AiPanel({ panel, setPanel, insertInline, applySel, applyFill, addChange, stop, redoSel, limits, scanOpts, fix, checkLim }: { panel: Panel; setPanel: (p: Panel) => void; insertInline: (t: string) => void; applySel: (m: "replace" | "after") => void; applyFill: (m: "end" | "replace") => void; addChange: (i: T.OocIssue) => void; stop: () => void; redoSel: (note: string, skip: string[]) => void; limits: WriteLimit[]; scanOpts: ScanOpts; fix: (body: string, hits: LimitHit[]) => Promise<void>; checkLim: (text: string) => Promise<T.ContIssue[]> }) {
  if (panel.kind === "none" || panel.kind === "hist" || panel.kind === "find" || panel.kind === "keys" || panel.kind === "export") return null;
  const close = (
    <button className="x" type="button" aria-label="关闭" onClick={() => setPanel({ kind: "none" })}>
      ×
    </button>
  );
  if (panel.kind === "sugg")
    return (
      <div className="panel ai-out">
        <h3>
          <span>接下来怎么写</span>
          {close}
        </h3>
        {panel.loading && <Empty>正在想……</Empty>}
        {panel.err && <p className="lint bad">{panel.err}</p>}
        {panel.opts.map((o, i) => {
          const body = splitLimitNote(o.t).body;
          const r = scanLimits(body, limits, scanOpts);
          return (
            <button key={i} className="opt" type="button" onClick={() => insertInline(body)}>
              {marked(body, r.hits, limits)}
              <small>
                {o.d}
                {r.hits.length > 0 && <span className="chip warn">违反限制：{[...new Set(r.hits.map((h) => h.word))].join("、")}</span>}
              </small>
            </button>
          );
        })}
      </div>
    );
  if (panel.kind === "sel") {
    const body = splitLimitNote(panel.text).body;
    // 润色、改写这类在原文上改的操作：生成完和原文对照，一字没改就直接说
    const ch = panel.done && !panel.err && !panel.noSel && body.trim() && REWRITE_OPS.includes(panel.op) ? changeOf(panel.orig, body) : null;
    return (
      <div className="panel ai-out">
        <h3>
          <span>AI {panel.op}{panel.done ? " · 已生成" : " · 生成中"}</span>
          {close}
        </h3>
        <AiResult text={panel.text} done={panel.done && !panel.err} limits={limits} opts={scanOpts} skip={panel.skip} empty={panel.done ? "" : "正在写……"} onFix={fix} onExcept={addExcept} />
        {panel.len && <LenMeter text={panel.text} target={panel.len} done={panel.done} />}
        {panel.err && <p className="lint bad">{panel.err}</p>}
        {panel.done && !panel.err && !splitLimitNote(panel.text).body.trim() && <Empty>AI 这次没有写出内容，可以重新生成。</Empty>}
        {ch && ch.same && (
          <div className="sel-same">
            <p>{panel.op === "润色" ? "这段已经很通顺，AI 没找到需要润色的地方，结果和原文一字不差。" : `AI 这次${panel.op}的结果和原文一字不差。`}</p>
            <button className="btn primary" type="button" onClick={() => redoSel([panel.note.trim(), STRONGER[panel.op] ?? `上一次的结果和原文一字不差，这次请真正按要求${panel.op}`].filter(Boolean).join("；"), panel.skip)}>
              改得更明显些
            </button>
          </div>
        )}
        {ch && !ch.same && <SelDiff parts={ch.parts} n={ch.n} open={panel.op === "润色"} />}
        {panel.done && <RedoNote note={panel.note} skip={panel.skip} redo={redoSel} limits={limits} />}
        <div className="addrow">
          {!panel.done && (
            <button className="btn" type="button" onClick={stop}>
              停止
            </button>
          )}
          {panel.done && body.trim() && !ch?.same && (
            <>
              {!panel.noSel && (
                <button className="btn primary" type="button" onClick={() => applySel("replace")}>
                  替换选中
                </button>
              )}
              <button className={panel.noSel ? "btn primary" : "btn"} type="button" onClick={() => applySel("after")}>
                插在后面
              </button>
            </>
          )}
        </div>
      </div>
    );
  }
  if (panel.kind === "fill")
    return (
      <div className="panel ai-out">
        <h3>
          <span>草稿区{panel.scene ? ` · ${panel.done ? "已生成" : "正在写"}「${panel.scene}」` : panel.done ? " · 已生成" : ""}</span>
          {close}
        </h3>
        <AiResult text={panel.text} done={panel.done && !panel.err} limits={limits} opts={scanOpts} empty={panel.done ? "" : "正在组装上下文……"} onFix={fix} onExcept={addExcept} />
        <LenMeter text={panel.text} target={panel.target} done={panel.done} />
        {panel.err && <p className="lint bad">{panel.err}</p>}
        {panel.done && panel.text && limits.some((l) => !l.off) && <LimCheckBtn text={panel.text} run={checkLim} />}
        <div className="addrow">
          {!panel.done && (
            <button className="btn" type="button" onClick={stop}>
              停止
            </button>
          )}
          {panel.done && splitLimitNote(panel.text).body.trim() && (
            <>
              <button className="btn primary" type="button" onClick={() => applyFill("end")}>
                接到正文末尾
              </button>
              {!panel.cont && (
                <button className="btn" type="button" onClick={() => applyFill("replace")}>
                  替换整章
                </button>
              )}
            </>
          )}
        </div>
        <div className="legend">{panel.cont ? "本章已经有正文，这次是接着正文结尾写大纲里还没写到的部分。想整章重写，先清空正文再生成。" : ""}草稿先放在这里，你确认后才进正文。进正文后浅黄底标出，生成后建议点右边的「一致性检查」。</div>
      </div>
    );
  return (
    <div className="panel ai-out">
      <h3>
        <span>一致性检查{panel.loading ? " · 检查中" : ""}</span>
        {close}
      </h3>
      {panel.rule.map((r, i) => (
        <Issue key={"r" + i} lv={r.lv}>
          {r.text}
          {r.quote && <div className="src">原文：{r.quote}</div>}
        </Issue>
      ))}
      {panel.loading && <Empty>规则检查完成，正在检查人物、设定、时间线和前文……</Empty>}
      {panel.err && <p className="lint bad">{panel.err}</p>}
      {panel.ai.map((x, i) => (
        <Issue key={"a" + i} lv={x.lv} actions={x.change ? <AsyncButton onClick={async () => addChange(x)}>这是成长，补一条人设变化</AsyncButton> : undefined}>
          <b>{x.who}</b>（{x.layer}）{x.suggestion}
          {x.quote && <div className="src">原文：{x.quote}</div>}
          {x.setting && (
            <div className="src">
              设定：{x.setting}
              {x.src ? `（${x.src}）` : ""}
            </div>
          )}
        </Issue>
      ))}
      {panel.cont.map((x, i) => (
        <Issue key={"c" + i} lv={x.lv}>
          <b>{x.kind}</b> {x.suggestion}
          {x.quote && <div className="src">原文：{x.quote}</div>}
          {x.conflict && (
            <div className="src">
              冲突：{x.conflict}
              {x.src ? `（${x.src}）` : ""}
            </div>
          )}
        </Issue>
      ))}
      {!panel.loading && !panel.rule.length && !panel.ai.length && !panel.cont.length && !panel.err && <Empty>没有发现矛盾。</Empty>}
    </div>
  );
}

/** 续写时没选中文字：取光标所在段落到光标处；光标在空段落就取上一段 */
function continueRange(doc: import("@tiptap/pm/model").Node, pos: number): { from: number; to: number } | null {
  const $p = doc.resolve(pos);
  if ($p.depth >= 1 && $p.parent.textContent.trim()) return { from: $p.start(), to: pos };
  let found: { from: number; to: number } | null = null;
  doc.nodesBetween(0, Math.max(0, $p.before($p.depth || 1)), (n, at) => {
    if (n.isTextblock && n.textContent.trim()) found = { from: at + 1, to: at + 1 + n.content.size };
    return !n.isTextblock;
  });
  return found;
}

/** 整章草稿生成后，让 AI 再查一遍词表查不出的限制（情节、人物、尺度） */
function LimCheckBtn({ text, run }: { text: string; run: (t: string) => Promise<T.ContIssue[]> }) {
  const [res, setRes] = useState<T.ContIssue[] | null>(null);
  const [err, setErr] = useState("");
  return (
    <div className="lim-check">
      <AsyncButton
        title="词表只能查词。情节走向、人物言行这类要 AI 读一遍，会多一次调用"
        onClick={async () => {
          setErr("");
          try {
            setRes(await run(text));
          } catch (e) {
            setErr(errText(e));
          }
        }}
      >
        让 AI 再查一遍限制（情节、人物）
      </AsyncButton>
      {err && <p className="lint bad">{err}</p>}
      {res && !res.length && <p className="lim-check ok">✓ AI 没发现违反写作限制的情节和言行</p>}
      {res?.map((x, i) => (
        <Issue key={i} lv={x.lv}>
          {x.conflict && <b>{x.conflict} </b>}
          {x.suggestion}
          {x.quote && <div className="src">原文：{x.quote}</div>}
        </Issue>
      ))}
    </div>
  );
}

function TocMenu({ at, close, add }: { at: { x: number; y: number }; close: () => void; add: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 只在页面或正文滚动时关菜单；菜单里的输入框字多了自己会横向/纵向滚动，不能算
    const off = (e: Event) => {
      if (e.type === "scroll" && box.current && e.target instanceof Node && box.current.contains(e.target)) return;
      close();
    };
    window.addEventListener("scroll", off, true);
    window.addEventListener("resize", off);
    return () => {
      window.removeEventListener("scroll", off, true);
      window.removeEventListener("resize", off);
    };
  }, [close]);
  return (
    <>
      <div className="ctx-mask" onMouseDown={(e) => { e.preventDefault(); close(); }} onContextMenu={(e) => { e.preventDefault(); close(); }} />
      <div ref={box} className="ctx-menu" role="menu" aria-label="章节操作" style={{ left: at.x, top: at.y }} onKeyDown={(e) => e.key === "Escape" && close()}>
        <button type="button" role="menuitem" autoFocus onClick={add}>
          在这一章后加一章
        </button>
      </div>
    </>
  );
}

/** 草稿区的字数：已生成多少 / 目标多少；写完差得多时说一声 */
function LenMeter({ text, target, done }: { text: string; target?: number; done: boolean }) {
  if (!target || !text.trim()) return null;
  const n = countWords(splitLimitNote(text).body);
  const short = done && n < target * SHORT_RATIO;
  return (
    <p className={"len-meter" + (short ? " warn" : "")}>
      {done ? "共" : "已生成"} {n.toLocaleString()} 字 / 目标约 {target.toLocaleString()} 字
      {short ? "。补写后仍然偏短，多半是大纲内容不够展开，可以在大纲里多写几个情节" : ""}
    </p>
  );
}

function SelMenu({ at, close, run, copy, next, ban, limits, len: len0 }: { at: { x: number; y: number; sel: boolean }; close: () => void; run: (op: string, note: string, skip: string[], len?: number) => void; copy: (cut: boolean) => void; next: () => void; ban: () => void; limits: WriteLimit[]; len: number }) {
  const [note, setNote] = useState("");
  const [len, setLen] = useState(len0);
  const [skip, setSkip] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 只在页面或正文滚动时关菜单；菜单里的输入框字多了自己会横向/纵向滚动，不能算
    const off = (e: Event) => {
      if (e.type === "scroll" && box.current && e.target instanceof Node && box.current.contains(e.target)) return;
      close();
    };
    window.addEventListener("scroll", off, true);
    window.addEventListener("resize", off);
    return () => {
      window.removeEventListener("scroll", off, true);
      window.removeEventListener("resize", off);
    };
  }, [close]);
  return (
    <>
      <div className="ctx-mask" onMouseDown={(e) => { e.preventDefault(); close(); }} onContextMenu={(e) => { e.preventDefault(); close(); }} />
      <div ref={box} className="ctx-menu" role="menu" aria-label="AI 处理选中的文字" style={{ left: at.x, top: at.y }}>
        <div className="ctx-h">{at.sel ? "AI 处理选中的文字" : "AI 接着写"}</div>
        <textarea
          className="ctx-note"
          rows={1}
          value={note}
          autoFocus
          placeholder="要求（可选）：如 节奏放慢、多写心理、转向冲突"
          aria-label="这一次的要求，可以不填"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") close();
          }}
        />
        <NoteConflicts note={note} limits={limits} skip={skip} setSkip={setSkip} />
        {Object.keys(T.SEL_OPS)
          .filter((k) => at.sel || k === "续写")
          .map((k) => (
            <button key={k} type="button" role="menuitem" title={T.SEL_OPS[k]} onClick={() => run(k, note, skip, k === "续写" ? len : undefined)}>
              {k}
              {k === "续写" && <kbd>约 {len} 字</kbd>}
            </button>
          ))}
        <div className="ctx-len" role="group" aria-label="续写长度">
          续写长度
          {CONT_LENS.map((o) => (
            <button key={o.k} type="button" className={len === o.n ? "on" : ""} aria-pressed={len === o.n} title={`约 ${o.n} 字`} onClick={() => setLen(o.n)}>
              {o.k}
            </button>
          ))}
        </div>
        {!at.sel && (
          <button type="button" role="menuitem" onClick={next}>
            接下来怎么写 <kbd>Ctrl+Enter</kbd>
          </button>
        )}
        {at.sel && (
          <>
            <hr />
            <button type="button" role="menuitem" className="lim-item" title="把选中的字加进写作限制，以后 AI 不这样写，写了会标出来" onClick={ban}>
              以后别这样写…
            </button>
            <button type="button" role="menuitem" onClick={() => copy(false)}>
              复制 <kbd>Ctrl+C</kbd>
            </button>
            <button type="button" role="menuitem" onClick={() => copy(true)}>
              剪切 <kbd>Ctrl+X</kbd>
            </button>
          </>
        )}
        <div className="ctx-f">{at.sel ? "" : "没选中文字时，续写会接着光标所在的这一段写。选中一段可以扩写、改写、润色。"}要求不填，就按前文、大纲和人物设定来写。结果在右边面板里，确认后才写进正文。按住 Shift 右键是系统菜单。</div>
      </div>
    </>
  );
}

function SaveState({ saving, savedAt, err, retry }: { saving: number; savedAt: number; err: string | null; retry: () => void }) {
  if (err)
    return (
      <button type="button" className="save-state bad" onClick={retry} title={err}>
        保存失败，点此重试
      </button>
    );
  if (saving > 0) return <span className="save-state">保存中…</span>;
  if (!savedAt) return <span className="save-state">已保存</span>;
  return <span className="save-state">已保存 {fmtHM(savedAt)}</span>;
}

function HistoryPanel({ panel, current, close, pick, restore }: { panel: Extract<Panel, { kind: "hist" }>; current: string; close: () => void; pick: (id: string) => void; restore: (v: repo.VersionFull) => void }) {
  const sel = panel.sel;
  // 停笔 1 秒后再按最新正文重新对比，不在每次按键时整章 diff
  const [cmp, setCmp] = useState(current);
  useEffect(() => {
    const t = setTimeout(() => setCmp(current), 1000);
    return () => clearTimeout(t);
  }, [current]);
  const parts = useMemo(() => (sel ? diffText(sel.plain ?? "", cmp) : []), [sel, cmp]);
  return (
    <div className="panel ai-out hist">
      <h3>
        <span>本章历史</span>
        <button className="x" type="button" aria-label="关闭" onClick={close}>
          ×
        </button>
      </h3>
      {!panel.list.length && <Empty>还没有快照。写满 10 分钟、字数变化 500 字、AI 改正文前、离开本章时都会自动留一份。</Empty>}
      <ul className="ver-list">
        {panel.list.map((v) => (
          <li key={v.id}>
            <button type="button" className={"opt" + (sel?.id === v.id ? " cur" : "")} onClick={() => pick(v.id)}>
              {fmtTime(v.at)}
              <small>
                {v.words.toLocaleString()} 字 · {v.reason}
              </small>
            </button>
          </li>
        ))}
      </ul>
      {sel && (
        <>
          <div className="legend">和当前正文比：红色删除线是当时有、现在没有的；绿色是现在新加的。</div>
          <div className="ai-text diff">
            {parts.map(([op, t], i) => (op === 0 ? <span key={i}>{t.length > 400 ? t.slice(0, 180) + " …… " + t.slice(-180) : t}</span> : op < 0 ? <del key={i}>{t}</del> : <ins key={i}>{t}</ins>))}
          </div>
          <div className="addrow">
            <button className="btn primary" type="button" onClick={() => restore(sel)}>
              用这一版替换本章
            </button>
            <button
              className="btn"
              type="button"
              onClick={() =>
                navigator.clipboard.writeText(sel.plain ?? "").then(
                  () => toast("已复制这一版的全文，可以只贴回需要的段落"),
                  () => toast("复制失败"),
                )
              }
            >
              复制这一版全文
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const KEYS: [string, string][] = [
  ["Ctrl+Enter", "AI 给三个接下来的写法"],
  ["右键", "AI 续写 / 扩写 / 改写（可以写要求）"],
  ["Alt+↑ / Alt+↓", "上一章 / 下一章"],
  ["Ctrl+Shift+N", "在当前章后新建一章"],
  ["Ctrl+F", "查找（本章或全书）"],
  ["Ctrl+H", "查找替换"],
  ["Ctrl+S", "立刻保存并存一版"],
  ["Ctrl+/", "打开这张快捷键表"],
  ["Esc", "关掉右边的面板和右键菜单"],
  ["Shift+右键", "系统自带的右键菜单"],
];

function KeysPanel({ close }: { close: () => void }) {
  return (
    <div className="panel ai-out">
      <h3>
        <span>快捷键</span>
        <button className="x" type="button" aria-label="关闭" onClick={close}>
          ×
        </button>
      </h3>
      <table className="keys">
        <tbody>
          {KEYS.map(([k, d]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FindPanel({ editor, workId, curId, chs, replace: startReplace, open, close, refreshWords, addToday }: { editor: Editor | null; workId: string; curId: string; chs: { ch: { id: string; title: string }; no: number }[]; replace: boolean; open: (id: string) => void; close: () => void; refreshWords: () => void; addToday: (delta: number) => void }) {
  const [q, setQ] = useState("");
  const [rep, setRep] = useState("");
  const [showRep, setShowRep] = useState(startReplace);
  const [scope, setScope] = useState<"ch" | "book">("ch");
  const [idx, setIdx] = useState(0);
  const [book, setBook] = useState<{ id: string; no: number; title: string; n: number; s: string[] }[] | null>(null);
  const [ver, setVer] = useState(0);
  useEffect(() => setShowRep(startReplace), [startReplace]);
  const hits = useMemo(() => (editor ? findInDoc(editor.state.doc, q) : []), [editor, q, ver, curId]);
  useEffect(() => {
    if (!editor) return;
    // 切章载入新章不发 update，要看 transaction 才知道正文换了
    const f = ({ transaction }: { transaction: { docChanged: boolean } }) => void (transaction.docChanged && setVer((v) => v + 1));
    editor.on("transaction", f);
    return () => void editor.off("transaction", f);
  }, [editor]);
  // 换了一章，从第 1 处重新数
  useEffect(() => setIdx(0), [curId]);
  // 关掉查找面板时收起命中的选中底色
  useEffect(
    () => () => {
      if (editor && !editor.isDestroyed && keepSelKey.getState(editor.state)) editor.view.dispatch(editor.state.tr.setMeta(keepSelKey, false));
    },
    [editor],
  );

  useEffect(() => {
    if (scope !== "book" || !q) return setBook(null);
    let dead = false;
    const t = setTimeout(async () => {
      const texts = new Map((await repo.allTexts(workId)).map((x) => [x.id, x.plain]));
      if (editor) texts.set(curId, editor.getText({ blockSeparator: "\n" }));
      const list = chs
        .map((r) => {
          const p = texts.get(r.ch.id) ?? "";
          return { id: r.ch.id, no: r.no, title: r.ch.title, n: countIn(p, q), s: snippets(p, q, 2) };
        })
        .filter((x) => x.n);
      if (!dead) setBook(list);
    }, 250);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [scope, q, workId, ver, curId, chs.length]);

  function go(i: number, list: Hit[] = hits) {
    if (!editor || !list.length) return;
    const k = ((i % list.length) + list.length) % list.length;
    setIdx(k);
    // 不把焦点交给正文：焦点留在查找框，再按回车还是「下一处」，不会在正文里删字换段。选中底色用 sel-keep 画
    editor
      .chain()
      .setTextSelection(list[k])
      .command(({ tr }) => {
        tr.setMeta(keepSelKey, true);
        return true;
      })
      .scrollIntoView()
      .run();
  }
  function replaceOne() {
    if (!editor || !q) return;
    const { from, to } = editor.state.selection;
    if (editor.state.doc.textBetween(from, to) !== q) return go(idx);
    // 和「本章全部替换」一样按纯文字换，不当成 HTML 解析
    editor
      .chain()
      .command(({ tr }) => {
        if (rep) tr.insertText(rep, from, to);
        else tr.delete(from, to);
        return true;
      })
      .run();
    // 按替换后的正文重新找，直接选中后面的下一处
    const list = findInDoc(editor.state.doc, q);
    const k = list.findIndex((h) => h.from >= from + rep.length);
    if (list.length) go(k < 0 ? 0 : k, list);
    else setIdx(0);
  }
  function replaceChapter(): number {
    if (!editor || !q) return 0;
    const list = findInDoc(editor.state.doc, q);
    if (!list.length) return 0;
    editor
      .chain()
      .command(({ tr }) => {
        for (const h of [...list].reverse()) {
          if (rep) tr.insertText(rep, h.from, h.to);
          else tr.delete(h.from, h.to);
        }
        return true;
      })
      .run();
    return list.length;
  }
  async function replaceBook() {
    if (!q || !book?.length) return;
    const total = book.reduce((a, x) => a + x.n, 0);
    if (!confirm(`把全书 ${book.length} 章里的 ${total} 处「${q}」换成「${rep}」？每章换之前都会先留一份快照，可以在「历史」里找回。`)) return;
    let n = 0;
    let delta = 0;
    for (const r of book) {
      if (r.id === curId) {
        if (editor) await snapshot(workId, curId, snapOf(editor), "全书替换前");
        n += replaceChapter();
        continue;
      }
      const t = await repo.loadText(r.id);
      if (!t) continue;
      const out = replaceInHtml(t.html, q, rep);
      if (!out.n) continue;
      await snapshot(workId, r.id, { html: t.html, plain: t.plain, words: t.words, ai: t.ai_chars }, "全书替换前");
      const plain = htmlToText(out.html);
      delta += await repo.saveText(workId, r.id, out.html, plain, countWords(plain), t.ai_chars);
      arc.noteEdit(r.id);
      n += out.n;
    }
    // 其他章直接写库，字数变化也要算进「今日」
    addToday(delta);
    refreshWords();
    setVer((v) => v + 1);
    toast(`已替换 ${n} 处`);
  }

  return (
    <div className="panel ai-out find">
      <h3>
        <span>{showRep ? "查找替换" : "查找"}</span>
        <button className="x" type="button" aria-label="关闭" onClick={close}>
          ×
        </button>
      </h3>
      <Seg value={scope} onChange={setScope} label="查找范围" options={[["ch", "本章"], ["book", "全书"]]} />
      <input
        autoFocus
        value={q}
        placeholder="要找的字"
        aria-label="查找"
        onChange={(e) => {
          setQ(e.target.value);
          setIdx(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (scope === "ch") go(e.shiftKey ? idx - 1 : hits[idx] && editor?.state.selection.from === hits[idx].from ? idx + 1 : idx);
          }
        }}
      />
      {showRep ? (
        <input value={rep} placeholder="换成（留空就是删掉）" aria-label="替换为" onChange={(e) => setRep(e.target.value)} />
      ) : (
        <button className="btn sm linkish" type="button" onClick={() => setShowRep(true)}>
          还要替换？
        </button>
      )}
      {scope === "ch" ? (
        <>
          <p className="legend">{q ? (hits.length ? `本章 ${hits.length} 处，第 ${Math.min(idx + 1, hits.length)} 处` : "本章没有找到") : "回车跳到下一处，Shift+回车上一处"}</p>
          <div className="addrow">
            <button className="btn" type="button" disabled={!hits.length} onClick={() => go(idx - 1)}>
              上一处
            </button>
            <button className="btn" type="button" disabled={!hits.length} onClick={() => go(editor?.state.selection.from === hits[idx]?.from ? idx + 1 : idx)}>
              下一处
            </button>
            {showRep && (
              <>
                <button className="btn" type="button" disabled={!hits.length} onClick={replaceOne}>
                  替换这处
                </button>
                <button
                  className="btn primary"
                  type="button"
                  disabled={!hits.length}
                  onClick={async () => {
                    if (editor) await snapshot(workId, curId, snapOf(editor), "替换前");
                    toast(`已替换 ${replaceChapter()} 处`);
                  }}
                >
                  本章全部替换
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          {q && !book && <Empty>正在找……</Empty>}
          {book && !book.length && <Empty>全书都没有找到。</Empty>}
          {book && book.length > 0 && (
            <>
              <p className="legend">
                {book.length} 章，共 {book.reduce((a, x) => a + x.n, 0)} 处。点一章跳过去。
              </p>
              <ul className="ver-list">
                {book.map((r) => (
                  <li key={r.id}>
                    <button type="button" className={"opt" + (r.id === curId ? " cur" : "")} onClick={() => open(r.id)}>
                      第{r.no}章 {r.title}（{r.n} 处）
                      {r.s.map((x, i) => (
                        <small key={i}>{x}</small>
                      ))}
                    </button>
                  </li>
                ))}
              </ul>
              {showRep && (
                <div className="addrow">
                  <button className="btn primary" type="button" onClick={replaceBook}>
                    全书全部替换
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** 「归档本章」：马上让 AI 给这一章做摘要和章末状态 */
function ArchiveBtn({ id, flush }: { id: string; flush: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(arc.busy.has(id));
  useEffect(() => {
    setBusy(arc.busy.has(id));
    return arc.onChange(() => setBusy(arc.busy.has(id)));
  }, [id]);
  return (
    <AsyncButton
      title="让 AI 给这一章写摘要、记下章末每个人物的状态。平时写完、改完会自动做，这里可以马上做一次"
      disabled={busy}
      onClick={async () => {
        try {
          await flush();
          const r = await arc.check(id, { force: true });
          toast(r === "same" ? "这一章自上次归档后没有改动" : r === "none" ? "这一章还没有正文" : "本章已归档");
        } catch (e) {
          toast(errText(e));
        }
      }}
    >
      {busy ? "归档中…" : "归档本章"}
    </AsyncButton>
  );
}
