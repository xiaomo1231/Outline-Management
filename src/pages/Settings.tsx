import { useEffect, useState } from "react";
import { toast } from "../lib/store";
import { getSecret, setSecret } from "../lib/secret";
import { DEFAULT_AI, listModels, chat, errText, type AiSettings } from "../lib/ai/client";
import { EDITOR_DEFAULT, MEM_DEFAULT, RESIDENT_MAX, RESIDENT_MIN, residentLimitOf, useSetting, type EditorPrefs, type MemPrefs } from "../lib/hooks";
import * as repo from "../lib/repo";
import { isTauri, getDb } from "../lib/db";
import { AsyncButton, Empty } from "../components/ui";
import { BackupPanel, ExportPanel, TrashPanel } from "./DataPanels";
import { APP_VERSION, checkUpdate, downloadUpdate, installUpdate, openReleasePage, pickAsset, RELEASES_URL, updateKind, type UpdateInfo } from "../lib/update";
import { backup } from "../lib/backup";
import { useStore } from "../lib/store";

export default function Settings() {
  const [ai, setAi] = useSetting<AiSettings>("ai", DEFAULT_AI);
  const [memp, setMemp] = useSetting<MemPrefs>("memory", MEM_DEFAULT);
  const [edp, setEdp, edpReady] = useSetting<EditorPrefs>("editor", EDITOR_DEFAULT);
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
            disabled={!key.trim()}
            onClick={async () => {
              await setSecret("deepseek", key.trim());
              setHasKey(true);
              setKey("");
              toast(isTauri ? "密钥已存进 Windows 凭据管理器" : "密钥已保存");
            }}
          >
            保存密钥
          </button>
          <AsyncButton
            onClick={async () => {
              try {
                // 填了新密钥还没点保存，就先替作者存上
                if (key.trim()) {
                  await setSecret("deepseek", key.trim());
                  setHasKey(true);
                  setKey("");
                }
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
          {hasKey && (
            <button
              className="btn"
              type="button"
              style={{ marginLeft: "auto" }}
              onClick={async () => {
                if (!confirm("删除已保存的 DeepSeek 密钥？删除后 AI 功能都用不了，要重新填写才能恢复。")) return;
                await setSecret("deepseek", "");
                setHasKey(false);
                toast("密钥已删除");
              }}
            >
              删除密钥
            </button>
          )}
        </div>
        <p className="legend">
          墨枢的 AI 功能用的是 DeepSeek（深度求索）的接口。到 platform.deepseek.com 注册、充值后在「API keys」里创建一个密钥，粘贴到上面。按用量计费，写作日常用一般每天几分钱到几毛钱，下面的「用量」里能看到。
        </p>
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
        <h3>记忆与每日整理</h3>
        <div className="meta-row">
          <label>
            做每日整理的时间
            <span className="row2" style={{ gap: 4 }}>
              <select value={memp.dailyAt.split(":")[0]} aria-label="小时" onChange={(e) => setMemp({ ...memp, dailyAt: e.target.value + ":" + (memp.dailyAt.split(":")[1] || "00") })}>
                {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </select>
              :
              <select value={memp.dailyAt.split(":")[1]} aria-label="分钟" onChange={(e) => setMemp({ ...memp, dailyAt: memp.dailyAt.split(":")[0] + ":" + e.target.value })}>
                {Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0")).concat(memp.dailyAt.split(":")[1] && +memp.dailyAt.split(":")[1] % 5 ? [memp.dailyAt.split(":")[1]] : []).map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </span>
          </label>
          <label>
            核心摘要上限（字）
            <input
              type="number"
              min={RESIDENT_MIN}
              max={RESIDENT_MAX}
              step={1000}
              value={memp.residentLimit}
              onChange={(e) => setMemp({ ...memp, residentLimit: +e.target.value })}
              onBlur={() => setMemp({ ...memp, residentLimit: residentLimitOf(memp) })}
            />
          </label>
          <p className="legend" style={{ gridColumn: "1 / -1", margin: 0 }}>
            核心摘要是每次调用 AI 都会带上的“这本书的要点”，可以设 {RESIDENT_MIN.toLocaleString()}–{RESIDENT_MAX.toLocaleString()} 字，默认 10,000。调高能记住更多人物和剧情，但每次调用 AI 都要多带这些字，会多花钱：每多 1,000 字，每次调用大约多 0.1 分钱（按 DeepSeek 价格粗估，连续调用命中缓存时更便宜）。改完到「记忆」页点「现在整理」，就会按新上限重新整理。
          </p>
          <label className="check">
            <span>
              <input type="checkbox" checked={memp.autoModel} onChange={(e) => setMemp({ ...memp, autoModel: e.target.checked })} /> 每日整理时顺便跑 AI 整理（会花 API 费，默认关）
            </span>
          </label>
        </div>
      </div>

      <div className="panel">
        <h3>写作</h3>
        <label className="check">
          <span>
            <input type="checkbox" checked={edp.aiMark} disabled={!edpReady} onChange={(e) => setEdp({ ...edp, aiMark: e.target.checked })} /> 正文里显示 AI 标记（浅黄底是 AI 原样写的，虚线是 AI 写后你改过的）
          </span>
        </label>
        <p className="legend" style={{ margin: "6px 0 0" }}>
          关掉只是不显示，AI 写的字照样记录，写作页底部的「本章 AI 占比」照常计算。写作页底部也有同样的开关。
        </p>
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
        <p className="legend">{dir ? `所有数据存在：${dir}（数据库 moshu.db，备份在 backups 文件夹）` : "浏览器调试版的数据存在这个浏览器里。"}</p>
      </div>
      <VersionPanel />
      <ExportPanel />
      <BackupPanel />
      <TrashPanel />
    </section>
  );
}

function VersionPanel() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [err, setErr] = useState("");
  const [dl, setDl] = useState<{ got: number; total: number } | null>(null);
  const [ready, setReady] = useState<string | null>(null);

  async function fetchNew(i: UpdateInfo) {
    if (!isTauri) return;
    const a = pickAsset(i.assets, await updateKind());
    if (!a) {
      setErr("这个版本的发布页没有可自动更新的文件，请打开下载页手动下载。");
      return;
    }
    setDl({ got: 0, total: a.size });
    try {
      setReady(await downloadUpdate(a, (got, total) => setDl({ got, total: total || a.size })));
    } catch (e: any) {
      setErr("自动下载失败：" + (e?.message || e) + "。可以打开下载页手动下载。");
    } finally {
      setDl(null);
    }
  }

  const mb = (n: number) => (n / 1048576).toFixed(1) + " MB";
  return (
    <div className="panel">
      <h3>版本</h3>
      <p className="plan-sum">
        <span>
          当前版本 <b>v{APP_VERSION}</b>
        </span>
        {info && (
          <span>
            最新版本 <b>{info.latest}</b>
            {info.publishedAt && `（${new Date(info.publishedAt).toLocaleDateString()} 发布）`}
          </span>
        )}
      </p>
      <div className="addrow">
        <AsyncButton
          disabled={!!dl}
          onClick={async () => {
            setErr("");
            setReady(null);
            try {
              const i = await checkUpdate();
              setInfo(i);
              if (i.newer) await fetchNew(i);
            } catch (e: any) {
              setInfo(null);
              setErr("检查失败：" + (e?.message || e));
            }
          }}
        >
          检查更新
        </AsyncButton>
        {ready && (
          <AsyncButton
            primary
            onClick={async () => {
              if (!confirm("墨枢会先保存正文、备份一份数据库，然后关闭并安装新版，装好后自动重新打开。现在安装吗？")) return;
              try {
                await installUpdate(ready, async () => {
                  await useStore.getState().flushSaves();
                  const r = await backup({ prune: false });
                  if (r.startsWith("备份失败")) throw new Error("安装前的备份没成功，先不安装：" + r);
                });
              } catch (e: any) {
                setErr(String(e?.message || e));
              }
            }}
          >
            安装 {info?.latest} 并重启
          </AsyncButton>
        )}
        {info?.newer && !ready && (
          <AsyncButton onClick={() => openReleasePage(info.url)}>打开 {info.latest} 的下载页</AsyncButton>
        )}
      </div>
      {dl && (
        <p className="legend">
          正在下载 {info?.latest}：{mb(dl.got)}
          {dl.total ? ` / ${mb(dl.total)}` : ""}
          <span className="meter" style={{ display: "block", marginTop: 6 }}>
            <span style={{ display: "block", height: "100%", background: "var(--accent)", width: dl.total ? Math.min(100, (dl.got / dl.total) * 100) + "%" : "0" }} />
          </span>
        </p>
      )}
      {ready && <p className="legend">新版已经下载好并通过校验。点「安装并重启」就行，作品数据不受影响。</p>}
      {info && !info.newer && <p className="legend">已经是最新版本。</p>}
      {info?.newer && info.notes && <pre className="legend" style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>{info.notes}</pre>}
      {err && <p className="lint bad">{err}</p>}
      <p className="legend">
        只有点「检查更新」时才会访问 GitHub，墨枢不会自己联网检查。发现新版会自动下载并核对校验值，下好后点「安装并重启」：安装版会运行新的安装程序，免安装版会直接替换「墨枢.exe」。安装前会先保存正文、备份数据库。作品数据在 %APPDATA%\app.moshu.writer\，更新不会动它，新版第一次打开会自动升级数据库。发布页：{RELEASES_URL}
      </p>
    </div>
  );
}
