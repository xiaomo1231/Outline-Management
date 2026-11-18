import { Guide } from "../components/Guide";
import { fmtTime } from "../lib/util";
import { useEffect, useRef, useState } from "react";
import { useStore, toast } from "../lib/store";
import * as mem from "../lib/memory";
import * as repo from "../lib/repo";
import { compileStyle } from "../lib/style";
import { MEM_DEFAULT, residentLimitOf, useSetting, type MemPrefs } from "../lib/hooks";
import { AsyncButton, Empty, Seg } from "../components/ui";
import { modelRun } from "../lib/ai/nightly";
import * as arc from "../lib/ai/archive";
import { errText } from "../lib/ai/client";
import { ctx } from "./outline/ctx";
import type { MemItem } from "../lib/types";

type Tab = "health" | "items" | "resident" | "bible" | "diary" | "changes";

/** 每日整理。force：手动点「现在整理」时，不管设置里开没开，都跑 AI 整理 */
export async function runAll(onStep?: (s: string) => void, force = false) {
  const s = useStore.getState();
  if (!s.work) return;
  const prefs = { ...MEM_DEFAULT, ...(await repo.getSetting<Partial<MemPrefs>>("memory", {})) };
  onStep?.("自动整理：备份、结算、升降层");
  const a = await mem.scriptRun(s.work, s.vols);
  if (!a.ok) return a;
  if (!prefs.autoModel && !force) return a;
  try {
    return await modelRun(ctx(), residentLimitOf(prefs), onStep);
  } catch (e) {
    toast(errText(e));
    return a;
  }
}

export default function Memory() {
  const work = useStore((s) => s.work)!;
  const [tab, setTab] = useState<Tab>("health");
  const [ver, setVer] = useState(0);
  const refresh = () => setVer((v) => v + 1);
  return (
    <section className="view">
      <div className="ol-head">
        <Seg
          value={tab}
          onChange={setTab}
          label="记忆页分区"
          style={{ margin: 0 }}
          options={[
            ["health", "健康与整理"],
            ["items", "四层记忆"],
            ["resident", "核心摘要"],
            ["bible", "设定集"],
            ["diary", "写作日记"],
            ["changes", "AI 变更记录"],
          ]}
        />
      </div>
      <Guide
        id="memory"
        title="记忆页里这些词是什么意思"
        steps={[
          "章节归档：每章写完、改过之后，AI 在后台给这一章写摘要、记下章末每个人物的状态、新事实和人设变化（每章约一分钱）。生成大纲和正文时的“前文”就读这些。",
          "每日整理：每天到点（默认 22:05）自动把今天写的内容归档进记忆。分两步：",
          "自动整理：不花钱，负责备份、统计哪些记忆被用到、调整记忆的远近层级。",
          "AI 整理：调 DeepSeek（会花一点 API 费），补归档漏掉的章、写写作日记、整理核心摘要和设定集。每晚自动跑默认关，可以在设置里打开；在这里点「现在整理」会立刻跑一次。",
          "核心摘要：每次调用 AI 都会带上的一页“这本书的要点”，越短越准。",
          "设定集：已经定下、以后不能推翻的设定和事实，AI 检查矛盾时会对照它。",
        ]}
        tip="不想管这些也没关系：章节归档会自动进行，写作和大纲照常能用。"
      />
      {tab === "health" && <HealthTab key={ver} work={work.id} refresh={refresh} />}
      {tab === "items" && <ItemsTab work={work.id} />}
      {tab === "resident" && <ResidentTab work={work.id} />}
      {tab === "bible" && <BibleTab work={work.id} />}
      {tab === "diary" && <DiaryTab work={work.id} />}
      {tab === "changes" && <ChangesTab />}
    </section>
  );
}

