import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { AiEdit, AiText, AiTracker, AI_META, aiChars } from "../components/aiMarks";
import { ScanHighlight, scanKey, setBanWords } from "../components/scanDeco";
import { KeepCaret } from "../components/keepCaret";
import { SelectionUi, keepSelKey } from "../components/selectionUi";
import { Guide } from "../components/Guide";
import { useStore, toast, registerFlush } from "../lib/store";
import { persistChapter, readDraft, clearDraft, snapshot, shrinkToast, writeDraft, type Snap } from "../lib/chapterSave";
import { diffText } from "../lib/diff";
import { loadInto, publishText, setDoc } from "../lib/editorText";
import * as repo from "../lib/repo";
import { allChapters, findChapter, newChapter, plants } from "../lib/outline";
import { countWords, debounce, fmtHM, fmtTime, htmlToText, today, uid } from "../lib/util";
import { scan, sentenceLengths, parseBans } from "../lib/aiscan";
import { EDITOR_DEFAULT, useSetting, type EditorPrefs } from "../lib/hooks";
import { importFont, loadSavedFonts, SYSTEM_FONTS } from "../lib/fonts";
import { ruleCheck } from "../lib/chars";
import { Issue, AsyncButton, Empty, Seg } from "../components/ui";
import { countIn, findInDoc, replaceInHtml, snippets } from "../lib/findReplace";
import { ExportPanel } from "./DataPanels";
import * as T from "../lib/ai/tasks";
import { errText } from "../lib/ai/client";
import type { Ctx } from "../lib/ai/context";
import { phaseName } from "../lib/plan";
import * as arc from "../lib/ai/archive";

