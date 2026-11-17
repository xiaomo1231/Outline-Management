// 新手路线卡：从梗概到正文的六步，每步能跳过去，做完自动打勾，可以关掉。
import { useStore } from "../lib/store";
import { useSetting } from "../lib/hooks";

export interface RouteStep {
  t: string;
  done: boolean;
  go: () => void;
}

export type RouteGo = { intro: () => void; vol: () => void; chs: () => void; scenes: () => void; sync: () => void; write: () => void };

export function routeSteps(go: RouteGo): RouteStep[] {
  const s = useStore.getState();
  const chs = s.vols.flatMap((v) => v.chapters);
  return [
    { t: "写全书梗概", done: !!s.work?.intro?.trim(), go: go.intro },
    { t: "建卷，写卷大纲", done: s.vols.some((v) => v.outline?.trim()), go: go.vol },
    { t: "拆成逐章大纲", done: chs.filter((c) => c.ol?.trim() || c.title.trim()).length >= 2, go: go.chs },
    { t: "把一章拆成场景", done: chs.some((c) => c.scenes.length), go: go.scenes },
    { t: "同步到时间线", done: s.events.length > 0, go: go.sync },
    { t: "开始写正文", done: chs.some((c) => c.status !== "大纲"), go: go.write },
  ];
}

export function RouteCard({ go }: { go: RouteGo }) {
  const work = useStore((s) => s.work);
  // 订阅这些数据，做完一步时勾会马上出现
  useStore((s) => s.vols);
  useStore((s) => s.events);
  const [hide, setHide, ready] = useSetting<Record<string, number>>("routeCard", {});
  if (!ready || !work || hide[work.id]) return null;
  const steps = routeSteps(go);
  const n = steps.filter((x) => x.done).length;
  if (n === steps.length) return null;
  const next = steps.findIndex((x) => !x.done);
  return (
    <div className="route" role="note">
      <div className="route-h">
        <b>新书上手路线</b>
        <span className="muted">
          {n}/{steps.length} 步。不一定要按顺序，也可以随时跳过直接写。
        </span>
        <button type="button" className="btn sm" onClick={() => setHide({ ...hide, [work.id]: 1 })}>
          不用了，关掉
        </button>
      </div>
      <ol>
        {steps.map((x, i) => (
          <li key={x.t} className={(x.done ? "done" : "") + (i === next ? " next" : "")}>
            <span className="tick">{x.done ? "✓" : i + 1}</span>
            <span>{x.t}</span>
            {!x.done && (
              <button type="button" className="btn sm" onClick={x.go}>
                去做
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
