// 写作页里和写作限制有关的小部件：AI 结果的检查、这一次要求的冲突提示、「以后别这样写」
import { useMemo, useState, type ReactNode } from "react";
import type { WriteLimit } from "../lib/types";
import { levelName, newLimit, noteConflicts, scanLimits, splitLimitNote, type LimitHit, type ScanOpts } from "../lib/limits";

/** 把违反限制的词标出来 */
export function marked(text: string, hits: LimitHit[], limits: WriteLimit[]): ReactNode[] {
  const out: ReactNode[] = [];
  let p = 0;
  hits.forEach((h, i) => {
    if (h.from < p) return;
    out.push(text.slice(p, h.from));
    const l = limits.find((x) => x.id === h.id);
    out.push(
      <mark key={i} className={"lim-mark" + (h.unsure ? " unsure" : "")} title={`限制：${l?.text ?? ""}${h.unsure ? "（认不出是谁说的，你来判断）" : ""}`}>
        {text.slice(h.from, h.to)}
      </mark>,
    );
    p = h.to;
  });
  out.push(text.slice(p));
  return out;
}

/**
 * AI 写好的一段：去掉末尾的「【限制】」说明行单独显示，用词表扫一遍，违反的标出来，
 * 给「只改这几处」和「这个词不算」。
 */
