import { useEffect, useState, type MouseEvent } from "react";
import { useStore, toast } from "../../lib/store";
import { allChapters, applyVolumeSplit, chapterRanges, pickChapters, dayLabel, findScene, moveChapter, moveScene, newChapter, newScene, parseQuickChapters, SHARE, sceneToEvent, sortEvents, type ChRef } from "../../lib/outline";
import { phaseName } from "../../lib/plan";
import * as T from "../../lib/ai/tasks";
import { errText } from "../../lib/ai/client";
import { cnNum, uid } from "../../lib/util";
import { useSetting } from "../../lib/hooks";
import { AsyncButton, Empty, Field, Issue } from "../../components/ui";
import type { Say } from "./Outline";
import type { Scene } from "../../lib/types";
import { addMentioned, mentioned, SCENE_TEXT, sceneText } from "../../lib/mention";
import { ctx, names } from "./ctx";
import { trashChapter, trashChapters, trashScene } from "../../lib/trash";
import * as repo from "../../lib/repo";
import * as arc from "../../lib/ai/archive";
import { olText } from "../../lib/chapterOutline";
import { OlEditor, OlExpand, OlModeSwitch, OlView } from "../../components/OlEditor";
import { FocusField } from "../../components/FocusField";

/** 选中的章和场景（场景序号 -1 表示只选了章） */
export interface Sel {
  ch: string | null;
  s: number;
  /** 选中了某一卷（看卷大纲） */
  vol?: string | null;
}

const ST = ["大纲", "写作中", "已写"];

/** 所属阶段下拉的选项：[值, 显示名]，值是 "段:阶段"，空串是未归属 */
function phaseOptions(plan: ReturnType<typeof useStore.getState>["plan"]): [string, string][] {
  const out: [string, string][] = [["", "未归属"]];
  plan.forEach((a, ai) => {
    if (a.gap) out.push([`${ai}:-1`, `${a.name} · 段前过渡`]);
    a.ph.forEach((p, pi) => out.push([`${ai}:${pi}`, `${a.name} · ${p.n}`]));
  });
  return out;
}

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
  const empty = !vs.some((v) => v.outline?.trim() || v.chapters.some((c) => c.title.trim() || olText(c) || c.scenes.length));
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
    d.vols[r.v].chapters[r.c].scenes.push({ ...newScene(x.add!.scene.t), goal: x.add!.scene.goal, conf: x.add!.scene.conf, who: [...new Set([...(x.add!.scene.who ?? []), ...mentioned(useStore.getState().chars, [x.add!.scene.t, x.add!.scene.goal, x.add!.scene.conf].join("\n"))])], plant: x.add!.scene.plant ?? "", pay: x.add!.scene.pay ?? "", ai: true });
  });
}

