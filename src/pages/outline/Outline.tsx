import { useState, type ReactNode } from "react";
import { useStore, toast } from "../../lib/store";
import { buildSync, RUN_ORDER, SEC, type SyncItem, type SyncSec } from "../../lib/outline";
import { Empty } from "../../components/ui";
import { CharActions, DetailChars, SimpleChars } from "./Chars";
import { Tree, TreeActions, type Sel } from "./Tree";
import { EventActions, Events } from "./Events";
import { Plan, PlanActions } from "./Plan";
import { names } from "./ctx";

export type Say = (node: ReactNode) => void;
type Tab = "chars" | "tree" | "events" | "plan";

const HINT: Record<Tab, string> = {
  chars: "每个人物卡都可以点「AI 起草空白项」，或点「从正文整理人物」从已写章节里提取。AI 写的内容是浅黄底，你改过之后变回普通底色。外貌是锁定项，以后正文写出矛盾会报错。「详细版」有 12 组完整档案、人设时间轴、知情范围和称呼表。",
  tree: "拖动 ⋮⋮ 调整章节和场景顺序，点章或场景在右边编辑。「详细版」放开视角、故事时间、地点、转折、结果、情绪、信息揭示等全部字段。「同步」可以把大纲导入时间线和篇幅规划，也能反过来导入。",
  events: "事件按故事内的时间排。伏笔的埋和收也是事件。点任一事件打开事件卡，「详细版」可以写起因、经过、结果、影响、信息揭示和前后因果。「同步」会把还没进大纲的事件变成场景，也会把大纲里的场景加进时间线。",
  plan: "给每个事件段定总章数和阶段，段与段之间留几章过渡。拖动标尺上的竖线，或直接改数字。「同步到大纲」会给章节标上所属阶段、补建空章；大纲里改了章的归属，也能回写到这里。",
};

