import { useEffect, useRef, useState } from "react";
import { useStore, toast } from "../lib/store";
import * as repo from "../lib/repo";
import * as mem from "../lib/memory";
import { chat, errText, type Msg, type ToolDef } from "../lib/ai/client";
import { stablePrefix, type Ctx } from "../lib/ai/context";
import { describe } from "../lib/chars";
import { allChapters, findChapter, newScene, plants } from "../lib/outline";
import { phaseName } from "../lib/plan";
import { clip, uid } from "../lib/util";
import type { Chat, ChatMsg } from "../lib/types";
import { ctx } from "../pages/outline/ctx";

const MODES: [string, string][] = [
  ["找思路", "给 3–5 个明显不同的方向，每个写清用到了哪些已有的线、会和什么冲突、代价是什么。只写方向，不写成段的正文。避开常见套路。"],
  ["查设定", "只根据资料回答，答案带章节出处；资料里没有就直说没有。"],
  ["检查", "找出矛盾和问题，带原文或设定出处，按严重度排。"],
  ["推演", "推演这个假设会影响哪些人物、事件和伏笔，逐条列出。"],
];

const TOOLS: ToolDef[] = [
  { type: "function", function: { name: "get_character", description: "查一个人物的完整人设，可以指定在第几章时的状态", parameters: { type: "object", properties: { name: { type: "string" }, chapter: { type: "number" } }, required: ["name"] } } },
  { type: "function", function: { name: "read_chapter", description: "读某一章的正文（太长时只给前后部分）", parameters: { type: "object", properties: { no: { type: "number" } }, required: ["no"] } } },
  { type: "function", function: { name: "search_text", description: "在全书正文里搜索关键词，返回出现的章节和上下文", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "get_outline", description: "读第 from 到 to 章的大纲（场景、目标、冲突、伏笔）", parameters: { type: "object", properties: { from: { type: "number" }, to: { type: "number" } }, required: ["from", "to"] } } },
  { type: "function", function: { name: "get_timeline", description: "读故事内时间线（事件表）", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "list_plants", description: "列出所有伏笔，以及埋和收的章节", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "search_memory", description: "在作品记忆和作品圣经里搜索", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
];

async function runTool(c: Ctx, name: string, args: any): Promise<[string, string]> {
  const chs = allChapters(c.vols);
  switch (name) {
    case "get_character": {
      const p = c.chars.find((x) => x.name && (x.name === args.name || x.name.includes(args.name) || (x.f.alias || "").includes(args.name)));
      if (!p) return ["没有这个人物", `查人物：${args.name}`];
      return [describe(p, c.vols, args.chapter || chs.length), `${p.name}人物卡`];
    }
    case "read_chapter": {
      const r = chs.find((x) => x.no === args.no);
      if (!r) return ["没有这一章", `第${args.no}章`];
      const t = await repo.loadText(r.ch.id);
      const p = t?.plain || "（这一章还没有正文）";
      return [p.length > 8000 ? p.slice(0, 4000) + "\n……（中间省略）……\n" + p.slice(-4000) : p, `第${r.no}章正文`];
    }
    case "search_text": {
      const q = String(args.query || "");
      const out: string[] = [];
      for (const r of chs) {
        const t = await repo.loadText(r.ch.id);
        if (!t?.plain || !q) continue;
        let i = t.plain.indexOf(q);
        let n = 0;
        while (i >= 0 && n < 3) {
          out.push(`第${r.no}章：…${t.plain.slice(Math.max(0, i - 60), i + q.length + 60)}…`);
          i = t.plain.indexOf(q, i + q.length);
          n++;
        }
        if (out.length > 30) break;
      }
      return [out.join("\n") || "正文里没有找到", `搜索正文：${q}`];
    }
    case "get_outline": {
      const sel = chs.filter((r) => r.no >= args.from && r.no <= args.to).slice(0, 40);
      return [sel.map((r) => `第${r.no}章 ${r.ch.title}${r.ch.summary ? "（摘要：" + r.ch.summary + "）" : ""}\n` + r.ch.scenes.map((s) => `  - ${s.t}｜目标:${s.goal}｜冲突:${s.conf}｜人物:${s.who.join("、")}${s.plant ? "｜埋:" + s.plant : ""}${s.pay ? "｜收:" + s.pay : ""}`).join("\n")).join("\n") || "这个范围没有章节", `第${args.from}–${args.to}章大纲`];
    }
    case "get_timeline":
      return [c.events.map((e) => `第${e.day}天${e.time ? " " + e.time : ""}｜${findChapter(c.vols, e.ch) ? "第" + findChapter(c.vols, e.ch)!.no + "章" : "未指定"}｜${e.t}｜${e.who}${e.place ? "｜" + e.place : ""}${e.result ? "｜结果:" + e.result : ""}`).join("\n") || "还没有事件", "时间线"];
    case "list_plants":
      return [plants(c.vols, c.events).map((p) => `${p.name}：第${p.plantNo ?? "?"}章埋，${p.payNo ? `第${p.payNo}章收` : "还没收"}`).join("\n") || "还没有伏笔", "伏笔板"];
    case "search_memory": {
      const q = String(args.query || "");
      const items = (await mem.items(c.work.id)).filter((x) => x.text.includes(q)).slice(0, 20);
      await mem.voteHit(c.work.id, items.map((x) => x.id));
      const bible = (await mem.getBible(c.work.id)).text.split("\n").filter((l) => l.includes(q)).slice(0, 10);
      return [[...items.map((x) => `[第${x.ch}章] ${x.text}`), ...bible.map((l) => "[作品圣经] " + l)].join("\n") || "记忆里没有", `搜索记忆：${q}`];
    }
  }
  return ["未知工具", name];
}

/** 第二、三层上下文：当前位置 + 按名字自动召回 */
async function locationAndRecall(c: Ctx, text: string, page: string, chapterId: string | null, selection: string): Promise<{ text: string; refs: string[] }> {
  const refs: string[] = [];
  const parts: string[] = [];
  const chs = allChapters(c.vols);
  const r = findChapter(c.vols, chapterId);
  const where = { write: "写作页", outline: "大纲页", style: "风格页", memory: "记忆页", settings: "设置页" }[page] ?? page;
  parts.push(`作者现在在${where}${r ? `，打开的是第${r.no}章「${r.ch.title}」` : ""}。全书 ${chs.length} 章。`);
  if (r) {
    refs.push(`当前：第${r.no}章`);
    if (page === "write") {
      const t = await repo.loadText(r.ch.id);
      if (t?.plain) parts.push(`第${r.no}章正文（结尾 2000 字）：\n${t.plain.slice(-2000)}`);
    }
    if (r.ch.pl) parts.push(`第${r.no}章在篇幅规划里属于：${phaseName(c.plan, r.ch.pl)}`);
  }
  if (selection) {
    parts.push("作者选中的文字：\n" + selection.slice(0, 2000));
    refs.push("选中的文字");
  }
  const no = r?.no ?? chs.length;
  // @人物 / @第N章 / #伏笔 手动指定，加上消息里提到的名字
  const mentioned = c.chars.filter((p) => p.name && (text.includes(p.name) || text.includes("@" + p.name)));
  for (const p of mentioned.slice(0, 5)) {
    parts.push(describe(p, c.vols, no));
    refs.push(p.name + "人物卡");
  }
  for (const m of text.matchAll(/@第(\d+)章/g)) {
    const x = chs.find((y) => y.no === +m[1]);
    if (!x) continue;
    const t = await repo.loadText(x.ch.id);
    parts.push(`第${x.no}章「${x.ch.title}」${x.ch.summary ? "摘要：" + x.ch.summary : ""}\n${clip(t?.plain ?? "", 3000)}`);
    refs.push(`第${x.no}章`);
  }
  const pl = plants(c.vols, c.events);
  const tagged = [...text.matchAll(/#([^\s#，。]+)/g)].map((m) => m[1]);
  const hitPlants = pl.filter((p) => tagged.some((t) => p.name.includes(t)) || text.includes(p.name));
  const open = pl.filter((p) => p.plantNo && !p.payNo);
  if (hitPlants.length || open.length) {
    parts.push("伏笔：" + [...new Set([...hitPlants, ...open])].slice(0, 15).map((p) => `${p.name}（第${p.plantNo ?? "?"}章埋${p.payNo ? `，第${p.payNo}章收` : "，未收"}）`).join("；"));
    refs.push(hitPlants.length ? "伏笔：" + hitPlants.map((p) => p.name).join("、") : "未收伏笔");
  }
  const near = chs.filter((x) => Math.abs(x.no - no) <= 2 && x.ch.scenes.length);
  if (near.length) {
    parts.push("前后几章大纲：\n" + near.map((x) => `第${x.no}章 ${x.ch.title}：` + x.ch.scenes.map((s) => s.t + (s.goal ? `（${s.goal}）` : "")).join("；")).join("\n"));
    refs.push(`第${near[0].no}–${near[near.length - 1].no}章大纲`);
  }
  const keys = text.split(/[\s，。、？！,.?!@#]+/).filter((w) => w.length >= 2);
  const items = (await mem.items(c.work.id)).filter((x) => x.layer > 1 && keys.some((k) => x.text.includes(k))).slice(0, 10);
  if (items.length) {
    await mem.voteHit(c.work.id, items.map((x) => x.id));
    parts.push("相关的早前记忆：\n" + items.map((x) => `[第${x.ch}章] ${x.text}`).join("\n"));
    refs.push(`召回记忆 ${items.length} 条`);
  }
  const rejected = (await mem.items(c.work.id)).filter((x) => x.kind === "rejected").slice(0, 10);
  if (rejected.length) parts.push("作者已经否掉的思路（不要再推荐）：\n" + rejected.map((x) => x.text).join("\n"));
  return { text: parts.join("\n\n"), refs };
}

export default function Assistant() {
  const work = useStore((s) => s.work)!;
  const page = useStore((s) => s.page);
  const chapterId = useStore((s) => s.chapterId);
  const [open, setOpen] = useState(false);
  const [dock, setDock] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [cur, setCur] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    repo.listChats(work.id).then((cs) => {
      setChats(cs);
      setCur(cs[0]?.id ?? null);
    });
  }, [work.id]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  });

  const chatObj = chats.find((c) => c.id === cur);

  async function persist(c: Chat) {
    setChats((cs) => [c, ...cs.filter((x) => x.id !== c.id)]);
    await repo.saveChat(work.id, c);
  }

  async function build(q: string) {
    const c = ctx();
    const sel = window.getSelection()?.toString() ?? "";
    const loc = await locationAndRecall(c, q, page, chapterId, sel);
    const modeText = MODES.find((m) => m[0] === mode)?.[1];
    const system = (await stablePrefix(c, "你是这本小说作者的写作搭子，读得到整本书的资料。作者是主导，你给思路和信息，不替作者做决定。回答简洁、具体、说人话，不用套话。需要更多资料时调用工具去查，不要编造书里没有的内容。")) + "\n\n=== 当前位置和相关资料 ===\n" + loc.text + (modeText ? "\n\n本次的用法：" + mode + "。" + modeText : "");
    return { system, refs: loc.refs };
  }

  async function send() {
    const q = text.trim();
    if (!q || busy) return;
    setErr("");
    let c = chatObj;
    if (!c) c = { id: uid("chat"), title: clip(q, 14), msgs: [], updated: Date.now() };
    const userMsg: ChatMsg = { role: "user", content: (mode ? `【${mode}】` : "") + q, at: Date.now() };
    c = { ...c, msgs: [...c.msgs, userMsg], updated: Date.now() };
    setCur(c.id);
    setText("");
    await persist(c);
    setBusy("正在整理资料");
    abort.current = new AbortController();
    try {
      const { system, refs } = await build(q);
      const history: Msg[] = c.msgs.slice(-12).map((m) => ({ role: m.role, content: m.content }));
      const msgs: Msg[] = [{ role: "system", content: system }, ...history];
      const used = [...refs];
      let answer = "";
      for (let round = 0; round < 5; round++) {
        setBusy(round ? "正在查资料" : "正在想");
        const last = round === 4;
        const r = await chat(msgs, { tools: last ? undefined : TOOLS, signal: abort.current.signal, temperature: mode === "找思路" ? 1.2 : 0.7 });
        if (!r.toolCalls.length) {
          answer = r.content;
          break;
        }
        msgs.push({ role: "assistant", content: r.content || null, tool_calls: r.toolCalls });
        for (const tc of r.toolCalls) {
          let args: any = {};
          try {
            args = JSON.parse(tc.function.arguments || "{}");
          } catch {
            /* 参数坏了按空处理 */
          }
          const [out, label] = await runTool(ctx(), tc.function.name, args);
          used.push(label);
          msgs.push({ role: "tool", tool_call_id: tc.id, content: out.slice(0, 12000) });
        }
      }
      c = { ...c, msgs: [...c.msgs, { role: "assistant", content: answer || "（没有回答）", at: Date.now(), refs: [...new Set(used)] }], updated: Date.now() };
      await persist(c);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy("");
    }
  }

  async function remember(kind: "decision" | "rejected" | "inspire", content: string) {
    const r = findChapter(useStore.getState().vols, chapterId);
    await mem.addItem(work.id, kind, clip(content, 400), r?.no ?? 0, "AI 助手对话", kind === "rejected" ? 3 : 1);
    toast(kind === "decision" ? "已作为“决定”记进记忆" : kind === "rejected" ? "已记下，以后不再推荐这个方向" : "已放进灵感箱");
  }

  function toScene(content: string) {
    const s = useStore.getState();
    const r = findChapter(s.vols, chapterId) ?? allChapters(s.vols).slice(-1)[0];
    if (!r) return toast("还没有章节");
    const title = clip(content.split("\n").find((l) => l.trim())?.replace(/^[\d.、#*\-\s]+/, "") ?? "新场景", 18);
    if (!confirm(`在第${r.no}章末尾新建场景「${title}」，把这段回答放进“目标”？`)) return;
    s.aiEdit(`AI 助手：存为场景「${title}」`, ["vols"], (d) => void d.vols[r.v].chapters[r.c].scenes.push({ ...newScene(title), goal: clip(content, 300), ai: true, from: "AI 助手" }));
    toast(`已存进第${r.no}章`);
  }

  function toEvent(content: string) {
    const s = useStore.getState();
    const r = findChapter(s.vols, chapterId);
    const title = clip(content.split("\n").find((l) => l.trim())?.replace(/^[\d.、#*\-\s]+/, "") ?? "新事件", 24);
    if (!confirm(`在时间线上新建事件「${title}」？`)) return;
    s.aiEdit(`AI 助手：加入时间线「${title}」`, ["events"], (d) => void d.events.push({ id: uid("e"), day: 1, ch: r?.ch.id ?? null, t: title, who: "", ty: "main", note: clip(content, 400), from: "AI 助手" }));
    toast("已加入时间线，记得改故事时间");
  }

  if (!open)
    return (
      <button className="fab" type="button" onClick={() => setOpen(true)} title="AI 助手（Ctrl+J）" aria-label="打开 AI 助手">
        AI
      </button>
    );

  return (
    <div className={"assist" + (dock ? " dock" : "")} role="dialog" aria-label="AI 助手">
      <header>
        <select value={cur ?? ""} aria-label="对话" onChange={(e) => setCur(e.target.value || null)}>
          <option value="">新对话</option>
          {chats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <button className="x" type="button" title="新对话" onClick={() => setCur(null)}>
          ＋
        </button>
        {chatObj && (
          <button
            className="x"
            type="button"
            title="删除这个对话"
            onClick={async () => {
              if (!confirm("删除这个对话？")) return;
              await repo.deleteChat(chatObj.id);
              setChats(chats.filter((c) => c.id !== chatObj.id));
              setCur(null);
            }}
          >
            🗑
          </button>
        )}
        <button className="x" type="button" title={dock ? "改成浮窗" : "固定在右侧"} onClick={() => setDock(!dock)}>
          {dock ? "⧉" : "▮"}
        </button>
        <button className="x" type="button" aria-label="收起" onClick={() => setOpen(false)}>
          ×
        </button>
      </header>
      <div className="assist-list" ref={listRef}>
        {!chatObj?.msgs.length && (
          <div className="empty" style={{ padding: 8 }}>
            我读得到这本书的人物、大纲、时间线、伏笔、记忆和正文。可以问“林照第一次见陈渡是哪章”，也可以让我找思路。用 @人名、@第12章、#伏笔 指定资料。默认只聊天，不会改你的作品。
          </div>
        )}
        {chatObj?.msgs.map((m, i) => (
          <div key={i} className={"msg " + (m.role === "user" ? "me" : "ai")}>
            <div className="msg-t">{m.content}</div>
            {m.refs && m.refs.length > 0 && (
              <div className="refs">
                这次参考了：
                {m.refs.map((r) => (
                  <span key={r} className="chip">
                    {r}
                  </span>
                ))}
              </div>
            )}
            {m.role === "assistant" && (
              <div className="chips">
                <button type="button" onClick={() => remember("decision", m.content)}>
                  就这么定
                </button>
                <button type="button" onClick={() => remember("rejected", m.content)}>
                  否掉这个方向
                </button>
                <button type="button" onClick={() => remember("inspire", m.content)}>
                  记到灵感箱
                </button>
                <button type="button" onClick={() => toScene(m.content)}>
                  存为场景
                </button>
                <button type="button" onClick={() => toEvent(m.content)}>
                  加入时间线
                </button>
                <button type="button" onClick={() => navigator.clipboard?.writeText(m.content).then(() => toast("已复制"))}>
                  复制
                </button>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg ai">{busy}……</div>}
        {err && <p className="lint bad">{err}</p>}
      </div>
      {preview != null && (
        <div className="assist-preview">
          <div className="bar">
            <b>这次要发给 DeepSeek 的资料</b>
            <button className="x" type="button" onClick={() => setPreview(null)}>
              ×
            </button>
          </div>
          <pre>{preview}</pre>
        </div>
      )}
      <div className="assist-in">
        <div className="chips">
          {MODES.map(([m]) => (
            <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(mode === m ? "" : m)}>
              {m}
            </button>
          ))}
          <button type="button" onClick={async () => setPreview((await build(text || "（空）")).system)}>
            预览发送内容
          </button>
        </div>
        <div className="addrow">
          <textarea
            rows={2}
            value={text}
            placeholder="问点什么，Enter 发送，Shift+Enter 换行"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {busy ? (
            <button className="btn" type="button" onClick={() => abort.current?.abort()}>
              停止
            </button>
          ) : (
            <button className="btn primary" type="button" onClick={send}>
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
