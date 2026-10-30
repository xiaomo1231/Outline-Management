import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { AiEdit, AiText, AiTracker, AI_META, aiChars } from "../components/aiMarks";
import { ScanHighlight, scanKey } from "../components/scanDeco";
import { useStore, toast } from "../lib/store";
import * as repo from "../lib/repo";
import { allChapters, findChapter, newChapter, plants } from "../lib/outline";
import { countWords, debounce, today, uid } from "../lib/util";
import { scan, sentenceLengths } from "../lib/aiscan";
import { EDITOR_DEFAULT, useSetting, type EditorPrefs } from "../lib/hooks";
import { importFont, loadSavedFonts, SYSTEM_FONTS } from "../lib/fonts";
import { ruleCheck } from "../lib/chars";
import { Issue, AsyncButton, Empty } from "../components/ui";
import * as T from "../lib/ai/tasks";
import { errText } from "../lib/ai/client";
import type { Ctx } from "../lib/ai/context";
import { phaseName } from "../lib/plan";

function ctx(): Ctx {
  const s = useStore.getState();
  return { work: s.work!, vols: s.vols, chars: s.chars, events: s.events, plan: s.plan, style: s.style, calls: s.calls, changesets: s.changesets };
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
  | { kind: "sel"; op: string; from: number; to: number; text: string; done: boolean; err?: string }
  | { kind: "fill"; scene: string; text: string; done: boolean; err?: string }
  | { kind: "check"; loading: boolean; rule: ReturnType<typeof ruleCheck>; ai: T.OocIssue[]; err?: string };

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
  const [words, setWords] = useState<Record<string, number>>({});
  const [todayWords, setTodayWords] = useState(0);
  const [plain, setPlain] = useState("");
  const [ai, setAi] = useState<[number, number]>([0, 0]);
  const [panel, setPanel] = useState<Panel>({ kind: "none" });
  const abort = useRef<AbortController | null>(null);
  const loadedFor = useRef<string | null>(null);

  const chs = useMemo(() => allChapters(vols), [vols]);
  const cur = findChapter(vols, chapterId) ?? chs[0];

  useEffect(() => {
    if (prefsReady) loadSavedFonts(prefs.fonts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsReady]);

  // 全书字数
  useEffect(() => {
    repo.allTexts(work.id).then((ts) => setWords(Object.fromEntries(ts.map((t) => [t.id, t.words]))));
    repo.dailyWords(work.id, 1).then((d) => setTodayWords(d.find((x) => x.day === today())?.words ?? 0));
  }, [work.id]);

  const save = useMemo(
    () =>
      debounce(async (id: string, ed: Editor) => {
        const html = ed.getHTML();
        const text = ed.getText({ blockSeparator: "\n" });
        const w = countWords(text);
        const [a, e] = aiChars(ed.state.doc);
        const delta = await repo.saveText(work.id, id, html, text, w, a + e);
        setWords((m) => ({ ...m, [id]: w }));
        if (delta) setTodayWords((x) => x + delta);
      }, 700),
    [work.id],
  );

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, codeBlock: false, code: false, horizontalRule: false }), Placeholder.configure({ placeholder: "从这里开始写。Ctrl+Enter 让 AI 给三个接下来的写法。" }), AiText, AiEdit, AiTracker, ScanHighlight],
    content: "",
    onUpdate: ({ editor: ed }) => {
      if (!loadedFor.current) return;
      setPlain(ed.getText({ blockSeparator: "\n" }));
      setAi(aiChars(ed.state.doc));
      save(loadedFor.current, ed);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const root = ed.view.dom;
      root.querySelectorAll("p.active").forEach((p) => p.classList.remove("active"));
      try {
        const { node } = ed.view.domAtPos(ed.state.selection.from);
        const p = (node.nodeType === 3 ? node.parentElement : (node as HTMLElement))?.closest("p");
        p?.classList.add("active");
      } catch {
        /* 光标在文档边缘 */
      }
    },
  });

  // 切换章节：先存上一章，再加载
  useEffect(() => {
    if (!editor || !cur) return;
    const id = cur.ch.id;
    if (loadedFor.current === id) return;
    if (loadedFor.current) save.flush(loadedFor.current, editor);
    loadedFor.current = null;
    repo.loadText(id).then((t) => {
      editor.commands.setContent(t?.html || "", false);
      loadedFor.current = id;
      setPlain(editor.getText({ blockSeparator: "\n" }));
      setAi(aiChars(editor.state.doc));
      setPanel({ kind: "none" });
    });
  }, [editor, cur?.ch.id]);

  useEffect(() => () => {
    if (editor && loadedFor.current) save.flush(loadedFor.current, editor);
  }, [editor]);

  // Ctrl+Enter
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        suggest();
      }
      if (e.key === "Escape") setPanel({ kind: "none" });
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

  function insertInline(text: string) {
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

  async function selOp(op: string) {
    if (!editor || !cur) return;
    const { from, to } = editor.state.selection;
    const sel = editor.state.doc.textBetween(from, to, "\n");
    if (!sel.trim()) {
      toast("先在正文里选中一段");
      return;
    }
    abort.current?.abort();
    abort.current = new AbortController();
    setPanel({ kind: "sel", op, from, to, text: "", done: false });
    try {
      await T.selectionOp(ctx(), cur, op, sel, editor.state.doc.textBetween(0, from, "\n"), (d) => setPanel((p) => (p.kind === "sel" ? { ...p, text: p.text + d } : p)), abort.current.signal);
      setPanel((p) => (p.kind === "sel" ? { ...p, done: true } : p));
    } catch (e) {
      setPanel((p) => (p.kind === "sel" ? { ...p, done: true, err: errText(e) } : p));
    }
  }

  function applySel(mode: "replace" | "after") {
    if (panel.kind !== "sel" || !editor) return;
    const content = aiParas(panel.text);
    const chain = editor.chain().focus().command(({ tr }) => {
      tr.setMeta(AI_META, true);
      return true;
    });
    if (mode === "replace") chain.insertContentAt({ from: panel.from, to: panel.to }, content).run();
    else chain.insertContentAt(editor.state.doc.resolve(panel.to).after(1), content).run();
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
    setPanel({ kind: "check", loading: true, rule, ai: [] });
    try {
      const issues = await T.checkCharacters(ctx(), cur, plain);
      setPanel({ kind: "check", loading: false, rule, ai: issues });
    } catch (e) {
      setPanel({ kind: "check", loading: false, rule, ai: [], err: errText(e) });
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
  const scanRows = scanOn ? scan(plain) : [];
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
          <ul>
            {vols.map((v, vi) => (
              <li key={v.id} style={{ display: "contents" }}>
                <div className="vol-t">
                  <span>{v.title}</span>
                  <button className="x" type="button" title="在这一卷末尾加一章" onClick={() => addChapter(vi)}>
                    ＋
                  </button>
                </div>
                {chs
                  .filter((r) => r.v === vi)
                  .map((r) => (
                    <button key={r.ch.id} type="button" className={"toc-i" + (r.ch.id === cur.ch.id ? " cur" : "")} onClick={() => openChapter(r.ch.id)}>
                      <span>
                        第{r.no}章 {r.ch.title}
                      </span>
                      <small>{words[r.ch.id] ? (words[r.ch.id] / 1000).toFixed(1) + "k" : r.ch.status === "大纲" ? "纲" : ""}</small>
                    </button>
                  ))}
              </li>
            ))}
          </ul>
          <div className="addrow">
            <button className="btn" type="button" onClick={() => addChapter()}>
              在当前章后加一章
            </button>
          </div>
        </nav>

        <div className="stack">
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
          </div>

          <article className={"sheet" + (prefs.paper === "warm" ? " paper-warm" : prefs.paper === "night" ? " paper-night" : "")}>
            <div className="chap-title-row">
              <span className="chap-no">第{cur.no}章</span>
              <input className="chap-title" value={cur.ch.title} placeholder="章名" aria-label="章名" onChange={(e) => edit("vols", (d) => void (d[cur.v].chapters[cur.c].title = e.target.value))} />
              <select
                className="btn"
                value={cur.ch.status}
                aria-label="状态"
                onChange={(e) => edit("vols", (d) => void (d[cur.v].chapters[cur.c].status = e.target.value as any))}
              >
                <option>大纲</option>
                <option>写作中</option>
                <option>已写</option>
              </select>
            </div>
            <div className="chap-meta">
              {cur.ch.scenes.length} 个场景{cur.ch.pl ? " · " + phaseName(plan, cur.ch.pl) : ""} · 本章 {chWords} 字
            </div>
            <div id="editor" style={{ fontFamily: prefs.font, fontSize: prefs.size, lineHeight: prefs.lineHeight, ["--indent" as any]: prefs.indent ? "2em" : "0" }}>
              <EditorContent editor={editor} />
            </div>
          </article>

          <div className="status" aria-live="polite">
            <span>
              本章 <b>{chWords}</b> 字
            </span>
            <span>
              全书 <b>{total.toLocaleString()}</b> 字
            </span>
            <span className="goal">
              今日 <b>{Math.max(0, todayWords)}</b> / {work.goal}
              <i>
                <span style={{ width: Math.min(100, (Math.max(0, todayWords) / Math.max(1, work.goal)) * 100) + "%" }} />
              </i>
            </span>
            <span>
              AI 占比 <b>{chWords ? Math.round((aiTotal / chWords) * 100) : 0}%</b>
              {ai[1] ? `（其中 ${Math.round((ai[1] / Math.max(1, chWords)) * 100)}% 你改过）` : ""}
            </span>
          </div>
        </div>

        <aside className="stack side">
          <AiPanel panel={panel} setPanel={setPanel} insertInline={insertInline} applySel={applySel} applyFill={applyFill} addChange={addChange} stop={() => abort.current?.abort()} />

          <div className="panel">
            <h3>本章大纲</h3>
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
              <button className="btn" type="button" onClick={check}>
                人设检查
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

function AiPanel({ panel, setPanel, insertInline, applySel, applyFill, addChange, stop }: { panel: Panel; setPanel: (p: Panel) => void; insertInline: (t: string) => void; applySel: (m: "replace" | "after") => void; applyFill: (m: "end" | "replace") => void; addChange: (i: T.OocIssue) => void; stop: () => void }) {
  if (panel.kind === "none") return null;
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
          <span>AI {panel.op}</span>
          {close}
        </h3>
        <div className="ai-text">{panel.text || (panel.done ? "" : "正在写……")}</div>
        {panel.err && <p className="lint bad">{panel.err}</p>}
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
          <span>草稿区{panel.scene ? ` · 正在写「${panel.scene}」` : ""}</span>
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
        <div className="legend">草稿先放在这里，你确认后才进正文。进正文后浅黄底标出，生成后建议点「人设检查」。</div>
      </div>
    );
  return (
    <div className="panel ai-out">
      <h3>
        <span>人设检查</span>
        {close}
      </h3>
      {panel.rule.map((r, i) => (
        <Issue key={"r" + i} lv={r.lv}>
          {r.text}
          {r.quote && <div className="src">原文：{r.quote}</div>}
        </Issue>
      ))}
      {panel.loading && <Empty>规则检查完成，正在做事实和性格检查……</Empty>}
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
      {!panel.loading && !panel.rule.length && !panel.ai.length && !panel.err && <Empty>没有发现矛盾。</Empty>}
    </div>
  );
}