export default function Outline() {
  const [tab, setTab] = useState<Tab>("chars");
  const [cmode, setCmode] = useState<"simple" | "detail">("simple");
  const [omode, setOmode] = useState<"simple" | "detail">("simple");
  const [emode, setEmode] = useState<"simple" | "detail">("simple");
  const vols = useStore((s) => s.vols);
  const [sel, setSel] = useState<Sel>({ ch: vols[0]?.chapters[0]?.id ?? null, s: -1 });
  const [esel, setEsel] = useState<string | null>(null);
  const [ai, setAi] = useState<{ tab: Tab; node: ReactNode } | null>(null);
  const say: Say = (node) => setAi({ tab, node });
  const shown = ai && ai.tab === tab ? ai.node : <Empty>{HINT[tab]}</Empty>;
  const openSync = (focus: Tab) => setAi({ tab, node: <SyncPanel focus={focus} done={(n) => setAi({ tab, node: n })} /> });

  return (
    <section id="outline" className="view">
      <div className="ol-head">
        <div className="seg" role="group" aria-label="大纲页分区">
          {(
            [
              ["chars", "人物"],
              ["tree", "大纲"],
              ["events", "事件"],
              ["plan", "篇幅规划"],
            ] as [Tab, string][]
          ).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
        {tab === "chars" && <CharActions mode={cmode} setMode={setCmode} say={say} />}
        {tab === "tree" && <TreeActions mode={omode} setMode={setOmode} say={say} onSync={() => openSync("tree")} sel={sel} setSel={setSel} />}
        {tab === "events" && <EventActions mode={emode} setMode={setEmode} say={say} onSync={() => openSync("events")} />}
        {tab === "plan" && <PlanActions say={say} onSync={() => openSync("plan")} />}
      </div>
      <div className="grid-ol">
        <div>
          {tab === "chars" && (cmode === "simple" ? <SimpleChars say={say} /> : <DetailChars say={say} />)}
          {tab === "tree" && (
            <Tree
              mode={omode}
              say={say}
              sel={sel}
              setSel={setSel}
              goEvent={(id) => {
                setEsel(id);
                setTab("events");
              }}
            />
          )}
          {tab === "events" && (
            <Events
              mode={emode}
              sel={esel}
              setSel={setEsel}
              goScene={(ch, s) => {
                setSel({ ch, s });
                setTab("tree");
              }}
            />
          )}
          {tab === "plan" && <Plan say={say} />}
        </div>
        <aside className="panel ai-box">
          <h3>
            <span>AI 助手</span>
          </h3>
          <div>{shown}</div>
        </aside>
      </div>
    </section>
  );
}

function SyncPanel({ focus, done }: { focus: Tab; done: (n: ReactNode) => void }) {
  const vols = useStore((s) => s.vols);
  const events = useStore((s) => s.events);
  const plan = useStore((s) => s.plan);
  const [{ items, notes }] = useState(() => buildSync({ vols, events, plan }));
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map((i) => [i.key, i.on])));
  const order: SyncSec[] = focus === "events" ? ["A", "B", "C", "D"] : focus === "plan" ? ["C", "D", "A", "B"] : ["B", "A", "D", "C"];

  function run() {
    const picked: SyncItem[] = [];
    for (const k of RUN_ORDER) for (const it of items) if (it.sec === k && on[it.key]) picked.push(it);
    const nm = names();
    useStore.getState().aiEdit(`同步 ${picked.length} 项`, ["vols", "events", "plan"], (d) => {
      for (const it of picked) it.run(d as any, nm);
    });
    toast(picked.length ? `已同步 ${picked.length} 项` : "没有执行任何改动");
    done(
      picked.length ? (
        <>
          <p style={{ margin: "0 0 6px" }}>已执行 {picked.length} 项：</p>
          <ul style={{ margin: "0 0 6px", paddingLeft: 18 }}>
            {picked.map((p) => (
              <li key={p.key}>
                {SEC[p.sec][0]}：{p.lab}
              </li>
            ))}
          </ul>
          <p className="empty" style={{ margin: 0 }}>新建的场景和事件标了来源，只搬了标题、时间、人物这些已有信息，没有替你写情节。整组撤销在「记忆」页的变更记录里。</p>
        </>
      ) : (
        <Empty>没有勾选任何改动。</Empty>
      ),
    );
  }

  return (
    <div>
      <p style={{ margin: "0 0 4px" }}>
        <b>同步预览</b>
      </p>
      <p className="empty" style={{ margin: "0 0 8px" }}>
        只执行勾选的项。已经关联的场景和事件，故事时间、地点、结果、信息揭示会自动保持一致，不用再同步。
      </p>
      {order.map((k) => {
        const its = items.filter((i) => i.sec === k);
        const ns = notes.filter((n) => n.sec === k);
        return (
          <div className="sy" key={k}>
            <div className="sy-t">
              {SEC[k][0]}
              <small>{SEC[k][1]}</small>
            </div>
            {its.map((p) => (
              <label className="sy-i" key={p.key}>
                <input type="checkbox" checked={!!on[p.key]} onChange={(e) => setOn({ ...on, [p.key]: e.target.checked })} />
                <span>
                  {p.lab}
                  {p.why && <small>{p.why}</small>}
                </span>
              </label>
            ))}
            {ns.map((n, i) => (
              <div className="sy-n" key={i}>
                {n.t}
              </div>
            ))}
            {!its.length && !ns.length && (
              <div className="sy-n">{k === "D" ? "大纲里各阶段的章数和规划一致。在大纲「详细版」里改某一章的所属阶段，这里会列出要改的章数。" : k === "C" && !plan.length ? "还没有篇幅规划。" : "两边一致，没有要改的。"}</div>
            )}
          </div>
        );
      })}
      <button className="btn primary" type="button" id="sy-go" disabled={!items.length} onClick={run}>
        执行勾选的改动
      </button>
    </div>
  );
}
