import { useEffect, useState } from "react";
import { useStore, toast } from "../lib/store";
import * as mem from "../lib/memory";
import * as repo from "../lib/repo";
import { compileStyle } from "../lib/style";
import { MEM_DEFAULT, useSetting, type MemPrefs } from "../lib/hooks";
import { AsyncButton, Empty, Seg } from "../components/ui";
import { modelRun } from "../lib/ai/nightly";
import { errText } from "../lib/ai/client";
import { ctx } from "./outline/ctx";
import type { MemItem } from "../lib/types";

type Tab = "health" | "items" | "resident" | "bible" | "diary" | "changes";

export async function runAll(onStep?: (s: string) => void) {
  const s = useStore.getState();
  if (!s.work) return;
  const prefs = { ...MEM_DEFAULT, ...(await repo.getSetting<Partial<MemPrefs>>("memory", {})) };
  onStep?.("脚本班：备份、结算、升降层");
  const a = await mem.scriptRun(s.work, s.vols);
  if (!a.ok) return a;
  if (!prefs.autoModel) return a;
  try {
    return await modelRun(ctx(), prefs.residentLimit, onStep);
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
            ["health", "健康与结账"],
            ["items", "四层记忆"],
            ["resident", "常驻页"],
            ["bible", "作品圣经"],
            ["diary", "写作日记"],
            ["changes", "AI 变更记录"],
          ]}
        />
      </div>
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
  const [prefs] = useSetting<MemPrefs>("memory", MEM_DEFAULT);
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
            <li className={h.residentChars ? "" : "bad"}>常驻页 {h.residentChars ? `${h.residentChars} 字（上限 ${prefs.residentLimit}）` : "还没生成，AI 会现场拼一份"}</li>
            <li className={h.lastScript?.ok === false ? "bad" : ""}>上次脚本班：{h.lastScript ? `${new Date(h.lastScript.at).toLocaleString()}，${h.lastScript.ok ? "正常" : "出错"}` : "还没跑过"}</li>
            <li className={h.lastModel?.ok === false ? "bad" : ""}>上次模型班：{h.lastModel ? `${new Date(h.lastModel.at).toLocaleString()}，${h.lastModel.ok ? "正常" : "出错"}` : "还没跑过"}</li>
            <li className={h.diaryToday ? "" : "bad"}>今日写作日记：{h.diaryToday ? "已生成" : "还没生成"}</li>
            <li className={h.bibleDays != null && h.bibleDays > 7 ? "bad" : ""}>作品圣经：{h.bibleDays == null ? "还是空的" : `${h.bibleDays} 天前更新`}</li>
            <li>
              待结算的票：新条目 {h.pending.new} 张，命中 {h.pending.hit} 张
            </li>
          </ul>
        ) : (
          <Empty>读取中……</Empty>
        )}
        <div className="addrow">
          <AsyncButton
            primary
            onClick={async () => {
              await runAll(setStep);
              setStep("");
              refresh();
              toast("结账完成");
            }}
          >
            现在结账（脚本班 + 模型班）
          </AsyncButton>
          <AsyncButton
            onClick={async () => {
              await mem.scriptRun(useStore.getState().work!, useStore.getState().vols);
              refresh();
            }}
          >
            只跑脚本班
          </AsyncButton>
        </div>
        {step && <p className="legend">{step}……</p>}
        <p className="legend">
          每天 {prefs.dailyAt} 自动结账；关闭应用时、下次打开发现漏跑时也会补跑。脚本班不花 API 费；模型班调 DeepSeek，给新写的章节做摘要、记人设变化、写日记、整理常驻页和作品圣经。
        </p>
      </div>
      <div className="panel">
        <h3>结账日志</h3>
        {log.length ? (
          <div className="log">
            {log.slice(0, 30).map((e, i) => (
              <div key={i} className={"log-e" + (e.ok ? "" : " bad")}>
                <b>
                  {new Date(e.at).toLocaleString()} · {e.kind === "script" ? "脚本班" : "模型班"}
                </b>
                {e.lines.map((l, j) => (
                  <div key={j}>{l}</div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <Empty>还没有结账记录。</Empty>
        )}
      </div>
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
      <h3>常驻页 · 每次调用 AI 都会带上（{text.length} / {prefs.residentLimit} 字）</h3>
      <textarea rows={18} value={text} onChange={(e) => setText(e.target.value)} placeholder="还没生成。可以点下面按需生成，或者等今晚结账。" />
      <div className="addrow">
        <button className="btn primary" type="button" onClick={async () => { await mem.saveResident(work, text, prefs.residentLimit); toast("已保存"); }}>
          保存
        </button>
        <button
          className="btn"
          type="button"
          onClick={async () => {
            const s = useStore.getState();
            const t = mem.buildResident(s.work!, s.chars, s.vols, s.events, compileStyle(s.style), await mem.items(work, 1), prefs.residentLimit);
            setText(t);
            toast("已按当前数据重新拼了一份，记得保存");
          }}
        >
          按当前数据重新拼（不调 AI）
        </button>
      </div>
      <p className="legend">{at ? `上次整理：${new Date(at).toLocaleString()}。` : ""}一半写人物和写作规范（只缩不消失），一半写剧情事实和未收伏笔。你改过的内容会保留到下次模型班整理。</p>
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
      <h3>作品圣经 · 这本书已经定下、不能推翻的东西</h3>
      <textarea rows={20} value={text} onChange={(e) => setText(e.target.value)} placeholder="世界规则、人物定论、重要物件、地点、时间线定点。模型班会从新写的章节里提炼进来，你也可以直接写。" />
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
      )) : <Empty>还没有日记。每天结账时模型班会写一份：今日进度、剧情推进、人物变化、伏笔变动、遗留问题。</Empty>}
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
                <td className="num">{new Date(c.at).toLocaleString()}</td>
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