function HealthTab({ work, refresh }: { work: string; refresh: () => void }) {
  const [prefs, setPrefs, prefsReady] = useSetting<MemPrefs>("memory", MEM_DEFAULT);
  const [h, setH] = useState<mem.Health | null>(null);
  const [log, setLog] = useState<mem.MemLogEntry[]>([]);
  const [step, setStep] = useState("");
  useEffect(() => {
    mem.health(work, prefs.dailyAt).then(setH);
    mem.getLog(work).then(setLog);
  }, [work, prefs.dailyAt]);
  return (
    <div className="grid-2">
      <div className="panel">
        <h3>记忆健康</h3>
        {h ? (
          <ul className="health">
            <li>
              各层条目：{h.counts.map((n, i) => `${mem.LAYER[i + 1]} ${n}`).join("、")}
            </li>
            <li className={h.residentChars ? "" : "bad"}>核心摘要 {h.residentChars ? `${h.residentChars} 字（上限 ${residentLimitOf(prefs)}）` : "还没生成，AI 会现场拼一份"}</li>
            <li className={h.lastScript?.ok === false ? "bad" : ""}>上次自动整理：{h.lastScript ? `${fmtTime(h.lastScript.at)}，${h.lastScript.ok ? "正常" : "出错"}` : "还没跑过"}</li>
            <li className={h.lastModel?.ok === false ? "bad" : ""}>上次 AI 整理：{h.lastModel ? `${fmtTime(h.lastModel.at)}，${h.lastModel.ok ? "正常" : "出错"}` : "还没跑过"}</li>
            <li className={h.diaryToday ? "" : "bad"}>今日写作日记：{h.diaryToday ? "已生成" : "还没生成"}</li>
            <li className={h.bibleDays != null && h.bibleDays > 7 ? "bad" : ""}>设定集：{h.bibleDays == null ? "还是空的" : `${h.bibleDays} 天前更新`}</li>
            <li>
              待整理：新条目 {h.pending.new} 条，命中 {h.pending.hit} 次
            </li>
          </ul>
        ) : (
          <Empty>读取中……</Empty>
        )}
        <div className="addrow">
          <AsyncButton
            primary
            onClick={async () => {
              await runAll(setStep, true);
              setStep("");
              refresh();
              toast("整理完成");
            }}
          >
            现在整理（自动整理 + AI 整理）
          </AsyncButton>
          <AsyncButton
            onClick={async () => {
              await mem.scriptRun(useStore.getState().work!, useStore.getState().vols);
              refresh();
            }}
          >
            只跑自动整理
          </AsyncButton>
        </div>
        {step && <p className="legend">{step}……</p>}
        {prefsReady && !prefs.autoModel && (
          <div className="lint" style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: "var(--seal-soft)" }}>
            <b>每晚的 AI 整理没打开。</b>白天写完的章仍会自动归档（需要填好 DeepSeek 密钥），但写作日记、核心摘要、设定集不会每晚更新，漏归档的章也不会每晚补上。
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
              <input type="checkbox" checked={prefs.autoModel} onChange={(e) => setPrefs({ ...prefs, autoModel: e.target.checked })} /> 每日整理时顺便跑 AI 整理（会花一点 API 费）
            </label>
          </div>
        )}
        <ArchivePanel work={work} />
        <p className="legend">
          每天 {prefs.dailyAt} 自动做每日整理；关闭应用时、下次打开发现漏跑时也会补跑。自动整理不花 API 费；AI 整理调 DeepSeek，补归档漏掉的章、写日记、整理核心摘要和设定集。
        </p>
      </div>
      <div className="panel">
        <h3>整理日志</h3>
        {log.length ? (
          <div className="log">
            {log.slice(0, 30).map((e, i) => (
              <div key={i} className={"log-e" + (e.ok ? "" : " bad")}>
                <b>
                  {fmtTime(e.at)} · {e.kind === "script" ? "自动整理" : "AI 整理"}
                </b>
                {e.lines.map((l, j) => (
                  <div key={j}>{l}</div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <Empty>还没有整理记录。</Empty>
        )}
      </div>
    </div>
  );
}

/** 章节归档：几章已归档、几章没归档，补归档全部 */
function ArchivePanel({ work }: { work: string }) {
  const [left, setLeft] = useState<{ n: number; cost: number } | null>(null);
  const [total, setTotal] = useState(0);
  const [prog, setProg] = useState<{ done: number; total: number; cur: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const load = async () => {
    const st = useStore.getState();
    const list = await arc.stale(work, st.vols);
    const texts = new Map((await repo.allTexts(work)).map((t) => [t.id, t.words]));
    setLeft({ n: list.length, cost: arc.estimateCost(list.map((r) => texts.get(r.ch.id) ?? 0)) });
    setTotal((await repo.allArchives(work)).length);
  };
  useEffect(() => {
    load();
    return arc.onChange(() => {
      if (!abort.current) load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work]);
  return (
    <div style={{ marginTop: 12 }}>
      <h3>章节归档</h3>
      <p className="legend" style={{ marginTop: 0 }}>
        每章写完、改过之后（停手 2 分钟、离开这一章、或状态改成「已写」），AI 会在后台给这一章写摘要、记下章末每个人物的状态。生成大纲和正文时，“前文”就读这些归档。
      </p>
      {left ? (
        <p>
          已归档 {total} 章{left.n ? `，还有 ${left.n} 章没归档或归档后改动较大` : "，没有要补的"}。
        </p>
      ) : (
        <Empty>读取中……</Empty>
      )}
      {prog ? (
        <div>
          <progress max={prog.total} value={prog.done} style={{ width: "100%" }} />
          <p className="legend">
            {prog.done}/{prog.total}
            {prog.cur ? ` · 正在归档${prog.cur}` : ""}
          </p>
          <button className="btn sm" type="button" onClick={() => abort.current?.abort()}>
            停止
          </button>
        </div>
      ) : (
        !!left?.n && (
          <AsyncButton
            onClick={async () => {
              if (!confirm(`要补归档 ${left.n} 章吗？\n按 DeepSeek 价格粗估约 ${Math.max(0.01, left.cost).toFixed(2)} 元（实际以账单为准）。几章同时跑，可以中途停止。`)) return;
              abort.current = new AbortController();
              setProg({ done: 0, total: left.n, cur: "" });
              try {
                const list = await arc.stale(work, useStore.getState().vols);
                const r = await arc.archiveMany(list, (done, total, cur) => setProg((p) => ({ done, total, cur: cur || p?.cur || "" })), abort.current.signal, 3);
                const st = useStore.getState();
                if (r.ok && st.work) await mem.scriptRun(st.work, st.vols);
                toast(`补归档完成：${r.ok} 章${r.failed ? `，失败 ${r.failed} 章：${r.err}` : ""}${abort.current.signal.aborted ? "（已停止）" : ""}`);
              } catch (e) {
                toast(errText(e));
              } finally {
                abort.current = null;
                setProg(null);
                load();
              }
            }}
          >
            补归档全部
          </AsyncButton>
        )
      )}
    </div>
  );
}

function ItemsTab({ work }: { work: string }) {
  const [items, setItems] = useState<MemItem[]>([]);
  const [q, setQ] = useState("");
  const [add, setAdd] = useState("");
  const load = () => mem.items(work).then(setItems);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work]);
  const shown = items.filter((x) => !q || x.text.includes(q));
  return (
    <div className="panel">
      <div className="addrow" style={{ marginTop: 0 }}>
        <input value={q} placeholder="搜索记忆" onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="mem-cols">
        {[1, 2, 3, 4].map((l) => (
          <div key={l} className="mem-col">
            <h3>
              {mem.LAYER[l]}（{shown.filter((x) => x.layer === l).length}）
            </h3>
            {shown
              .filter((x) => x.layer === l)
              .map((x) => (
                <div key={x.id} className="mem-i">
                  <div>{l >= 3 ? x.short : x.text}</div>
                  <small>
                    第{x.ch}章 · {x.kind === "decision" ? "决定" : x.kind === "rejected" ? "否掉的思路" : x.kind === "inspire" ? "灵感" : "事实"} · 命中 {x.hits} · 分 {x.score}
                  </small>
                  <div className="chips">
                    {l > 1 && <button type="button" onClick={() => mem.updateItem(x.id, { layer: l - 1 }).then(load)}>上移</button>}
                    {l < 4 && <button type="button" onClick={() => mem.updateItem(x.id, { layer: l + 1 }).then(load)}>下移</button>}
                    <button type="button" onClick={() => { const t = prompt("修改这条记忆", x.text); if (t != null && t.trim()) mem.updateItem(x.id, { text: t.trim() }).then(load); }}>改</button>
                  </div>
                </div>
              ))}
          </div>
        ))}
      </div>
      <div className="addrow">
        <input value={add} placeholder="手动加一条要记住的事，例如：老人的伞从不打开" onChange={(e) => setAdd(e.target.value)} />
        <button
          className="btn"
          type="button"
          onClick={async () => {
            if (!add.trim()) return;
            await mem.addItem(work, "decision", add.trim(), await mem.currentNo(work, useStore.getState().vols), "作者手动");
            setAdd("");
            load();
          }}
        >
          加入近期层
        </button>
      </div>
      <p className="legend">层级按分数自动升降：最近命中次数 + 离当前章节的距离 + 后面 10 章的大纲是否还会用到。原文永远不删，冷层只是在上下文里带短版本。</p>
    </div>
  );
}

function ResidentTab({ work }: { work: string }) {
  const [prefs] = useSetting<MemPrefs>("memory", MEM_DEFAULT);
  const [text, setText] = useState("");
  const [at, setAt] = useState(0);
  useEffect(() => {
    mem.getResident(work).then((r) => {
      setText(r?.text ?? "");
      setAt(r?.at ?? 0);
    });
  }, [work]);
  return (
    <div className="panel">
      <h3>核心摘要 · 每次调用 AI 都会带上（{text.length} / {residentLimitOf(prefs)} 字）</h3>
      <textarea rows={18} value={text} onChange={(e) => setText(e.target.value)} placeholder="还没生成。可以点下面按需生成，或者等今晚的每日整理。" />
      <div className="addrow">
        <button className="btn primary" type="button" onClick={async () => { await mem.saveResident(work, text, residentLimitOf(prefs)); toast("已保存"); }}>
          保存
        </button>
        <button
          className="btn"
          type="button"
          onClick={async () => {
            const s = useStore.getState();
            const t = mem.buildResident(s.work!, s.chars, s.vols, s.events, compileStyle(s.style), await mem.items(work, 1), residentLimitOf(prefs));
            setText(t);
            toast("已按当前数据重新拼了一份，记得保存");
          }}
        >
          按当前数据重新拼（不调 AI）
        </button>
      </div>
      <p className="legend">{at ? `上次整理：${fmtTime(at)}。` : ""}一半写人物和写作规范（只缩不消失），一半写剧情事实和未收伏笔。你改过的内容会保留到下次 AI 整理。</p>
    </div>
  );
}

function BibleTab({ work }: { work: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    mem.getBible(work).then((b) => setText(b.text));
  }, [work]);
  return (
    <div className="panel">
      <h3>设定集 · 这本书已经定下、不能推翻的东西</h3>
      <textarea rows={20} value={text} onChange={(e) => setText(e.target.value)} placeholder="世界规则、人物定论、重要物件、地点、时间线定点。AI 整理会从新写的章节里提炼进来，你也可以直接写。" />
      <div className="addrow">
        <button className="btn primary" type="button" onClick={async () => { await mem.saveBible(work, text); toast("已保存"); }}>
          保存
        </button>
      </div>
    </div>
  );
}

function DiaryTab({ work }: { work: string }) {
  const [list, setList] = useState<{ day: string; text: string }[]>([]);
  useEffect(() => {
    repo.listDiary(work).then(setList);
  }, [work]);
  return (
    <div className="panel">
      <h3>写作日记</h3>
      {list.length ? list.map((d) => (
        <details key={d.day} open={d === list[0]}>
          <summary>{d.day}</summary>
          <pre className="diary">{d.text}</pre>
        </details>
      )) : <Empty>还没有日记。每日整理时 AI 整理会写一份：今日进度、剧情推进、人物变化、伏笔变动、遗留问题。</Empty>}
    </div>
  );
}

function ChangesTab() {
  const cs = useStore((s) => s.changesets);
  const undo = useStore((s) => s.undoChange);
  return (
    <div className="panel">
      <h3>AI 变更记录 · AI 的每次修改都能整组撤销</h3>
      {cs.length ? (
        <table className="ev">
          <thead>
            <tr>
              <th>时间</th>
              <th>内容</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cs.map((c) => (
              <tr key={c.id}>
                <td className="num">{fmtTime(c.at)}</td>
                <td>{c.label}</td>
                <td>
                  {c.undone ? (
                    "已撤销"
                  ) : (
                    <button className="btn" type="button" onClick={() => confirm("撤销会把相关数据恢复到这次修改之前，之后你在这些地方做的改动也会一起回退。继续？") && undo(c.id)}>
                      整组撤销
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>还没有 AI 修改记录。</Empty>
      )}
    </div>
  );
}
