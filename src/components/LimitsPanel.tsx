import { useState } from "react";
import { useSetting } from "../lib/hooks";
import { toast } from "../lib/store";
import type { LimitLevel, LimitType, LimitWho, WriteLimit } from "../lib/types";
import { DEFAULT_CAP, DEFAULT_LEVEL, LEVELS, LIMIT_TYPES, PRESETS, copyForBook, fromPreset, guessType, levelName, limitsBlock, limitsTail, newLimit, parseWords, ruleLikeLimits, whoText } from "../lib/limits";
import { Empty, Seg } from "./ui";

export interface LimitsExtra {
  /** 本书的卷，用来设「只在这几卷生效」 */
  vols?: { id: string; title: string }[];
  /** 「帮我列词」 */
  genWords?: (l: WriteLimit) => Promise<string[]>;
  /** 全书各条限制的命中次数 */
  counts?: Record<string, number>;
  /** 「我的规则」原文，以及把其中像限制的行移过来 */
  rules?: string;
  moveRules?: (lines: string[]) => void;
}

/** 本书的写作限制：作者用自己的话写「不要什么」，AI 在所有任务里遵守，生成后自动检查 */
export default function LimitsPanel({ value, onChange, names, vols = [], genWords, counts, rules, moveRules, compact }: { value: WriteLimit[]; onChange: (v: WriteLimit[]) => void; names: string[]; compact?: boolean } & LimitsExtra) {
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mine, setMine] = useSetting<WriteLimit[]>("limitTemplates", []);
  const like = ruleLikeLimits(rules);
  const list = value;
  const set = (id: string, p: Partial<WriteLimit>) => onChange(list.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const g = draft.trim() ? guessType(draft) : null;
  const old = list.filter((l) => l.fromOld).length;

  function add() {
    const t = draft.trim();
    if (!t) return;
    const l = newLimit(t);
    onChange([...list, l]);
    setDraft("");
    setOpen(l.id);
  }
  function togglePreset(key: string, on: boolean) {
    if (on) {
      const l = fromPreset(key);
      if (l && !list.some((x) => x.preset === key)) onChange([...list, l]);
    } else onChange(list.filter((x) => x.preset !== key));
  }

  const block = limitsBlock(list);
  const tail = limitsTail(list);
  return (
    <div className={compact ? "stack" : "lim-grid"}>
      <div className="stack">
        <div className="panel">
          {old > 0 && <p className="lim-banner">原来的「禁用清单」已自动转成 {old} 条限制（标着「从禁用清单转来」），不用重填。</p>}
          {like.length > 0 && moveRules && (
            <div className="lim-banner">
              你的「我的规则」里有 {like.length} 条像限制：{like.map((x) => "「" + x + "」").join("")}。移到这里，AI 写完会自动检查，排大纲和聊天时也会带上。
              <div className="addrow">
                <button className="btn" type="button" onClick={() => moveRules(like)}>
                  移过来
                </button>
              </div>
            </div>
          )}
          <h3>
            本书的写作限制 <span className="chip">{list.filter((l) => !l.off).length} 条生效</span>
          </h3>
          {!list.length && <Empty>还没有限制。在下面用一句话写你不想让 AI 写的东西，或者勾几个常用预设。</Empty>}
          <div className="lim-list">
            {list.map((l) => (
              <LimitRow
                key={l.id}
                l={l}
                open={open === l.id}
                toggle={() => setOpen(open === l.id ? null : l.id)}
                set={(p) => set(l.id, p)}
                del={() => onChange(list.filter((x) => x.id !== l.id))}
                names={names}
                vols={vols}
                genWords={genWords}
                count={counts?.[l.id]}
                saved={mine.some((m) => m.text === l.text)}
                save={() => {
                  setMine([...mine.filter((m) => m.text !== l.text), copyForBook(l)]);
                  toast(`「${l.text}」已存为常用限制，新建作品时可以直接勾上`);
                }}
              />
            ))}
          </div>
        </div>
        <div className="panel">
          <h3>新增一条</h3>
          <div className="addrow">
            <input value={draft} placeholder="用你自己的话写，例如：不要文绉绉的词 / 不写血腥过程 / 女主不哭" aria-label="新的写作限制" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            <button className="btn primary" type="button" onClick={add} disabled={!draft.trim()}>
              添加
            </button>
          </div>
          <p className="legend">
            {g ? (
              <>
                会添加为 <span className="chip">{g.type}</span> <span className="chip">{levelName(g.level)}</span>，加完可以改，再填检查词表。
              </>
            ) : (
              "写完会自动猜类型和力度。"
            )}
          </p>
          {mine.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>我的常用限制（在任何一本书里点「存为常用」加进来）</h3>
              <div className="lim-presets">
                {mine.map((m) => {
                  const has = list.some((l) => l.text === m.text);
                  return (
                    <label key={m.id}>
                      <input type="checkbox" checked={has} onChange={(e) => onChange(e.target.checked ? [...list, copyForBook(m)] : list.filter((l) => l.text !== m.text))} />
                      {m.text}
                      <button type="button" className="x" title="从常用里删掉（不影响已经用了它的书）" onClick={(e) => (e.preventDefault(), setMine(mine.filter((x) => x.id !== m.id)))}>
                        ×
                      </button>
                    </label>
                  );
                })}
              </div>
            </>
          )}
          <h3 style={{ marginTop: 14 }}>常用预设（勾上即用，自带检查词表）</h3>
          <div className="lim-presets">
            {PRESETS.map((p) => (
              <label key={p.key}>
                <input type="checkbox" checked={list.some((l) => l.preset === p.key)} onChange={(e) => togglePreset(p.key, e.target.checked)} />
                {p.text}
              </label>
            ))}
          </div>
        </div>
      </div>
      {!compact && <div className="panel out">
        <h3>AI 实际看到的</h3>
        <p className="legend" style={{ marginTop: 0 }}>开头这段放进每次调用的系统提示；最后一句加在每次生成请求的末尾。词表只用来检查，不发给 AI。排大纲、补人设时只带内容尺度、情节走向和人物言行。</p>
        <pre>{block ? block + "\n\n……（核心摘要、前文、大纲、文风等）……\n\n" + tail : "还没有生效的限制。"}</pre>
      </div>}
    </div>
  );
}

