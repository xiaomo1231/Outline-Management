//! 自动更新：下载新版、核对 SHA-256、然后安装。
//! 安装版：运行新的 setup.exe（被动模式，只显示进度条），装完自动打开。
//! 免安装版：把正在运行的 exe 改名成 .old，把新 exe 放到原位置，再重新打开。
//! 作品数据在 %APPDATA% 里，更新不碰它。

use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tauri_plugin_http::reqwest;

/// 只允许从本仓库的发布页下载
const PREFIX: &str = "https://github.com/xiaomo1231/Outline-Management/releases/download/";

fn exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| e.to_string())
}

/// 安装版的目录里有卸载程序；没有就是免安装版
#[tauri::command]
pub fn update_kind() -> Result<String, String> {
    let dir = exe()?.parent().map(|p| p.to_path_buf()).ok_or("找不到程序目录")?;
    Ok(if dir.join("uninstall.exe").exists() { "installer" } else { "portable" }.into())
}

fn dir() -> Result<PathBuf, String> {
    let d = std::env::temp_dir().join("moshu-update");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn safe_name(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.contains(['/', '\\', ':']) || name.contains("..") || !name.ends_with(".exe") {
        return Err("文件名不对".into());
    }
    Ok(name)
}

/// 下载到临时目录并核对 SHA-256，返回文件路径。下载中会发 update-progress 事件：[已下载, 总大小]
#[tauri::command]
pub async fn update_download(app: AppHandle, url: String, name: String, sha256: String) -> Result<String, String> {
    if !url.starts_with(PREFIX) {
        return Err("下载地址不是墨枢的发布页".into());
    }
    let want = sha256.trim().trim_start_matches("sha256:").to_lowercase();
    if want.len() != 64 {
        return Err("发布页没有给出校验值，不能自动安装，请手动下载".into());
    }
    let path = dir()?.join(safe_name(&name)?);
    let part = path.with_extension("part");
    let mut res = reqwest::Client::new()
        .get(&url)
        .header("User-Agent", "moshu-updater")
        .send()
        .await
        .map_err(|e| format!("下载失败：{e}"))?;
    if !res.status().is_success() {
        return Err(format!("下载失败：HTTP {}", res.status()));
    }
    let total = res.content_length().unwrap_or(0);
    let mut f = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut got: u64 = 0;
    let mut last: u64 = 0;
    while let Some(c) = res.chunk().await.map_err(|e| format!("下载中断：{e}"))? {
        f.write_all(&c).map_err(|e| e.to_string())?;
        h.update(&c);
        got += c.len() as u64;
        if got - last > 256 * 1024 || got == total {
            last = got;
            let _ = app.emit("update-progress", (got, total));
        }
    }
    f.flush().map_err(|e| e.to_string())?;
    drop(f);
    let hex: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if hex != want {
        let _ = std::fs::remove_file(&part);
        return Err("下载的文件校验不通过，已删除。请稍后再试或手动下载".into());
    }
    let _ = std::fs::remove_file(&path);
    std::fs::rename(&part, &path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(windows)]
fn detached(cmd: &mut std::process::Command) -> &mut std::process::Command {
    use std::os::windows::process::CommandExt;
    // DETACHED_PROCESS | CREATE_NO_WINDOW
    cmd.creation_flags(0x0000_0008 | 0x0800_0000)
}
#[cfg(not(windows))]
fn detached(cmd: &mut std::process::Command) -> &mut std::process::Command {
    cmd
}

/// 安装下载好的新版，然后退出墨枢。调用前前端已经保存并备份
#[tauri::command]
pub fn update_install(app: AppHandle, path: String) -> Result<(), String> {
    let file = PathBuf::from(&path);
    if !file.starts_with(dir()?) || !file.exists() {
        return Err("找不到下载好的安装文件".into());
    }
    if update_kind()? == "installer" {
        // 和 Tauri 自带更新器一样：/P 被动模式只显示进度条，/UPDATE 不重建快捷方式，/R 装完重新打开墨枢
        std::process::Command::new(&file).args(["/P", "/UPDATE", "/R"]).spawn().map_err(|e| format!("启动安装程序失败：{e}"))?;
    } else {
        let me = exe()?;
        let old = me.with_extension("exe.old");
        let _ = std::fs::remove_file(&old);
        // Windows 允许给正在运行的 exe 改名
        std::fs::rename(&me, &old).map_err(|e| format!("替换失败：{e}"))?;
        if let Err(e) = std::fs::copy(&file, &me) {
            let _ = std::fs::rename(&old, &me);
            return Err(format!("替换失败：{e}"));
        }
        // 等这个进程退出后再打开新版，否则会被「只开一个窗口」挡回来
        let cmdline = format!("ping -n 3 127.0.0.1 >nul & start \"\" \"{}\"", me.display());
        detached(std::process::Command::new("cmd").args(["/C", &cmdline])).spawn().map_err(|e| e.to_string())?;
    }
    app.exit(0);
    Ok(())
}

/// 启动时清掉上次免安装版更新留下的旧文件
pub fn cleanup() {
    if let Ok(me) = exe() {
        let _ = std::fs::remove_file(me.with_extension("exe.old"));
    }
}
