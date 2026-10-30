import { useState } from "react";
import { useStore, toast } from "../../lib/store";
import { GROUPS, ROLES, SIMPLE, fieldLabel } from "../../lib/charFields";
import { completion, snapshot } from "../../lib/chars";
import { allChapters, findChapter } from "../../lib/outline";
import * as T from "../../lib/ai/tasks";
import { errText } from "../../lib/ai/client";
import { uid } from "../../lib/util";
import { AsyncButton, Empty } from "../../components/ui";
import type { Say } from "./Outline";
import type { Character, RevealState } from "../../lib/types";
import { ctx } from "./ctx";

export function CharActions({ mode, setMode, say }: { mode: "simple" | "detail"; setMode: (m: "simple" | "detail") => void; say: Say }) {
  const [role, setRole] = useState(ROLES[0]);
  const edit = useStore((s) => s.edit);
  return (
    <div className="acts">
      <span className="seg" role="group" aria-label="人物视图" style={{ margin: 0, minWidth: 0 }}>
        <button type="button" aria-pressed={mode === "simple"} onClick={() => setMode("simple")}>
          简单版
        </button>
        <button type="button" aria-pressed={mode === "detail"} onClick={() => setMode("detail")}>
          详细版
        </button>
      </span>
      <select className="btn" value={role} aria-label="新人物定位" onChange={(e) => setRole(e.target.value)}>
        {ROLES.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      <button
        className="btn"
        type="button"
        onClick={() => {
          edit("chars", (d) => void d.push({ id: uid("p"), role, name: "", f: {} }));
          toast("已添加，可以点「AI 起草空白项」");
        }}
      >
        添加人物
      </button>
      <AsyncButton
        primary
        onClick={async () => {
          say(<Empty>正在读已写的章节……</Empty>);
          try {
            const r = await T.scanCharacters(ctx());
            if (!r.updates.length && !r.added.length) return say(<Empty>还没有正文，或者没有发现新的人物信息。</Empty>);
            const lines: string[] = [];
            useStore.getState().aiEdit("从正文整理人物", ["chars"], (d) => {
              for (const u of r.updates) {
                const p = d.chars.find((x) => x.name === u.name);
                if (!p || !u.field || !u.value) continue;
                // 已填的内容不覆盖，只有“关系”这类会变的项追加
                if (p.f[u.field] && u.field !== "rel") continue;
                p.f[u.field] = u.field === "rel" && p.f.rel ? p.f.rel + "；" + u.value : u.value;
                (p.ai ??= {})[u.field] = 1;
                (p.src ??= {})[u.field] = `第${u.ch}章`;
                lines.push(`${p.name} · ${fieldLabel(u.field)}`);
              }
              for (const a of r.added) {
                if (d.chars.some((x) => x.name === a.name)) continue;
                const ai: Record<string, 1> = {};
                const src: Record<string, string> = {};
                Object.keys(a.fields || {}).forEach((k) => ((ai[k] = 1), (src[k] = `第${a.ch}章`)));
                d.chars.push({ id: uid("p"), role: ROLES.includes(a.role) ? a.role : "配角", name: a.name, f: a.fields || {}, ai, src });
                lines.push(`新发现人物：${a.name}`);
              }
            });
            say(
              <>
                <p style={{ margin: "0 0 8px" }}>更新了 {lines.length} 处：</p>
                <ul style={{ margin: 0, paddingLeft: 18 }}>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                <p className="empty">每一项都标了来源章节。没有覆盖你写过的内容，只有“关系”会追加。不对可以到「记忆」页的变更记录里整组撤销。</p>
              </>,
            );
          } catch (e) {
            say(<p className="lint bad">{errText(e)}</p>);
          }
        }}
      >
        从正文整理人物
      </AsyncButton>
    </div>
  );
}

async function draft(i: number, scope: string, say: Say) {
  const c = useStore.getState().chars[i];
  try {
    const r = await T.draftCharacter(ctx(), c, scope);
    const n = Object.keys(r).length;
    if (!n) return say(<Empty>没有空白项需要补。</Empty>);
    useStore.getState().aiEdit(`AI 起草「${c.name || c.role}」`, ["chars"], (d) => {
      const p = d.chars.find((x) => x.id === c.id);
      if (!p) return;
      for (const [k, v] of Object.entries(r)) {
        if (k === "__name") {
          p.name = v;
          continue;
        }
        if (p.f[k]) continue;
        p.f[k] = v;
        (p.ai ??= {})[k] = 1;
      }
    });
    say(
      <>
        <p style={{ margin: "0 0 8px" }}>为「{c.name || c.role}」补了 {n} 项，浅黄底是 AI 写的。</p>
        <p className="empty" style={{ margin: 0 }}>
          起草时参考了常驻页（作品简介、主要人物、文风）。不会改动你已经填的内容。你改过的项会变回普通底色。
        </p>
      </>,
    );
  } catch (e) {
    say(<p className="lint bad">{errText(e)}</p>);
  }
}

function setField(id: string, k: string, v: string) {
  useStore.getState().edit("chars", (d) => {
    const p = d.find((x) => x.id === id);
    if (!p) return;
    p.f[k] = v;
    if (p.ai) delete p.ai[k];
  });
}

export function SimpleChars({ say }: { say: Say }) {
  const chars = useStore((s) => s.chars);
  const edit = useStore((s) => s.edit);
  if (!chars.length) return <Empty>还没有人物，点右上角「添加人物」。</Empty>;
  return (
    <div className="chars">
      {chars.map((c, i) => (
        <div className="cc" key={c.id}>
          <div className="hd">
            <select value={c.role} aria-label="定位" onChange={(e) => edit("chars", (d) => void (d[i].role = e.target.value))}>
              {[...new Set([...ROLES, c.role])].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <input value={c.name} placeholder="姓名（可让 AI 起）" aria-label="姓名" onChange={(e) => edit("chars", (d) => void (d[i].name = e.target.value))} />
          </div>
          {SIMPLE.map(([k, l]) => (
            <div className="fld" key={k}>
              <span className={k === "look" ? "lock" : ""}>{l}</span>
              <div>
                <textarea rows={1} className={c.ai?.[k] ? "aid" : ""} aria-label={l} value={c.f[k] || ""} onChange={(e) => setField(c.id, k, e.target.value)} />
                {c.src?.[k] && <div className="src">来源：{c.src[k]}</div>}
              </div>
            </div>
          ))}
          <div className="ft">
            <AsyncButton onClick={() => draft(i, "simple", say)}>AI 起草空白项</AsyncButton>
            <button className="btn" type="button" onClick={() => confirm(`删除「${c.name || c.role}」？`) && edit("chars", (d) => void d.splice(i, 1))}>
              删除
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const FLAG: Record<string, string> = { lock: "锁定", hid: "可隐藏", dyn: "随剧情变化" };

export function DetailChars({ say }: { say: Say }) {
  const chars = useStore((s) => s.chars);
  const vols = useStore((s) => s.vols);
  const edit = useStore((s) => s.edit);
  const [sel, setSel] = useState(0);
  const [newF, setNewF] = useState<Record<string, string>>({});
  const chs = allChapters(vols);
  const [at, setAt] = useState<number | null>(null);
  const c: Character | undefined = chars[Math.min(sel, chars.length - 1)];
  if (!c) return <Empty>还没有人物。</Empty>;
  const ci = chars.indexOf(c);
  const comp = completion(c);
  const no = at ?? chs.length;
  const snap = snapshot(c, vols, no);
  const changes = (c.changes ?? []).slice().sort((a, b) => (findChapter(vols, a.ch)?.no ?? 0) - (findChapter(vols, b.ch)?.no ?? 0));

  return (
    <div className="cd">
      <div className="cd-list">
        {chars.map((x, i) => {
          const cp = completion(x);
          return (
            <button key={x.id} type="button" aria-current={i === ci} onClick={() => setSel(i)}>
              <b>{x.name || "（未命名）"}</b>
              <small>
                {x.role} · 已填 {cp.done}/{cp.all}
              </small>
              <span className="meter">
                <span style={{ width: (cp.done / cp.all) * 100 + "%" }} />
              </span>
            </button>
          );
        })}
      </div>
      <div>
        <div className="cd-head">
          <div className="r1">
            <select value={c.role} aria-label="定位" onChange={(e) => edit("chars", (d) => void (d[ci].role = e.target.value))}>
              {[...new Set([...ROLES, c.role])].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <input value={c.name} placeholder="姓名" aria-label="姓名" onChange={(e) => edit("chars", (d) => void (d[ci].name = e.target.value))} />
            <AsyncButton primary onClick={() => draft(ci, "all", say)}>
              AI 补全全部空白
            </AsyncButton>
          </div>
          <div className="cd-nav">
            {GROUPS.map((g) => (
              <a key={g.id} href={"#g-" + g.id} onClick={(e) => (e.preventDefault(), document.getElementById("g-" + g.id)?.scrollIntoView({ behavior: "smooth" }))}>
                {g.name}
                <i>
                  {comp.groups[g.id][0]}/{comp.groups[g.id][1]}
                </i>
              </a>
            ))}
            <a href="#g-timeline" onClick={(e) => (e.preventDefault(), document.getElementById("g-timeline")?.scrollIntoView({ behavior: "smooth" }))}>
              人设时间轴<i>{changes.length}</i>
            </a>
          </div>
        </div>

        <div className="grp" id="g-timeline">
          <header>
            <b>人设时间轴</b>
            <span className="cnt">拖动看他在任意一章的状态</span>
          </header>
          <div style={{ padding: "10px 14px" }}>
            <div className="inline-num">
              <span className="src">第 {no} 章</span>
              <input type="range" min={1} max={Math.max(1, chs.length)} value={no} onChange={(e) => setAt(+e.target.value)} aria-label="章节" />
            </div>
            {changes.length ? (
              <table className="ev" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>章</th>
                    <th>字段</th>
                    <th>变化</th>
                    <th>原因</th>
                    <th>状态</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {changes.map((x) => {
                    const n = findChapter(vols, x.ch)?.no ?? 0;
                    return (
                      <tr key={x.id} style={{ opacity: n > no ? 0.45 : 1 }}>
                        <td className="num">第{n}章</td>
                        <td>{fieldLabel(x.field)}</td>
                        <td>
                          {x.from || "（空）"} → <b>{x.to}</b>
                          {x.quote && <div className="src">原文：{x.quote}</div>}
                        </td>
                        <td>{x.cause}</td>
                        <td>{x.status === "conflict" ? <span className="ty pay">锁定项冲突</span> : x.status === "undone" ? "已撤销" : x.by === "ai" ? "AI 记录" : "手动"}</td>
                        <td>
                          {x.status === "conflict" && (
                            <>
                              <button className="btn" type="button" onClick={() => edit("chars", (d) => { const p = d.find((y) => y.id === c.id)!; p.changes!.find((y) => y.id === x.id)!.status = "applied"; })}>
                                采纳
                              </button>{" "}
                            </>
                          )}
                          {x.status !== "undone" && (
                            <button className="btn" type="button" onClick={() => edit("chars", (d) => void (d.find((y) => y.id === c.id)!.changes!.find((y) => y.id === x.id)!.status = "undone"))}>
                              撤销
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <Empty>还没有变化记录。每天结账时，AI 读新写的章节，把人物的变化记在这里；锁定项的变化不会自动采纳。</Empty>
            )}
            <div className="legend">滑块所在章的状态：{Object.entries(snap).filter(([k, v]) => v && v !== c.f[k]).map(([k, v]) => `${fieldLabel(k)}：${v}`).join("；") || "和初始卡一样"}</div>
          </div>
        </div>

        {GROUPS.map((g) => (
          <div className="grp" id={"g-" + g.id} key={g.id}>
            <header>
              <b>{g.name}</b>
              <span className="cnt">
                {comp.groups[g.id][0]}/{comp.groups[g.id][1]}
              </span>
              <span className="sp">
                <AsyncButton onClick={() => draft(ci, g.id, say)}>AI 补全本组</AsyncButton>
              </span>
            </header>
            {g.note && <div className="note">{g.note}</div>}
            <div className="rows">
              {[...g.fields, ...(c.custom?.[g.id] ?? []).map((x) => ({ k: x.k, label: x.label, hint: "", flag: undefined }))].map((f) => (
                <div className="dfl" key={f.k}>
                  <span className="lb">
                    {f.label}
                    {f.flag && <span className={"tg " + f.flag}>{FLAG[f.flag]}</span>}
                    {c.src?.[f.k] && <span className="src">来源：{c.src[f.k]}</span>}
                  </span>
                  <textarea rows={2} className={c.ai?.[f.k] ? "aid" : ""} placeholder={f.hint} aria-label={f.label} value={c.f[f.k] || ""} onChange={(e) => setField(c.id, f.k, e.target.value)} />
                  {f.flag === "hid" && (
                    <span className="rev">
                      揭示：
                      <select
                        value={c.rev?.[f.k]?.s ?? "未揭示"}
                        aria-label="揭示状态"
                        onChange={(e) => edit("chars", (d) => { const p = d[ci]; (p.rev ??= {})[f.k] = { ...(p.rev[f.k] ?? {}), s: e.target.value as RevealState }; })}
                      >
                        <option>未揭示</option>
                        <option>部分揭示</option>
                        <option>已揭示</option>
                      </select>
                      计划在
                      <input value={c.rev?.[f.k]?.ch ?? ""} placeholder="第几章" aria-label="计划揭示章节" onChange={(e) => edit("chars", (d) => { const p = d[ci]; (p.rev ??= {})[f.k] = { s: p.rev[f.k]?.s ?? "未揭示", ch: e.target.value }; })} />
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="addf">
              <input value={newF[g.id] ?? ""} placeholder="加一个自定义字段，例如：武器名" onChange={(e) => setNewF({ ...newF, [g.id]: e.target.value })} />
              <button
                className="btn"
                type="button"
                onClick={() => {
                  const label = (newF[g.id] || "").trim();
                  if (!label) return;
                  edit("chars", (d) => { const p = d[ci]; ((p.custom ??= {})[g.id] ??= []).push({ k: "x_" + uid(), label }); });
                  setNewF({ ...newF, [g.id]: "" });
                }}
              >
                添加字段
              </button>
            </div>
          </div>
        ))}

        <div className="grp">
          <header>
            <b>知情范围</b>
            <span className="cnt">这个人从哪一章起知道什么，防止角色知道不该知道的事</span>
          </header>
          <div style={{ padding: "10px 14px" }}>
            {(c.knows ?? []).map((k, i) => (
              <div className="addrow" key={i} style={{ marginTop: 4 }}>
                <input value={k.secret} aria-label="知道的事" onChange={(e) => edit("chars", (d) => void (d[ci].knows![i].secret = e.target.value))} />
                <select className="btn" value={k.ch ?? ""} aria-label="从哪一章起" onChange={(e) => edit("chars", (d) => void (d[ci].knows![i].ch = e.target.value || null))}>
                  <option value="">一开始就知道</option>
                  {chs.map((r) => (
                    <option key={r.ch.id} value={r.ch.id}>
                      第{r.no}章起
                    </option>
                  ))}
                </select>
                <button className="x" type="button" aria-label="删除" onClick={() => edit("chars", (d) => void d[ci].knows!.splice(i, 1))}>
                  ×
                </button>
              </div>
            ))}
            <div className="addrow">
              <button className="btn" type="button" onClick={() => edit("chars", (d) => void (d[ci].knows ??= []).push({ secret: "", ch: null }))}>
                加一条
              </button>
              <label className="src" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                死亡于
                <select className="btn" value={c.dead ?? ""} onChange={(e) => edit("chars", (d) => void (d[ci].dead = e.target.value || null))}>
                  <option value="">（还活着）</option>
                  {chs.map((r) => (
                    <option key={r.ch.id} value={r.ch.id}>
                      第{r.no}章
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>
        <CallTable />
      </div>
    </div>
  );
}

function CallTable() {
  const calls = useStore((s) => s.calls);
  const chars = useStore((s) => s.chars);
  const edit = useStore((s) => s.edit);
  const names = chars.map((c) => c.name).filter(Boolean);
  return (
    <div className="grp">
      <header>
        <b>称呼表</b>
        <span className="cnt">A 叫 B 什么，一目了然。写正文时会检查</span>
      </header>
      <div style={{ padding: "10px 14px" }}>
        {calls.map((x, i) => (
          <div className="addrow" key={i} style={{ marginTop: 4 }}>
            <select className="btn" value={x.from} aria-label="谁" onChange={(e) => edit("calls", (d) => void (d[i].from = e.target.value))}>
              <option value="">谁</option>
              {names.map((n) => <option key={n}>{n}</option>)}
            </select>
            <span className="src">叫</span>
            <select className="btn" value={x.to} aria-label="叫谁" onChange={(e) => edit("calls", (d) => void (d[i].to = e.target.value))}>
              <option value="">谁</option>
              {names.map((n) => <option key={n}>{n}</option>)}
            </select>
            <input value={x.term} placeholder="称呼" aria-label="称呼" onChange={(e) => edit("calls", (d) => void (d[i].term = e.target.value))} />
            <button className="x" type="button" aria-label="删除" onClick={() => edit("calls", (d) => void d.splice(i, 1))}>
              ×
            </button>
          </div>
        ))}
        <div className="addrow">
          <button className="btn" type="button" onClick={() => edit("calls", (d) => void d.push({ from: "", to: "", term: "" }))}>
            加一条称呼
          </button>
        </div>
      </div>
    </div>
  );
}
