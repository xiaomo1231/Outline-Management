import { useState } from "react";
import { useStore } from "../lib/store";
import StyleBuilder from "../components/StyleBuilder";
import { emptySetup } from "../lib/style";
import { newChapter } from "../lib/outline";
import { uid } from "../lib/util";
import type { StyleSetup } from "../lib/types";

export default function NewWork() {
  const createWork = useStore((s) => s.createWork);
  const openWork = useStore((s) => s.openWork);
  const go = useStore((s) => s.go);
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [intro, setIntro] = useState("");
  const [goal, setGoal] = useState(4000);
  const [chapWords, setChapWords] = useState(2500);
  const [style, setStyle] = useState<StyleSetup>(emptySetup());

  async function finish(page: "write" | "outline") {
    const id = await createWork(
      { name: name.trim() || "未命名作品", intro: intro.trim(), goal: Math.max(100, goal || 4000), chapWords: Math.max(500, chapWords || 2500) },
      { style, vols: [{ id: uid("v"), title: "第一卷", chapters: [newChapter("")] }], chars: [{ id: uid("p"), role: "男主", name: "", f: {} }, { id: uid("p"), role: "女主", name: "", f: {} }] },
    );
    await openWork(id, page);
  }

  const Step = ({ n, t }: { n: number; t: string }) => (
    <button type="button" className={"step" + (step === n ? " on" : step > n ? " done" : "")} onClick={() => (n < step || name.trim()) && setStep(n)}>
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
        <button className="btn" type="button" style={{ marginLeft: "auto" }} onClick={() => go("library")}>
          取消
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
            <button className="btn primary" type="button" disabled={!name.trim()} onClick={() => setStep(2)}>
              下一步：搭建风格
            </button>
          </div>
        </div>
      )}
      {step === 2 && (
        <>
          <StyleBuilder value={style} onChange={setStyle} />
          <div className="addrow">
            <button className="btn" type="button" onClick={() => setStep(1)}>
              上一步
            </button>
            <button className="btn primary" type="button" onClick={() => setStep(3)}>
              下一步
            </button>
          </div>
        </>
      )}
      {step === 3 && (
        <div className="panel" style={{ maxWidth: 560 }}>
          <h3>准备好了</h3>
          <p>
            《{name || "未命名作品"}》，日更 {goal} 字，每章约 {chapWords} 字。风格以后随时可以在「风格」页改。
          </p>
          <div className="go">
            <div className="row2">
              <button className="btn primary" type="button" onClick={() => finish("write")}>
                进入写作
              </button>
              <button className="btn" type="button" onClick={() => finish("outline")}>
                先去搭大纲和人物
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
