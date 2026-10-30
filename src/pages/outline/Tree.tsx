import { useState } from "react";
import { useStore, toast } from "../../lib/store";
import { allChapters, findScene, newChapter, newScene, SHARE, sceneToEvent, type ChRef } from "../../lib/outline";
import { phaseName } from "../../lib/plan";
import * as T from "../../lib/ai/tasks";
import { errText } from "../../lib/ai/client";
import { uid } from "../../lib/util";
import * as repo from "../../lib/repo";
import { AsyncButton, Empty, Field, Issue } from "../../components/ui";
import type { Say } from "./Outline";
import type { Scene } from "../../lib/types";
import { ctx, names } from "./ctx";

/** 选中的章和场景（场景序号 -1 表示只选了章） */
export interface Sel {
  ch: string | null;
  s: number;
}

const ST = ["大纲", "写作中", "已写"];

export function TreeActions({ mode, setMode, say, onSync, sel, setSel }: { mode: "simple" | "detail"; setMode: (m: "simple" | "detail") => void; say: Say; onSync: () => void; sel: Sel; setSel: (s: Sel) => void }) {
  return (
    <div className="acts">
      <span className="seg" role="group" aria-label="大纲视图" style={{ margin: 0, minWidth: 0 }}>
        <button type="button" aria-pressed={mode === "simple"} onClick={() => setMode("simple")}>
          简单版
        </button>
        <button type="button" aria-pressed={mode === "detail"} onClick={() => setMode("detail")}>
          详细版
        </button>
      </span>
      <button className="btn" type="button" onClick={onSync}>
        同步
      </button>
      <AsyncButton primary onClick={() => tidy(say, setSel)}>
        AI 梳理大纲
      </AsyncButton>
      <span hidden>{sel.ch}</span>
    </div>
  );
}

async function tidy(say: Say, setSel: (s: Sel) => void) {
  say(<Empty>正在读全书大纲……</Empty>);
  try {
    const issues = await T.tidyOutline(ctx());
    const show = (done: Record<number, boolean>) =>
      say(
        <>
          {issues.map((x, i) => (
            <Issue
              key={i}
              lv={x.lv}
              actions={
                <>
                  {x.add && (
                    <button className="btn" type="button" disabled={done[i]} onClick={() => { addFix(x); show({ ...done, [i]: true }); }}>
                      {done[i] ? "已加" : `在第${x.add.chapter}章加场景`}
                    </button>
                  )}
                  {x.goto && (
                    <button className="btn" type="button" onClick={() => { const r = allChapters(useStore.getState().vols).find((y) => y.no === x.goto); if (r) setSel({ ch: r.ch.id, s: -1 }); }}>
                      定位
                    </button>
                  )}
                </>
              }
            >
              {x.text}
            </Issue>
          ))}
          {!issues.length && <Empty>没有发现明显问题。</Empty>}
        </>,
      );
    show({});
  } catch (e) {
    say(<p className="lint bad">{errText(e)}</p>);
  }
}

function addFix(x: T.TidyIssue) {
  if (!x.add) return;
  useStore.getState().aiEdit(`梳理大纲：第${x.add.chapter}章加场景`, ["vols"], (d) => {
    const r = allChapters(d.vols as any).find((y) => y.no === x.add!.chapter);
    if (!r) return;
    d.vols[r.v].chapters[r.c].scenes.push({ ...newScene(x.add!.scene.t), goal: x.add!.scene.goal, conf: x.add!.scene.conf, who: x.add!.scene.who ?? [], plant: x.add!.scene.plant ?? "", pay: x.add!.scene.pay ?? "", ai: true });
  });
}

