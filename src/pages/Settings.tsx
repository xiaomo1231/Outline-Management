import { useEffect, useState } from "react";
import { useStore, toast } from "../lib/store";
import { getSecret, setSecret } from "../lib/secret";
import { DEFAULT_AI, listModels, chat, errText, type AiSettings } from "../lib/ai/client";
import { MEM_DEFAULT, useSetting, type MemPrefs } from "../lib/hooks";
import * as repo from "../lib/repo";
import { isTauri, getDb } from "../lib/db";
import { allChapters } from "../lib/outline";
import { AsyncButton, Empty } from "../components/ui";

export default function Settings() {
  const work = useStore((s) => s.work);
  const [ai, setAi] = useSetting<AiSettings>("ai", DEFAULT_AI);
  const [memp, setMemp] = useSetting<MemPrefs>("memory", MEM_DEFAULT);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof repo.getUsage>>>([]);
  const [dir, setDir] = useState<string | null>(null);

  useEffect(() => {
    getSecret("deepseek").then((k) => setHasKey(!!k));
    repo.getUsage(30).then(setUsage);
    getDb().then((d) => d.dir()).then(setDir);
  }, []);

  const sum = usage.reduce((a, u) => ({ p: a.p + u.prompt, c: a.c + u.cached, o: a.o + u.completion, n: a.n + u.calls }), { p: 0, c: 0, o: 0, n: 0 });

  return (
    <section className="view settings">
      <div className="panel">
        <h3>DeepSeek</h3>
        <div className="meta-row">
          <label>
            API 密钥 {hasKey && <span className="chip">已保存</span>}
            <input type="password" value={key} placeholder={hasKey ? "已保存，重新填写会覆盖" : "sk-…"} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
          </label>
          <label>
            接口地址
            <input value={ai.baseUrl} onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })} />
          </label>
        </div>
        <div className="addrow">
          <button
            className="btn primary"
            type="button"
            onClick={async () => {
              await setSecret("deepseek", key.trim());
              setHasKey(!!key.trim());
              setKey("");
              toast(key.trim() ? (isTauri ? "密钥已存进 Windows 凭据管理器" : "密钥已保存") : "密钥已删除");
            }}
          >
            {key.trim() ? "保存密钥" : "删除密钥"}
          </button>
          <AsyncButton
            onClick={async () => {
              try {
                const m = await listModels();
                setModels(m);
                const r = await chat([{ role: "user", content: "回复两个字：可以" }], { maxTokens: 10 });
                setMsg(`连接正常。可用模型：${m.join("、")}。测试回复：${r.content}`);
              } catch (e) {
                setMsg(errText(e));
              }
            }}
          >
            测试连接并获取模型
          </AsyncButton>
        </div>
        {msg && <p className="legend">{msg}</p>}
        <div className="meta-row" style={{ marginTop: 10 }}>
          <label>
            日常模型（起草、梳理、聊天）
            <input list="models" value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} />
          </label>
          <label>
            写正文和深度检查用的模型
            <input list="models" value={ai.writeModel} onChange={(e) => setAi({ ...ai, writeModel: e.target.value })} />
          </label>
          <label>
            创造性（temperature，0–2）
            <input type="number" min={0} max={2} step={0.1} value={ai.temperature} onChange={(e) => setAi({ ...ai, temperature: +e.target.value })} />
          </label>
          <label>
            每天 token 上限（0 为不限）
            <input type="number" min={0} step={10000} value={ai.dailyLimit} onChange={(e) => setAi({ ...ai, dailyLimit: +e.target.value })} />
          </label>
        </div>
        <datalist id="models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <p className="legend">模型名以 DeepSeek 官方当前提供的为准，点「测试连接」会列出你的账号能用的模型。密钥{isTauri ? "保存在 Windows 凭据管理器里，不进数据库" : "在浏览器调试版里存在本机浏览器"}。</p>
      </div>

      <div className="panel">
        <h3>记忆与结账</h3>
        <div className="meta-row">
          <label>
            每天结账时间
            <input type="time" value={memp.dailyAt} onChange={(e) => setMemp({ ...memp, dailyAt: e.target.value })} />
          </label>
          <label>
            常驻页上限（字）
            <input type="number" min={1000} max={8000} step={500} value={memp.residentLimit} onChange={(e) => setMemp({ ...memp, residentLimit: +e.target.value })} />
          </label>
          <label className="check">
            <span>
              <input type="checkbox" checked={memp.autoModel} onChange={(e) => setMemp({ ...memp, autoModel: e.target.checked })} /> 结账时自动跑模型班（会花 API 费）
            </span>
          </label>
        </div>
      </div>

      <div className="panel">
        <h3>用量（近 30 天）</h3>
        {usage.length ? (
          <>
            <p className="plan-sum">
              <span>
                调用 <b>{sum.n}</b> 次
              </span>
              <span>
                输入 <b>{sum.p.toLocaleString()}</b> token（其中缓存命中 <b>{sum.c.toLocaleString()}</b>）
              </span>
              <span>
                输出 <b>{sum.o.toLocaleString()}</b> token
              </span>
            </p>
            <table className="ev">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>调用</th>
                  <th>输入</th>
                  <th>缓存命中</th>
                  <th>输出</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={u.day}>
                    <td className="num">{u.day}</td>
                    <td className="num">{u.calls}</td>
                    <td className="num">{u.prompt.toLocaleString()}</td>
                    <td className="num">{u.cached.toLocaleString()}</td>
                    <td className="num">{u.completion.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="legend">费用按 DeepSeek 官网当前价格乘以上面的 token 数计算。缓存命中的输入比普通输入便宜很多。</p>
          </>
        ) : (
          <Empty>还没有调用记录。</Empty>
        )}
      </div>

      <div className="panel">
        <h3>数据</h3>
        <p className="legend">{dir ? `所有数据存在：${dir}（数据库 moshu.db，备份在 backups 文件夹，保留 14 份）` : "浏览器调试版的数据存在这个浏览器里。"}</p>
        {work && (
          <div className="addrow">
            <AsyncButton onClick={() => exportWork("md")}>导出本书为 Markdown</AsyncButton>
            <AsyncButton onClick={() => exportWork("txt")}>导出本书为 TXT</AsyncButton>
          </div>
        )}
      </div>
    </section>
  );
}

async function exportWork(kind: "md" | "txt") {
  const s = useStore.getState();
  if (!s.work) return;
  const parts: string[] = [kind === "md" ? `# ${s.work.name}\n\n${s.work.intro}\n` : `${s.work.name}\n\n${s.work.intro}\n`];
  let lastVol = -1;
  for (const r of allChapters(s.vols)) {
    if (r.v !== lastVol) {
      lastVol = r.v;
      parts.push(kind === "md" ? `\n## ${s.vols[r.v].title}\n` : `\n${s.vols[r.v].title}\n`);
    }
    const t = await repo.loadText(r.ch.id);
    parts.push((kind === "md" ? `\n### 第${r.no}章 ${r.ch.title}\n\n` : `\n第${r.no}章 ${r.ch.title}\n\n`) + (t?.plain ?? "").split("\n").filter(Boolean).map((p) => (kind === "txt" ? "　　" + p : p)).join(kind === "md" ? "\n\n" : "\n"));
  }
  const text = parts.join("\n");
  const name = `${s.work.name}.${kind}`;
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: name, filters: [{ name: kind.toUpperCase(), extensions: [kind] }] });
    if (!path) return;
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, text);
    toast("已导出到 " + path);
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    a.download = name;
    a.click();
  }
}
