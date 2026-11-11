//! 鲸汐桌面外壳：把 Node 后端当 sidecar 管起来。
//!
//! 生命周期（见 PR 说明）：
//! - setup：选端口、生成本机令牌、拉起后端、轮询 `/api/health`，通过后才显示主窗口；
//! - 后端意外退出：自动重启，最多 3 次；
//! - 默认关最后一个窗口就退出 App，并先 SIGTERM、3 秒后强杀后端；
//! - 「后台继续逛」打开后，关窗只隐藏，菜单栏/托盘常驻。

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

const PREFERRED_PORT: u16 = 8787;
const HEALTH_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_RESTARTS: u32 = 3;
/// 后端在这个退出码上说明端口被占（apps/api/src/server.ts 的 EXIT_ADDR_IN_USE）。
const EXIT_ADDR_IN_USE: i32 = 98;
const TRAY_ID: &str = "wp-tray";
const LOG_ROTATE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Clone, Serialize)]
struct BackendInfo {
  url: String,
  token: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendExited {
  code: Option<i32>,
  will_restart: bool,
}

struct Running {
  child: Child,
  /// 持有 stdin 管道：App 进程一旦没了（含被 kill -9），管道关闭，后端据此自退。
  _stdin: Option<ChildStdin>,
}

struct Backend {
  port: Mutex<u16>,
  token: String,
  running: Mutex<Option<Running>>,
  ready: AtomicBool,
  shutting_down: AtomicBool,
  log_path: PathBuf,
}

impl Backend {
  fn info(&self) -> BackendInfo {
    BackendInfo { url: format!("http://127.0.0.1:{}", *self.port.lock().unwrap()), token: self.token.clone() }
  }
}

struct KeepRunning(AtomicBool);

/* ------------------------------------------------------------------ 小工具 */

fn random_token() -> String {
  let mut buf = [0u8; 32];
  getrandom::fill(&mut buf).expect("系统随机数不可用");
  buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn pick_port(avoid: Option<u16>) -> u16 {
  if avoid != Some(PREFERRED_PORT) && TcpListener::bind(("127.0.0.1", PREFERRED_PORT)).is_ok() {
    return PREFERRED_PORT;
  }
  TcpListener::bind(("127.0.0.1", 0)).and_then(|l| l.local_addr()).map(|a| a.port()).unwrap_or(PREFERRED_PORT)
}

/// 最小的 HTTP GET：只关心状态码是不是 200，不额外引入 HTTP 客户端依赖。
fn health_ok(port: u16, token: &str) -> bool {
  let addr = SocketAddr::from(([127, 0, 0, 1], port));
  let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else { return false };
  let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
  let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));
  let req = format!(
    "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
  );
  if stream.write_all(req.as_bytes()).is_err() {
    return false;
  }
  let mut head = [0u8; 32];
  let n = stream.read(&mut head).unwrap_or(0);
  std::str::from_utf8(&head[..n]).map(|s| s.starts_with("HTTP/1.1 200") || s.starts_with("HTTP/1.0 200")).unwrap_or(false)
}

fn open_log(path: &Path) -> Option<File> {
  if let Some(dir) = path.parent() {
    let _ = fs::create_dir_all(dir);
  }
  if fs::metadata(path).map(|m| m.len() > LOG_ROTATE_BYTES).unwrap_or(false) {
    let _ = fs::rename(path, path.with_extension("log.1"));
  }
  OpenOptions::new().create(true).append(true).open(path).ok()
}

fn show_main(app: &AppHandle) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
  }
}

/* ------------------------------------------------------------------ 设置持久化 */

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
  app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

fn load_keep_running(app: &AppHandle) -> bool {
  settings_path(app)
    .and_then(|p| fs::read_to_string(p).ok())
    .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
    .and_then(|v| v.get("keep_running").and_then(|b| b.as_bool()))
    .unwrap_or(false)
}

fn save_keep_running(app: &AppHandle, value: bool) -> Result<(), String> {
  let path = settings_path(app).ok_or("找不到配置目录")?;
  if let Some(dir) = path.parent() {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  }
  let body = serde_json::json!({ "keep_running": value }).to_string();
  fs::write(path, body).map_err(|e| e.to_string())
}

/* ------------------------------------------------------------------ 托盘 */

fn ensure_tray(app: &AppHandle) -> tauri::Result<()> {
  if app.tray_by_id(TRAY_ID).is_some() {
    return Ok(());
  }
  let open = MenuItem::with_id(app, "open", "打开鲸汐", true, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", "退出鲸汐", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&open, &quit])?;
  let mut builder = TrayIconBuilder::with_id(TRAY_ID)
    .tooltip("鲸汐")
    .menu(&menu)
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id.as_ref() {
      "open" => show_main(app),
      "quit" => app.exit(0),
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
        show_main(tray.app_handle());
      }
    });
  if let Some(icon) = app.default_window_icon() {
    builder = builder.icon(icon.clone());
  }
  builder.build(app)?;
  Ok(())
}

fn remove_tray(app: &AppHandle) {
  let _ = app.remove_tray_by_id(TRAY_ID);
}

