import { useRef, useState } from "react";
import { useStore } from "../../lib/store";
import { allChapters } from "../../lib/outline";
import { applyPaceFix, bookLen, KIND, newArc, paceCheck, ranges, redistribute, total, TYPES, type PaceIssue } from "../../lib/plan";
import { Empty, Issue } from "../../components/ui";
import type { Say } from "./Outline";
import type { PhaseKind } from "../../lib/types";

export function PlanActions({ say, onSync }: { say: Say; onSync: () => void }) {
  const showPace = () => {
    const out = paceCheck(useStore.getState().plan);
    const render = (done: Record<number, boolean>) =>
      say(
        out.length ? (
          <>
            {out.map((o, i) => (
              <Issue
                key={i}
                lv={o.lv}
                actions={
                  o.fix && (
                    <button
                      className="btn"
                      type="button"
                      disabled={done[i]}
                      onClick={() => {
                        useStore.getState().aiEdit("梳理节奏：" + o.text.slice(0, 12), ["plan"], (d) => applyPaceFix(d.plan as any, o.fix as NonNullable<PaceIssue["fix"]>));
                        render({ ...done, [i]: true });
                      }}
                    >
                      {done[i] ? "已采纳" : "采纳"}
                    </button>
                  )
                }
              >
                {o.text}
              </Issue>
            ))}
          </>
        ) : (
          <Empty>节奏没有明显问题。</Empty>
        ),
      );
    render({});
  };
  return (
    <div className="acts">
      <button className="btn" type="button" onClick={onSync}>
        同步到大纲
      </button>
      <button className="btn primary" type="button" onClick={showPace}>
        梳理节奏
      </button>
    </div>
  );
}

