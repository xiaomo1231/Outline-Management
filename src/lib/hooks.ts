import { useEffect, useRef, useState } from "react";
import { getSetting, setSetting } from "./repo";

/** 读写一项设置，改动后自动保存 */
export function useSetting<T>(key: string, fallback: T): [T, (v: T) => void, boolean] {
  const [v, setV] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  const fb = useRef(fallback);
  useEffect(() => {
    let alive = true;
    getSetting<T>(key, fb.current).then((x) => {
      if (!alive) return;
      setV(typeof fb.current === "object" && fb.current && !Array.isArray(fb.current) ? { ...fb.current, ...(x as any) } : x);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return [
    v,
    (nv: T) => {
      setV(nv);
      setSetting(key, nv);
    },
    ready,
  ];
}

export interface EditorPrefs {
  font: string;
  size: number;
  lineHeight: number;
  paper: "plain" | "warm" | "night";
  width: number;
  indent: boolean;
  gap: number;
  fonts: { name: string; path: string }[];
}
export const EDITOR_DEFAULT: EditorPrefs = { font: "var(--f-body)", size: 18, lineHeight: 1.9, paper: "plain", width: 38, indent: true, gap: 0.6, fonts: [] };

export interface MemPrefs {
  dailyAt: string;
  residentLimit: number;
  autoModel: boolean;
  /** 设置版本：2 起核心摘要默认上限从 3000 调到 10000 */
  rv?: number;
}
export const RESIDENT_MIN = 1000;
export const RESIDENT_MAX = 20000;
export const MEM_DEFAULT: MemPrefs = { dailyAt: "22:05", residentLimit: 10000, autoModel: false, rv: 2 };

/** 核心摘要上限，夹在允许范围里 */
export function residentLimitOf(p: Partial<MemPrefs>): number {
  const n = Math.round(Number(p.residentLimit) || MEM_DEFAULT.residentLimit);
  return Math.min(RESIDENT_MAX, Math.max(RESIDENT_MIN, n));
}

/** 老设置里存的是旧默认值 3000（多半是改别的设置时顺带存下的），升到新默认 10000；作者自己改过的不动 */
export function migrateMemPrefs(x: Partial<MemPrefs>): Partial<MemPrefs> | null {
  if ((x.rv ?? 0) >= 2) return null;
  return { ...x, residentLimit: x.residentLimit == null || x.residentLimit === 3000 ? 10000 : x.residentLimit, rv: 2 };
}