export function Tree({ mode, say, sel, setSel, goEvent }: { mode: "simple" | "detail"; say: Say; sel: Sel; setSel: (s: Sel) => void; goEvent: (id: string) => void }) {
  const vols = useStore((s) => s.vols);
  const plan = useStore((s) => s.plan);
  const edit = useStore((s) => s.edit);
  const editMany = useStore((s) => s.editMany);
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
  // 多选的章（Ctrl / Shift 点章名），两章以上时右边换成批量操作卡
  const [pick, setPick] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const picked = pick.filter((id) => chs.some((r) => r.ch.id === id));
  const multi = picked.length >= 2;

  useEffect(() => {
    if (!multi) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setPick([]);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [multi]);

  function clickChapter(e: MouseEvent, id: string) {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      const next = pickChapters(chs.map((r) => r.ch.id), picked, id, e.shiftKey ? "range" : "toggle", anchor, sel.s < 0 ? sel.ch : null);
      if (!e.shiftKey) setAnchor(id);
      else if (!anchor) setAnchor(sel.ch ?? id);
      if (next.length >= 2) return setPick(next);
      setPick([]);
      if (next.length === 1) setSel({ ch: next[0], s: -1 });
      return;
    }
    setPick([]);
    setAnchor(id);
    setSel({ ch: id, s: -1 });
  }

  // 打开大纲页时（比如从写作页切过来）直接滚到选中的章；这一卷收起了就先展开
  useEffect(() => {
    const r = chs.find((x) => x.ch.id === sel.ch);
    if (!r || r === chs[0]) return;
    const vid = vols[r.v]?.id;
    if (vid && fold[vid]) setFold({ ...fold, [vid]: 0 });
    const t = setTimeout(() => document.querySelector(`[data-ch="${r.ch.id}"]`)?.scrollIntoView({ block: "center" }), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 换了选中的章或场景，右边章卡回到顶部
  useEffect(() => {
    document.querySelector(".split > .det")?.scrollTo?.(0, 0);
  }, [sel.ch, sel.s, sel.vol]);

  /** target 是章时放到这一章（si 为场景位置）；是数字时表示把章放到这一卷末尾 */
  function drop(target: ChRef | number, si: number | null) {
    if (!drag) return;
    // 选中状态记的是场景序号，拖完按 id 找回原来选中的场景
    const selId = sel.ch && sel.s >= 0 ? chs.find((r) => r.ch.id === sel.ch)?.ch.scenes[sel.s]?.id : undefined;
    let moved = false;
    if (drag.k === "c") edit("vols", (d) => void (moved = typeof target === "number" ? moveChapter(d as any, plan, drag.id, null, target) : moveChapter(d as any, plan, drag.id, target.ch.id)));
    else if (typeof target !== "number") editMany(["vols", "events"], (d) => void (moved = moveScene(d.vols as any, d.events as any, drag.id, drag.s!, target.ch.id, si)));
    setDrag(null);
    if (!moved) return;
    const f = selId ? findScene(useStore.getState().vols, selId) : undefined;
    if (f) setSel({ ch: f.r.ch.id, s: f.i });
    toast("顺序已调整，章节号会自动重排");
  }

  return (
    <div className="split">
      <div>
        <RippleBanner say={say} />
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
                    if (!olText(ch)) ch.ol = split.trim();
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
            <div
              className="vol"
              key={v.id}
              onDragOver={(e) => drag?.k === "c" && e.preventDefault()}
              onDrop={(e) => {
                // 章放在卷标题、空白处或「加一章」上：放到这一卷末尾，空卷也能拖进来
                if (drag?.k !== "c") return;
                e.preventDefault();
                drop(vi, null);
              }}
            >
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
                  const on = multi ? picked.includes(r.ch.id) : sel.ch === r.ch.id && sel.s < 0;
                  const tg = phaseName(plan, r.ch.pl);
                  return (
                    <div
                      key={r.ch.id}
                      data-ch={r.ch.id}
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
                      <div
                        className="cht"
                        title="Ctrl 点选可以多选，Shift 点选连选一段，然后批量改状态、阶段或删除"
                        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                        onClick={(e) => clickChapter(e, r.ch.id)}
                      >
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
                      {olText(r.ch) && <div className="fn">{olText(r.ch).slice(0, 60)}{olText(r.ch).length > 60 ? "……" : ""}</div>}
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
                              onClick={() => { setPick([]); setSel({ ch: r.ch.id, s: si }); }}
                            >
                              <span className="grip" aria-hidden="true">
                                ⋮⋮
                              </span>
                              <span className="sct">
                                {s.key ? (
                                  <span>
                                    <span className="key-star" title="重点场景">★</span>
                                    {s.t}
                                  </span>
                                ) : (
                                  s.t
                                )}
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
      {multi ? (
        <BatchCard ids={picked} clear={() => setPick([])} setSel={setSel} />
      ) : (
        <Det mode={mode} sel={sel} setSel={setSel} say={say} goEvent={goEvent} />
      )}
    </div>
  );
}

/** 多选了几章时右边的批量操作卡：一次改状态、所属阶段，或一起删 */
function BatchCard({ ids, clear, setSel }: { ids: string[]; clear: () => void; setSel: (s: Sel) => void }) {
  const vols = useStore((s) => s.vols);
  const plan = useStore((s) => s.plan);
  const edit = useStore((s) => s.edit);
  const [busy, setBusy] = useState(false);
  const set = new Set(ids);
  const rs = allChapters(vols).filter((r) => set.has(r.ch.id));
  const range = chapterRanges(rs.map((r) => r.no));
  const count = (st: string) => rs.filter((r) => r.ch.status === st).length;
  const pls = new Set(rs.map((r) => (r.ch.pl ? `${r.ch.pl.a}:${r.ch.pl.p}` : "")));
  const apply = (fn: (ch: any) => void) =>
    edit("vols", (d) => {
      for (const v of d) for (const c of v.chapters) if (set.has(c.id)) fn(c);
    });
  return (
    <div className="panel det batch">
      <h3>已选 {rs.length} 章</h3>
      <p className="batch-range">{range}</p>
      <Field label="状态" hint={ST.map((x) => `${x} ${count(x)}`).join(" · ")}>
        <div className="seg" role="group" aria-label="批量改状态" style={{ margin: 0 }}>
          {ST.map((x) => (
            <button
              key={x}
              type="button"
              aria-pressed={count(x) === rs.length}
              onClick={() => {
                apply((c) => void (c.status = x));
                toast(`${range}都改成了「${x}」`);
              }}
            >
              {x}
            </button>
          ))}
        </div>
      </Field>
      <Field label="所属阶段" hint={pls.size > 1 ? "这几章现在分属不同阶段，选一个就都改过去" : "对应篇幅规划里的事件段和阶段"}>
        <select
          aria-label="批量改所属阶段"
          value={pls.size === 1 ? [...pls][0] : "*"}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "*") return;
            const q = v.split(":");
            apply((c) => void (c.pl = v ? { a: +q[0], p: +q[1] } : null));
            toast(`${range}的所属阶段已改`);
          }}
        >
          {pls.size > 1 && <option value="*">（各不相同）</option>}
          {phaseOptions(plan).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <div className="ft" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="btn" type="button" onClick={clear}>
          取消多选
        </button>
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={async () => {
            if (!confirm(`删除${range}（共 ${rs.length} 章）？正文会一起放进回收站，30 天内可以在「设置 → 回收站」恢复。`)) return;
            setBusy(true);
            try {
              const n = await trashChapters(useStore.getState().work!.id, ids);
              toast(`已把 ${n} 章放进回收站`);
              clear();
              setSel({ ch: null, s: -1 });
            } finally {
              setBusy(false);
            }
          }}
        >
          删除这 {rs.length} 章
        </button>
      </div>
      <div className="legend" style={{ marginTop: 10 }}>Ctrl 点章名加减一章，Shift 点章名连选一段，Esc 或单击某一章退出多选。</div>
    </div>
  );
}

/** 场景的「第几天」。已关联事件时清空只留在框里不写入（事件必须有天数），这样退格清空再重输不会接在原数字后面；离开输入框后回到实际天数 */
function DayInput({ value, keep, set }: { value?: number | null; keep: boolean; set: (v: number | null) => void }) {
  const [t, setT] = useState<string | null>(null);
  return (
    <input
      type="number"
      value={t ?? value ?? ""}
      onChange={(e) => {
        const x = e.target.value;
        setT(x);
        if (x !== "" || !keep) set(x === "" ? null : +x);
      }}
      onBlur={() => setT(null)}
      aria-label="第几天"
    />
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
  const [bigOl, setBigOl] = useState(false);
  const vi = sel.vol ? vols.findIndex((v) => v.id === sel.vol) : -1;
  if (vi >= 0) return <VolCard key={vols[vi].id} vi={vi} setSel={setSel} say={say} />;
  const r = allChapters(vols).find((x) => x.ch.id === sel.ch);
  if (!r) return <div className="panel det"><Empty>点左侧的章或场景来编辑，或点卷名旁的「卷大纲」先写整卷的走向。</Empty></div>;
  const s = sel.s >= 0 ? r.ch.scenes[sel.s] : undefined;
  const D = mode === "detail";
  const nm = chars.map((c) => c.name).filter(Boolean);
  const setCh = (k: string, v: any) => edit("vols", (d) => void ((d[r.v].chapters[r.c] as any)[k] = v));
  const setOlAll = (ol: string, seg: boolean) =>
    edit("vols", (d) => {
      const c = d[r.v].chapters[r.c];
      c.ol = ol;
      if (seg) c.olSeg = true;
      else delete c.olSeg;
    });
  const setSc = (k: keyof Scene, v: any) =>
    editMany(["vols", "events"], (d) => {
      const sc = d.vols[r.v].chapters[r.c].scenes[sel.s] as any;
      // 已关联事件的场景清空天数时两边都保留原来的天数（事件必须有天数），免得场景显示未定、事件却成了第 1 天
      if (k === "day" && v == null && sc.ev) {
        const e = d.events.find((x) => x.id === sc.ev);
        if (e) v = e.day;
      }
      // 改场景大纲时，按文字里新提到的人名（含别名）自动勾上出场人物
      if ((SCENE_TEXT as readonly string[]).includes(k as string)) {
        const before = sceneText(sc);
        sc[k] = v;
        const who = addMentioned(sc.who, chars, before, sceneText(sc));
        if (who !== sc.who) {
          sc.who = who;
          if (sc.ev) {
            const e = d.events.find((x) => x.id === sc.ev) as any;
            if (e) e.who = who.join("、");
          }
        }
      } else sc[k] = v;
      // 已关联的事件保持一致
      if ((SHARE as readonly string[]).includes(k as string) && sc.ev) {
        const e = d.events.find((x) => x.id === sc.ev) as any;
        if (e) e[k] = v;
      }
    });
  const plOpts = phaseOptions(plan);
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
          <div className="fld-ol">
            <div className="fld-ol-h">
              <span>本章大纲</span>
              <OlModeSwitch ch={r.ch} onChange={setOlAll} />
              <button type="button" className="linkish" title="打开大窗口写本章大纲，旁边列出本章场景" onClick={() => setBigOl(true)}>
                展开编辑
              </button>
            </div>
            <OlEditor ch={r.ch} onChange={setOlAll} />
            <div className="hint">这一章发生什么，写多写少都行。写正文时 AI 会照着它来</div>
          </div>
          {bigOl && <OlExpand no={r.no} title={r.ch.title} ch={r.ch} scenes={r.ch.scenes} onChange={setOlAll} close={() => setBigOl(false)} />}
          <Field label="写作重点" hint="这一章想多写什么、怎么写。大纲管发生什么，这里管笔墨往哪里放；生成草稿、续写、扩写时 AI 会照着它分配篇幅">
            <FocusField value={r.ch.focus ?? ""} onChange={(v) => setCh("focus", v)} />
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
          <Field label="重点场景" hint="本章写作重点落在这一场。按场景生成草稿时，这一场分到的字数是普通场景的两倍">
            <label>
              <input type="checkbox" checked={!!s.key} onChange={(e) => setSc("key", e.target.checked || undefined)} />
              这是本章的重头戏
            </label>
          </Field>
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
              {nm.length > 0 && (
                <button
                  className="btn sm"
                  type="button"
                  title="按本场景的标题、目标、冲突等文字里出现的人名和别名勾选；写大纲时也会自动勾上新提到的人"
                  onClick={() => {
                    const add = mentioned(chars, sceneText(s) + "\n" + (r.ch.scenes.length === 1 ? olText(r.ch) : "")).filter((n) => !s.who.includes(n));
                    if (!add.length) return toast("大纲里没认出新的人物");
                    setSc("who", [...s.who, ...add]);
                    toast(`已勾上：${add.join("、")}`);
                  }}
                >
                  按大纲识别
                </button>
              )}
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
                  第<DayInput value={s.day} keep={!!s.ev} set={(v) => setSc("day", v)} />天
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
            {r.ch.olSeg ? (
              <div className="vol-ch-seg" onClick={() => setSel({ ch: r.ch.id, s: -1 })} title="分段写的章纲，点开章卡编辑">
                <OlView ch={r.ch} />
                {!olText(r.ch) && <span className="muted">（分段章纲，还没写，点开章卡编辑）</span>}
              </div>
            ) : (
              <textarea rows={2} value={r.ch.ol ?? ""} placeholder="这一章发生什么" aria-label={`第${r.no}章大纲`} onChange={(e) => setOl(r.c, "ol", e.target.value)} />
            )}
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
        <button
          className="btn"
          type="button"
          disabled={chs.length > 0 || vols.length < 2}
          title={chs.length ? "这一卷还有章，先把章拖到别的卷或删掉" : vols.length < 2 ? "至少要留一卷" : "删掉这个空卷"}
          onClick={() => {
            if (!confirm(`删除「${v.title || `第${cnNum(vi + 1)}卷`}」？这一卷没有章，卷大纲、目标等内容会一起删掉。`)) return;
            const id = v.id;
            edit("vols", (d) => {
              const i = d.findIndex((x) => x.id === id);
              if (i >= 0 && !d[i].chapters.length && d.length > 1) d.splice(i, 1);
            });
            setSel({ ch: null, s: -1 });
            toast("已删除这一卷");
          }}
        >
          删除本卷
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
                  if (c.title.trim() || olText(c) || c.scenes.length) continue;
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
  // 用全书章号，和大纲树上的编号一致
  const chs = allChapters(vols).filter((r) => r.v === vi);
  return (
    <div>
      <p style={{ margin: "0 0 4px" }}>
        <b>拆章预览</b>
      </p>
      <p className="empty" style={{ margin: "0 0 8px" }}>
        勾选要用的章。已有的章只填空着的章名、大纲和钩子，已经有场景的章不加场景；多出来的在卷末新建。
      </p>
      {list.map((x, i) => {
        const ex = chs[i]?.ch;
        return (
          <label className="sy-i" key={i}>
            <input type="checkbox" checked={on[i]} onChange={(e) => setOn(on.map((v, j) => (j === i ? e.target.checked : v)))} />
            <span>
              <b>{ex ? `补第 ${chs[i].no} 章` : "新建"}：{x.t}</b>
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
            res = applyVolumeSplit(d.vols as any, d.events as any, vi, list.map((x, i) => (on[i] ? x : null)), tl, useStore.getState().chars);
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

/** 前文改了、改掉了影响后文的东西：提醒对齐后面的大纲 */
function RippleBanner({ say }: { say: Say }) {
  const work = useStore((s) => s.work);
  const vols = useStore((s) => s.vols);
  const [list, setList] = useState<arc.Ripple[]>([]);
  useEffect(() => {
    if (!work) return;
    const load = () => arc.ripples(work.id).then(setList);
    load();
    return arc.onChange(load);
  }, [work?.id]);
  const chs = allChapters(vols);
  const shown = list.filter((x) => chs.some((r) => r.ch.id === x.ch));
  if (!work || !shown.length) return null;
  return (
    <div className="panel" style={{ marginBottom: 12, background: "var(--seal-soft)" }}>
      <h3>前文改了，后面的大纲可能对不上</h3>
      {shown.map((x) => {
        const r = chs.find((y) => y.ch.id === x.ch)!;
        return (
          <div key={x.id} style={{ marginBottom: 8 }}>
            <p style={{ margin: "0 0 4px" }}>
              <b>第{r.no}章</b>：{x.what}
            </p>
            <div className="addrow" style={{ marginTop: 0 }}>
              <AsyncButton
                primary
                onClick={async () => {
                  say(<Empty>正在对照新的第{r.no}章，检查后面还没写正文的章……</Empty>);
                  try {
                    const texts = await repo.allTexts(work.id);
                    const written = new Set(texts.filter((t) => t.words >= 200).map((t) => t.id));
                    const c = ctx();
                    const fixes = await T.alignOutlines(c, r.no, x.what, written);
                    const ids = new Map(allChapters(c.vols).map((y) => [y.no, y.ch.id]));
                    const laterWritten = allChapters(c.vols).filter((y) => y.no > r.no && written.has(y.ch.id)).map((y) => y.no);
                    say(<AlignPreview fixes={fixes.map((f) => ({ ...f, id: ids.get(f.no)! })).filter((f) => f.id)} laterWritten={laterWritten} done={(n) => { say(n); arc.dismissRipple(work.id, x.id); }} />);
                  } catch (e) {
                    say(<p className="lint bad">{errText(e)}</p>);
                  }
                }}
              >
                让 AI 对齐后续大纲
              </AsyncButton>
              <button className="btn" type="button" onClick={() => arc.dismissRipple(work.id, x.id)}>
                不用，忽略
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AlignPreview({ fixes, laterWritten, done }: { fixes: (T.AlignFix & { id: string })[]; laterWritten: number[]; done: (n: ReturnType<typeof Empty>) => void }) {
  const vols = useStore((s) => s.vols);
  const [on, setOn] = useState<boolean[]>(() => fixes.map(() => true));
  const note = laterWritten.length ? <p className="empty" style={{ margin: "0 0 8px" }}>第{laterWritten.slice(0, 8).join("、")}{laterWritten.length > 8 ? "等" : ""}章已经写了正文，没有动，需要的话自己对一下。</p> : null;
  if (!fixes.length)
    return (
      <div>
        <p style={{ margin: "0 0 4px" }}>后面还没写正文的章大纲和新的前文对得上，不用改。</p>
        {note}
        <button className="btn" type="button" onClick={() => done(<Empty>已确认，不用改。</Empty>)}>
          好的
        </button>
      </div>
    );
  return (
    <div>
      <p style={{ margin: "0 0 4px" }}>
        <b>对齐预览</b>
      </p>
      <p className="empty" style={{ margin: "0 0 8px" }}>
        勾选要改的章。只改列出来的字段，场景不增不删。
      </p>
      {note}
      {fixes.map((f, i) => {
        const r = allChapters(vols).find((y) => y.ch.id === f.id);
        if (!r) return null;
        return (
          <label className="sy-i" key={i}>
            <input type="checkbox" checked={on[i]} onChange={(e) => setOn(on.map((v, j) => (j === i ? e.target.checked : v)))} />
            <span>
              <b>
                第{r.no}章 {r.ch.title}
              </b>
              <small>{f.why}</small>
              {f.ol && (
                <small>
                  大纲：<s>{r.ch.ol || "（空）"}</s> → {f.ol}
                </small>
              )}
              {(f.scenes ?? []).map((sc, k) => {
                const old = r.ch.scenes[sc.i];
                if (!old) return null;
                return (
                  <small key={k}>
                    场景「{old.t}」：{[sc.goal && `目标 → ${sc.goal}`, sc.conf && `冲突 → ${sc.conf}`, sc.who?.length && `人物 → ${sc.who.join("、")}`].filter(Boolean).join("；")}
                  </small>
                );
              })}
            </span>
          </label>
        );
      })}
      <button
        className="btn primary"
        type="button"
        disabled={!on.some(Boolean)}
        onClick={() => {
          let n = 0;
          useStore.getState().aiEdit("前文改动后对齐后续大纲", ["vols"], (d) => {
            fixes.forEach((f, i) => {
              if (!on[i]) return;
              const r = allChapters(d.vols as any).find((y) => y.ch.id === f.id);
              if (!r) return;
              const ch = d.vols[r.v].chapters[r.c];
              if (f.ol) ch.ol = f.ol;
              for (const sc of f.scenes ?? []) {
                const s = ch.scenes[sc.i];
                if (!s) continue;
                if (sc.goal) s.goal = sc.goal;
                if (sc.conf) s.conf = sc.conf;
                if (sc.who?.length) s.who = sc.who.filter(Boolean);
              }
              n++;
            });
          });
          toast(`已对齐 ${n} 章大纲`);
          done(<Empty>已对齐 {n} 章大纲。不满意可以在「记忆」页的变更记录里整组撤销。</Empty>);
        }}
      >
        改这 {on.filter(Boolean).length} 章
      </button>
    </div>
  );
}
