// 模型班：脚本班跑完后才动。给新写的章节做摘要、提取人设变化和新事实、写写作日记、整理常驻页和作品圣经。
import { chat, chatJson } from "./client";
import type { Ctx } from "./context";
import { useStore } from "../store";
import * as repo from "../repo";
import * as mem from "../memory";
import { allChapters } from "../outline";
import { fieldDef, fieldLabel } from "../charFields";
import { compileStyle } from "../style";
import { today, uid } from "../util";
import type { CharChange } from "../types";

interface ChapterDigest {
  summary: string;
  facts: string[];
  changes: { name: string; field: string; to: string; cause: string; quote: string }[];
}

export async function modelRun(c: Ctx, residentLimit: number, onStep?: (s: string) => void): Promise<mem.MemLogEntry> {
  const lines: string[] = [];
  const log = await mem.getLog(c.work.id);
  const lastScript = log.find((e) => e.kind === "script");
  if (!lastScript || lastScript.day !== today() || !lastScript.ok) {
    const e: mem.MemLogEntry = { at: Date.now(), day: today(), kind: "model", ok: false, lines: ["今天的脚本班还没跑完，模型班不动。"] };
    await mem.appendLog(c.work.id, e);
    return e;
  }
  try {
    // 1. 新写或改过的章节：摘要 + 新事实 + 人设变化
    const texts = await repo.allTexts(c.work.id);
    const chs = allChapters(c.vols);
    const todo = chs.filter((r) => {
      const t = texts.find((x) => x.id === r.ch.id);
      return t && t.words > 200 && (!r.ch.summaryAt || t.updated > r.ch.summaryAt);
    }).slice(0, 8);
    let nChanges = 0;
    let nConflict = 0;
    let nFacts = 0;
    const keys = [...new Set(["id", "class", "power", "clothes", "acc", "want", "rel", "core", "look", "hair", "fear", "values"])];
    for (const r of todo) {
      onStep?.(`读第 ${r.no} 章`);
      const t = texts.find((x) => x.id === r.ch.id)!;
      const people = c.chars.filter((x) => x.name && t.plain.includes(x.name));
      const d = await chatJson<ChapterDigest>([
        { role: "system", content: "你是小说的记忆整理员。只记录正文里确实写到的内容。" },
        { role: "user", content: `第${r.no}章正文：\n${t.plain.slice(0, 30000)}\n\n出场人物现有设定：\n${people.map((p) => `${p.name}：` + keys.filter((k) => p.f[k]).map((k) => `${k}(${fieldLabel(k)})=${p.f[k]}`).join("；")).join("\n") || "无"}\n\n返回 JSON：\n{"summary":"150 字以内的章节摘要","facts":["这一章确立的、以后要记住的事实，每条一句，最多 8 条"],"changes":[{"name":"人物","field":"字段键（从上面的键里选）","to":"新值","cause":"触发事件","quote":"原文短引用"}]}\n人设变化只记真正改变了的（身份、处境、关系、外观、能力、动机等），没有就空数组。` },
      ], { temperature: 0.2 });
      const now = Date.now();
      const conflicts: string[] = [];
      useStore.getState().aiEdit(`第${r.no}章结账：摘要和人设变化`, ["vols", "chars"], (dr) => {
        const ch = dr.vols[r.v]?.chapters[r.c];
        if (ch) {
          ch.summary = d.summary;
          ch.summaryAt = now;
        }
        for (const x of d.changes ?? []) {
          const p = dr.chars.find((y) => y.name === x.name);
          if (!p || !x.field || !x.to) continue;
          const lock = fieldDef(x.field)?.flag === "lock";
          const cc: CharChange = { id: uid("cc"), ch: r.ch.id, field: x.field, from: p.f[x.field] || "", to: x.to, cause: x.cause, quote: x.quote, by: "ai", at: now, status: lock ? "conflict" : "applied" };
          (p.changes ??= []).push(cc);
          if (lock) conflicts.push(`${p.name}的${fieldLabel(x.field)}`);
          else nChanges++;
        }
      });
      nConflict += conflicts.length;
      for (const f of d.facts ?? []) {
        await mem.voteNew(c.work.id, "fact", f, r.no, `第${r.no}章`);
        nFacts++;
      }
    }
    lines.push(`摘要 ${todo.length} 章，人设变化 ${nChanges} 条${nConflict ? `，锁定项冲突 ${nConflict} 条待你处理` : ""}，新事实 ${nFacts} 条。`);
    // 新事实当场入层
    if (nFacts) {
      const st = useStore.getState();
      await mem.scriptRun(st.work!, st.vols);
    }
    const s = useStore.getState();
    const cur: Ctx = { ...c, vols: s.vols, chars: s.chars };

    // 2. 写作日记
    onStep?.("写今天的写作日记");
    const daily = (await repo.dailyWords(c.work.id, 1)).find((x) => x.day === today());
    const todays = allChapters(cur.vols).filter((r) => texts.find((x) => x.id === r.ch.id && new Date(x.updated).toDateString() === new Date().toDateString()));
    const changesToday = cur.chars.flatMap((p) => (p.changes ?? []).filter((x) => new Date(x.at).toDateString() === new Date().toDateString()).map((x) => `${p.name}：${fieldLabel(x.field)} ${x.from || "（空）"} → ${x.to}（${x.status === "conflict" ? "锁定项冲突，待处理" : x.cause}）`));
    const diary = await chat([
      { role: "system", content: "你替作者写当天的写作日记，平实、具体、不夸。分五段，每段用【】标题：今日进度、剧情推进、人物变化、伏笔变动、遗留问题。" },
      { role: "user", content: `今天写了 ${daily?.words ?? 0} 字。\n今天动过的章节：\n${todays.map((r) => `第${r.no}章 ${r.ch.title}：${r.ch.summary || ""}`).join("\n") || "无"}\n人设变化：\n${changesToday.join("\n") || "无"}\n大纲里的伏笔：\n${cur.vols.flatMap((v) => v.chapters.flatMap((ch) => ch.scenes.filter((x) => x.plant || x.pay).map((x) => `${x.plant ? "埋 " + x.plant : ""}${x.pay ? " 收 " + x.pay : ""}`))).join("；") || "无"}` },
    ], { temperature: 0.5 });
    await repo.saveDiary(c.work.id, today(), diary.content.trim());
    lines.push("写作日记已生成。");

    // 3. 常驻页压短捋顺
    onStep?.("整理常驻页");
    const facts = await mem.items(c.work.id, 1);
    const raw = mem.buildResident(cur.work, cur.chars, cur.vols, cur.events, compileStyle(cur.style), facts, residentLimit * 2);
    const res = await chat([
      { role: "system", content: `你整理小说的「常驻页」：每次调用 AI 都会带上它。一半写人物当前状态和写作规范，一半写剧情事实和未收伏笔。压到 ${residentLimit} 字以内，信息不丢，去掉重复，用短句。直接输出正文。` },
      { role: "user", content: raw },
    ], { temperature: 0.2 });
    const text = res.content.trim().slice(0, Math.round(residentLimit * 1.1));
    await mem.saveResident(c.work.id, text, residentLimit);
    lines.push(`常驻页 ${text.length} 字（上限 ${residentLimit}）。`);

    // 4. 作品圣经：只提炼「这本书定下了什么」
    onStep?.("更新作品圣经");
    const bible = await mem.getBible(c.work.id);
    const sums = todo.map((r) => `第${r.no}章：${s.vols[r.v]?.chapters[r.c]?.summary ?? ""}`).join("\n");
    if (sums) {
      const b = await chat([
        { role: "system", content: "你维护小说的「作品圣经」：只记已经确立、以后不能推翻的设定和事实，按类别分组（世界规则、人物定论、重要物件、地点、时间线定点）。保留已有条目，加入新的，删除重复。直接输出全文。" },
        { role: "user", content: `现有作品圣经：\n${bible.text || "（空）"}\n\n新写的章节摘要：\n${sums}` },
      ], { temperature: 0.2 });
      await mem.saveBible(c.work.id, b.content.trim());
      lines.push("作品圣经已更新。");
    } else lines.push("没有新章节，作品圣经不动。");

    const e: mem.MemLogEntry = { at: Date.now(), day: today(), kind: "model", ok: true, lines };
    await mem.appendLog(c.work.id, e);
    return e;
  } catch (err: any) {
    const e: mem.MemLogEntry = { at: Date.now(), day: today(), kind: "model", ok: false, lines: [...lines, "出错：" + (err?.message || err)] };
    await mem.appendLog(c.work.id, e);
    return e;
  }
}