/* ------------------------------------------------------------------ 后端进程 */

fn build_command(app: &AppHandle, port: u16, token: &str) -> Result<Command, String> {
  let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

  let mut cmd;
  let mut paths = Vec::new();
  if tauri::is_dev() {
    // tauri dev：直接跑源码，和 `pnpm --dir apps/api run serve` 一样（读 apps/api/.env）。
    let api_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../api");
    cmd = Command::new("node");
    cmd.current_dir(api_dir).args(["--experimental-strip-types", "--env-file-if-exists=.env", "src/server.ts"]);
  } else {
    let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?.parent().map(Path::to_path_buf).ok_or("找不到可执行文件目录")?;
    let node = exe_dir.join(if cfg!(windows) { "whale-node.exe" } else { "whale-node" });
    let res = app.path().resource_dir().map_err(|e| e.to_string())?;
    let entry = res.join("api").join("dist").join("server.mjs");
    cmd = Command::new(node);
    cmd.current_dir(res.join("api"))
      .arg(format!("--env-file-if-exists={}", data_dir.join(".env").display()))
      .arg(entry);
    // 后端按名字 spawn("ffmpeg")，优先使用随包的工具目录。
    paths.push(res.join("bin"));
  }

  #[cfg(target_os = "macos")]
  {
    // Dock 启动的 GUI 不会读取 shell profile；补充 Homebrew 路径以解析本机 Codex CLI。
    paths.extend([PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")]);
  }

  if let Some(old) = std::env::var_os("PATH") {
    paths.extend(std::env::split_paths(&old));
  }
  if let Ok(joined) = std::env::join_paths(paths) {
    cmd.env("PATH", joined);
  }

  cmd
    .env("API_PORT", port.to_string())
    .env("WP_DATA_DIR", &data_dir)
    .env("WP_LOCAL_TOKEN", token)
    .stdin(Stdio::piped());

  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
  }
  Ok(cmd)
}

fn spawn_backend(app: &AppHandle, backend: &Backend) -> Result<(), String> {
  let port = *backend.port.lock().unwrap();
  let mut cmd = build_command(app, port, &backend.token)?;
  match open_log(&backend.log_path) {
    Some(mut log) => {
      let _ = writeln!(log, "\n--- 后端启动 端口 {port} ---");
      let err = log.try_clone().map_err(|e| e.to_string())?;
      cmd.stdout(Stdio::from(log)).stderr(Stdio::from(err));
    }
    None => {
      cmd.stdout(Stdio::null()).stderr(Stdio::null());
    }
  }
  let mut child = cmd.spawn().map_err(|e| format!("无法启动后端：{e}"))?;
  let stdin = child.stdin.take();
  *backend.running.lock().unwrap() = Some(Running { child, _stdin: stdin });
  Ok(())
}

/// 先让后端自己退（关 stdin + SIGTERM），3 秒还在就强杀。可重复调用。
fn stop_backend(backend: &Backend) {
  backend.shutting_down.store(true, Ordering::SeqCst);
  let Some(mut running) = backend.running.lock().unwrap().take() else { return };
  drop(running._stdin.take());
  #[cfg(unix)]
  unsafe {
    libc::kill(running.child.id() as libc::pid_t, libc::SIGTERM);
  }
  #[cfg(not(unix))]
  let _ = running.child.kill();
  let deadline = Instant::now() + Duration::from_secs(3);
  loop {
    match running.child.try_wait() {
      Ok(Some(_)) => return,
      Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
      _ => break,
    }
  }
  let _ = running.child.kill();
  let _ = running.child.wait();
}

/// 如果后端已退出，返回退出码（`Some(None)` = 被信号杀死）；还活着返回 `None`。
fn poll_exit(backend: &Backend) -> Option<Option<i32>> {
  let mut guard = backend.running.lock().unwrap();
  let running = guard.as_mut()?;
  match running.child.try_wait() {
    Ok(Some(status)) => {
      *guard = None;
      Some(status.code())
    }
    Ok(None) => None,
    Err(_) => {
      *guard = None;
      Some(None)
    }
  }
}

fn error_dialog(app: &AppHandle, body: String) {
  app
    .dialog()
    .message(body)
    .title("鲸汐没能启动")
    .kind(MessageDialogKind::Error)
    .blocking_show();
}

/// 监督线程：启动 → 等健康 → 守着；意外退出就重启，最多 3 次。
fn supervise(app: AppHandle) {
  let backend = app.state::<Backend>();
  let mut restarts: u32 = 0;
  let mut first_window_shown = false;

  loop {
    if backend.shutting_down.load(Ordering::SeqCst) {
      return;
    }
    backend.ready.store(false, Ordering::SeqCst);
    if let Err(message) = spawn_backend(&app, &backend) {
      error_dialog(&app, format!("{message}\n\n日志：{}", backend.log_path.display()));
      show_main(&app);
      return;
    }
    let started = Instant::now();
    let mut timed_out_reported = false;
    let mut became_ready_at: Option<Instant> = None;

    let exit_code = loop {
      if backend.shutting_down.load(Ordering::SeqCst) {
        return;
      }
      if let Some(code) = poll_exit(&backend) {
        break code;
      }
      if !backend.ready.load(Ordering::SeqCst) {
        let port = *backend.port.lock().unwrap();
        if health_ok(port, &backend.token) {
          backend.ready.store(true, Ordering::SeqCst);
          became_ready_at = Some(Instant::now());
          if !first_window_shown {
            first_window_shown = true;
            show_main(&app);
          }
          let info = backend.info();
          log::info!("后端已就绪：{}", info.url);
          let _ = app.emit("backend-ready", info);
        } else if !timed_out_reported && started.elapsed() > HEALTH_TIMEOUT {
          timed_out_reported = true;
          error_dialog(
            &app,
            format!(
              "后端在 {} 秒内没有准备好。\n\n日志在：{}\n\n点确定后会先打开窗口，后端起来后会自动接上。",
              HEALTH_TIMEOUT.as_secs(),
              backend.log_path.display()
            ),
          );
          if !first_window_shown {
            first_window_shown = true;
            show_main(&app);
          }
        }
      }
      std::thread::sleep(Duration::from_millis(250));
    };

    if backend.shutting_down.load(Ordering::SeqCst) {
      return;
    }
    // 稳定跑过一分钟再崩，不算连续崩溃。
    if became_ready_at.map(|t| t.elapsed() > Duration::from_secs(60)).unwrap_or(false) {
      restarts = 0;
    }
    let will_restart = restarts < MAX_RESTARTS;
    // 先换端口再报退出：监听 backend-exited 的界面这时查 backend_info，拿到的就是重启要用的地址。
    // 前端恢复仍以随后带 url/token 的 backend-ready 为准。
    if will_restart && exit_code == Some(EXIT_ADDR_IN_USE) {
      let old = *backend.port.lock().unwrap();
      let new = pick_port(Some(old));
      *backend.port.lock().unwrap() = new;
      log::info!("后端端口 {old} 被占用，改用 {new} 重启");
    }
    let _ = app.emit("backend-exited", BackendExited { code: exit_code, will_restart });
    if !will_restart {
      error_dialog(
        &app,
        format!("后端连续退出了 {} 次，不再重试。\n\n日志在：{}", MAX_RESTARTS + 1, backend.log_path.display()),
      );
      show_main(&app);
      return;
    }
    restarts += 1;
    std::thread::sleep(Duration::from_millis(800));
  }
}

/* ------------------------------------------------------------------ 命令 */

#[tauri::command]
fn backend_info(backend: State<'_, Backend>) -> BackendInfo {
  backend.info()
}

#[tauri::command]
fn get_keep_running(state: State<'_, KeepRunning>) -> bool {
  state.0.load(Ordering::SeqCst)
}

#[tauri::command]
fn set_keep_running(app: AppHandle, state: State<'_, KeepRunning>, enabled: bool) -> Result<(), String> {
  save_keep_running(&app, enabled)?;
  state.0.store(enabled, Ordering::SeqCst);
  if enabled {
    ensure_tray(&app).map_err(|e| e.to_string())?;
  } else {
    remove_tray(&app);
    // 窗口可能正藏着，托盘又没了：把窗口叫出来，别让用户找不到 App。
    show_main(&app);
  }
  Ok(())
}

/* ------------------------------------------------------------------ 入口 */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();

  #[cfg(desktop)]
  {
    // 必须第一个注册。第二次打开 App：聚焦已有窗口，不再起第二套后端。
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)));
  }

  let app = builder
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![backend_info, get_keep_running, set_keep_running])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
      }
      let handle = app.handle().clone();
      let log_dir = app.path().app_log_dir().unwrap_or_else(|_| std::env::temp_dir());
      let backend = Backend {
        port: Mutex::new(pick_port(None)),
        token: random_token(),
        running: Mutex::new(None),
        ready: AtomicBool::new(false),
        shutting_down: AtomicBool::new(false),
        log_path: log_dir.join("api.log"),
      };
      app.manage(backend);

      let keep = load_keep_running(&handle);
      app.manage(KeepRunning(AtomicBool::new(keep)));
      if keep {
        ensure_tray(&handle)?;
      }

      std::thread::spawn(move || supervise(handle));
      Ok(())
    })
    .on_window_event(|window, event| {
      if window.label() != "main" {
        return;
      }
      if let WindowEvent::CloseRequested { api, .. } = event {
        let app = window.app_handle();
        if app.state::<KeepRunning>().0.load(Ordering::SeqCst) {
          api.prevent_close();
          let _ = window.hide();
        } else {
          // 默认：关窗就是退出（macOS 也一样）。
          app.exit(0);
        }
      }
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|app, event| match event {
    RunEvent::ExitRequested { .. } | RunEvent::Exit => {
      // 窗口关闭走不到这里的情况（后台模式）已在 CloseRequested 拦下，所以到这里就是真要退出。
      if let Some(backend) = app.try_state::<Backend>() {
        stop_backend(&backend);
      }
    }
    #[cfg(target_os = "macos")]
    RunEvent::Reopen { .. } => show_main(app),
    _ => {}
  });
}
