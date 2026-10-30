import { useEffect, useRef, useState } from "react";
import { useStore, toast, type Page } from "./lib/store";
import * as repo from "./lib/repo";
import * as mem from "./lib/memory";
import { isTauri } from "./lib/db";
import { MEM_DEFAULT, type EditorPrefs, type MemPrefs } from "./lib/hooks";
import { loadSavedFonts } from "./lib/fonts";
import { today } from "./lib/util";
import Library from "./pages/Library";
import NewWork from "./pages/NewWork";
import Write from "./pages/Write";
import Outline from "./pages/outline/Outline";
import Style from "./pages/Style";
import Memory, { runAll } from "./pages/Memory";
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

  useEffect(() => {
    (async () => {
      await loadSavedFonts((await repo.getSetting<Partial<EditorPrefs>>("editor", {})).fonts ?? []);
      const s = useStore.getState();
      await s.loadWorks();
      const last = await repo.getSetting<string | null>("lastWork", null);
      if (last && useStore.getState().works.some((w) => w.id === last)) await s.openWork(last);
      setReady(true);
    })();
  }, []);

  useScheduler(work?.id ?? null);

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
      {h.overdue ? " · 今天还没结账" : h.lastScript ? ` · 上次结账 ${new Date(h.lastScript.at).toLocaleDateString()}` : ""}
    </button>
  );
}

/** 每天定时结账；打开时发现漏跑就补；关窗口时跑一次脚本班 */
function useScheduler(workId: string | null) {
  const running = useRef(false);
  useEffect(() => {
    if (!workId) return;
    const run = async (why: string) => {
      if (running.current) return;
      running.current = true;
      try {
        const r = await runAll();
        if (r) toast(`${why}：记忆已结账`);
      } finally {
        running.current = false;
      }
    };
    const check = async () => {
      const p = await prefs();
      const h = await mem.health(workId, p.dailyAt);
      if (h.overdue) run(h.lastScript && h.lastScript.day < today() ? "补跑昨天漏掉的结账" : "到点了");
    };
    const t0 = setTimeout(check, 8000);
    const t = setInterval(check, 60_000);
    return () => {
      clearTimeout(t0);
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
      setLines([
        y ? `上次写作 ${y.day}，写了 ${y.words.toLocaleString()} 字。今天目标 ${s.work?.goal.toLocaleString()} 字。` : `今天目标 ${s.work?.goal.toLocaleString()} 字。`,
        `记忆：${h.counts.map((n, i) => `${mem.LAYER[i + 1]} ${n}`).join("、")}；常驻页 ${h.residentChars ? h.residentChars + " 字" : "还没生成"}。`,
        h.lastScript ? `上次结账 ${new Date(h.lastScript.at).toLocaleString()}，${h.lastScript.ok ? "正常" : "出错了，去记忆页看看"}${h.overdue ? "；有漏跑，稍后自动补上" : ""}。` : "还没结过账，今晚会第一次结账。",
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
