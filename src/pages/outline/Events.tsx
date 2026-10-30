import { useMemo, useState } from "react";
import { useStore, toast } from "../../lib/store";
import { allChapters, chapterLabel, eventToOutline, findChapter, findScene, SHARE, sortEvents } from "../../lib/outline";
import { phaseName, where } from "../../lib/plan";
import * as T from "../../lib/ai/tasks";
import { errText } from "../../lib/ai/client";
import * as repo from "../../lib/repo";
import { uid } from "../../lib/util";
import { AsyncButton, Empty, Field, Issue } from "../../components/ui";
import type { Say } from "./Outline";
import type { EventType, StoryEvent } from "../../lib/types";
import { ctx, names } from "./ctx";

export const TYN: Record<EventType, string> = { main: "主线", side: "支线", plant: "伏笔埋", pay: "伏笔收" };
const TYC: Record<EventType, string> = { main: "var(--accent)", side: "var(--muted)", plant: "var(--ai-line)", pay: "var(--seal)" };

export function EventActions({ mode, setMode, say, onSync }: { mode: "simple" | "detail"; setMode: (m: "simple" | "detail") => void; say: Say; onSync: () => void }) {
  const [chId, setChId] = useState("");
  const vols = useStore((s) => s.vols);
  const chs = allChapters(vols);
  return (
    <div className="acts">
      <span className="seg" role="group" aria-label="事件视图" style={{ margin: 0, minWidth: 0 }}>
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
      <AsyncButton
        onClick={async () => {
          say(<Empty>正在检查时间线……</Empty>);
          try {
            const is = await T.checkTimeline(ctx());
            say(is.length ? <>{is.map((x, i) => <Issue key={i} lv={x.lv}>{x.text}</Issue>)}</> : <Empty>没有发现时间矛盾。</Empty>);
          } catch (e) {
            say(<p className="lint bad">{errText(e)}</p>);
          }
        }}
      >
        检查时间矛盾
      </AsyncButton>
      <select className="btn" value={chId} aria-label="从哪一章提取" onChange={(e) => setChId(e.target.value)}>
        <option value="">选一章</option>
        {chs.map((r) => (
          <option key={r.ch.id} value={r.ch.id}>
            第{r.no}章 {r.ch.title}
          </option>
        ))}
      </select>
      <AsyncButton
        primary
        onClick={async () => {
          const r = chs.find((x) => x.ch.id === chId);
          if (!r) return toast("先选一章");
          const t = await repo.loadText(r.ch.id);
          if (!t?.plain) return toast("这一章还没有正文");
          try {
            const evs = await T.extractEvents(ctx(), r, t.plain);
            useStore.getState().aiEdit(`从第${r.no}章提取事件`, ["events"], (d) => {
              for (const e of evs) d.events.push({ ...e, id: uid("e") });
              sortEvents(d.events as any);
            });
            say(<p style={{ margin: 0 }}>从第{r.no}章提取了 {evs.length} 个事件，标了「AI 提取」。故事时间按正文里的“第二天”“三天前”这类词推算。</p>);
          } catch (e) {
            say(<p className="lint bad">{errText(e)}</p>);
          }
        }}
      >
        从正文提取事件
      </AsyncButton>
    </div>
  );
}

