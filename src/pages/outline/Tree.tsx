import { useState } from "react";
import { useStore, toast } from "../../lib/store";
import { allChapters, applyVolumeSplit, dayLabel, findScene, newChapter, newScene, parseQuickChapters, SHARE, sceneToEvent, sortEvents, type ChRef } from "../../lib/outline";
import { phaseName, where } from "../../lib/plan";
import * as T from "../../lib/ai/tasks";
import { errText } from "../../lib/ai/client";
import { cnNum, uid } from "../../lib/util";
import { useSetting } from "../../lib/hooks";
import { AsyncButton, Empty, Field, Issue } from "../../components/ui";
import type { Say } from "./Outline";
import type { Scene } from "../../lib/types";
import { ctx, names } from "./ctx";
import { trashChapter, trashScene } from "../../lib/trash";
import * as repo from "../../lib/repo";

/** 选中的章和场景（场景序号 -1 表示只选了章） */
export interface Sel {
  ch: string | null;
  s: number;
  /** 选中了某一卷（看卷大纲） */
  vol?: string | null;
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
        AI 检查大纲
      </AsyncButton>
      <span hidden>{sel.ch}</span>
    </div>
  );
}

async function tidy(say: Say, setSel: (s: Sel) => void) {
  const vs = useStore.getState().vols;
  const empty = !vs.some((v) => v.outline?.trim() || v.chapters.some((c) => c.title.trim() || c.ol?.trim() || c.scenes.length));
  if (empty) return say(<Empty>大纲还是空的，没什么可检查的。先点卷名旁的「卷大纲」写这一卷的走向，或者给几章写上本章大纲，再来检查断线、伏笔和节奏。</Empty>);
  say(<Empty>正在读全书大纲，找断线、没收的伏笔和节奏问题……</Empty>);
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
  const [fold, setFold] = useSetting<Record<string, number>>("treeFold", {});
  const work = useStore((s) => s.work);
  const saveWorkInfo = useStore((s) => s.saveWorkInfo);
  const D = mode === "detail";
  const allFolded = vols.length > 0 && vols.every((v) => fold[v.id]);
  const toggle = (id: string) => setFold({ ...fold, [id]: fold[id] ? 0 : 1 });
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
        // 有篇幅规划时，拖过去的章按新位置更新所属阶段
        if (plan.length && item.pl) {
          const no = allChapters(d as any).find((r) => r.ch.id === item.id)?.no;
          const w = no ? where(plan, no) : null;
          if (w) item.pl = w;
        }
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
          <h3>全书梗概</h3>
          <textarea
            rows={3}
            value={work?.intro ?? ""}
            placeholder="这本书讲什么：主角是谁、想要什么、最大的阻碍、大致结局。AI 每次都会看到这段。"
            aria-label="全书梗概"
            onChange={(e) => saveWorkInfo({ intro: e.target.value })}
          />
        </div>
        <div className="panel" style={{ marginBottom: 12 }}>
          <h3>一句话拆成场景</h3>
          <div className="addrow" style={{ marginTop: 0 }}>
            <input value={split} placeholder="例如：主角第二次上天台，老人教他看见“多出来的东西”，但不肯说自己是谁" onChange={(e) => setSplit(e.target.value)} />
            <AsyncButton
              onClick={async () => {
                if (!split.trim() || !cur) return toast("先写一句话，再选好要放进的章");
                try {
                  const scenes = await T.splitScenes(ctx(), split, cur);
                  useStore.getState().aiEdit(`拆场景：${split.slice(0, 12)}`, ["vols", "events"], (d) => {
                    const ch = d.vols[cur.v].chapters[cur.c];
                    // 这句话就是本章大纲，本章还没写大纲时顺手存进去
                    if (!ch.ol?.trim()) ch.ol = split.trim();
                    const add = scenes.map((s) => ({ ...s, id: uid("s") }));
                    ch.scenes.push(...add);
                    const r = allChapters(d.vols as any).find((x) => x.ch.id === ch.id)!;
                    for (const sc of ch.scenes) if (add.some((a) => a.id === sc.id)) sceneToEvent(d.vols as any, d.events as any, sc as any, r);
                    sortEvents(d.events as any);
                  });
                  say(
                    <>
                      <p style={{ margin: "0 0 8px" }}>拆成了 {scenes.length} 个场景，放进第{cur.no}章，也加进了时间线。</p>
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
          <div className="tree-acts">
            <button className="btn sm" type="button" onClick={() => setFold(allFolded ? {} : Object.fromEntries([...vols.map((v) => [v.id, 1]), ...chs.map((r) => [r.ch.id, 1])]))}>
              {allFolded ? "全部展开" : "全部折叠"}
            </button>
          </div>
          {vols.map((v, vi) => (
            <div className="vol" key={v.id}>
              <h4>
                <button type="button" className="fold" aria-expanded={!fold[v.id]} title={fold[v.id] ? "展开这一卷" : "收起这一卷"} onClick={() => toggle(v.id)}>
                  {fold[v.id] ? "▸" : "▾"}
                </button>
                <input className="vol-name" value={v.title} aria-label="卷名" onChange={(e) => edit("vols", (d) => void (d[vi].title = e.target.value))} />
                <button className={"btn vol-ol" + (sel.vol === v.id ? " on" : "")} type="button" onClick={() => setSel({ ch: null, s: -1, vol: v.id })} title="写这一卷的完整大纲，再逐章细分">
                  卷大纲{v.outline?.trim() ? "" : "（未写）"}
                </button>
              </h4>
              {v.outline?.trim() && (
                <div className="vol-sum" onClick={() => setSel({ ch: null, s: -1, vol: v.id })}>
                  {v.outline.trim().slice(0, 80)}
                  {v.outline.trim().length > 80 ? "……" : ""}
                </div>
              )}
              {fold[v.id] ? (
                <div className="vol-sum" onClick={() => toggle(v.id)}>
                  已收起 · {v.chapters.length} 章，点这里展开
                </div>
              ) : null}
              {!fold[v.id] && chs
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
                        {r.ch.scenes.length > 0 ? (
                          <button type="button" className="fold" aria-expanded={!fold[r.ch.id]} title={fold[r.ch.id] ? "展开场景" : "收起场景"} onClick={(e) => { e.stopPropagation(); toggle(r.ch.id); }}>
                            {fold[r.ch.id] ? "▸" : "▾"}
                          </button>
                        ) : (
                          <span className="grip" aria-hidden="true">
                            ⋮⋮
                          </span>
                        )}
                        <b>
                          第{r.no}章 {r.ch.title || "（未命名）"}
                        </b>
                        {tg && <span className="pl">{tg}</span>}
                        <span className="st">
                          {r.ch.status} · {r.ch.scenes.length} 场{D && r.ch.w ? ` · ${r.ch.w} 字` : ""}
                        </span>
                      </div>
                      {r.ch.ol?.trim() && <div className="fn">{r.ch.ol.trim().slice(0, 60)}{r.ch.ol.trim().length > 60 ? "……" : ""}</div>}
                      {D && r.ch.fn && <div className="fn">作用：{r.ch.fn}</div>}
                      {r.ch.scenes.length > 0 && !fold[r.ch.id] && (
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
                              onDragOver={(e) => e.preventDefault()}
                              onDragEnd={() => setDrag(null)}
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
                                {!D && s.day != null && <small>{dayLabel(s.day)}</small>}
                                {D && (
                                  <small>
                                    {dayLabel(s.day)}{s.day != null && s.time ? " " + s.time : ""}
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
              {!fold[v.id] && <button
                className="btn addch"
                type="button"
                onClick={() => {
                  const c = newChapter("");
                  edit("vols", (d) => void d[vi].chapters.push(c));
                  setSel({ ch: c.id, s: -1 });
                }}
              >
                ＋ 加一章
              </button>}
            </div>
          ))}
          <button className="btn addch" type="button" onClick={() => edit("vols", (d) => void d.push({ id: uid("v"), title: `第${cnNum(d.length + 1)}卷`, chapters: [] }))}>
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
  const vi = sel.vol ? vols.findIndex((v) => v.id === sel.vol) : -1;
  if (vi >= 0) return <VolCard vi={vi} setSel={setSel} say={say} />;
  const r = allChapters(vols).find((x) => x.ch.id === sel.ch);
  if (!r) return <div className="panel det"><Empty>点左侧的章或场景来编辑，或点卷名旁的「卷大纲」先写整卷的走向。</Empty></div>;
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
        if (e) e[k] = k === "day" ? v ?? 1 : v;
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
          <Field label="本章大纲" hint="这一章发生什么，几句话就够。写正文时 AI 会照着它来">
            <textarea rows={3} value={r.ch.ol ?? ""} placeholder="例如：主角夜探档案室，发现父亲的名字被涂掉；被管理员撞见，只好编了个谎" onChange={(e) => setCh("ol", e.target.value)} />
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
                if (!confirm(`删除第${r.no}章？正文会一起放进回收站，30 天内可以在「设置 → 回收站」恢复。`)) return;
                trashChapter(useStore.getState().work!.id, r.v, r.c, r.no).then(() => toast("已放进回收站"));
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
            {s.who.filter((n) => n && !nm.includes(n)).length > 0 && (
              <div className="addrow" style={{ marginTop: 4 }}>
                <span className="src">这些人还不在人物表里：{s.who.filter((n) => n && !nm.includes(n)).join("、")}</span>
                <button
                  className="btn sm"
                  type="button"
                  onClick={() => {
                    const add = s.who.filter((n) => n && !nm.includes(n));
                    edit("chars", (d) => void d.push(...add.map((name) => ({ id: uid("p"), role: "配角", name, f: {} }))));
                    toast(`已加进人物表：${add.join("、")}，到「人物」页补设定`);
                  }}
                >
                  一键加进人物
                </button>
              </div>
            )}
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
                  第<input type="number" value={s.day ?? ""} onChange={(e) => setSc("day", num(e.target.value))} aria-label="第几天" />天
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
                  已关联时间线：<b>{ev.t}</b>（{dayLabel(ev.day)}）<small className="src"> · 标题、故事时间、时刻、地点、结果、信息揭示两边自动同步</small>
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
                const linked = s.ev && useStore.getState().events.find((x) => x.id === s.ev);
                const drop = !!linked && confirm(`这个场景关联了时间线上的事件「${linked.t}」。\n要把事件也一起删掉吗？\n\n选「确定」一起删；选「取消」只删场景，事件留在时间线上。`);
                trashScene(useStore.getState().work!.id, r.v, r.c, sel.s, drop);
                setSel({ ch: r.ch.id, s: -1 });
                toast(drop ? "场景已放进回收站，时间线上的事件也删了" : linked ? "场景已放进回收站，时间线上的事件保留" : "场景已放进回收站");
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

function VolCard({ vi, setSel, say }: { vi: number; setSel: (s: Sel) => void; say: Say }) {
  const vols = useStore((s) => s.vols);
  const edit = useStore((s) => s.edit);
  const v = vols[vi];
  const chs = allChapters(vols).filter((r) => r.v === vi);
  const [n, setN] = useState<number>(v.plan || Math.max(chs.length, 6));
  const [tl, setTl] = useState(true);
  const [quick, setQuick] = useState<string | null>(null);
  const setV = (k: "outline" | "plan" | "goal" | "climax" | "hook" | "words", val: any) => edit("vols", (d) => void ((d[vi] as any)[k] = val));
  const setOl = (c: number, k: "title" | "ol", val: string) => edit("vols", (d) => void ((d[vi].chapters[c] as any)[k] = val));

  return (
    <div className="panel det">
      <h3>卷大纲 · {v.title || `第${cnNum(vi + 1)}卷`}</h3>
      <Field label="整卷走向" hint="这一卷（或接下来几章）从哪里开始、经过哪些转折、到哪里结束。写多写少都行">
        <textarea
          rows={8}
          value={v.outline ?? ""}
          placeholder={"例如：\n主角被调到边城，起初只想混日子；\n第一次出城巡查撞见走私，顺藤摸瓜查到上司；\n上司反咬一口，主角被关进地牢；\n狱中结识老兵，得知父亲旧案的线索；\n卷末越狱，决定回京翻案。"}
          onChange={(e) => setV("outline", e.target.value)}
        />
      </Field>
      <div className="vol-meta">
        <Field label="本卷目标" hint="这一卷结束时主角要得到或失去什么">
          <input value={v.goal ?? ""} onChange={(e) => setV("goal", e.target.value)} />
        </Field>
        <Field label="本卷高潮" hint="最燃 / 最虐的那一场">
          <input value={v.climax ?? ""} onChange={(e) => setV("climax", e.target.value)} />
        </Field>
        <Field label="卷末钩子" hint="让读者追下一卷的悬念">
          <input value={v.hook ?? ""} onChange={(e) => setV("hook", e.target.value)} />
        </Field>
        <Field label="计划字数" hint={`已写的章 ${chs.length} 章`}>
          <input type="number" min={0} step={10000} value={v.words ?? ""} placeholder="例如 300000" onChange={(e) => setV("words", e.target.value === "" ? null : +e.target.value)} />
        </Field>
      </div>
      <div className="addrow" style={{ marginTop: 4, flexWrap: "wrap" }}>
        <label className="legend" style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
          拆成
          <input type="number" min={1} max={40} value={n} style={{ width: 64 }} aria-label="拆成几章" onChange={(e) => { const x = Math.max(1, Math.min(40, +e.target.value || 1)); setN(x); setV("plan", x); }} />
          章
        </label>
        <label className="legend" style={{ display: "flex", alignItems: "center", gap: 4, margin: 0 }}>
          <input type="checkbox" checked={tl} onChange={(e) => setTl(e.target.checked)} />
          新场景加进时间线
        </label>
        <AsyncButton
          primary
          disabled={!v.outline?.trim()}
          title={v.outline?.trim() ? "" : "先写卷大纲"}
          onClick={async () => {
            say(<Empty>正在把卷大纲拆成 {n} 章……</Empty>);
            try {
              const list = await T.splitVolume(ctx(), vi, n);
              say(<SplitPreview vi={vi} list={list} tl={tl} done={(node) => say(node)} />);
            } catch (e) {
              say(<p className="lint bad">{errText(e)}</p>);
            }
          }}
        >
          AI 拆成逐章大纲
        </AsyncButton>
      </div>
      <h4 className="dh">逐章大纲</h4>
      {!chs.length && <Empty>这一卷还没有章。可以自己加，也可以写好卷大纲后让 AI 拆。</Empty>}
      <div className="vol-chs">
        {chs.map((r) => (
          <div key={r.ch.id} className="vol-ch">
            <div className="vol-ch-t">
              <button type="button" className="linkish" onClick={() => setSel({ ch: r.ch.id, s: -1 })} title="打开章卡">
                第{r.no}章
              </button>
              <input value={r.ch.title} placeholder="章名" aria-label={`第${r.no}章章名`} onChange={(e) => setOl(r.c, "title", e.target.value)} />
              <small>{r.ch.scenes.length} 场</small>
            </div>
            <textarea rows={2} value={r.ch.ol ?? ""} placeholder="这一章发生什么" aria-label={`第${r.no}章大纲`} onChange={(e) => setOl(r.c, "ol", e.target.value)} />
          </div>
        ))}
      </div>
      <div className="addrow" style={{ flexWrap: "wrap" }}>
        <button className="btn" type="button" onClick={() => edit("vols", (d) => void d[vi].chapters.push(newChapter("")))}>
          ＋ 在这一卷加一章
        </button>
        <button className="btn" type="button" onClick={() => setQuick(quick === null ? "" : null)}>
          {quick === null ? "一次加多章" : "收起"}
        </button>
      </div>
      {quick !== null && (
        <div style={{ marginTop: 8 }}>
          <textarea
            rows={5}
            value={quick}
            placeholder={"一行一章，用「｜」分开章名、本章大纲、章末钩子（后两项可以不写）：\n初到边城｜主角报到，被派去守最破的城门｜城门外有人在夜里挖地道\n夜巡｜第一次出城巡查，撞见走私车队\n顺藤摸瓜"}
            onChange={(e) => setQuick(e.target.value)}
          />
          <div className="addrow">
            <button
              className="btn primary"
              type="button"
              disabled={!quick.trim()}
              onClick={async () => {
                const list = parseQuickChapters(quick);
                // 先填这一卷里完全空着的章（没章名、没大纲、没场景、没正文），比如新书自带的第一章
                const blank: string[] = [];
                for (const c of v.chapters) {
                  if (c.title.trim() || c.ol?.trim() || c.scenes.length) continue;
                  const t = await repo.loadText(c.id);
                  if (!t?.words) blank.push(c.id);
                }
                edit("vols", (d) => {
                  const q = [...list];
                  for (const c of d[vi].chapters) {
                    if (!q.length || !blank.includes(c.id)) continue;
                    const x = q.shift()!;
                    Object.assign(c, { title: x.t, ol: x.ol, hook: x.hook });
                  }
                  for (const x of q) d[vi].chapters.push({ ...newChapter(x.t), ol: x.ol, hook: x.hook });
                });
                toast(`加了 ${list.length} 章`);
                setQuick(null);
              }}
            >
              加进这一卷（{parseQuickChapters(quick).length} 章）
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SplitPreview({ vi, list, tl, done }: { vi: number; list: T.SplitChapter[]; tl: boolean; done: (n: ReturnType<typeof Empty>) => void }) {
  const vols = useStore((s) => s.vols);
  const [on, setOn] = useState<boolean[]>(() => list.map(() => true));
  const chs = vols[vi]?.chapters ?? [];
  return (
    <div>
      <p style={{ margin: "0 0 4px" }}>
        <b>拆章预览</b>
      </p>
      <p className="empty" style={{ margin: "0 0 8px" }}>
        勾选要用的章。已有的章只填空着的章名、大纲和钩子，已经有场景的章不加场景；多出来的在卷末新建。
      </p>
      {list.map((x, i) => {
        const ex = chs[i];
        return (
          <label className="sy-i" key={i}>
            <input type="checkbox" checked={on[i]} onChange={(e) => setOn(on.map((v, j) => (j === i ? e.target.checked : v)))} />
            <span>
              <b>{ex ? `补第 ${i + 1} 章` : "新建"}：{x.t}</b>
              <small>{x.ol}</small>
              {x.scenes.length > 0 && <small>场景：{x.scenes.map((s) => s.t).join("、")}{ex?.scenes.length ? "（这一章已有场景，不加）" : ""}</small>}
            </span>
          </label>
        );
      })}
      <button
        className="btn primary"
        type="button"
        disabled={!on.some(Boolean)}
        onClick={() => {
          let res = { filled: 0, added: 0, scenes: 0 };
          const v = useStore.getState().vols[vi];
          useStore.getState().aiEdit(`拆卷大纲：${v?.title ?? ""}`, ["vols", "events"], (d) => {
            res = applyVolumeSplit(d.vols as any, d.events as any, vi, list.map((x, i) => (on[i] ? x : null)), tl);
          });
          toast(`已写进大纲：补全 ${res.filled} 章，新建 ${res.added} 章`);
          done(
            <Empty>
              补全已有的 {res.filled} 章，新建 {res.added} 章，一共 {res.scenes} 个场景{tl ? "，都加进了时间线" : ""}。你写过的内容没动。不满意可以在「记忆」页的变更记录里整组撤销。
            </Empty>,
          );
        }}
      >
        写进大纲（{on.filter(Boolean).length} 章）
      </button>
    </div>
  );
}
