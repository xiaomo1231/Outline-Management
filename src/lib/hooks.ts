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
}
export const MEM_DEFAULT: MemPrefs = { dailyAt: "22:05", residentLimit: 3000, autoModel: true };
