import { useState } from "react";
import type { StyleBlock, StyleDims, StyleSetup } from "../lib/types";
import { allBlocks, BUILTIN, blockById, compileStyle, DIMS, fuse, impact, leak } from "../lib/style";
import { analyzeBook, decode, dimsFromMetrics, METRIC_ROWS, metricsText, nearest } from "../lib/corpus";
import type { StyleMetrics } from "../lib/types";
import { Seg, Empty } from "./ui";
import * as T from "../lib/ai/tasks";
import { errText } from "../lib/ai/client";
import { uid } from "../lib/util";

type Slot = "core" | "sub" | "accent";
const SLOT_NAME: Record<Slot, string> = { core: "核心风格", sub: "次级风格", accent: "点缀" };
const SLOT_HINT: Record<Slot, string> = { core: "只能放一个，决定整体写法", sub: "不限数量，建议 1–2 个", accent: "不限数量，只在特定场景起作用" };
const EMPTY_DIMS: StyleDims = { pov: "", lang: "", vocab: "", rhythm: "", dialog: "", tone: "", avoid: "" };

export default function StyleBuilder({ value, onChange }: { value: StyleSetup; onChange: (v: StyleSetup) => void }) {
  const [tab, setTab] = useState<"lib" | "book" | "chat" | "mix" | "manual">("lib");
  const [over, setOver] = useState<Slot | null>(null);
  const s = value;
  const used = new Set([s.core, ...s.sub, ...s.accent]);
  const imp = impact(s);

  function place(id: string, slot: Slot) {
    const n: StyleSetup = { ...s, core: s.core === id ? null : s.core, sub: s.sub.filter((x) => x !== id), accent: s.accent.filter((x) => x !== id) };
    if (slot === "core") n.core = id;
    else n[slot] = [...n[slot], id];
    onChange(n);
  }
  function remove(id: string) {
    onChange({ ...s, core: s.core === id ? null : s.core, sub: s.sub.filter((x) => x !== id), accent: s.accent.filter((x) => x !== id) });
  }
  function saveBlock(b: Omit<StyleBlock, "id">): string[] | null {
    const hit = leak(b);
    if (hit.length) return hit;
    onChange({ ...s, blocks: [...s.blocks, { ...b, id: uid("st"), kind: "custom" }] });
    return null;
  }
  function delBlock(id: string) {
    const n = { ...s, blocks: s.blocks.filter((x) => x.id !== id) };
    onChange({ ...n, core: n.core === id ? null : n.core, sub: n.sub.filter((x) => x !== id), accent: n.accent.filter((x) => x !== id) });
  }

  const groups: [string, StyleBlock[]][] = [
    ["题材风格", allBlocks(s).filter((b) => b.kind === "genre")],
    ["基调与点缀", allBlocks(s).filter((b) => b.kind === "tone")],
    ["我的风格", s.blocks],
  ];

  return (
    <div className="grid3 style-grid">
      <div className="panel">
        <Seg value={tab} onChange={setTab} label="风格来源" options={[["lib", "风格库"], ["book", "拆书"], ["chat", "AI 对话"], ["mix", "AI 融合"], ["manual", "手动新建"]]} />
        {tab === "lib" &&
          groups.map(([g, list]) => (
            <div className="lib-group" key={g}>
              <h4>{g}</h4>
              {!list.length && <Empty>用「AI 对话」「AI 融合」或「手动新建」做的风格块会放在这里。</Empty>}
              {list.map((b) => (
                <div key={b.id} className={"card" + (used.has(b.id) ? " used" : "")} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", b.id)}>
                  <div className="nm">
                    <b>{b.name}</b>
                    {!b.builtin && (
                      <button className="x" type="button" aria-label={"删除 " + b.name} onClick={() => delBlock(b.id)}>
                        ×
                      </button>
                    )}
                  </div>
                  <div className="sc">
                    {b.desc}
                    {b.metrics && (
                      <small className="mt">
                        {b.builtin ? `据书库 ${b.metrics.books} 本统计 · ` : ""}句长 {Math.round(b.metrics.sentLen)} 字 · 对白 {Math.round(b.metrics.dialog * 100)}%
                      </small>
                    )}
                  </div>
                  <div className="add">
                    {(["core", "sub", "accent"] as Slot[]).map((k) => (
                      <button key={k} type="button" onClick={() => place(b.id, k)}>
                        设为{SLOT_NAME[k].replace("风格", "")}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        {tab === "book" && <BookAnalyze onSave={saveBlock} />}
        {tab === "chat" && <StyleChat onSave={saveBlock} />}
        {tab === "mix" && <StyleMix setup={s} onSave={saveBlock} />}
        {tab === "manual" && <ManualBlock onSave={saveBlock} />}
      </div>

      <div className="stack">
        {(["core", "sub", "accent"] as Slot[]).map((slot) => {
          const ids = slot === "core" ? (s.core ? [s.core] : []) : s[slot];
          return (
            <div
              key={slot}
              className={"slot" + (over === slot ? " over" : "")}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(slot);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/plain");
                if (id && blockById(s, id)) place(id, slot);
              }}
            >
              <header>
                <b>{SLOT_NAME[slot]}</b>
                <span>{SLOT_HINT[slot]}</span>
              </header>
              {!ids.length && <div className="hint">把左边的风格块拖到这里</div>}
              {ids.map((id) => {
                const b = blockById(s, id);
                if (!b) return null;
                return (
                  <div className="placed" key={id}>
                    <div className="row">
                      <b>{b.name}</b>
                      <span className="src">{b.desc}</span>
                      <button className="x" type="button" aria-label={"移除 " + b.name} onClick={() => remove(id)} style={{ marginLeft: "auto" }}>
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        <div className="impact">
          <h3>组合效果</h3>
          <div className="share">
            {imp.shares.map((x, i) => (
              <span key={i} title={`${x.name} ${x.pct}%`} style={{ width: x.pct + "%", background: x.slot === "核心" ? "var(--accent)" : x.slot === "次级" ? "var(--ai-line)" : "var(--muted)" }} />
            ))}
          </div>
          <div className="nums" style={{ marginTop: 6 }}>
            {imp.shares.map((x, i) => (
              <span key={i}>
                {x.name} <b>{x.pct}%</b>
              </span>
            ))}
            <span>
              提示词约 <b>{imp.chars}</b> 字 / <b>{imp.tokens}</b> token
            </span>
          </div>
          {imp.warnings.length > 0 && (
            <ul>
              {imp.warnings.map((w, i) => (
                <li key={i} className="warn">
                  {w}
                </li>
              ))}
            </ul>
          )}
          <p className="legend">每多一个次级或点缀，每个块的影响就会变小；提示词越长，每次调用越贵，而且写法越容易变得“平均”。</p>
        </div>
        <div className="panel">
          <h3>我的规则（优先级最高）</h3>
          <textarea rows={4} value={s.rules} placeholder={"一行一条，例如：\n对白不用感叹号\n不写心理独白，只写动作\n主角从不说脏话"} onChange={(e) => onChange({ ...s, rules: e.target.value })} />
          <h3 style={{ marginTop: 12 }}>样章（可选）</h3>
          <textarea rows={5} value={s.samples} placeholder="贴几段你自己写的文字。AI 会模仿它的语感、句子长短和用词，不会模仿情节。" onChange={(e) => onChange({ ...s, samples: e.target.value })} />
        </div>
      </div>

      <div className="panel out">
        <div className="bar">
          <h3 style={{ margin: 0 }}>写进提示词的内容</h3>
        </div>
        <pre>{compileStyle(s) || "放入风格块或写规则后，这里会显示 AI 实际看到的写作要求。"}</pre>
        <p className="legend">风格块只描述怎么写，不包含人物、情节和桥段，避免写成模板。</p>
      </div>
    </div>
  );
}

function DraftView({ d }: { d: { name: string; desc: string; dims: StyleDims } }) {
  return (
    <dl className="draft">
      <dt>名称</dt>
      <dd>{d.name}</dd>
      <dt>生效场景</dt>
      <dd>{d.desc}</dd>
      {DIMS.filter(([k]) => d.dims[k]).map(([k, l]) => (
        <div key={k}>
          <dt>{l}</dt>
          <dd>{d.dims[k]}</dd>
        </div>
      ))}
    </dl>
  );
}

function StyleChat({ onSave }: { onSave: (b: Omit<StyleBlock, "id">) => string[] | null }) {
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; content: string; draft?: T.StyleDraft }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState("");

  async function send(t: string) {
    t = t.trim();
    if (!t || busy) return;
    const next = [...msgs, { role: "user" as const, content: t }];
    setMsgs(next);
    setText("");
    setBusy(true);
    setErr("");
    try {
      const d = await T.styleChat(next.map((m) => ({ role: m.role, content: m.draft ? JSON.stringify({ name: m.draft.name, desc: m.draft.desc, dims: m.draft.dims }) : m.content })));
      setMsgs([...next, { role: "assistant", content: d.reply, draft: d }]);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }
  const last = [...msgs].reverse().find((m) => m.draft)?.draft;
  return (
    <div>
      <p className="empty">描述你想要的语感，例如「像旧报纸一样的民国腔，句子长一点」。AI 起草一个风格块，你可以接着说“再冷一点”。</p>
      <div className="chat">
        {msgs.map((m, i) => (
          <div key={i} className={"msg " + (m.role === "user" ? "me" : "ai")}>
            {m.content}
            {m.draft && <DraftView d={m.draft} />}
          </div>
        ))}
        {busy && <div className="msg ai">正在起草……</div>}
      </div>
      {err && <p className="lint bad">{err}</p>}
      {last && (
        <div className="chips">
          <button
            type="button"
            onClick={() => {
              const hit = onSave({ name: last.name, desc: last.desc, dims: { ...EMPTY_DIMS, ...last.dims }, kind: "custom", ai: true });
              setSaved(hit ? `包含具体内容或套路词「${hit.join("」「")}」，请让 AI 改掉后再存。` : `已存为「${last.name}」，在风格库的「我的风格」里。`);
            }}
          >
            一键存为风格块
          </button>
          <button type="button" onClick={() => send("再冷一点")}>
            再冷一点
          </button>
          <button type="button" onClick={() => send("句子再短一点")}>
            句子再短一点
          </button>
        </div>
      )}
      {saved && <p className="lint ok">{saved}</p>}
      <div className="addrow">
        <input value={text} placeholder="想要什么样的写法？" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send(text)} />
        <button className="btn primary" type="button" onClick={() => send(text)} disabled={busy}>
          发送
        </button>
      </div>
    </div>
  );
}

function StyleMix({ setup, onSave }: { setup: StyleSetup; onSave: (b: Omit<StyleBlock, "id">) => string[] | null }) {
  const [pick, setPick] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<T.StyleDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const blocks = pick.map((id) => blockById(setup, id)).filter(Boolean) as StyleBlock[];
  return (
    <div>
      <p className="empty">勾选两个以上的风格，第一个勾的为主。可以用规则直接合，也可以让 AI 处理冲突。</p>
      <div className="pick">
        {allBlocks(setup).map((b) => (
          <label key={b.id}>
            <input type="checkbox" checked={pick.includes(b.id)} onChange={(e) => setPick(e.target.checked ? [...pick, b.id] : pick.filter((x) => x !== b.id))} />
            {b.name}
            {pick.indexOf(b.id) === 0 && <span className="chip">为主</span>}
          </label>
        ))}
      </div>
      <div className="form">
        <div className="f">
          <span>名称</span>
          <input value={name} placeholder={blocks.map((b) => b.name).join("×") || "新风格"} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="f">
          <span>要求</span>
          <input value={note} placeholder="例如：节奏用前者，基调用后者" onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div className="addrow">
        <button className="btn" type="button" disabled={blocks.length < 2} onClick={() => setDraft({ ...fuse(blocks, name || blocks.map((b) => b.name).join("×")), reply: "按规则合并：每一项以第一个为主，其余作为补充，避免项合在一起。" })}>
          按规则合并
        </button>
        <button
          className="btn primary"
          type="button"
          disabled={blocks.length < 2 || busy}
          onClick={async () => {
            setBusy(true);
            setMsg("");
            try {
              const d = await T.fuseStyles(blocks, note);
              setDraft({ ...d, name: name || d.name });
            } catch (e) {
              setMsg(errText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "融合中…" : "AI 融合"}
        </button>
      </div>
      {draft && (
        <div className="msg ai" style={{ maxWidth: "100%", marginTop: 8 }}>
          {draft.reply}
          <DraftView d={draft} />
          <div className="chips">
            <button
              type="button"
              onClick={() => {
                const hit = onSave({ name: draft.name, desc: draft.desc, dims: { ...EMPTY_DIMS, ...draft.dims }, kind: "custom", ai: true });
                setMsg(hit ? `包含「${hit.join("」「")}」，请删掉后再存。` : `已存为「${draft.name}」。`);
              }}
            >
              存为风格块
            </button>
          </div>
        </div>
      )}
      {msg && <p className="lint">{msg}</p>}
    </div>
  );
}

function ManualBlock({ onSave }: { onSave: (b: Omit<StyleBlock, "id">) => string[] | null }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [dims, setDims] = useState<StyleDims>(EMPTY_DIMS);
  const [lint, setLint] = useState<{ ok: boolean; t: string } | null>(null);
  return (
    <div className="form">
      <div className="f">
        <span>名称</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="f">
        <span>适用</span>
        <input value={desc} placeholder="全篇 / 打斗 / 感情戏……" onChange={(e) => setDesc(e.target.value)} />
      </div>
      {DIMS.map(([k, l]) => (
        <div className="f" key={k}>
          <span>{l}</span>
          <input value={dims[k]} onChange={(e) => setDims({ ...dims, [k]: e.target.value })} />
        </div>
      ))}
      <button
        className="btn primary"
        type="button"
        onClick={() => {
          if (!name.trim()) return setLint({ ok: false, t: "请先写风格名称。" });
          if (!Object.values(dims).some((x) => x.trim())) return setLint({ ok: false, t: "至少填一项写法。" });
          const hit = onSave({ name: name.trim(), desc: desc.trim() || "全篇", dims, kind: "custom" });
          if (hit) return setLint({ ok: false, t: `包含具体内容或套路词「${hit.join("」「")}」。风格块只写怎么写，请删掉后再保存。` });
          setLint({ ok: true, t: "已保存到「我的风格」。" });
          setName("");
          setDesc("");
          setDims(EMPTY_DIMS);
        }}
      >
        保存风格块
      </button>
      {lint && <p className={"lint " + (lint.ok ? "ok" : "bad")}>{lint.t}</p>}
    </div>
  );
}

type Book = { name: string; chapters: number; pseudo: boolean; opening: StyleMetrics; body: StyleMetrics; samples: string[] };

/** 拆书：导入一本 txt，统计写法，可选让 AI 写描述，存成风格块。原文不保存。 */
function BookAnalyze({ onSave }: { onSave: (b: Omit<StyleBlock, "id">) => string[] | null }) {
  const [book, setBook] = useState<Book | null>(null);
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState<{ name: string; desc: string; dims: StyleDims; reply?: string } | null>(null);
  const [lint, setLint] = useState<{ ok: boolean; t: string } | null>(null);
  const ref = nearest(book?.body ?? ({} as StyleMetrics), BUILTIN);

  async function load(f: File) {
    setBusy("正在读取和统计……");
    setDraft(null);
    setLint(null);
    try {
      const text = decode(await f.arrayBuffer());
      await new Promise((r) => setTimeout(r, 30));
      const a = analyzeBook(text);
      if (a.chapters < 5) throw new Error("文字太少，至少要几万字才统计得准。");
      const name = f.name.replace(/\.txt$/i, "").replace(/[（(][^）)]*[）)]$/, "");
      setBook({ name, ...a });
      const d = dimsFromMetrics(a.body);
      setDraft({ name: name.slice(0, 8) + "式写法", desc: "全篇", dims: d });
    } catch (e) {
      setLint({ ok: false, t: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="form">
      <p className="legend" style={{ marginTop: 0 }}>
        导入一本小说的 txt（UTF-8 或 GBK 都行），统计它的句长、段落、对白比例、开章和收章习惯，存成风格块。只保存统计数字和写法描述，不保存原文。
      </p>
      <label className="btn" style={{ alignSelf: "flex-start" }}>
        选择 txt 文件
        <input type="file" accept=".txt,text/plain" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
      </label>
      {busy && <p className="legend">{busy}</p>}
      {book && (
        <>
          <p className="legend">
            《{book.name}》共 {book.chapters} {book.pseudo ? "段（没有识别到章节标题，按 3000 字一段统计，章长和收章习惯算不出来）" : "章"}。{ref && `写法最接近风格库里的「${ref.name}」。`}
          </p>
          <div className="tbl-wrap">
            <table className="ev">
              <thead>
                <tr>
                  <th>项目</th>
                  <th>本书</th>
                  <th>开篇</th>
                  {ref && <th title={`书库里「${ref.name}」类的中位数`}>{ref.name}</th>}
                </tr>
              </thead>
              <tbody>
                {METRIC_ROWS.map(([k, l, f]) => {
                  const v = book.body[k] as number | null;
                  if (v == null) return null;
                  const o = book.opening[k] as number | null;
                  const rv = ref?.metrics?.[k] as number | null | undefined;
                  return (
                    <tr key={k}>
                      <td>{l}</td>
                      <td className="num">{f(v)}</td>
                      <td className="num">{o == null ? "—" : f(o)}</td>
                      {ref && <td className="num">{rv == null ? "—" : f(rv)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button
            className="btn"
            type="button"
            disabled={!!busy}
            onClick={async () => {
              setBusy("AI 正在读三段样本（约 4500 字）……");
              try {
                const d = await T.describeStyle(book.name, metricsText(book.body, "这本书的统计"), book.samples);
                setDraft({ ...d, dims: { ...EMPTY_DIMS, ...d.dims } });
              } catch (e) {
                setLint({ ok: false, t: errText(e) });
              } finally {
                setBusy("");
              }
            }}
          >
            让 AI 读样本，写得更细
          </button>
          {draft && (
            <>
              <div className="f">
                <span>名称</span>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              {DIMS.map(([k, l]) => (
                <div className="f" key={k}>
                  <span>{l}</span>
                  <input value={draft.dims[k]} onChange={(e) => setDraft({ ...draft, dims: { ...draft.dims, [k]: e.target.value } })} />
                </div>
              ))}
              {draft.reply && <p className="legend">{draft.reply}</p>}
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  const hit = onSave({ name: draft.name.trim() || "拆书风格", desc: draft.desc || "全篇", dims: draft.dims, kind: "custom", metrics: { ...book.body, books: 1 } });
                  if (hit) return setLint({ ok: false, t: `包含具体内容或套路词「${hit.join("」「")}」。风格块只写怎么写，请删掉后再保存。` });
                  setLint({ ok: true, t: "已保存到「我的风格」，统计数字也一起存了，设为核心后会写进提示词。" });
                }}
              >
                保存为风格块
              </button>
            </>
          )}
        </>
      )}
      {lint && <p className={"lint " + (lint.ok ? "ok" : "bad")}>{lint.t}</p>}
    </div>
  );
}
