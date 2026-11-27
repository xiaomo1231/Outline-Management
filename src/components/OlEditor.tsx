import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Chapter, Scene } from "../lib/types";
import { fromSegs, joinOl, OL_KEYS, parseOl, toSegs, type OlSeg } from "../lib/chapterOutline";

type Change = (ol: string, seg: boolean) => void;

const PH = "例如：主角夜探档案室，发现父亲的名字被涂掉；被管理员撞见，只好编了个谎";
const SEG_PH: Record<string, string> = {
  起因: "这一章从哪里开始，谁想做什么",
  经过: "事情怎么推进，遇到什么阻碍",
  转折: "哪里出了意外、局面怎么变",
  结果: "这一章停在哪里，留下什么",
};

/** 本章大纲编辑：自由文字或按段写，两种可以互相切换 */
export function OlEditor({ ch, onChange, big }: { ch: Pick<Chapter, "ol" | "olSeg">; onChange: Change; big?: boolean }) {
  const ol = ch.ol ?? "";
  if (!ch.olSeg)
    return (
      <textarea
        className={"ol-free" + (big ? " big" : "")}
        rows={big ? 16 : 4}
        value={ol}
        placeholder={PH}
        aria-label="本章大纲"
        onChange={(e) => onChange(e.target.value, false)}
      />
    );
  const segs = parseOl(ol);
  const put = (next: OlSeg[]) => onChange(joinOl(next), true);
  const set = (i: number, p: Partial<OlSeg>) => put(segs.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: number) => {
    const n = [...segs];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    put(n);
  };
  const nextKey = () => OL_KEYS.find((k) => !segs.some((s) => s.k === k)) ?? `第${segs.length + 1}段`;
  return (
    <div className={"ol-segs" + (big ? " big" : "")}>
      {segs.map((s, i) => (
        <div className="ol-seg" key={i}>
          <div className="ol-seg-h">
            <input value={s.k} placeholder="段名" aria-label={`第${i + 1}段的段名`} onChange={(e) => set(i, { k: e.target.value })} />
            <span className="ol-seg-tools">
              <button type="button" title="上移" aria-label="上移" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" title="下移" aria-label="下移" disabled={i === segs.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button
                type="button"
                title="删掉这一段"
                aria-label="删掉这一段"
                onClick={() => (!s.t.trim() || confirm(`删掉「${s.k || "这一段"}」？里面的文字会一起删掉。`)) && put(segs.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </span>
          </div>
          <textarea rows={big ? 4 : 2} value={s.t} placeholder={SEG_PH[s.k] ?? "这一段发生什么"} aria-label={`${s.k || `第${i + 1}段`}的内容`} onChange={(e) => set(i, { t: e.target.value })} />
        </div>
      ))}
      <button type="button" className="btn ol-add" onClick={() => put([...segs, { k: nextKey(), t: "" }])}>
        + 加一段
      </button>
    </div>
  );
}

/** 自由 / 分段 切换按钮 */
export function OlModeSwitch({ ch, onChange }: { ch: Pick<Chapter, "ol" | "olSeg">; onChange: Change }) {
  const ol = ch.ol ?? "";
  return ch.olSeg ? (
    <button
      type="button"
      className="linkish"
      title="去掉段名，合成一整段文字"
      onClick={() => {
        const segs = parseOl(ol);
        if (segs.some((s) => s.k && s.t.trim()) && !confirm("合成一整段后段名会去掉，每段的文字各占一行。继续？")) return;
        onChange(fromSegs(segs), false);
      }}
    >
      合成一整段
    </button>
  ) : (
    <button type="button" className="linkish" title="按 起因 / 经过 / 转折 / 结果 分段写，每段可以改名、增删、调顺序" onClick={() => onChange(joinOl(toSegs(ol)), true)}>
      分段写
    </button>
  );
}

/** 写作页等只读的地方显示本章大纲 */
export function OlView({ ch }: { ch: Pick<Chapter, "ol" | "olSeg"> }) {
  const ol = ch.ol?.trim() ?? "";
  if (!ol) return null;
  if (!ch.olSeg) return <p className="ch-ol">{ol}</p>;
  const segs = parseOl(ol).filter((s) => s.t.trim());
  if (!segs.length) return null;
  return (
    <dl className="ch-ol ol-view">
      {segs.map((s, i) => (
        <div key={i}>
          {s.k && <dt>{s.k}</dt>}
          <dd>{s.t}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 展开编辑：大窗口写本章大纲，右边列出本章场景作参照 */
export function OlExpand({ no, title, ch, scenes, onChange, close }: { no: number; title: string; ch: Pick<Chapter, "ol" | "olSeg" | "hook">; scenes: Scene[]; onChange: Change; close: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [close]);
  const n = (ch.olSeg ? parseOl(ch.ol ?? "").map((s) => s.t).join("") : ch.ol ?? "").replace(/\s/g, "").length;
  // 挂到 body 上：章卡是 sticky 的，弹窗放在里面会被右边的 AI 助手面板压住
  return createPortal(
    <div className="ol-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="ol-modal" role="dialog" aria-label={`第${no}章 本章大纲`}>
        <div className="ol-modal-h">
          <h4>
            第{no}章 {title || "（未命名）"} · 本章大纲
          </h4>
          <span className="ol-modal-meta">
            {n} 字 · <OlModeSwitch ch={ch} onChange={onChange} />
          </span>
          <button type="button" className="btn" onClick={close}>
            完成
          </button>
        </div>
        <div className="ol-modal-b">
          <div className="ol-modal-ed">
            <OlEditor ch={ch} onChange={onChange} big />
          </div>
          <aside className="ol-modal-ref" aria-label="本章场景">
            <h5>本章场景</h5>
            {scenes.length ? (
              <ol>
                {scenes.map((s, i) => (
                  <li key={i}>
                    <b>{s.t || `场景${i + 1}`}</b>
                    {s.goal && <div>目标：{s.goal}</div>}
                    {s.conf && <div>冲突：{s.conf}</div>}
                    {s.turn && <div>转折：{s.turn}</div>}
                    {s.result && <div>结果：{s.result}</div>}
                    {s.who.length > 0 && <div className="who-line">人物：{s.who.join("、")}</div>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">这一章还没拆场景。大纲写好后，可以回章卡里「在本章加场景」或让 AI 拆。</p>
            )}
            {ch.hook?.trim() && (
              <>
                <h5>章末钩子</h5>
                <p>{ch.hook}</p>
              </>
            )}
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}