export function Plan({ say }: { say: Say }) {
  const plan = useStore((s) => s.plan);
  const vols = useStore((s) => s.vols);
  const work = useStore((s) => s.work)!;
  const edit = useStore((s) => s.edit);
  const [na, setNa] = useState({ name: "", type: "explore", total: 20, gap: 2 });
  const [totals, setTotals] = useState<Record<number, number>>({});
  const drag = useRef<{ a: number; p: number; x: number; cw: number; acc: number } | null>(null);
  const [dragOn, setDragOn] = useState<string | null>(null);
  const N = bookLen(plan);
  const R = ranges(plan);
  const chs = allChapters(vols);
  const tagged = (a: number) => chs.filter((r) => r.ch.pl?.a === a).length;

  const ticks = [];
  for (let t = 10; t <= N; t += 10) ticks.push(t);

  return (
    <>
      <div className="panel">
        <h3>全书篇幅 · 拖动阶段之间的竖线可以调整章数</h3>
        {plan.length ? (
          <div className="ruler-wrap">
            <div
              className="ruler"
              onPointerMove={(e) => {
                const d0 = drag.current;
                if (!d0) return;
                let d = Math.round((e.clientX - d0.x) / d0.cw) - d0.acc;
                if (!d) return;
                const ph = plan[d0.a].ph;
                const L = ph[d0.p];
                const Rr = ph[d0.p + 1];
                if (L.c + d < 1) d = 1 - L.c;
                if (Rr.c - d < 1) d = Rr.c - 1;
                if (!d) return;
                d0.acc += d;
                edit("plan", (x) => {
                  x[d0.a].ph[d0.p].c += d;
                  x[d0.a].ph[d0.p + 1].c -= d;
                });
              }}
              onPointerUp={() => {
                drag.current = null;
                setDragOn(null);
              }}
              onPointerCancel={() => {
                drag.current = null;
                setDragOn(null);
              }}
            >
              <div className="arcs">
                {plan.map((a, ai) => [
                  a.gap ? (
                    <div key={"g" + ai} className="gap" style={{ flex: a.gap }} title={`过渡 ${a.gap} 章`}>
                      {a.gap} 章
                    </div>
                  ) : null,
                  <div key={"a" + ai} className="arc" style={{ flex: total(a) }}>
                    {a.ph.map((p, pi) => (
                      <div key={pi} className={"ph k-" + p.k} style={{ width: (p.c / total(a)) * 100 + "%" }} title={`${p.n} ${p.c} 章`}>
                        <b>{p.n}</b>
                        <span>{p.c} 章</span>
                        {pi < a.ph.length - 1 && (
                          <i
                            className={"hdl" + (dragOn === `${ai}:${pi}` ? " on" : "")}
                            role="separator"
                            aria-label={`拖动调整 ${p.n} 的章数`}
                            onPointerDown={(e) => {
                              e.preventDefault();
                              const arcEl = (e.target as HTMLElement).closest(".arc")!;
                              drag.current = { a: ai, p: pi, x: e.clientX, cw: arcEl.getBoundingClientRect().width / total(a), acc: 0 };
                              setDragOn(`${ai}:${pi}`);
                              (e.target as HTMLElement).closest(".ruler")!.setPointerCapture(e.pointerId);
                            }}
                          />
                        )}
                      </div>
                    ))}
                  </div>,
                ])}
              </div>
              <div className="names">
                {plan.map((a, ai) => [
                  a.gap ? <div key={"g" + ai} style={{ flex: a.gap }} /> : null,
                  <div key={"n" + ai} style={{ flex: total(a) }}>
                    <div className="an">{a.name}</div>
                    <div className="rg">
                      第 {R[ai].s}–{R[ai].e} 章
                    </div>
                  </div>,
                ])}
              </div>
              <div className="ticks">
                {ticks.map((t) => (
                  <span key={t} style={{ left: ((t - 0.5) / N) * 100 + "%" }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <Empty>还没有事件段。在下面新增一个，比如“探索遗迹 30 章”，AI 会按类型给出各阶段的章数。</Empty>
        )}
        <div className="plan-sum">
          <span>
            全书规划 <b>{N}</b> 章
          </span>
          <span>
            事件段 <b>{plan.length}</b> 个
          </span>
          <span>
            过渡章 <b>{plan.reduce((s, a) => s + a.gap, 0)}</b> 章
          </span>
          <span>
            大纲里已有 <b>{chs.length}</b> 章
          </span>
          <span>
            按每章约 {work.chapWords} 字、日更 {work.goal} 字，约 <b>{Math.ceil((N * work.chapWords) / Math.max(1, work.goal))}</b> 天写完
          </span>
        </div>
      </div>

      <div className="arcs-ed">
        {plan.map((a, ai) => (
          <div key={ai}>
            {(ai > 0 || a.gap > 0) && (
              <div className="gap-ed">
                与上一段间隔 <input type="number" min={0} value={a.gap} aria-label="间隔章数" onChange={(e) => edit("plan", (d) => void (d[ai].gap = Math.max(0, +e.target.value || 0)))} /> 章
                {a.gap > 0 && `（第 ${R[ai].g0}–${R[ai].g1} 章，日常或支线过渡）`}
              </div>
            )}
            <div className="arc-ed">
              <div className="top2">
                <input className="nm" value={a.name} aria-label="事件名" onChange={(e) => edit("plan", (d) => void (d[ai].name = e.target.value))} />
                <span className="rng">
                  第 {R[ai].s}–{R[ai].e} 章 · 共 {total(a)} 章 · 大纲已归入 {tagged(ai)} 章
                </span>
              </div>
              <div className="phs">
                {a.ph.map((p, pi) => (
                  <div className="phr" key={pi}>
                    <select value={p.k} aria-label="阶段类型" onChange={(e) => edit("plan", (d) => void (d[ai].ph[pi].k = e.target.value as PhaseKind))}>
                      {(Object.keys(KIND) as PhaseKind[]).map((k) => (
                        <option key={k} value={k}>
                          {KIND[k]}
                        </option>
                      ))}
                    </select>
                    <input value={p.n} aria-label="阶段名" onChange={(e) => edit("plan", (d) => void (d[ai].ph[pi].n = e.target.value))} />
                    <input type="number" min={1} value={p.c} aria-label="章数" onChange={(e) => edit("plan", (d) => void (d[ai].ph[pi].c = Math.max(1, +e.target.value || 1)))} />
                    <input className={"goal" + (p.ai ? " aid" : "")} value={p.g} placeholder="这一阶段要完成什么（只写目标，不写细节）" aria-label="阶段目标" onChange={(e) => edit("plan", (d) => { d[ai].ph[pi].g = e.target.value; d[ai].ph[pi].ai = false; })} />
                    <button className="x" type="button" aria-label="删除阶段" onClick={() => a.ph.length > 1 && edit("plan", (d) => void d[ai].ph.splice(pi, 1))}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="ft2">
                <button className="btn" type="button" onClick={() => edit("plan", (d) => void d[ai].ph.push({ k: "free", n: "新阶段", c: 2, g: "" }))}>
                  加一个阶段
                </button>
                <span className="tot">
                  总章数 <input type="number" min={3} value={totals[ai] ?? total(a)} aria-label="总章数" onChange={(e) => setTotals({ ...totals, [ai]: +e.target.value })} />
                </span>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    const T = Math.max(3, totals[ai] ?? total(a));
                    edit("plan", (d) => redistribute(d[ai] as any, T));
                    say(<p style={{ margin: 0 }}>「{a.name}」改成 {T} 章，按原来的比例重新分配。</p>);
                  }}
                >
                  按总数重新分配
                </button>
                <button className="btn" type="button" onClick={() => confirm(`删除事件段「${a.name}」？`) && edit("plan", (d) => void d.splice(ai, 1))}>
                  删除事件段
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <h3>新增事件段</h3>
        <div className="addrow" style={{ marginTop: 0, flexWrap: "wrap" }}>
          <input value={na.name} placeholder="事件名，例如：探索遗迹" onChange={(e) => setNa({ ...na, name: e.target.value })} />
          <select className="btn" value={na.type} aria-label="事件类型" onChange={(e) => setNa({ ...na, type: e.target.value })}>
            {TYPES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <input type="number" min={3} value={na.total} aria-label="总章数" style={{ maxWidth: 80 }} onChange={(e) => setNa({ ...na, total: +e.target.value })} />
          <input type="number" min={0} value={na.gap} aria-label="与上一段间隔章数" style={{ maxWidth: 80 }} onChange={(e) => setNa({ ...na, gap: +e.target.value })} />
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              const a = newArc(na.name.trim() || "新事件段", na.type, Math.max(3, na.total || 20), Math.max(0, na.gap || 0));
              useStore.getState().aiEdit(`新增事件段「${a.name}」`, ["plan"], (d) => void d.plan.push(a));
              say(
                <>
                  <p style={{ margin: "0 0 6px" }}>已添加「{a.name}」，共 {total(a)} 章：</p>
                  <ul style={{ margin: "0 0 6px", paddingLeft: 18 }}>
                    {a.ph.map((p, i) => (
                      <li key={i}>
                        {p.n} {p.c} 章
                      </li>
                    ))}
                  </ul>
                  <p className="empty" style={{ margin: 0 }}>比例来自这个类型的常见节奏。浅黄底的阶段目标是自动填的，只是方向，不含具体情节。</p>
                </>,
              );
              setNa({ ...na, name: "" });
            }}
          >
            按类型分配后添加
          </button>
        </div>
        <div className="legend">依次是：事件名、类型、总章数、与上一段隔几章。之后都可以手动调。</div>
      </div>
    </>
  );
}
