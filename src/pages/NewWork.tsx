import { useEffect, useRef, useState } from "react";
import LimitsPanel from "../components/LimitsPanel";
import { copyForBook } from "../lib/limits";
import type { WriteLimit } from "../lib/types";
import { useStore } from "../lib/store";
import StyleBuilder from "../components/StyleBuilder";
import { emptySetup } from "../lib/style";
import { newChapter } from "../lib/outline";
import { uid } from "../lib/util";
import type { StyleSetup } from "../lib/types";
import * as repo from "../lib/repo";
import { hasKey } from "../lib/secret";

export default function NewWork() {
  const createWork = useStore((s) => s.createWork);
  const openWork = useStore((s) => s.openWork);
  const go = useStore((s) => s.go);
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [intro, setIntro] = useState("");
  const [goal, setGoal] = useState(2000);
  const [workId, setWorkId] = useState<string | null>(null);
  const [keyOk, setKeyOk] = useState(true);
  const [chapWords, setChapWords] = useState(2500);
  const [style, setStyle] = useState<StyleSetup>(emptySetup());
  // 新书默认带上「我的常用限制」，作者可以在最后一步取消
  useEffect(() => {
    repo.getSetting<WriteLimit[]>("limitTemplates", []).then((ls) => ls.length && setStyle((s) => (s.limits?.length ? s : { ...s, limits: ls.map(copyForBook) })));
  }, []);

  const info = () => ({ name: name.trim() || "未命名作品", intro: intro.trim(), goal: Math.max(100, goal || 2000), chapWords: Math.max(500, chapWords || 2500) });
  // 建书只建一次：连点「下一步」时第二次等第一次建好的那本
  const creating = useRef<Promise<string> | null>(null);
  function ensureWork(): Promise<string> {
    if (!creating.current) {
      creating.current = createWork(info(), { style, vols: [{ id: uid("v"), title: "第一卷", chapters: [newChapter("")] }], chars: [{ id: uid("p"), role: "主角", name: "", f: {} }, { id: uid("p"), role: "配角", name: "", f: {} }] });
      creating.current.then(setWorkId, () => (creating.current = null));
    }
    return creating.current;
  }
  const createdId = () => creating.current ?? Promise.resolve(null);

  // 离开第一步就先把书建好，中途关掉也不会丢
  async function leaveStep1() {
    const id = await createdId();
    if (!id) await ensureWork();
    else await saveInfo(id);
    setStep(2);
  }
  async function saveInfo(id: string) {
    const w = (await repo.listWorks()).find((x) => x.id === id);
    if (w) await repo.saveWork({ ...w, ...info(), updated: Date.now() });
    // 作品库卡片读的是 store 里的列表，跟着刷新
    await useStore.getState().loadWorks();
  }
  async function toStep3(s: StyleSetup = style) {
    const id = await createdId();
    if (id) await repo.saveDoc(id, "style", s);
    hasKey().then(setKeyOk, () => setKeyOk(false));
    setStep(3);
  }
  // 跳过：组件里的风格也清空，后面「进入写作」「现在去填」才不会把搭过的风格又写回去
  function skipStyle() {
    const s = { ...emptySetup(), limits: style.limits };
    setStyle(s);
    void toStep3(s);
  }
  // 回书架前把当前填的信息和风格存下来
  async function backToShelf() {
    const id = await createdId();
    if (id) {
      await saveInfo(id);
      await repo.saveDoc(id, "style", style);
    }
    go("library");
  }

  async function finish(page: "write" | "outline") {
    let id = await createdId();
    if (!id) {
      id = await ensureWork();
    } else {
      await saveInfo(id);
      await repo.saveDoc(id, "style", style);
    }
    await openWork(id, page);
  }

  const Step = ({ n, t }: { n: number; t: string }) => (
    <button type="button" className={"step" + (step === n ? " on" : step > n ? " done" : "")} onClick={() => {
        if (n === step || !(n < step || name.trim())) return;
        if (step === 1) void leaveStep1().then(() => { if (n === 3) return toStep3(); });
        else if (n === 3) void toStep3();
        else setStep(n);
      }}>
      <i>{n}</i>
      {t}
    </button>
  );

  return (
    <section id="style" className="view">
      <div className="steps">
        <Step n={1} t="作品信息" />
        <span className="arrow">→</span>
        <Step n={2} t="搭建风格" />
        <span className="arrow">→</span>
        <Step n={3} t="进入写作" />
        <button className="btn" type="button" style={{ marginLeft: "auto" }} onClick={() => void backToShelf()}>
          {workId ? "先回书架（书已保存）" : "取消"}
        </button>
      </div>
      {step === 1 && (
        <div className="panel" style={{ maxWidth: 760 }}>
          <div className="meta-row">
            <label>
              书名
              <input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              日更目标（字）
              <input type="number" min={100} step={100} value={goal} onChange={(e) => setGoal(+e.target.value)} />
            </label>
            <label>
              每章大约（字）
              <input type="number" min={500} step={100} value={chapWords} onChange={(e) => setChapWords(+e.target.value)} />
            </label>
          </div>
          <label className="meta-col">
            一句话简介
            <textarea rows={3} value={intro} placeholder="这本书讲什么。AI 每次都会看到这句话。" onChange={(e) => setIntro(e.target.value)} />
          </label>
          <div className="addrow">
            <button className="btn primary" type="button" disabled={!name.trim()} onClick={() => void leaveStep1()}>
              下一步：搭建风格
            </button>
          </div>
        </div>
      )}
      {step === 2 && (
        <>
          <div className="wiz-bar">
            <span className="muted">从左边把风格拖进右边的格子（或点卡片上的按钮）。不懂也没关系，可以直接跳过，以后在「风格」页随时改。</span>
            <button className="btn" type="button" onClick={() => setStep(1)}>
              上一步
            </button>
            <button className="btn" type="button" onClick={skipStyle}>
              跳过，用默认风格
            </button>
            <button className="btn primary" type="button" onClick={() => void toStep3()}>
              下一步
            </button>
          </div>
          <StyleBuilder value={style} onChange={setStyle} />
        </>
      )}
      {step === 3 && (
        <div className="panel" style={{ maxWidth: 560 }}>
          <h3>准备好了</h3>
          <p>
            《{info().name}》，日更 {info().goal} 字，每章约 {info().chapWords} 字。书已经存好了，风格以后随时可以在「风格」页改。
          </p>
          {!keyOk && (
            <p className="hint">
              还没填 AI 密钥：写作、大纲、人物都能正常用，只是 AI 功能（续写、拆章、检查）要先去「设置 → AI 密钥」填一个 DeepSeek 密钥才能用。
              <button className="btn sm linkish" type="button" onClick={async () => { if (workId) { await saveInfo(workId); await repo.saveDoc(workId, "style", style); await openWork(workId, "write"); } useStore.getState().go("settings"); }}>
                现在去填
              </button>
            </p>
          )}
          <div className="go">
            <div className="row2">
              <button className="btn primary" type="button" onClick={() => finish("write")}>
                进入写作
              </button>
              <button className="btn" type="button" onClick={() => finish("outline")}>
                先去搭大纲和人物（推荐新手）
              </button>
            </div>
          </div>
        </div>
      )}
      {step === 3 && (
        <div style={{ maxWidth: 760, marginTop: 16 }}>
          <p className="muted" style={{ margin: "0 0 8px" }}>写作限制（可选）：这本书里不想让 AI 写的词、内容和情节。已经勾上了你的常用限制，以后在「风格与限制」页随时改。</p>
          <LimitsPanel compact value={style.limits ?? []} names={[]} onChange={(v) => setStyle({ ...style, limits: v })} />
        </div>
      )}
    </section>
  );
}
