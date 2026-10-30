import { useStore } from "../../lib/store";
import type { Ctx } from "../../lib/ai/context";

export function ctx(): Ctx {
  const s = useStore.getState();
  return { work: s.work!, vols: s.vols, chars: s.chars, events: s.events, plan: s.plan, style: s.style, calls: s.calls, changesets: s.changesets };
}

export function names(): string[] {
  return useStore.getState().chars.map((c) => c.name).filter(Boolean);
}
