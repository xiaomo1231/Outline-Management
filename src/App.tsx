import { useEffect, useRef, useState } from "react";
import { useStore, toast, type Page } from "./lib/store";
import * as repo from "./lib/repo";
import * as mem from "./lib/memory";
import { isTauri } from "./lib/db";
import * as bk from "./lib/backup";
import { purgeOld } from "./lib/trash";
import { MEM_DEFAULT, migrateMemPrefs, type EditorPrefs, type MemPrefs } from "./lib/hooks";
import { loadSavedFonts } from "./lib/fonts";
import { fmtTime, today } from "./lib/util";
import Library from "./pages/Library";
import NewWork from "./pages/NewWork";
import Write from "./pages/Write";
import Outline from "./pages/outline/Outline";
import Style from "./pages/Style";
import Memory, { runAll } from "./pages/Memory";
import * as arc from "./lib/ai/archive";
import Settings from "./pages/Settings";
import Assistant from "./components/Assistant";

const TABS: [Page, string, boolean][] = [
  ["library", "作品库", false],
  ["write", "写作", true],
  ["outline", "大纲", true],
  ["style", "风格", true],
  ["memory", "记忆", true],
  ["settings", "设置", false],
];

async function prefs(): Promise<MemPrefs> {
  return { ...MEM_DEFAULT, ...(await repo.getSetting<Partial<MemPrefs>>("memory", {})) };
}

export default function App() {
  const page = useStore((s) => s.page);
  const work = useStore((s) => s.work);
  const msg = useStore((s) => s.toast);
  const [ready, setReady] = useState(false);
  const [broken, setBroken] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setBroken(await bk.checkIntegrity());
      purgeOld().catch(() => {});
      // 核心摘要默认上限从 3000 调到 10000：老设置里的旧默认值跟着升
      const mp = migrateMemPrefs(await repo.getSetting<Partial<MemPrefs>>("memory", {}));
      if (mp) await repo.setSetting("memory", mp);
      await loadSavedFonts((await repo.getSetting<Partial<EditorPrefs>>("editor", {})).fonts ?? []);
      const s = useStore.getState();
      await s.loadWorks();
      const last = await repo.getSetting<string | null>("lastWork", null);
      if (last && useStore.getState().works.some((w) => w.id === last)) await s.openWork(last);
      setReady(true);
    })();
  }, []);

  useScheduler(work?.id ?? null);
  useAutoBackup();

  if (!ready) return <div className="boot">墨枢</div>;
  const needWork = !work && page !== "library" && page !== "new" && page !== "settings";

  return (
    <>
      <header className="top">
        <div className="brand">
          <b>墨枢</b>
          <span>{work ? work.name : "小说写作"}</span>
        </div>
        <nav className="tabs" aria-label="视图">
          {TABS.map(([p, l, w]) =>
            w && !work ? null : (
              <a
                key={p}
                href={"#" + p}
                aria-current={page === p ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  useStore.getState().go(p);
                }}
              >
                {l}
              </a>
            ),
          )}
        </nav>
        {work && <MemoryBar work={work.id} />}
      </header>
      {broken && (
        <div className="banner bad" role="alert">
          数据库检查发现问题（{broken}）。建议到「设置 → 备份与恢复」从最近一份备份恢复。
          <button className="btn" type="button" onClick={() => useStore.getState().go("settings")}>
            去恢复
          </button>
          <button className="x" type="button" aria-label="关闭" onClick={() => setBroken(null)}>
            ×
          </button>
        </div>
      )}
      <main>
        {(page === "library" || needWork) && <Library />}
        {page === "new" && <NewWork />}
        {work && page === "write" && <Write />}
        {work && page === "outline" && <Outline />}
        {work && page === "style" && <Style />}
        {work && page === "memory" && <Memory />}
        {page === "settings" && <Settings />}
      </main>
      {work && <Assistant key={work.id} />}
      {work && <DayReport work={work.id} />}
      {msg && (
        <div className="toast" role="status">
          {msg}
        </div>
      )}
    </>
  );
}

/** 顶栏右侧的记忆健康：有问题时变色，点开去记忆页 */
function MemoryBar({ work }: { work: string }) {
  const page = useStore((s) => s.page);
  const [h, setH] = useState<mem.Health | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const p = await prefs();
      const x = await mem.health(work, p.dailyAt);
      if (alive) setH(x);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [work, page]);
  if (!h) return null;
  const bad = h.overdue || h.lastScript?.ok === false || h.lastModel?.ok === false;
  return (
    <button type="button" className={"membar" + (bad ? " bad" : "")} onClick={() => useStore.getState().go("memory")} title="记忆健康，点开看详情">
      <i />
      记忆 {h.counts.reduce((a, b) => a + b, 0)} 条
      {h.overdue ? " · 今天还没整理" : h.lastScript ? ` · 上次整理 ${new Date(h.lastScript.at).toLocaleDateString()}` : ""}
    </button>
  );
}