export function AiResult({ text, done, limits, opts, skip = [], empty, onFix, onExcept }: { text: string; done: boolean; limits: WriteLimit[]; opts: ScanOpts; skip?: string[]; empty: string; onFix: (body: string, hits: LimitHit[]) => Promise<void>; onExcept: (id: string, word: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { body, notes } = useMemo(() => splitLimitNote(text), [text]);
  const use = useMemo(() => limits.filter((l) => !skip.includes(l.id)), [limits, skip]);
  const r = useMemo(() => (done ? scanLimits(body, use, opts) : { hits: [], stats: [] }), [done, body, use, opts]);
  const flagged = r.stats.filter((s) => s.over || s.unsure);
  const skipped = limits.filter((l) => skip.includes(l.id));
  return (
    <>
      <div className="ai-text">{done ? (body ? marked(body, r.hits, limits) : empty) : text || empty}</div>
      {done &&
        notes.map((n, i) => (
          <div key={i} className="lim-note" title="AI 写在正文末尾的说明，已经拿出来，不会进正文">
            【限制】{n}
          </div>
        ))}
      {done && skipped.length > 0 && <p className="legend">这一次暂时关掉了：{skipped.map((l) => "「" + l.text + "」").join("、")}</p>}
      {done && body && use.some((l) => !l.off && l.words.length) && (
        flagged.length ? (
          <div className="lim-check">
            <b>违反写作限制 {r.hits.length} 处</b>，用之前看一下：
            <ul>
              {flagged.map((s) => {
                const ws = [...new Set(r.hits.filter((h) => h.id === s.limit.id).map((h) => h.word))];
                return (
                  <li key={s.limit.id}>
                    <div className="row">
                      <span className="chip lim-badge">{s.limit.text}</span>
                      {ws.map((w) => `「${w}」`).join("")}
                      {s.limit.level === "less" && <span className="legend" style={{ margin: 0 }}>{s.n} 次，上限 {s.allowed}</span>}
                      {s.unsure > 0 && <span className="legend" style={{ margin: 0 }}>其中 {s.unsure} 处在对白里，认不出是谁说的（虚线）</span>}
                    </div>
                    <div className="row">
                      <span className="legend" style={{ margin: 0 }}>标错了？</span>
                      {ws.map((w) => (
                        <button key={w} type="button" className="btn" title="以后这个词不算违反这条限制" onClick={() => onExcept(s.limit.id, w)}>
                          「{w}」不算
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="addrow">
              <button
                className="btn"
                type="button"
                disabled={busy || !r.hits.length}
                onClick={async () => {
                  setBusy(true);
                  setErr("");
                  try {
                    await onFix(body, r.hits);
                  } catch (e: any) {
                    setErr(String(e?.message || e));
                  }
                  setBusy(false);
                }}
              >
                {busy ? "正在改……" : "只改这几处"}
              </button>
            </div>
            <p className="legend">「只改这几处」只把有问题的句子发给 AI 按限制重写，其余的字不动。也可以照样采用，再自己改。</p>
            {err && <p className="lint bad">{err}</p>}
          </div>
        ) : (
          <p className="lim-check ok">✓ 没有违反写作限制的词{r.stats.some((s) => s.exempt) ? "（人物例外的对白没算）" : ""}</p>
        )
      )}
    </>
  );
}

/** 这一次的要求和写作限制冲突：默认以限制为准，可以勾选这次暂时关掉 */
export function NoteConflicts({ note, limits, skip, setSkip }: { note: string; limits: WriteLimit[]; skip: string[]; setSkip: (v: string[]) => void }) {
  const cs = noteConflicts(note, limits);
  if (!cs.length) return null;
  return (
    <>
      {cs.map((l) => (
        <div className="note-conflict" key={l.id}>
          和写作限制 <b>「{l.text}」</b>（{levelName(l.level)}）冲突，默认以限制为准。
          <label>
            <input type="checkbox" checked={skip.includes(l.id)} onChange={(e) => setSkip(e.target.checked ? [...skip, l.id] : skip.filter((x) => x !== l.id))} />
            这一次暂时关掉这条
          </label>
        </div>
      ))}
    </>
  );
}

/** 右键「以后别这样写」：把选中的字加进一条限制的词表，或者新建一条 */
export function BanModal({ sel, limits, close, save }: { sel: string; limits: WriteLimit[]; close: () => void; save: (v: WriteLimit[], msg: string) => void }) {
  const q = sel.trim().slice(0, 30);
  const best = limits.find((l) => l.words.some((w) => q.includes(w) || w.includes(q))) ?? (q.length <= 4 ? limits.find((l) => l.type === "用词语感") : undefined);
  const [mode, setMode] = useState<"add" | "new">(best ? "add" : "new");
  const [pick, setPick] = useState(best?.id ?? limits[0]?.id ?? "");
  const [text, setText] = useState(`不要写「${q.slice(0, 12)}」这类`);
  const [word, setWord] = useState(q.length <= 8);
  function ok() {
    if (mode === "add" && pick) {
      const l = limits.find((x) => x.id === pick)!;
      const n: WriteLimit = { ...l, words: word && !l.words.includes(q) ? [...l.words, q] : l.words, except: l.except.filter((x) => x !== q), examples: l.examples?.includes(q) ? l.examples : [l.examples, q].filter(Boolean).join("、") };
      save(limits.map((x) => (x.id === pick ? n : x)), `已加到「${l.text}」`);
    } else {
      const n = newLimit(text || q);
      n.examples = q;
      if (word) n.words = [q];
      save([...limits, n], `已新建限制「${n.text}」，可以到「风格与限制」里细调`);
    }
  }
  return (
    <div className="lim-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="lim-modal" role="dialog" aria-label="以后别这样写">
        <h4>以后别这样写</h4>
        <div className="q">{q}</div>
        {limits.length > 0 && (
          <label className="r">
            <input type="radio" checked={mode === "add"} onChange={() => setMode("add")} />
            加到已有限制
            <select value={pick} onChange={(e) => (setPick(e.target.value), setMode("add"))}>
              {limits.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.text}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="r">
          <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} />
          新建一条
          <input type="text" value={text} onChange={(e) => (setText(e.target.value), setMode("new"))} />
        </label>
        <label className="r">
          <input type="checkbox" checked={word} onChange={(e) => setWord(e.target.checked)} />
          把「{q.length > 12 ? q.slice(0, 12) + "…" : q}」加进检查词表（短词才合适；长句只当例子给 AI 看）
        </label>
        <div className="addrow" style={{ justifyContent: "flex-end" }}>
          <button className="btn" type="button" onClick={close}>
            取消
          </button>
          <button className="btn primary" type="button" onClick={ok}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
