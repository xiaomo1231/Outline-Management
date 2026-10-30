import { isTauri } from "./db";

// 桌面版把密钥存进 Windows 凭据管理器；浏览器调试时退回 localStorage。
export async function getSecret(name: string): Promise<string> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("secret_get", { name });
  }
  try {
    return localStorage.getItem("secret:" + name) ?? "";
  } catch {
    return "";
  }
}

export async function setSecret(name: string, value: string) {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("secret_set", { name, value });
    return;
  }
  try {
    if (value) localStorage.setItem("secret:" + name, value);
    else localStorage.removeItem("secret:" + name);
  } catch {
    /* 隐私模式下拿不到存储，忽略 */
  }
}