/** 写作时每 2 小时自动备份一次数据库（每日整理和关窗时另有备份） */
function useAutoBackup() {
  useEffect(() => {
    if (!isTauri) return;
    const tick = async () => {
      const last = await repo.getSetting<number>("lastBackup", 0);
      if (Date.now() - last >= bk.BACKUP_EVERY) await bk.backup();
    };
    const t = setInterval(() => void tick(), 10 * 60_000);
    return () => clearInterval(t);
  }, []);
}

/** 每天定时做每日整理；打开时发现漏跑就补；关窗口时跑一次自动整理 */
function useScheduler(workId: string | null) {
  const running = useRef(false);
  useEffect(() => {
    if (!workId) return;
    const run = async (why: string) => {
      if (running.current) return;
      running.current = true;
      try {
        const r = await runAll();
        if (r) toast(`${why}：记忆已整理`);
      } finally {
        running.current = false;
      }
    };
    const check = async () => {
      const p = await prefs();
      const h = await mem.health(workId, p.dailyAt);
      if (h.overdue) run(h.owe < today() ? "补跑漏掉的整理" : "到点了");
    };
    const t0 = setTimeout(check, 8000);
    const t = setInterval(check, 60_000);
    // 上次关窗前改了还没来得及归档的章，打开后补上
    const t1 = setTimeout(() => void arc.catchUpRecent(workId).catch(() => {}), 20_000);
    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
      arc.cancelPending();
      clearInterval(t);
    };
  }, [workId]);

  useEffect(() => {
    if (!isTauri) {
      const f = () => void useStore.getState().flushSaves();
      window.addEventListener("beforeunload", f);
      return () => window.removeEventListener("beforeunload", f);
    }
    let un: (() => void) | undefined;
    let closing = false;
    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      un = await win.onCloseRequested(async (e) => {
        if (closing) return;
        e.preventDefault();
        closing = true;
        const s = useStore.getState();
        try {
          await s.flushSaves();
          if (s.work) await Promise.race([mem.scriptRun(s.work, s.vols), new Promise((r) => setTimeout(r, 5000))]);
        } finally {
          await win.destroy();
        }
      });
    })();
    return () => un?.();
  }, []);
}

/** 每天第一次打开时的三行自报 */
function DayReport({ work }: { work: string }) {
  const [lines, setLines] = useState<string[] | null>(null);
  useEffect(() => {
    (async () => {
      const key = "dayReport:" + work;
      if ((await repo.getSetting<string>(key, "")) === today()) return;
      await repo.setSetting(key, today());
      const s = useStore.getState();
      const p = await prefs();
      const [days, h] = await Promise.all([repo.dailyWords(work, 7), mem.health(work, p.dailyAt)]);
      const y = days.find((d) => d.day < today());
      if (!y && !h.lastScript) {
        setLines([
          `欢迎！今天的目标是 ${s.work?.goal.toLocaleString()} 字，写作页底栏会实时显示进度。`,
          "写的内容每隔几秒自动保存，不用手动点保存。",
          "不知道从哪开始？先去「大纲」写一句话梗概，或者直接在这里开写。",
        ]);
        return;
      }
      setLines([
        y ? `上次写作 ${y.day}，写了 ${y.words.toLocaleString()} 字。今天目标 ${s.work?.goal.toLocaleString()} 字。` : `今天目标 ${s.work?.goal.toLocaleString()} 字。`,
        `记忆：${h.counts.map((n, i) => `${mem.LAYER[i + 1]} ${n}`).join("、")}；核心摘要 ${h.residentChars ? h.residentChars + " 字" : "还没生成"}。`,
        h.lastScript ? `上次整理 ${fmtTime(h.lastScript.at)}，${h.lastScript.ok ? "正常" : "出错了，去记忆页看看"}${h.overdue ? "；有漏跑，稍后自动补上" : ""}。` : "还没整理过，今晚会第一次每日整理。",
      ]);
    })();
  }, [work]);
  useEffect(() => {
    if (!lines) return;
    const t = setTimeout(() => setLines(null), 20_000);
    return () => clearTimeout(t);
  }, [lines]);
  if (!lines) return null;
  return (
    <div className="day-report" role="status">
      <b>今天开工</b>
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
      <button type="button" className="x" aria-label="关闭" onClick={() => setLines(null)}>
        ×
      </button>
    </div>
  );
}