export function Tree({ mode, say, sel, setSel, goEvent }: { mode: "simple" | "detail"; say: Say; sel: Sel; setSel: (s: Sel) => void; goEvent: (id: string) => void }) {
  const vols = useStore((s) => s.vols);
  const plan = useStore((s) => s.plan);
  const edit = useStore((s) => s.edit);
  const [drag, setDrag] = useState<{ k: "c" | "s"; id: string; s?: number } | null>(null);
  const [split, setSplit] = useState("");
  const D = mode === "detail";
  const chs = allChapters(vols);
  const cur = chs.find((r) => r.ch.id === sel.ch) ?? chs[0];

  function drop(target: ChRef, si: number | null) {
    if (!drag) return;
    edit("vols", (d) => {
      const all = allChapters(d as any);
      const from = all.find((r) => r.ch.id === drag.id);
      const to = all.find((r) => r.ch.id === target.ch.id);
      if (!from || !to) return;
      if (drag.k === "c") {
        if (from.ch.id === to.ch.id) return;
        const [item] = d[from.v].chapters.splice(from.c, 1);
        const tc = d[to.v].chapters.findIndex((c) => c.id === to.ch.id);
        d[to.v].chapters.splice(tc, 0, item);
      } else {
        const [s] = d[from.v].chapters[from.c].scenes.splice(drag.s!, 1);
        const arr = d[to.v].chapters.find((c) => c.id === to.ch.id)!.scenes;
        let ts = si ?? arr.length;
        if (from.ch.id === to.ch.id && drag.s! < ts) ts--;
        arr.splice(ts, 0, s);
      }
    });
    setDrag(null);
    toast("顺序已调整，章节号会自动重排");
  }

  return (
    <div className="split">
      <div>
        <div className="panel" style={{ marginBottom: 12 }}>
          <h3>一句话拆成场景</h3>
          <div className="addrow" style={{ marginTop: 0 }}>
            <input value={split} placeholder="例如：主角第二次上天台，老人教他看见“多出来的东西”，但不肯说自己是谁" onChange={(e) => setSplit(e.target.value)} />
            <AsyncButton
              onClick={async () => {
                if (!split.trim() || !cur) return toast("先写一句话，再选好要放进的章");
                try {
                  const scenes = await T.splitScenes(ctx(), split, cur);
                  useStore.getState().aiEdit(`拆场景：${split.slice(0, 12)}`, ["vols"], (d) => {
                    const ch = d.vols[cur.v].chapters[cur.c];
                    ch.scenes.push(...scenes.map((s) => ({ ...s, id: uid("s") })));
                  });
                  say(
                    <>
                      <p style={{ margin: "0 0 8px" }}>拆成了 {scenes.length} 个场景，放进第{cur.no}章。</p>
                      <p className="empty" style={{ margin: 0 }}>只给了每场的目标和冲突，没写对白和描写，正文留给你。</p>
                    </>,
                  );
                  setSplit("");
                } catch (e) {
                  say(<p className="lint bad">{errText(e)}</p>);
                }
              }}
            >
              AI 拆成场景
            </AsyncButton>
          </div>
          <div className="legend">拆出的场景放进当前选中的章{cur ? `（第${cur.no}章）` : ""}。</div>
        </div>
        <div className="tree">
          {vols.map((v, vi) => (
            <div className="vol" key={v.id}>
              <h4>
                <input className="vol-name" value={v.title} aria-label="卷名" onChange={(e) => edit("vols", (d) => void (d[vi].title = e.target.value))} />
              </h4>
              {chs
                .filter((r) => r.v === vi)
                .map((r) => {
                  const on = sel.ch === r.ch.id && sel.s < 0;
                  const tg = phaseName(plan, r.ch.pl);
                  return (
                    <div
                      key={r.ch.id}
                      className={"ch" + (on ? " on" : "") + (r.ch.scenes.length ? "" : " bare") + (drag?.id === r.ch.id && drag.k === "c" ? " dragging" : "")}
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.setData("text/plain", "c");
                        setDrag({ k: "c", id: r.ch.id });
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        drop(r, null);
                      }}
                      onDragEnd={() => setDrag(null)}
                    >
                      <div className="cht" onClick={() => setSel({ ch: r.ch.id, s: -1 })}>
                        <span className="grip" aria-hidden="true">
                          ⋮⋮
                        </span>
                        <b>
                          第{r.no}章 {r.ch.title || "（未命名）"}
                        </b>
                        {tg && <span className="pl">{tg}</span>}
                        <span className="st">
                          {r.ch.status} · {r.ch.scenes.length} 场{D && r.ch.w ? ` · ${r.ch.w} 字` : ""}
                        </span>
                      </div>
                      {D && r.ch.fn && <div className="fn">{r.ch.fn}</div>}
                      {r.ch.scenes.length > 0 && (
                        <ul className="scs">
                          {r.ch.scenes.map((s, si) => (
                            <li
                              key={s.id}
                              className={"sc" + (sel.ch === r.ch.id && sel.s === si ? " sel" : "")}
                              draggable
                              onDragStart={(e) => {
                                e.stopPropagation();
                                e.dataTransfer.setData("text/plain", "s");
                                setDrag({ k: "s", id: r.ch.id, s: si });
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                drop(r, si);
                              }}
                              onClick={() => setSel({ ch: r.ch.id, s: si })}
                            >
                              <span className="grip" aria-hidden="true">
                                ⋮⋮
                              </span>
                              <span className="sct">
                                {s.t}
                                {D && (
                                  <small>
                                    {s.day ? `第 ${s.day} 天${s.time ? " " + s.time : ""}` : "时间未定"}
                                    {s.pov ? ` · ${s.pov}视角` : ""}
                                    {s.place ? ` · ${s.place}` : ""}
                                  </small>
                                )}
                              </span>
                              <span className="pp">
                                {s.ev && (
                                  <span className="ty link" title="已关联时间线事件">
                                    线
                                  </span>
                                )}
                                {s.plant && <span className="ty plant">埋</span>}
                                {s.pay && <span className="ty pay">收</span>}
                                {s.ai && <span className="chip">AI</span>}
                                {s.from && <span className="chip">来自{s.from}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              <button
                className="btn addch"
                type="button"
                onClick={() => {
                  const c = newChapter("");
                  edit("vols", (d) => void d[vi].chapters.push(c));
                  setSel({ ch: c.id, s: -1 });
                }}
              >
                ＋ 加一章
              </button>
            </div>
          ))}
          <button className="btn addch" type="button" onClick={() => edit("vols", (d) => void d.push({ id: uid("v"), title: `第${d.length + 1}卷`, chapters: [] }))}>
            ＋ 加一卷
          </button>
        </div>
      </div>
      <Det mode={mode} sel={sel} setSel={setSel} say={say} goEvent={goEvent} />
    </div>
  );
}

function Det({ mode, sel, setSel, say, goEvent }: { mode: "simple" | "detail"; sel: Sel; setSel: (s: Sel) => void; say: Say; goEvent: (id: string) => void }) {
  const vols = useStore((s) => s.vols);
  const events = useStore((s) => s.events);
  const plan = useStore((s) => s.plan);
  const chars = useStore((s) => s.chars);
  const edit = useStore((s) => s.edit);
  const editMany = useStore((s) => s.editMany);
  const openChapter = useStore((s) => s.openChapter);
  const r = allChapters(vols).find((x) => x.ch.id === sel.ch);
  if (!r) return <div className="panel det"><Empty>点左侧的章或场景来编辑。</Empty></div>;
  const s = sel.s >= 0 ? r.ch.scenes[sel.s] : undefined;
  const D = mode === "detail";
  const nm = chars.map((c) => c.name).filter(Boolean);
  const setCh = (k: string, v: any) => edit("vols", (d) => void ((d[r.v].chapters[r.c] as any)[k] = v));
  const setSc = (k: keyof Scene, v: any) =>
    editMany(["vols", "events"], (d) => {
      const sc = d.vols[r.v].chapters[r.c].scenes[sel.s] as any;
      sc[k] = v;
      // 已关联的事件保持一致
      if ((SHARE as readonly string[]).includes(k as string) && sc.ev) {
        const e = d.events.find((x) => x.id === sc.ev) as any;
        if (e) e[k] = k === "day" ? v || 1 : v;
      }
    });
  const plOpts: [string, string][] = [["", "未归属"]];
  plan.forEach((a, ai) => {
    if (a.gap) plOpts.push([`${ai}:-1`, `${a.name} · 段前过渡`]);
    a.ph.forEach((p, pi) => plOpts.push([`${ai}:${pi}`, `${a.name} · ${p.n}`]));
  });
  const ev = s?.ev ? events.find((e) => e.id === s.ev) : undefined;
  const num = (v: string) => (v === "" ? null : +v);

  return (
    <div className="panel det">
      {(D || !s) && (
        <>
          <h3>章卡 · 第{r.no}章</h3>
          <Field label="章名">
            <input className="t" value={r.ch.title} onChange={(e) => setCh("title", e.target.value)} aria-label="章名" />
          </Field>
          <Field label="状态">
            <select value={r.ch.status} onChange={(e) => setCh("status", e.target.value)} aria-label="状态">
              {ST.map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="所属阶段" hint="对应篇幅规划里的事件段和阶段">
            <select value={r.ch.pl ? `${r.ch.pl.a}:${r.ch.pl.p}` : ""} aria-label="所属阶段" onChange={(e) => { const q = e.target.value.split(":"); setCh("pl", e.target.value ? { a: +q[0], p: +q[1] } : null); }}>
              {plOpts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          {D && (
            <>
              <Field label="本章作用"><textarea rows={2} value={r.ch.fn ?? ""} placeholder="这一章在全书里负责什么" onChange={(e) => setCh("fn", e.target.value)} /></Field>
              <Field label="预计字数"><input type="number" min={0} value={r.ch.w ?? ""} onChange={(e) => setCh("w", num(e.target.value))} /></Field>
              <Field label="章末钩子"><textarea rows={2} value={r.ch.hook ?? ""} placeholder="让读者想翻下一章的东西" onChange={(e) => setCh("hook", e.target.value)} /></Field>
              <Field label="备注"><textarea rows={1} value={r.ch.note ?? ""} onChange={(e) => setCh("note", e.target.value)} /></Field>
              {r.ch.summary && <Field label="AI 摘要"><div className="ro">{r.ch.summary}</div></Field>}
            </>
          )}
          <div className="ft" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: s ? 16 : 0 }}>
            <button className="btn" type="button" onClick={() => { edit("vols", (d) => void d[r.v].chapters[r.c].scenes.push(newScene())); setSel({ ch: r.ch.id, s: r.ch.scenes.length }); }}>
              在本章加场景
            </button>
            <button className="btn" type="button" onClick={() => openChapter(r.ch.id)}>
              去写这一章
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                if (!confirm(`删除第${r.no}章？正文也会一起删除。`)) return;
                const sids = new Set(r.ch.scenes.map((x) => x.id));
                useStore.getState().editMany(["vols", "events"], (d) => {
                  d.vols[r.v].chapters.splice(r.c, 1);
                  for (const e of d.events) {
                    if (e.sc && sids.has(e.sc)) delete e.sc;
                    if (e.ch === r.ch.id) e.ch = null;
                  }
                });
                repo.deleteText(r.ch.id);
                setSel({ ch: null, s: -1 });
              }}
            >
              删除本章
            </button>
          </div>
        </>
      )}
      {s && (
        <>
          <h3>场景卡 · 第{r.no}章</h3>
          <Field label="标题"><input className="t" value={s.t} onChange={(e) => setSc("t", e.target.value)} aria-label="标题" /></Field>
          {(["goal", "conf", "plant", "pay"] as const).map((k) => (
            <Field key={k} label={{ goal: "目标", conf: "冲突", plant: "埋伏笔", pay: "收伏笔" }[k]}>
              <textarea rows={2} value={s[k] ?? ""} onChange={(e) => setSc(k, e.target.value)} />
            </Field>
          ))}
          <Field label="出场人物">
            <div className="who">
              {[...new Set([...nm, ...s.who])].map((n) => (
                <label key={n}>
                  <input type="checkbox" checked={s.who.includes(n)} onChange={(e) => setSc("who", e.target.checked ? [...s.who, n] : s.who.filter((x) => x !== n))} />
                  {n}
                </label>
              ))}
              {!nm.length && <span className="src">先到「人物」里加人物</span>}
            </div>
          </Field>
          {D && (
            <>
              <h4 className="dh">详细项</h4>
              <Field label="视角">
                <select value={s.pov ?? ""} onChange={(e) => setSc("pov", e.target.value)} aria-label="视角">
                  <option value="">未定</option>
                  {nm.map((n) => <option key={n}>{n}</option>)}
                </select>
              </Field>
              <Field label="故事时间">
                <div className="two">
                  第<input type="number" min={0} value={s.day ?? ""} onChange={(e) => setSc("day", num(e.target.value))} aria-label="第几天" />天
                  <input value={s.time ?? ""} placeholder="时刻，如 23:40" onChange={(e) => setSc("time", e.target.value)} aria-label="时刻" />
                </div>
              </Field>
              <Field label="地点"><input value={s.place ?? ""} onChange={(e) => setSc("place", e.target.value)} aria-label="地点" /></Field>
              <Field label="转折"><textarea rows={2} value={s.turn ?? ""} placeholder="这一场在哪里拐了弯" onChange={(e) => setSc("turn", e.target.value)} /></Field>
              <Field label="结果"><textarea rows={2} value={s.result ?? ""} placeholder="场景结束时局面变成什么样" onChange={(e) => setSc("result", e.target.value)} /></Field>
              <Field label="情绪">
                <div className="two">
                  <input value={s.moodA ?? ""} placeholder="开场" onChange={(e) => setSc("moodA", e.target.value)} aria-label="开场情绪" />→
                  <input value={s.moodB ?? ""} placeholder="收尾" onChange={(e) => setSc("moodB", e.target.value)} aria-label="收尾情绪" />
                </div>
              </Field>
              <Field label="节奏">
                <select value={s.pace ?? ""} onChange={(e) => setSc("pace", e.target.value)} aria-label="节奏">
                  <option value="">未定</option>
                  <option>慢</option>
                  <option>中</option>
                  <option>快</option>
                </select>
              </Field>
              <Field label="信息揭示"><textarea rows={2} value={s.reveal ?? ""} placeholder="读者或角色在这一场知道了什么" onChange={(e) => setSc("reveal", e.target.value)} /></Field>
              <Field label="预估字数"><input type="number" min={0} value={s.words ?? ""} onChange={(e) => setSc("words", num(e.target.value))} /></Field>
              <Field label="状态">
                <select value={s.st ?? ""} onChange={(e) => setSc("st", e.target.value)} aria-label="场景状态">
                  <option value="">跟随章节</option>
                  {ST.map((x) => <option key={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="备注"><textarea rows={1} value={s.note ?? ""} onChange={(e) => setSc("note", e.target.value)} /></Field>
            </>
          )}
          <div className="lk">
            {ev ? (
              <>
                <span>
                  已关联时间线：<b>{ev.t}</b>（第 {ev.day} 天）
                </span>
                <button className="btn" type="button" onClick={() => goEvent(ev.id)}>在时间线中查看</button>
              </>
            ) : (
              <>
                <span>这个场景还没放进时间线</span>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    let day = 0;
                    editMany(["vols", "events"], (d) => {
                      const f = findScene(d.vols as any, s.id);
                      if (f) day = sceneToEvent(d.vols as any, d.events as any, f.s as any, f.r).day;
                    });
                    toast(`已加入时间线：第 ${day} 天`);
                  }}
                >
                  加入时间线
                </button>
              </>
            )}
          </div>
          <div className="ft" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <AsyncButton
              onClick={async () => {
                try {
                  const x = await T.fillScene(ctx(), r, s);
                  useStore.getState().aiEdit(`补全场景「${s.t}」`, ["vols"], (d) => {
                    const sc = d.vols[r.v].chapters[r.c].scenes[sel.s];
                    if (!sc.goal && x.goal) sc.goal = x.goal;
                    if (!sc.conf && x.conf) sc.conf = x.conf;
                  });
                  say(<p style={{ margin: 0 }}>补了目标和冲突，依据是本章其他场景和人物设定。</p>);
                } catch (e) {
                  say(<p className="lint bad">{errText(e)}</p>);
                }
              }}
            >
              AI 补全目标和冲突
            </AsyncButton>
            <button
              className="btn"
              type="button"
              onClick={() => {
                editMany(["vols", "events"], (d) => {
                  const sc = d.vols[r.v].chapters[r.c].scenes[sel.s];
                  const e = sc.ev && d.events.find((x) => x.id === sc.ev);
                  if (e) delete e.sc;
                  d.vols[r.v].chapters[r.c].scenes.splice(sel.s, 1);
                });
                setSel({ ch: r.ch.id, s: -1 });
                toast("场景已删除，时间线上的事件保留");
              }}
            >
              删除场景
            </button>
          </div>
        </>
      )}
      <span hidden>{names().length}</span>
    </div>
  );
}