function ctx(): Ctx {
  const s = useStore.getState();
  return { work: s.work!, vols: s.vols, chars: s.chars, events: s.events, plan: s.plan, style: s.style, calls: s.calls, changesets: s.changesets };
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
  | { kind: "sel"; op: string; from: number; to: number; text: string; done: boolean; err?: string; note: string }
  | { kind: "fill"; scene: string; text: string; done: boolean; err?: string }
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
  /** 选中文字后右键弹出的 AI 菜单 */
  const [menu, setMenu] = useState<{ x: number; y: number; sel: boolean } | null>(null);
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
  const abort = useRef<AbortController | null>(null);
  const loadedFor = useRef<string | null>(null);

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

  useEffect(() => {
    if (prefsReady) loadSavedFonts(prefs.fonts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsReady]);

  // 全书字数
  useEffect(() => {
    repo.allTexts(work.id).then((ts) => setWords(Object.fromEntries(ts.map((t) => [t.id, t.words]))));
    repo.dailyWords(work.id, 1).then((d) => {
      const t = d.find((x) => x.day === today());
      setTodayWords(t?.words ?? 0);
      setTodayExtra({ pasted: t?.pasted ?? 0, ai: t?.ai ?? 0 });
    });
  }, [work.id]);

  const bans = useMemo(() => parseBans(style.bans).words, [style.bans]);
  useEffect(() => setBanWords(bans), [bans]);

  const extra = (kind: "pasted" | "ai", n: number) => {
    if (!n) return;
    setTodayExtra((x) => ({ ...x, [kind]: x[kind] + n }));
    repo.addDailyExtra(work.id, kind, n).catch(() => {});
  };

  /** 立刻存一份（编辑器内容先同步取出，之后切章也不会串） */
  const saveNow = async (id: string, snap: Snap) => {
    try {
      const r = await persistChapter(work.id, id, snap);
      arc.noteEdit(id);
      setWords((m) => ({ ...m, [id]: snap.words }));
      if (r.delta) setTodayWords((x) => x + r.delta);
      if (r.shrunk) shrinkToast(r.shrunk);
    } catch {
      /* 已经留了本机草稿，状态栏会显示失败并自动重试 */
    }
  };
  const save = useMemo(() => debounce((id: string, ed: Editor) => saveNow(id, snapOf(ed)), 700), [work.id]);

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, codeBlock: false, code: false, horizontalRule: false }), Placeholder.configure({ placeholder: "从这里开始写。Ctrl+Enter 让 AI 给三个接下来的写法。" }), AiText, AiEdit, AiTracker, ScanHighlight, KeepCaret, SelectionUi],
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
      // 有字了，「大纲」状态自动变「写作中」
      const st = useStore.getState();
      const at = findChapter(st.vols, loadedFor.current);
      if (at && at.ch.status === "大纲" && ed.getText().trim().length >= 20) st.edit("vols", (d) => void (d[at.v].chapters[at.c].status = "写作中"));
    },
  });

  // 切换章节：先存上一章，再加载
  useEffect(() => {
    if (!editor || !cur) return;
    const id = cur.ch.id;
    if (loadedFor.current === id) return;
    const prev = loadedFor.current;
    if (prev) {
      const snap = snapOf(editor);
      const p = save.pending() ? save.flush(prev, editor) : Promise.resolve();
      p.then(() => snapshot(work.id, prev, snap, "离开本章"))
        .catch(() => {})
        // 离开这一章：不等 2 分钟，马上看要不要归档
        .then(() => arc.check(prev))
        .catch(() => {});
    }
    loadedFor.current = null;
    repo.loadText(id).then((t) => {
      const draft = readDraft(id);
      const useDraft = !!draft && draft.at > (t?.updated ?? 0) && draft.html !== t?.html && confirm(`这一章有一份没来得及存进数据库的草稿（${fmtTime(draft.at)}，${draft.words} 字）。要恢复它吗？\n选「取消」会丢掉草稿，保留库里的版本。`);
      if (draft && !useDraft) clearDraft(id);
      loadInto(editor, useDraft ? draft!.html : t?.html || "");
      loadedFor.current = id;
      if (useDraft) saveNow(id, snapOf(editor));
      setPlain(editor.getText({ blockSeparator: "\n" }));
      setAi(aiChars(editor.state.doc));
      setPanel((p) => (p.kind === "find" || p.kind === "keys" || p.kind === "export" ? p : { kind: "none" }));
    });
  }, [editor, cur?.ch.id]);

  useEffect(() => () => {
    if (editor && loadedFor.current && save.pending()) save.flush(loadedFor.current, editor);
  }, [editor]);

  // 关窗那一瞬间来不及写库：先同步留一份本机草稿，下次打开会提示恢复
  useEffect(() => {
    const f = () => {
      if (editor && loadedFor.current && save.pending()) writeDraft(loadedFor.current, snapOf(editor));
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [editor, save]);

  // 关窗、切书时由 store 统一冲刷正文
  useEffect(
    () =>
      registerFlush(() => {
        if (editor && loadedFor.current && save.pending()) return save.flush(loadedFor.current, editor);
      }),
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
      if (e.key === "Enter" && mod) {
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

  function addChapter(vi?: number) {
    const c = newChapter("");
    edit("vols", (d) => {
      if (!d.length) d.push({ id: uid("v"), title: "第一卷", chapters: [] });
      const v = vi ?? (cur ? cur.v : d.length - 1);
      d[v].chapters.splice(cur && vi == null ? cur.c + 1 : d[v].chapters.length, 0, c);
    });
    openChapter(c.id);
  }

  function before(): string {
    if (!editor) return "";
    const { from } = editor.state.selection;
    return editor.state.doc.textBetween(0, from, "\n");
  }

  async function suggest() {
    if (!editor || !cur) return;
    setPanel({ kind: "sugg", loading: true, opts: [] });
    try {
      const opts = await T.suggestNext(ctx(), cur, before());
      setPanel({ kind: "sugg", loading: false, opts });
    } catch (e) {
      setPanel({ kind: "sugg", loading: false, opts: [], err: errText(e) });
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

  function insertInline(text: string) {
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

  async function selOp(op: string, note = "", range?: { from: number; to: number }) {
    if (!editor || !cur) return;
    let { from, to } = range ?? editor.state.selection;
    // 续写不用先选中：取光标所在的这一段（光标在空行就取上一段）
    if (!range && from === to && op === "续写") {
      const p = continueRange(editor.state.doc, from);
      if (p) ({ from, to } = p);
    }
    const sel = editor.state.doc.textBetween(from, to, "\n");
    if (!sel.trim()) {
      toast(op === "续写" ? "正文还是空的，先写几句" : "先在正文里选中一段");
      return;
    }
    abort.current?.abort();
    abort.current = new AbortController();
    setPanel({ kind: "sel", op, from, to, text: "", done: false, note });
    try {
      await T.selectionOp(ctx(), cur, op, sel, editor.state.doc.textBetween(0, from, "\n"), (d) => setPanel((p) => (p.kind === "sel" ? { ...p, text: p.text + d } : p)), abort.current.signal, note);
      setPanel((p) => (p.kind === "sel" ? { ...p, done: true } : p));
    } catch (e) {
      setPanel((p) => (p.kind === "sel" ? { ...p, done: true, err: errText(e) } : p));
    }
  }

  function applySel(mode: "replace" | "after") {
    if (panel.kind !== "sel" || !editor) return;
    beforeAi();
    // 替换时按改动算：只改了几个词，就只有这几个词算 AI
    const orig = editor.state.doc.textBetween(panel.from, panel.to, "\n");
    const d = mode === "replace" ? diffParas(orig, panel.text) : null;
    extra("ai", d ? d.added : countWords(panel.text));
    const content = d ? d.content : aiParas(panel.text);
    const chain = editor.chain().focus().command(({ tr }) => {
      tr.setMeta(AI_META, true);
      return true;
    });
    if (mode === "replace") {
      // 选中的是整段就整段换掉；选中段落中间的一截、AI 只回了一段，就原地换文字，不再多出空段
      const doc = editor.state.doc;
      let { from, to } = panel;
      const $f = doc.resolve(from);
      const $t = doc.resolve(to);
      const whole = $f.parentOffset === 0 && $t.parentOffset === $t.parent.content.size;
      if (content.length === 1 && !whole) chain.insertContentAt({ from, to }, content[0].content).run();
      else {
        if ($f.parentOffset === 0 && $f.depth > 0) from = $f.before($f.depth);
        if ($t.parentOffset === $t.parent.content.size && $t.depth > 0) to = $t.after($t.depth);
        chain.insertContentAt({ from, to }, content).run();
      }
    } else chain.insertContentAt(editor.state.doc.resolve(panel.to).after(1), content).run();
    setPanel({ kind: "none" });
  }

  async function fill() {
    if (!editor || !cur) return;
    if (!cur.ch.scenes.length) {
      toast("这一章还没有场景大纲，先到大纲页拆场景");
      return;
    }
    abort.current?.abort();
    abort.current = new AbortController();
    setPanel({ kind: "fill", scene: "", text: "", done: false });
    try {
      await T.fillChapter(ctx(), cur, (_i, t) => setPanel((p) => (p.kind === "fill" ? { ...p, scene: t } : p)), (d) => setPanel((p) => (p.kind === "fill" ? { ...p, text: p.text + d } : p)), abort.current.signal);
      setPanel((p) => (p.kind === "fill" ? { ...p, done: true } : p));
    } catch (e) {
      setPanel((p) => (p.kind === "fill" ? { ...p, done: true, err: errText(e) } : p));
    }
  }

  function applyFill(mode: "end" | "replace") {
    if (panel.kind !== "fill" || !editor) return;
    beforeAi();
    extra("ai", countWords(panel.text));
    const content = aiParas(panel.text);
    const chain = editor.chain().focus().command(({ tr }) => {
      tr.setMeta(AI_META, true);
      return true;
    });
    if (mode === "replace") chain.setContent(content as any, true).run();
    else chain.insertContentAt(editor.state.doc.content.size, content).run();
    setPanel({ kind: "none" });
    toast("草稿已进正文，浅黄底的都是 AI 写的");
  }

  async function check() {
    if (!cur) return;
    const rule = ruleCheck(plain, chars, calls, vols, cur.no);
    setPanel({ kind: "check", loading: true, rule, ai: [], cont: [] });
    const [a, b] = await Promise.allSettled([T.checkCharacters(ctx(), cur, plain), T.checkContinuity(ctx(), cur, plain)]);
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
  const scanRows = scanOn ? scan(plain, bans) : [];
  const rhythm = sentenceLengths(plain).slice(-80);
  const maxR = Math.max(10, ...rhythm);
  const people = chars.filter((c) => c.name && (plain.includes(c.name) || cur.ch.scenes.some((s) => s.who.includes(c.name))));
  const open = plants(vols, events).filter((p) => p.plantNo && !p.payNo && p.plantNo <= cur.no);
  const aiTotal = ai[0] + ai[1];
  const fontList = [...SYSTEM_FONTS, ...prefs.fonts.map((f) => [`"${f.name}"`, f.name] as [string, string])];
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
                      <button key={r.ch.id} type="button" className={"toc-i" + (r.ch.id === cur.ch.id ? " cur" : "")} onClick={() => openChapter(r.ch.id)}>
                        <span>
                          第{r.no}章 {r.ch.title}
                        </span>
                        <small>{words[r.ch.id] ? (words[r.ch.id] / 1000).toFixed(1) + "k" : r.ch.status === "大纲" ? "纲" : ""}</small>
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
                "本章已经有场景大纲时，可以点「按大纲生成草稿」先铺一版，再自己改。",
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
              {scanOn ? "关闭套话高亮" : "扫描 AI 腔"}
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
                    (save.pending() && editor ? save.flush(id, editor) : Promise.resolve()).then(() => arc.check(id)).catch(() => {});
                  }
                }}
              >
                <option>大纲</option>
                <option>写作中</option>
                <option>已写</option>
              </select>
              <ArchiveBtn id={cur.ch.id} flush={() => (save.pending() && editor ? save.flush(cur.ch.id, editor) : Promise.resolve())} />
            </div>
            <div className="chap-meta">
              {cur.ch.scenes.length} 个场景{cur.ch.pl ? " · " + phaseName(plan, cur.ch.pl) : ""} · 本章 {chWords} 字
            </div>
            <div
              id="editor"
              className={prefs.aiMark ? undefined : "ai-off"}
              style={{ fontFamily: prefs.font, fontSize: prefs.size, lineHeight: prefs.lineHeight, ["--indent" as any]: prefs.indent ? "2em" : "0" }}
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
                run={(op, note) => {
                  setMenu(null);
                  selOp(op, note);
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

          <div className="status" aria-live="polite">
            <SaveState saving={saving} savedAt={savedAt} err={saveErr} retry={() => useStore.getState().flushSaves()} />
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
              本章 AI 占比 <b>{chWords ? Math.round((aiTotal / chWords) * 100) : 0}%</b>
              {ai[1] ? `（其中 ${Math.round((ai[1] / Math.max(1, chWords)) * 100)}% 你改过）` : ""}
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
            <AiPanel panel={panel} setPanel={setPanel} insertInline={insertInline} applySel={applySel} applyFill={applyFill} addChange={addChange} stop={() => abort.current?.abort()} redoSel={(note) => panel.kind === "sel" && selOp(panel.op, note, { from: panel.from, to: panel.to })} />
          )}

          <div className="panel">
            <h3>本章大纲</h3>
            {cur.ch.ol?.trim() && <p className="ch-ol">{cur.ch.ol}</p>}
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
              <Empty>这一章还没有场景。到「大纲」页拆场景后，这里会列出来。</Empty>
            )}
            <div className="addrow">
              <button className="btn primary" type="button" onClick={fill} disabled={!cur.ch.scenes.length}>
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
              <Empty>正文或场景里提到的人物会出现在这里。</Empty>
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
              </ul>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function RedoNote({ note, redo }: { note: string; redo: (n: string) => void }) {
  const [v, setV] = useState(note);
  return (
    <div className="addrow" style={{ marginTop: 6 }}>
      <input value={v} placeholder="不满意？写个要求再来一次（可选）" aria-label="重新生成的要求" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && redo(v)} />
      <button className="btn" type="button" onClick={() => redo(v)}>
        重新生成
      </button>
    </div>
  );
}

function AiPanel({ panel, setPanel, insertInline, applySel, applyFill, addChange, stop, redoSel }: { panel: Panel; setPanel: (p: Panel) => void; insertInline: (t: string) => void; applySel: (m: "replace" | "after") => void; applyFill: (m: "end" | "replace") => void; addChange: (i: T.OocIssue) => void; stop: () => void; redoSel: (note: string) => void }) {
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
        {panel.opts.map((o, i) => (
          <button key={i} className="opt" type="button" onClick={() => insertInline(o.t)}>
            {o.t}
            <small>{o.d}</small>
          </button>
        ))}
      </div>
    );
  if (panel.kind === "sel")
    return (
      <div className="panel ai-out">
        <h3>
          <span>AI {panel.op}{panel.done ? " · 已生成" : " · 生成中"}</span>
          {close}
        </h3>
        <div className="ai-text">{panel.text || (panel.done ? "" : "正在写……")}</div>
        {panel.err && <p className="lint bad">{panel.err}</p>}
        {panel.done && <RedoNote note={panel.note} redo={(n) => redoSel(n)} />}
        <div className="addrow">
          {!panel.done && (
            <button className="btn" type="button" onClick={stop}>
              停止
            </button>
          )}
          {panel.done && panel.text && (
            <>
              <button className="btn primary" type="button" onClick={() => applySel("replace")}>
                替换选中
              </button>
              <button className="btn" type="button" onClick={() => applySel("after")}>
                插在后面
              </button>
            </>
          )}
        </div>
      </div>
    );
  if (panel.kind === "fill")
    return (
      <div className="panel ai-out">
        <h3>
          <span>草稿区{panel.scene ? ` · ${panel.done ? "已生成" : "正在写"}「${panel.scene}」` : panel.done ? " · 已生成" : ""}</span>
          {close}
        </h3>
        <div className="ai-text">{panel.text || (panel.done ? "" : "正在组装上下文……")}</div>
        {panel.err && <p className="lint bad">{panel.err}</p>}
        <div className="addrow">
          {!panel.done && (
            <button className="btn" type="button" onClick={stop}>
              停止
            </button>
          )}
          {panel.done && panel.text && (
            <>
              <button className="btn primary" type="button" onClick={() => applyFill("end")}>
                接到正文末尾
              </button>
              <button className="btn" type="button" onClick={() => applyFill("replace")}>
                替换整章
              </button>
            </>
          )}
        </div>
        <div className="legend">草稿先放在这里，你确认后才进正文。进正文后浅黄底标出，生成后建议点右边的「一致性检查」。</div>
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

function SelMenu({ at, close, run, copy, next }: { at: { x: number; y: number; sel: boolean }; close: () => void; run: (op: string, note: string) => void; copy: (cut: boolean) => void; next: () => void }) {
  const [note, setNote] = useState("");
  useEffect(() => {
    const off = () => close();
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
      <div className="ctx-menu" role="menu" aria-label="AI 处理选中的文字" style={{ left: at.x, top: at.y }}>
        <div className="ctx-h">{at.sel ? "AI 处理选中的文字" : "AI 接着写"}</div>
        <input
          className="ctx-note"
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
        {Object.keys(T.SEL_OPS)
          .filter((k) => at.sel || k === "续写")
          .map((k) => (
            <button key={k} type="button" role="menuitem" title={T.SEL_OPS[k]} onClick={() => run(k, note)}>
              {k}
            </button>
          ))}
        {!at.sel && (
          <button type="button" role="menuitem" onClick={next}>
            接下来怎么写 <kbd>Ctrl+Enter</kbd>
          </button>
        )}
        {at.sel && (
          <>
            <hr />
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
  const parts = useMemo(() => (sel ? diffText(sel.plain ?? "", current) : []), [sel, current]);
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

function FindPanel({ editor, workId, curId, chs, replace: startReplace, open, close, refreshWords }: { editor: Editor | null; workId: string; curId: string; chs: { ch: { id: string; title: string }; no: number }[]; replace: boolean; open: (id: string) => void; close: () => void; refreshWords: () => void }) {
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
    const f = () => setVer((v) => v + 1);
    editor.on("update", f);
    return () => void editor.off("update", f);
  }, [editor]);

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

  function go(i: number) {
    if (!editor || !hits.length) return;
    const k = ((i % hits.length) + hits.length) % hits.length;
    setIdx(k);
    editor.chain().focus().setTextSelection(hits[k]).scrollIntoView().run();
  }
  function replaceOne() {
    if (!editor || !q) return;
    const { from, to } = editor.state.selection;
    if (editor.state.doc.textBetween(from, to) === q) {
      editor.chain().focus().insertContentAt({ from, to }, rep).run();
      setTimeout(() => go(idx), 0);
    } else go(idx);
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
      await repo.saveText(workId, r.id, out.html, plain, countWords(plain), t.ai_chars);
      arc.noteEdit(r.id);
      n += out.n;
    }
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
