// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { SelectionUi, keepSelKey } from "../../components/selectionUi";

function make() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: [StarterKit, SelectionUi], content: "<p>第一段文字</p><p>第二段文字</p><p>第三段</p>" });
}

describe("选中文字不闪", () => {
  it("选区移动时段落不会被重画，当前段落仍有 active", async () => {
    const ed = make();
    const paras = Array.from(ed.view.dom.querySelectorAll("p"));
    let removed = 0;
    const mo = new MutationObserver((ms) => ms.forEach((m) => (removed += m.removedNodes.length)));
    mo.observe(ed.view.dom, { childList: true, subtree: true });
    // 模拟拖选：从第一段一路选到第二段
    for (let to = 3; to <= 12; to++) ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 2, to)));
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 10)));
    await new Promise((r) => setTimeout(r, 0));
    mo.disconnect();
    expect(removed).toBe(0);
    const now = Array.from(ed.view.dom.querySelectorAll("p"));
    expect(now).toEqual(paras); // 还是原来那几个段落节点
    expect(now.map((p) => p.classList.contains("active"))).toEqual([false, true, false]);
    ed.destroy();
  });

  it("右键菜单开着时，选中的字有 sel-keep 底色；关掉后去掉", () => {
    const ed = make();
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 2, 5)));
    expect(ed.view.dom.querySelector(".sel-keep")).toBeNull();
    ed.view.dispatch(ed.state.tr.setMeta(keepSelKey, true));
    expect(ed.view.dom.querySelector(".sel-keep")?.textContent).toBe("一段文");
    ed.view.dispatch(ed.state.tr.setMeta(keepSelKey, false));
    expect(ed.view.dom.querySelector(".sel-keep")).toBeNull();
    // 没选中时不画
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 3)).setMeta(keepSelKey, true));
    expect(ed.view.dom.querySelector(".sel-keep")).toBeNull();
    ed.destroy();
  });
});
