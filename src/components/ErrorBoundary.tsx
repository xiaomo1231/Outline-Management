import { Component, type ErrorInfo, type ReactNode } from "react";
import { useStore } from "../lib/store";
import * as repo from "../lib/repo";

/** 最外层兜底：哪个界面渲染出错时显示提示和「重新加载」，不整页空白 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("界面出错：", err, info.componentStack);
  }

  async reload() {
    // 重新加载前把还没写进库的修改存掉
    try {
      await useStore.getState().flushSaves();
    } catch {
      /* 存不进去也照样重新加载 */
    }
    location.reload();
  }

  /** 重新加载还是出错（比如上次打开的那一章有坏数据）：下次启动先停在作品库，不自动打开这本书 */
  async library() {
    try {
      await useStore.getState().flushSaves();
    } catch {
      /* 忽略 */
    }
    try {
      await repo.setSetting("lastWork", null);
    } catch {
      /* 忽略 */
    }
    location.reload();
  }

  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    return (
      <div role="alert" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "var(--bg)", color: "var(--ink)" }}>
        <div className="panel" style={{ maxWidth: 480 }}>
          <h3 style={{ marginTop: 0 }}>界面出了点问题</h3>
          <p>已经保存的内容不受影响。点「重新加载」回到软件里继续。</p>
          <p className="legend" style={{ wordBreak: "break-all" }}>{String(err.message || err)}</p>
          <button className="btn primary" type="button" onClick={() => void this.reload()}>
            重新加载
          </button>{" "}
          <button className="btn" type="button" onClick={() => void this.library()}>
            回到作品库
          </button>
          <p className="legend">重新加载后还是这样，点「回到作品库」，再从书架打开这本书。</p>
        </div>
      </div>
    );
  }
}