export function Events({ mode, sel, setSel, goScene }: { mode: "simple" | "detail"; sel: string | null; setSel: (id: string | null) => void; goScene: (chId: string, si: number) => void }) {
  const events = useStore((s) => s.events);
  const vols = useStore((s) => s.vols);
  const plan = useStore((s) => s.plan);
  const edit = useStore((s) => s.edit);
  const [day, setDay] = useState(1);
  const [text, setText] = useState("");
  const [ty, setTy] = useState<EventType>("main");
  const D = mode === "detail";
  const sorted = useMemo(() => {
    const x = [...events];
    sortEvents(x);
    return x;
  }, [events]);
  const max = Math.max(4, ...events.map((e) => e.day));
  const arcOf = (e: StoryEvent) => {
    const r = findChapter(vols, e.ch);
    return r ? phaseName(plan, where(plan, r.no)) || "规划之外" : "";
  };
  const pick = (id: string) => setSel(sel === id ? null : id);

  return (
    <>
      <div className="panel">
        <h3>故事内时间线</h3>
        <div className="keys">
          {(Object.keys(TYN) as EventType[]).map((k) => (
            <span key={k}>
              <i style={{ background: TYC[k] }} />
              {TYN[k]}
            </span>
          ))}
        </div>
        <div className="tbl-wrap">
          <div className="tl">
            {Array.from({ length: max }, (_, i) => i + 1).map((d) => {
              const es = sorted.filter((e) => e.day === d);
              return (
                <div key={d}>
                  <div className="col">
                    {es.length ? (
                      es.map((e) => (
                        <div key={e.id} className={"ev-i" + (e.id === sel ? " on" : "")} style={{ borderLeftColor: TYC[e.ty] }} onClick={() => pick(e.id)}>
                          {e.t}
                          {D && (e.time || e.place) && <small>{[e.time, e.place].filter(Boolean).join(" · ")}</small>}
                        </div>
                      ))
                    ) : (
                      <span className="empty-day">暂无事件</span>
                    )}
                  </div>
                  <div className="day">第 {d} 天</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 12 }}>
        <h3>事件表</h3>
        <div className="tbl-wrap">
          <table className="ev">
            <thead>
              <tr>
                <th>故事时间</th>
                <th>章节</th>
                {D && <th>所属事件段</th>}
                <th>事件</th>
                {D && <th>地点</th>}
                <th>人物</th>
                <th>类型</th>
                {D && <th>重要度</th>}
                <th>大纲</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id} className={e.id === sel ? "on" : ""} onClick={() => pick(e.id)}>
                  <td className="num">
                    第 {e.day} 天{D && e.time ? " " + e.time : ""}
                  </td>
                  <td className="num">{chapterLabel(vols, e.ch)}</td>
                  {D && <td>{arcOf(e)}</td>}
                  <td className="evt">
                    {e.t}
                    {e.ai && <span className="chip">AI 提取</span>}
                    {e.from && <span className="chip">来自{e.from}</span>}
                  </td>
                  {D && <td>{e.place}</td>}
                  <td>{e.who}</td>
                  <td>
                    <span className={"ty " + e.ty}>{TYN[e.ty]}</span>
                  </td>
                  {D && <td className="num">{e.imp ? "★".repeat(+e.imp) : ""}</td>}
                  <td>{e.sc ? <span className="lk-ok">已关联</span> : <span className="lk-no">未导入</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!events.length && <Empty>还没有事件。在下面添加，或从正文提取，也可以用「同步」把大纲里的场景导进来。</Empty>}
        <div className="addrow">
          <input type="number" min={1} value={day} aria-label="第几天" style={{ maxWidth: 70 }} onChange={(e) => setDay(+e.target.value)} />
          <input value={text} placeholder="新事件，例如：主角第一次没去上班" onChange={(e) => setText(e.target.value)} />
          <select className="btn" value={ty} aria-label="类型" onChange={(e) => setTy(e.target.value as EventType)}>
            {(Object.keys(TYN) as EventType[]).map((k) => (
              <option key={k} value={k}>
                {TYN[k]}
              </option>
            ))}
          </select>
          <button
            className="btn"
            type="button"
            onClick={() => {
              if (!text.trim()) return;
              const id = uid("e");
              edit("events", (d) => void d.push({ id, day: day || 1, ch: null, t: text.trim(), who: "", ty }));
              setText("");
              setSel(id);
            }}
          >
            添加
          </button>
        </div>
        <div className="legend">点表格的行或时间线上的事件，打开事件卡。</div>
      </div>
      {sel && <EventCard id={sel} mode={mode} close={() => setSel(null)} goScene={goScene} />}
    </>
  );
}

function EventCard({ id, mode, close, goScene }: { id: string; mode: "simple" | "detail"; close: () => void; goScene: (chId: string, si: number) => void }) {
  const events = useStore((s) => s.events);
  const vols = useStore((s) => s.vols);
  const editMany = useStore((s) => s.editMany);
  const e = events.find((x) => x.id === id);
  if (!e) return null;
  const D = mode === "detail";
  const chs = allChapters(vols);
  const sc = findScene(vols, e.sc);
  const nexts = events.filter((x) => x.pre === e.id);
  const set = (k: keyof StoryEvent, v: any) =>
    editMany(["events", "vols"], (d) => {
      const ev = d.events.find((x) => x.id === id) as any;
      if (!ev) return;
      ev[k] = v;
      if (!ev.sc) return;
      const f = findScene(d.vols as any, ev.sc);
      if (!f) return;
      // 共享字段同步到关联的场景；改章节时场景跟着搬
      if ((SHARE as readonly string[]).includes(k as string)) (f.s as any)[k] = v;
      if (k === "ch" && v && v !== f.r.ch.id) {
        const to = allChapters(d.vols as any).find((x) => x.ch.id === v);
        if (to) {
          const [s] = d.vols[f.r.v].chapters[f.r.c].scenes.splice(f.i, 1);
          d.vols[to.v].chapters[to.c].scenes.push(s);
          toast(`关联的场景已一起移到第${to.no}章`);
        }
      }
    });
  const ta = (k: keyof StoryEvent, rows = 2, ph = "") => <textarea rows={rows} value={(e[k] as string) ?? ""} placeholder={ph} onChange={(x) => set(k, x.target.value)} />;

  return (
    <div className="panel evd" style={{ marginTop: 12 }}>
      <h3>
        <span>事件卡</span>
        <button className="x" type="button" aria-label="关闭" onClick={close}>
          ×
        </button>
      </h3>
      <div className="grid2">
        <div>
          <Field label="事件">{ta("t")}</Field>
          <Field label="故事时间">
            <div className="two">
              第<input type="number" min={1} value={e.day} aria-label="第几天" onChange={(x) => set("day", +x.target.value || 1)} />天
              {D && <input value={e.time ?? ""} placeholder="时刻" aria-label="时刻" onChange={(x) => set("time", x.target.value)} />}
            </div>
          </Field>
          <Field label="章节">
            <select value={e.ch ?? ""} aria-label="章节" onChange={(x) => set("ch", x.target.value || null)}>
              <option value="">未指定</option>
              {chs.map((r) => (
                <option key={r.ch.id} value={r.ch.id}>
                  第{r.no}章 {r.ch.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="人物">
            <input value={e.who} aria-label="人物" onChange={(x) => set("who", x.target.value)} />
          </Field>
          <Field label="类型">
            <select value={e.ty} aria-label="类型" onChange={(x) => set("ty", x.target.value)}>
              {(Object.keys(TYN) as EventType[]).map((k) => (
                <option key={k} value={k}>
                  {TYN[k]}
                </option>
              ))}
            </select>
          </Field>
          {D && (
            <>
              <Field label="地点">
                <input value={e.place ?? ""} aria-label="地点" onChange={(x) => set("place", x.target.value)} />
              </Field>
              <Field label="重要度">
                <select value={e.imp ?? ""} aria-label="重要度" onChange={(x) => set("imp", x.target.value ? +x.target.value : "")}>
                  <option value="">未定</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {"★".repeat(n)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="伏笔关联">{ta("fore", 1, "埋或收的是哪条伏笔")}</Field>
              <Field label="前置事件" hint="因为哪件事才发生">
                <select value={e.pre ?? ""} aria-label="前置事件" onChange={(x) => set("pre", x.target.value)}>
                  <option value="">无</option>
                  {events.filter((x) => x.id !== e.id).map((x) => (
                    <option key={x.id} value={x.id}>
                      第{x.day}天 · {x.t}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="后续事件">
                <div className="ro">{nexts.length ? nexts.map((x) => x.t).join("；") : "暂无。别的事件把这条设为前置后，会出现在这里"}</div>
              </Field>
            </>
          )}
        </div>
        {D && (
          <div>
            <Field label="起因">{ta("cause")}</Field>
            <Field label="经过">{ta("process", 3)}</Field>
            <Field label="结果">{ta("result")}</Field>
            <Field label="影响">{ta("impact", 2, "对人物关系和局势的长期影响")}</Field>
            <Field label="信息揭示">{ta("reveal", 2, "谁在这时知道了什么，读者知道了什么")}</Field>
            <Field label="备注">{ta("note", 1)}</Field>
          </div>
        )}
      </div>
      {!D && <p className="empty" style={{ margin: "2px 0 8px" }}>切到「详细版」可以填时刻、地点、起因、经过、结果、影响、信息揭示和前后因果。</p>}
      <div className="lk">
        {sc ? (
          <>
            <span>
              已关联大纲场景：<b>{sc.s.t}</b>（第{sc.r.no}章）
            </span>
            <button className="btn" type="button" onClick={() => goScene(sc.r.ch.id, sc.i)}>
              在大纲中打开
            </button>
          </>
        ) : (
          <>
            <span>这个事件还没放进大纲</span>
            <button
              className="btn"
              type="button"
              onClick={() => {
                if (!chs.length) return toast("大纲里还没有章，先去加一章");
                editMany(["vols", "events"], (d) => {
                  const ev = d.events.find((x) => x.id === id);
                  if (ev) eventToOutline(d.vols as any, ev as any, names());
                });
                toast("已放进大纲");
              }}
            >
              导入到大纲
            </button>
          </>
        )}
        <button
          className="btn"
          type="button"
          onClick={() => {
            editMany(["vols", "events"], (d) => {
              const i = d.events.findIndex((x) => x.id === id);
              const ev = d.events[i];
              const f = ev?.sc ? findScene(d.vols as any, ev.sc) : undefined;
              if (f) delete (f.s as any).ev;
              d.events.splice(i, 1);
            });
            close();
            toast("事件已删除，大纲里的场景保留");
          }}
        >
          删除事件
        </button>
      </div>
    </div>
  );
}