function LimitRow({ l, open, toggle, set, del, names, vols, genWords, count, saved, save }: { l: WriteLimit; open: boolean; toggle: () => void; set: (p: Partial<WriteLimit>) => void; del: () => void; names: string[]; vols: { id: string; title: string }[]; genWords?: (l: WriteLimit) => Promise<string[]>; count?: number; saved: boolean; save: () => void }) {
  const [words, setWords] = useState(l.words.join("、"));
  const [gen, setGen] = useState<{ busy: boolean; list: string[]; pick: string[]; err?: string } | null>(null);
  const who: LimitWho = l.who ?? { mode: "all", names: [], span: "dialog" };
  const setWho = (p: Partial<LimitWho>) => set({ who: { ...who, ...p } });
  const wt = whoText(l);
  return (
    <div className={"lim" + (l.off ? " off" : "")}>
      <div className="lim-head">
        <b>{l.text || "（没写说明）"}</b>
        <span className="chip">{l.type}</span>
        <span className={"chip" + (l.level === "never" ? " warn" : "")}>
          {levelName(l.level)}
          {l.level === "less" ? `（每千字≤${l.cap ?? DEFAULT_CAP}）` : ""}
        </span>
        {who.mode !== "all" && who.names.length > 0 && <span className="chip">{who.mode === "only" ? "只管 " : "例外 "}{who.names.join("、")}</span>}
        {l.fromOld && <span className="chip muted">从禁用清单转来</span>}
        {(l.vols?.length ?? 0) > 0 && <span className="chip muted">{l.vols!.map((id) => vols.find((v) => v.id === id)?.title ?? "已删的卷").join("、")}</span>}
        {count !== undefined && <span className={"chip" + (count ? " warn" : " muted")} title="全书正文里用词表扫到的次数（人物例外、没超上限的不算）">全书 {count} 处</span>}
        <span className="grow" />
        <label className="lim-on" title="暂停后保留这条，但不写进提示词、不检查">
          <input type="checkbox" checked={!l.off} onChange={(e) => set({ off: !e.target.checked })} />
          生效
        </label>
        {!saved && (
          <button className="btn" type="button" title="存为我的常用限制，其他书和新建作品时可以直接勾上" onClick={save}>
            存为常用
          </button>
        )}
        <button className="btn" type="button" onClick={toggle} aria-expanded={open}>
          {open ? "收起" : "编辑"}
        </button>
        <button className="btn" type="button" onClick={() => confirm(`删除限制「${l.text}」？`) && del()}>
          删除
        </button>
      </div>
      <div className="lim-meta">
        {l.words.length ? `词表 ${l.words.length} 个，AI 写完自动检查` : "没有词表：靠提示词预防，「一致性检查」时由 AI 查"}
        {l.except.length > 0 && ` · 例外词 ${l.except.length} 个`}
        {wt && ` · ${wt}`}
      </div>
      {open && (
        <div className="lim-body">
          <span>说明</span>
          <input value={l.text} onChange={(e) => set({ text: e.target.value })} />
          <span>类型</span>
          <Seg<LimitType> label="类型" value={l.type} options={LIMIT_TYPES.map((t) => [t, t])} onChange={(t) => set({ type: t, level: l.type === t ? l.level : DEFAULT_LEVEL[t] })} style={{ margin: 0 }} />
          <span>力度</span>
          <div className="lim-lv">
            <Seg<LimitLevel> label="力度" value={l.level} options={LEVELS} onChange={(v) => set({ level: v, cap: v === "less" ? l.cap ?? DEFAULT_CAP : l.cap })} style={{ margin: 0 }} />
            {l.level === "less" && (
              <label>
                每千字最多 <input type="number" min={0} max={50} value={l.cap ?? DEFAULT_CAP} onChange={(e) => set({ cap: Math.max(0, +e.target.value) })} /> 次
              </label>
            )}
          </div>
          <span>例子</span>
          <input value={l.examples ?? ""} placeholder="帮 AI 理解是哪一类，例如：伫立、凝眸、旋即" onChange={(e) => set({ examples: e.target.value })} />
          <span>想要的写法</span>
          <input value={l.want ?? ""} placeholder="告诉 AI 改成什么，例如：用大白话，「站着」不写「伫立」" onChange={(e) => set({ want: e.target.value })} />
          <span>检查词表</span>
          <div>
            <textarea rows={2} value={words} placeholder="顿号或换行分隔。AI 写完会用它自动检查；情节类的限制可以不填" onChange={(e) => setWords(e.target.value)} onBlur={() => set({ words: parseWords(words) })} />
            {l.words.some((w) => w.length === 1 && !/[！!？?…—]/.test(w)) && <div className="legend">单字词（如「遂」）容易误报，误报时在检查结果里点「不算」加成例外。</div>}
            {genWords && (
              <div className="addrow">
                <button
                  className="btn"
                  type="button"
                  disabled={gen?.busy}
                  title="AI 按这条限制的说明、例子和本书题材列一批词，你勾掉不要的再加进词表"
                  onClick={async () => {
                    setGen({ busy: true, list: [], pick: [] });
                    try {
                      const list = await genWords({ ...l, words: parseWords(words) });
                      setGen({ busy: false, list, pick: list });
                    } catch (e: any) {
                      setGen({ busy: false, list: [], pick: [], err: String(e?.message || e) });
                    }
                  }}
                >
                  {gen?.busy ? "正在列……" : "帮我列词"}
                </button>
              </div>
            )}
            {gen && !gen.busy && (
              <div className="lim-gen">
                {gen.err ? (
                  <p className="lint bad">{gen.err}</p>
                ) : gen.list.length ? (
                  <>
                    <div className="legend" style={{ marginTop: 0 }}>AI 列了 {gen.list.length} 个，取消勾选不要的：</div>
                    <div className="lim-names">
                      {gen.list.map((w) => (
                        <label key={w}>
                          <input type="checkbox" checked={gen.pick.includes(w)} onChange={(e) => setGen({ ...gen, pick: e.target.checked ? [...gen.pick, w] : gen.pick.filter((x) => x !== w) })} />
                          {w}
                        </label>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="legend">AI 没列出新词。情节类的限制本来就查不了词，会在「一致性检查」里由 AI 查。</p>
                )}
                <div className="addrow">
                  {gen.pick.length > 0 && (
                    <button
                      className="btn primary"
                      type="button"
                      onClick={() => {
                        const next = [...new Set([...parseWords(words), ...gen.pick])];
                        setWords(next.join("、"));
                        set({ words: next });
                        setGen(null);
                      }}
                    >
                      加入词表（{gen.pick.length}）
                    </button>
                  )}
                  <button className="btn" type="button" onClick={() => setGen(null)}>
                    收起
                  </button>
                </div>
              </div>
            )}
            {l.except.length > 0 && (
              <div className="lim-ex">
                例外词（不算违反）：
                {l.except.map((w) => (
                  <button key={w} type="button" className="chip" title="移出例外，重新算违反" onClick={() => set({ except: l.except.filter((x) => x !== w) })}>
                    {w} ×
                  </button>
                ))}
              </div>
            )}
          </div>
          {vols.length > 1 && (
            <>
              <span>哪几卷</span>
              <div className="lim-names">
                {vols.map((v) => (
                  <label key={v.id}>
                    <input type="checkbox" checked={l.vols?.includes(v.id) ?? false} onChange={(e) => set({ vols: e.target.checked ? [...(l.vols ?? []), v.id] : (l.vols ?? []).filter((x) => x !== v.id) })} />
                    {v.title}
                  </label>
                ))}
                <span className="legend" style={{ margin: 0 }}>{l.vols?.length ? "只在勾选的卷生效" : "都不勾就是全书"}</span>
              </div>
            </>
          )}
          <span>对谁生效</span>
          <div className="lim-who">
            <select value={who.mode} onChange={(e) => setWho({ mode: e.target.value as LimitWho["mode"] })} aria-label="对谁生效">
              <option value="all">所有人</option>
              <option value="except">除了这些人（给他们放宽）</option>
              <option value="only">只管这些人</option>
            </select>
            {who.mode !== "all" && (
              <>
                <div className="lim-names">
                  {names.length ? (
                    names.map((n) => (
                      <label key={n}>
                        <input type="checkbox" checked={who.names.includes(n)} onChange={(e) => setWho({ names: e.target.checked ? [...who.names, n] : who.names.filter((x) => x !== n) })} />
                        {n}
                      </label>
                    ))
                  ) : (
                    <span className="legend">人物页还没有起名字的人物。</span>
                  )}
                </div>
                <select value={who.span} onChange={(e) => setWho({ span: e.target.value as LimitWho["span"] })} aria-label="管到哪">
                  <option value="dialog">只管他的对白</option>
                  <option value="pov">他的对白和他视角的叙述</option>
                </select>
                {who.mode === "except" && (
                  <select value={who.level ?? ""} onChange={(e) => setWho({ level: (e.target.value || undefined) as LimitLevel | undefined })} aria-label="这些人的力度">
                    <option value="">这些人不受限制</option>
                    <option value="less">这些人尽量少用</option>
                    <option value="brief">这些人一笔带过</option>
                  </select>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
