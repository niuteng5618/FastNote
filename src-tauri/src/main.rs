// flymd 桌面端：Tauri 2
// 职责：对话框、文件系统、存储、窗口状态、外链打开等插件初始化

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, Emitter, State};
// 全局共享：保存通过“打开方式/默认程序”传入且可能早于前端监听的文件路径
#[derive(Default)]
struct PendingOpenPath(std::sync::Mutex<Option<String>>);
use serde::{Deserialize, Serialize};
use sha2::Digest;
use chrono::{DateTime, Utc};
use std::time::Duration;
use std::sync::OnceLock;

// 让 Xlib 变为线程安全。WebKitGTK 的渲染线程与我们设置窗口圆角形状（gdk shape
// region）时用到的 X 调用会并发访问同一个 X 连接；若从未调用 XInitThreads()，XCB
// 会在 poll_for_event 处命中 `xcb_xlib_threads_sequence_lost` 断言而整体崩溃
// （表现为启动即 Aborting）。必须在建立任何 X 连接（GTK 初始化）之前调用，
// 因此放在 main() 的最前面。libX11 已由 GTK 传递链接，这里直接声明该符号即可。
#[cfg(target_os = "linux")]
fn init_x11_threads() {
  #[link(name = "X11")]
  extern "C" {
    fn XInitThreads() -> std::os::raw::c_int;
  }
  unsafe {
    let _ = XInitThreads();
  }
}

#[cfg(target_os = "linux")]
fn init_linux_render_env() {
  // Linux 默认禁用 WebKitGTK 的 DMABUF 渲染，降低白屏概率；若用户显式设置则尊重用户配置
  use std::env;
  if env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
    env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
  }
  // wry 的窗口透明仅支持 X11（Wayland 下被忽略，圆角外露白底）。
  // Wayland 会话中强制走 XWayland，使 transparent: true 生效；用户显式设置则尊重用户配置。
  if env::var_os("GDK_BACKEND").is_none() {
    env::set_var("GDK_BACKEND", "x11");
  }
}

// ============================================================
// Linux 原生圆角兜底
// ------------------------------------------------------------
// 无边框 + transparent 的圆角依赖合成器对窗口透明的支持，在 VMware / Wayland
// 等环境常合成失败（表现为直角白底）。这里给 GTK 顶层窗口直接设置一个圆角形状
// 区域（gdk shape region），把窗口物理裁成圆角，不再依赖透明合成，任何环境都生效。
// 前端 CSS 仍保留（在支持合成时提供抗锯齿边缘）；形状区域半径与 CSS 一致（14px）。
#[cfg(target_os = "linux")]
const NT_WINDOW_RADIUS: i32 = 14;

// 用一组矩形条近似出一个圆角矩形区域。
#[cfg(target_os = "linux")]
fn build_rounded_region(width: i32, height: i32, radius: i32) -> cairo::Region {
  let r = radius.min(width / 2).min(height / 2).max(0);
  let mut rects: Vec<cairo::RectangleInt> = Vec::new();
  if r <= 0 {
    rects.push(cairo::RectangleInt::new(0, 0, width, height));
    return cairo::Region::create_rectangles(&rects);
  }
  // 中间主体：左右满宽，上下各留出 r 高度给圆角
  rects.push(cairo::RectangleInt::new(0, r, width, height - 2 * r));
  // 上、下圆角逐行近似（以像素中心到圆心的距离求内缩量）
  for y in 0..r {
    let dy = (r - y) as f64 - 0.5;
    let dx = ((r as f64) * (r as f64) - dy * dy).max(0.0).sqrt();
    let inset = ((r as f64) - dx).round() as i32;
    let x = inset;
    let w = width - 2 * inset;
    if w > 0 {
      rects.push(cairo::RectangleInt::new(x, y, w, 1)); // 顶部
      rects.push(cairo::RectangleInt::new(x, height - 1 - y, w, 1)); // 底部
    }
  }
  cairo::Region::create_rectangles(&rects)
}

// 依据当前窗口尺寸应用圆角形状；最大化时取消形状（直角，铺满屏幕）。
#[cfg(target_os = "linux")]
fn apply_round_region(gtk_win: &gtk::ApplicationWindow) {
  use gtk::prelude::*;
  let w = gtk_win.allocated_width();
  let h = gtk_win.allocated_height();
  if w <= 1 || h <= 1 {
    return;
  }
  if let Some(gdk_win) = gtk_win.window() {
    if gtk_win.is_maximized() {
      gdk_win.shape_combine_region(None, 0, 0);
    } else {
      let region = build_rounded_region(w, h, NT_WINDOW_RADIUS);
      gdk_win.shape_combine_region(Some(&region), 0, 0);
    }
  }
}

// 安装：首帧应用一次，并在尺寸变化（含最大化 / 还原）时重新计算圆角。
#[cfg(target_os = "linux")]
fn install_linux_rounded_corners(win: &tauri::WebviewWindow) {
  use gtk::prelude::*;
  if let Ok(gtk_win) = win.gtk_window() {
    apply_round_region(&gtk_win);
    gtk_win.connect_size_allocate(move |w, _alloc| {
      apply_round_region(w);
    });
  }
}

// Windows：最大化状态同步到前端。
// 用途：最大化时禁用前端自定义 resize handles，避免“按住顶部下拉还原窗口”被误判成改高度。
// 注意：这里不去动 resizable（会影响 Windows 的“拖拽标题栏下拉还原”行为）。
#[cfg(target_os = "windows")]
fn install_windows_maximized_resizable_workaround(win: &tauri::WebviewWindow) {
  use std::sync::{Arc, Mutex};

  fn sync_state(win: &tauri::WebviewWindow, last_maximized: &mut Option<bool>) {
    let Ok(is_maximized) = win.is_maximized() else { return; };

    // 首次同步：只建立基线；后续仅在状态变化时通知前端，避免刷事件。
    if last_maximized.is_none() {
      *last_maximized = Some(is_maximized);
      let _ = win.emit("flymd://window-maximized-changed", is_maximized);
      return;
    }

    if *last_maximized == Some(is_maximized) {
      return;
    }
    *last_maximized = Some(is_maximized);
    let _ = win.emit("flymd://window-maximized-changed", is_maximized);
  }

  let last_maximized = Arc::new(Mutex::new(None::<bool>));

  // 先同步一次，处理“启动即最大化”但事件还没到的情况。
  {
    let mut guard = last_maximized.lock().unwrap_or_else(|p| p.into_inner());
    sync_state(win, &mut guard);
  }

  // 注意：不能把用于注册回调的 `win` 同时 move 进闭包（Rust 借用规则会报 E0505）。
  // 这里保留用 `win`（&self）注册监听，另拷贝一份句柄给闭包里用。
  let win_for_cb = win.clone();
  let last_maximized_for_cb = last_maximized.clone();
  win.on_window_event(move |_event| {
    let mut guard = last_maximized_for_cb
      .lock()
      .unwrap_or_else(|p| p.into_inner());
    sync_state(&win_for_cb, &mut guard);
  });
}

// 启动诊断日志：发布版也能落盘，便于定位“黑屏/卡初始化”等问题
static STARTUP_LOG_PATH: OnceLock<std::path::PathBuf> = OnceLock::new();
static PANIC_HOOK_INSTALLED: OnceLock<()> = OnceLock::new();

// 网络代理设置：由前端写入（主题面板），用于影响 Rust 侧 reqwest/tauri-plugin-http 的新请求
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetworkProxyPrefs {
  enabled: bool,
  proxy_url: String,
  no_proxy: String,
}

static NETWORK_PROXY_PREFS: OnceLock<std::sync::Mutex<NetworkProxyPrefs>> = OnceLock::new();

fn default_network_proxy_prefs() -> NetworkProxyPrefs {
  NetworkProxyPrefs {
    enabled: false,
    proxy_url: "".into(),
    no_proxy: "".into(),
  }
}

fn normalize_network_no_proxy(raw: &str) -> String {
  fn add(out: &mut Vec<String>, value: &str) {
    let v = value.trim();
    if v.is_empty() {
      return;
    }
    if out.iter().any(|x| x.eq_ignore_ascii_case(v)) {
      return;
    }
    out.push(v.to_string());
  }

  let mut out: Vec<String> = Vec::new();
  for part in raw.split(|c| c == ',' || c == ' ' || c == '\n' || c == '\r' || c == '\t') {
    add(&mut out, part);
  }
  // 本机地址必须默认绕过代理，否则 dev 服务、本地接口和 WebView 内部请求都会被拖进慢路径。
  for part in ["localhost", "127.0.0.1", "::1"] {
    add(&mut out, part);
  }
  out.join(",")
}

fn apply_network_proxy_env(p: &NetworkProxyPrefs) -> Result<(), String> {
  use std::env;
  if !p.enabled {
    env::remove_var("HTTP_PROXY");
    env::remove_var("HTTPS_PROXY");
    env::remove_var("NO_PROXY");
    return Ok(());
  }

  let u = p.proxy_url.trim();
  if u.is_empty() {
    return Err("proxyUrl 为空".into());
  }

  let parsed = url::Url::parse(u).map_err(|e| format!("proxyUrl 非法：{e}"))?;
  let scheme = parsed.scheme().to_ascii_lowercase();
  if scheme != "http" && scheme != "https" {
    return Err("proxyUrl 仅支持 http/https".into());
  }

  env::set_var("HTTP_PROXY", u);
  env::set_var("HTTPS_PROXY", u);
  let np = normalize_network_no_proxy(p.no_proxy.trim());
  if np.is_empty() {
    env::remove_var("NO_PROXY");
  } else {
    env::set_var("NO_PROXY", np);
  }
  Ok(())
}

#[tauri::command]
fn set_network_proxy(enabled: bool, proxy_url: Option<String>, no_proxy: Option<String>) -> Result<NetworkProxyPrefs, String> {
  let mut prefs = NetworkProxyPrefs {
    enabled,
    proxy_url: proxy_url.unwrap_or_default(),
    no_proxy: no_proxy.unwrap_or_default(),
  };
  if prefs.enabled {
    prefs.no_proxy = normalize_network_no_proxy(&prefs.no_proxy);
  }
  apply_network_proxy_env(&prefs)?;
  let lock = NETWORK_PROXY_PREFS.get_or_init(|| std::sync::Mutex::new(default_network_proxy_prefs()));
  {
    let mut guard = lock.lock().unwrap_or_else(|p| p.into_inner());
    *guard = prefs.clone();
  }
  Ok(prefs)
}

#[tauri::command]
fn get_network_proxy() -> Result<NetworkProxyPrefs, String> {
  let lock = NETWORK_PROXY_PREFS.get_or_init(|| std::sync::Mutex::new(default_network_proxy_prefs()));
  let guard = lock.lock().unwrap_or_else(|p| p.into_inner());
  Ok(guard.clone())
}

fn now_epoch_ms() -> u128 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis())
    .unwrap_or(0)
}

fn try_write_log_line(path: &std::path::Path, line: &str) -> std::io::Result<()> {
  use std::io::Write;
  let mut f = std::fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(path)?;
  writeln!(f, "{line}")?;
  Ok(())
}

fn write_startup_log(line: &str) {
  let Some(path) = STARTUP_LOG_PATH.get() else { return; };
  let _ = try_write_log_line(path, line);
}

fn install_panic_hook_once() {
  if PANIC_HOOK_INSTALLED.set(()).is_err() {
    return;
  }

  std::panic::set_hook(Box::new(|info| {
    // 注意：release 里 panic=abort，但 hook 仍有机会写入关键信息
    let ts = now_epoch_ms();
    write_startup_log(&format!("[panic] t={ts}ms {info}"));
  }));
}

fn init_startup_log<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
  // 优先写入 app_log_dir；失败则退回 app_data_dir；再失败就放弃（不能为了日志把应用搞崩）
  let dir = app
    .path()
    .app_log_dir()
    .or_else(|_| app.path().app_data_dir());
  let Ok(mut dir) = dir else { return; };
  let _ = std::fs::create_dir_all(&dir);
  dir.push("flymd-startup.log");

  // 覆盖写：保留“最近一次启动”的信息，避免无限增长
  if let Ok(mut f) = std::fs::OpenOptions::new()
    .create(true)
    .write(true)
    .truncate(true)
    .open(&dir)
  {
    use std::io::Write;
    let _ = writeln!(f, "flymd 启动诊断日志（仅保留最近一次）");
  }

  let _ = STARTUP_LOG_PATH.set(dir);
  install_panic_hook_once();

  let ts = now_epoch_ms();
  write_startup_log(&format!("[boot] t={ts}ms pid={}", std::process::id()));

  if let Ok(exe) = std::env::current_exe() {
    let exe_s = exe.to_string_lossy();
    write_startup_log(&format!("[boot] exe={exe_s}"));
    if exe_s.contains("AppTranslocation") {
      write_startup_log("[boot] 检测到 AppTranslocation（quarantine/未签名常见触发点）");
    }
  }
  if let Ok(cwd) = std::env::current_dir() {
    write_startup_log(&format!("[boot] cwd={}", cwd.to_string_lossy()));
  }

  let args: Vec<String> = std::env::args().collect();
  if !args.is_empty() {
    write_startup_log(&format!("[boot] args={}", args.join(" ")));
  }

  // 只记录少量关键变量：GUI 启动与终端启动差异最大的就是这些
  for k in ["PATH", "HOME", "SHELL", "LANG", "LC_ALL"] {
    if let Ok(v) = std::env::var(k) {
      write_startup_log(&format!("[env] {k}={v}"));
    }
  }

  if let Ok(p) = app.path().app_log_dir() {
    write_startup_log(&format!("[path] app_log_dir={}", p.to_string_lossy()));
  }
  if let Ok(p) = app.path().app_config_dir() {
    write_startup_log(&format!("[path] app_config_dir={}", p.to_string_lossy()));
  }
  if let Ok(p) = app.path().app_data_dir() {
    write_startup_log(&format!("[path] app_data_dir={}", p.to_string_lossy()));
  }
}

// 判定是否为受支持的文档扩展名（md/markdown/txt/pdf），并确保路径存在
fn is_supported_doc_path(path: &std::path::Path) -> bool {
  use std::path::Path;
  let p: &Path = path;
  if !p.exists() {
    return false;
  }
  match p.extension().and_then(|s| s.to_str()).map(|s| s.to_ascii_lowercase()) {
    Some(ext) => ext == "md" || ext == "markdown" || ext == "txt" || ext == "pdf",
    None => false,
  }
}

// 判定是否为 Markdown 类文本（供插件扫描使用，不包含 PDF）
fn is_markdown_like_path(path: &std::path::Path) -> bool {
  use std::path::Path;
  let p: &Path = path;
  if !p.exists() {
    return false;
  }
  match p.extension().and_then(|s| s.to_str()).map(|s| s.to_ascii_lowercase()) {
    Some(ext) => ext == "md" || ext == "markdown" || ext == "txt",
    None => false,
  }
}

// 统一的“打开方式/默认程序”事件分发：写入 PendingOpenPath，并向前端发送 open-file 事件
fn dispatch_open_file_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: &std::path::Path) {
  if !is_supported_doc_path(path) {
    return;
  }
  let path_str = path.to_string_lossy().to_string();
  write_startup_log(&format!("[open] {}", path_str));
  // 先写入共享状态：即便当前窗口尚未创建，前端仍可在启动后通过 get_pending_open_path 主动拉取
  if let Some(state) = app.try_state::<PendingOpenPath>() {
    if let Ok(mut slot) = state.0.lock() {
      *slot = Some(path_str.clone());
    }
  }
  // 若主窗口已存在，则主动发送 open-file 事件；否则仅依赖前端兜底拉取
  if let Some(win) = app.get_webview_window("main") {
    let win_clone = win.clone();
    let path_clone = path_str.clone();
    std::thread::spawn(move || {
      std::thread::sleep(std::time::Duration::from_millis(500));
      let _ = win_clone.emit("open-file", path_clone);
      let _ = win_clone.set_focus();
    });
  }
}

// macOS：通过 RunEvent::Opened 捕获 Finder/Launch Services 传入的文件 URL，并复用统一分发逻辑
#[cfg(target_os = "macos")]
fn init_macos_open_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
  use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
  use tauri::RunEvent;

  PluginBuilder::new("macos-open-handler")
    .on_event(|app, event| {
      if let RunEvent::Opened { urls } = event {
        write_startup_log(&format!("[run] Opened urls={}", urls.len()));
        for url in urls {
          // 仅处理 file:// URL，其它协议（如自定义 URL Scheme）暂不介入
          if url.scheme() != "file" {
            continue;
          }
          if let Ok(path) = url.to_file_path() {
            dispatch_open_file_event(app, &path);
          }
        }
      }
    })
    .build()
}


#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadReq {
  access_key_id: String,
  secret_access_key: String,
  bucket: String,
  #[serde(default)]
  region: Option<String>,
  #[serde(default)]
  endpoint: Option<String>,
  #[serde(default = "UploadReq::default_true")]
  force_path_style: bool,
  #[serde(default = "UploadReq::default_true")]
  acl_public_read: bool,
  #[serde(default)]
  custom_domain: Option<String>,
  key: String,
  #[serde(default)]
  content_type: Option<String>,
  // 前端可传 Uint8Array -> Vec<u8>
  bytes: Vec<u8>,
}

impl UploadReq {
  fn default_true() -> bool { true }
}

#[derive(Debug, Serialize)]
struct UploadResp {
  key: String,
  public_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct UploadedImageRecord {
  id: String,
  bucket: String,
  key: String,
  public_url: String,
  uploaded_at: String,
  #[serde(default)]
  file_name: Option<String>,
  #[serde(default)]
  content_type: Option<String>,
  #[serde(default)]
  size: Option<u64>,
  // 新增：图床来源（默认 None 视为 s3）
  #[serde(default)]
  provider: Option<String>,
  // 新增：部分图床（如 ImgLa/Lsky）使用数值 key 删除
  #[serde(default)]
  remote_key: Option<u64>,
  // 新增：相册范围（如 ImgLa/Lsky 的 album_id）
  #[serde(default)]
  album_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploaderDeleteReq {
  access_key_id: String,
  secret_access_key: String,
  bucket: String,
  #[serde(default)]
  region: Option<String>,
  #[serde(default)]
  endpoint: Option<String>,
  #[serde(default)]
  force_path_style: Option<bool>,
  key: String,
}

fn uploader_history_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
  let mut dir = app
    .path()
    .app_config_dir()
    .map_err(|e| format!("app_config_dir error: {e}"))?;
  dir.push("uploader-history.json");
  Ok(dir)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresignReq {
  access_key_id: String,
  secret_access_key: String,
  bucket: String,
  #[serde(default)]
  region: Option<String>,
  #[serde(default)]
  endpoint: Option<String>,
  #[serde(default)]
  force_path_style: bool,
  #[serde(default)]
  custom_domain: Option<String>,
  key: String,
  #[serde(default)]
  expires: Option<u32>,
}

#[derive(Debug, Serialize)]
struct PresignResp {
  put_url: String,
  public_url: String,
}

#[tauri::command]
async fn upload_to_s3(req: UploadReq) -> Result<UploadResp, String> {
  // 使用 AWS SDK for Rust 直传，行为与 PicList（SDK）一致；仅构建机需工具链，用户零依赖。
  use aws_sdk_s3 as s3;
  use aws_config::meta::region::RegionProviderChain;
  use s3::config::Region;
  use s3::types::ObjectCannedAcl;
  use s3::primitives::ByteStream;

  let region_str = req.region.clone().unwrap_or_else(|| "us-east-1".to_string());
  let region = Region::new(region_str.clone());
  let region_provider = RegionProviderChain::first_try(region.clone());
  let base_conf = aws_config::defaults(aws_config::BehaviorVersion::latest())
    .region(region_provider)
    .load()
    .await;

  let creds = s3::config::Credentials::new(
    req.access_key_id.clone(),
    req.secret_access_key.clone(),
    None,
    None,
    "flymd",
  );
  let mut conf_builder = s3::config::Builder::from(&base_conf)
    .credentials_provider(creds)
    .force_path_style(req.force_path_style);
  if let Some(ep) = &req.endpoint { if !ep.trim().is_empty() { conf_builder = conf_builder.endpoint_url(ep.trim()); } }
  let conf = conf_builder.build();
  let client = s3::Client::from_conf(conf);

  let mut put = client
    .put_object()
    .bucket(req.bucket.clone())
    .key(req.key.clone())
    .body(ByteStream::from(req.bytes.clone()));
  if let Some(ct) = &req.content_type { if !ct.is_empty() { put = put.content_type(ct); } }
  if req.acl_public_read { put = put.acl(ObjectCannedAcl::PublicRead); }
  put.send().await.map_err(|e| format!("put_object error: {e}"))?;

  // 生成外链
  let key_enc = percent_encoding::utf8_percent_encode(&req.key, percent_encoding::NON_ALPHANUMERIC).to_string();
  let public_url = if let Some(custom) = &req.custom_domain {
    let base = custom.trim_end_matches('/');
    format!("{}/{}", base, key_enc)
  } else if let Some(ep) = &req.endpoint {
    let ep = ep.trim_end_matches('/');
    if req.force_path_style {
      // path-style: <endpoint>/<bucket>/<key>
      format!("{}/{}/{}", ep, req.bucket, key_enc)
    } else {
      // virtual-host: https://<bucket>.<host>/<key>
      match ep.parse::<url::Url>() {
        Ok(u) => format!("{}://{}.{}{}{}{}{}", u.scheme(), req.bucket, u.host_str().unwrap_or(""), if u.port().is_some() { ":" } else { "" }, u.port().map(|p| p.to_string()).unwrap_or_default(), if u.path() == "/" { "" } else { u.path() }, format!("/{}", key_enc)),
        Err(_) => format!("{}/{}/{}", ep, req.bucket, key_enc),
      }
    }
  } else {
    // 默认 S3 公域名
    if req.force_path_style { format!("https://s3.amazonaws.com/{}/{}", req.bucket, key_enc) } else { format!("https://{}.s3.amazonaws.com/{}", req.bucket, key_enc) }
  };

  Ok(UploadResp { key: req.key, public_url })
}

#[tauri::command]
async fn presign_put(req: PresignReq) -> Result<PresignResp, String> {
  use hmac::{Hmac, Mac};
  use sha2::Sha256;
  use std::time::SystemTime;

  let region_str = req.region.clone().unwrap_or_else(|| "us-east-1".to_string());
  let service = "s3";
  let expires = req.expires.unwrap_or(600);

  // 构建基础 URL 与 CanonicalURI
  let ep = req.endpoint.clone().unwrap_or_else(|| "https://s3.amazonaws.com".to_string());
  let ep_url = ep.parse::<url::Url>().map_err(|e| format!("invalid endpoint: {e}"))?;

  fn aws_uri_encode_segment(seg: &str) -> String {
    let mut out = String::with_capacity(seg.len());
    for &b in seg.as_bytes() {
      let c = b as char;
      let is_unreserved = (b'A'..=b'Z').contains(&b)
        || (b'a'..=b'z').contains(&b)
        || (b'0'..=b'9').contains(&b)
        || c == '-' || c == '_' || c == '.' || c == '~';
      if is_unreserved { out.push(c) } else { out.push('%'); out.push_str(&format!("{:02X}", b)); }
    }
    out
  }
  let key_enc = req.key.split('/').map(aws_uri_encode_segment).collect::<Vec<_>>().join("/");

  let (mut base_url, host_for_sig, canonical_uri) = if req.force_path_style {
    // <endpoint>/<bucket>/<key>
    let mut u = ep_url.clone();
    let mut new_path = u.path().trim_end_matches('/').to_string();
    new_path.push('/'); new_path.push_str(&req.bucket);
    new_path.push('/'); new_path.push_str(&key_enc);
    u.set_path(&new_path);
    let host_sig = u.host_str().unwrap_or("").to_string();
    (u, host_sig, new_path)
  } else {
    // https://<bucket>.<host>/<key>
    let host = format!("{}.{}", req.bucket, ep_url.host_str().unwrap_or(""));
    let u = url::Url::parse(&format!("{}://{}/{}", ep_url.scheme(), host, key_enc))
      .map_err(|e| format!("build url error: {e}"))?;
    (u, host, format!("/{}", key_enc))
  };

  // 构建 X-Amz-* 查询参数（不包含 Signature）
  let sys_now = SystemTime::now();
  let datetime: DateTime<Utc> = sys_now.into();
  let amz_date = datetime.format("%Y%m%dT%H%M%SZ").to_string();
  let date_stamp = datetime.format("%Y%m%d").to_string();
  let scope = format!("{}/{}/{}/aws4_request", date_stamp, region_str, service);

  // Query 编码（RFC3986，空格用 %20）
  fn enc_q(v: &str) -> String {
    let mut out = String::new();
    for &b in v.as_bytes() {
      let c = b as char;
      let unreserved = (b'A'..=b'Z').contains(&b)
        || (b'a'..=b'z').contains(&b)
        || (b'0'..=b'9').contains(&b)
        || c == '-' || c == '_' || c == '.' || c == '~';
      if unreserved { out.push(c) } else { out.push('%'); out.push_str(&format!("{:02X}", b)); }
    }
    out
  }

  let mut query: Vec<(String, String)> = vec![
    ("X-Amz-Algorithm".into(), "AWS4-HMAC-SHA256".into()),
    ("X-Amz-Credential".into(), format!("{}/{}", req.access_key_id, scope)),
    ("X-Amz-Date".into(), amz_date.clone()),
    ("X-Amz-Expires".into(), expires.to_string()),
    ("X-Amz-SignedHeaders".into(), "host".into()),
  ];
  query.sort_by(|a,b| a.0.cmp(&b.0));
  let canonical_query = query.iter().map(|(k,v)| format!("{}={}", enc_q(k), enc_q(v))).collect::<Vec<_>>().join("&");

  // CanonicalHeaders / SignedHeaders / HashedPayload
  let canonical_headers = format!("host:{}\n", host_for_sig);
  let signed_headers = "host";
  let hashed_payload = "UNSIGNED-PAYLOAD";

  // CanonicalRequest
  let canonical_request = format!(
    "PUT\n{}\n{}\n{}\n{}\n{}",
    canonical_uri, canonical_query, canonical_headers, signed_headers, hashed_payload
  );

  // StringToSign
  let string_to_sign = format!(
    "AWS4-HMAC-SHA256\n{}\n{}\n{}",
    amz_date,
    scope,
    hex::encode(sha2::Sha256::digest(canonical_request.as_bytes()))
  );

  // 派生签名密钥
  type HmacSha256 = Hmac<Sha256>;
  fn hmac(key: &[u8], data: &str) -> Vec<u8> { let mut mac = HmacSha256::new_from_slice(key).unwrap(); mac.update(data.as_bytes()); mac.finalize().into_bytes().to_vec() }
  let k_date = hmac(format!("AWS4{}", req.secret_access_key).as_bytes(), &date_stamp);
  let k_region = hmac(&k_date, &region_str);
  let k_service = hmac(&k_region, service);
  let k_signing = hmac(&k_service, "aws4_request");
  let signature = hex::encode(hmac(&k_signing, &string_to_sign));

  // 构造最终 URL（附加 Signature）
  let mut final_q = canonical_query.clone();
  final_q.push_str(&format!("&X-Amz-Signature={}", signature));
  base_url.set_query(Some(&final_q));

  // 生成外链
  let public_url = if let Some(custom) = &req.custom_domain {
    let base = custom.trim_end_matches('/');
    format!("{}/{}", base, key_enc)
  } else if req.force_path_style {
    format!("{}/{}/{}", ep.trim_end_matches('/'), req.bucket, key_enc)
  } else {
    format!("{}://{}.{}{}{}{}{}",
      ep_url.scheme(), req.bucket, ep_url.host_str().unwrap_or(""),
      if ep_url.port().is_some() { ":" } else { "" }, ep_url.port().map(|p| p.to_string()).unwrap_or_default(),
      if ep_url.path() == "/" { "" } else { ep_url.path() },
      format!("/{}", key_enc)
    )
  };

  Ok(PresignResp { put_url: base_url.to_string(), public_url })
}

// S3/R2 上传历史管理：仅记录非敏感元数据，便于前端插件查看与删除
#[tauri::command]
async fn flymd_record_uploaded_image(app: tauri::AppHandle, record: UploadedImageRecord) -> Result<(), String> {
  use std::fs;

  let path = uploader_history_path(&app)?;
  tauri::async_runtime::spawn_blocking(move || {
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent).map_err(|e| format!("create_dir_all error: {e}"))?;
    }
    let mut list: Vec<UploadedImageRecord> = match fs::read_to_string(&path) {
      Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
      Err(_) => Vec::new(),
    };
    // 去重：同 bucket/key/public_url 仅保留最新一条
    if let Some(pos) = list
      .iter()
      .position(|x| x.bucket == record.bucket && x.key == record.key && x.public_url == record.public_url)
    {
      list.remove(pos);
    }
    list.push(record);
    const MAX_ITEMS: usize = 2000;
    if list.len() > MAX_ITEMS {
      let drop_n = list.len() - MAX_ITEMS;
      list.drain(0..drop_n);
    }
    let json = serde_json::to_string_pretty(&list).map_err(|e| format!("serialize error: {e}"))?;
    fs::write(&path, json.as_bytes()).map_err(|e| format!("write error: {e}"))?;
    Ok::<(), String>(())
  })
  .await
  .map_err(|e| format!("join error: {e}"))??;

  Ok(())
}

#[tauri::command]
async fn flymd_list_uploaded_images(app: tauri::AppHandle) -> Result<Vec<UploadedImageRecord>, String> {
  use std::fs;

  let path = uploader_history_path(&app)?;
  let list = tauri::async_runtime::spawn_blocking(move || {
    if !path.exists() {
      return Ok::<Vec<UploadedImageRecord>, String>(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("read error: {e}"))?;
    let mut list: Vec<UploadedImageRecord> = serde_json::from_str(&text).unwrap_or_default();
    // 按时间倒序返回（新上传在前）
    list.sort_by(|a, b| b.uploaded_at.cmp(&a.uploaded_at));
    Ok(list)
  })
  .await
  .map_err(|e| format!("join error: {e}"))??;

  Ok(list)
}

#[tauri::command]
async fn flymd_delete_uploaded_image(app: tauri::AppHandle, req: UploaderDeleteReq) -> Result<(), String> {
  // 1) 使用当前配置删除远端对象
  use aws_config::meta::region::RegionProviderChain;
  use aws_sdk_s3 as s3;
  use s3::config::Region;

  let region_str = req.region.clone().unwrap_or_else(|| "us-east-1".to_string());
  let region = Region::new(region_str.clone());
  let region_provider = RegionProviderChain::first_try(region.clone());
  let base_conf = aws_config::defaults(aws_config::BehaviorVersion::latest())
    .region(region_provider)
    .load()
    .await;

  let creds = s3::config::Credentials::new(
    req.access_key_id.clone(),
    req.secret_access_key.clone(),
    None,
    None,
    "flymd",
  );
  let mut conf_builder = s3::config::Builder::from(&base_conf)
    .credentials_provider(creds)
    .force_path_style(req.force_path_style.unwrap_or(true));
  if let Some(ep) = &req.endpoint {
    if !ep.trim().is_empty() {
      conf_builder = conf_builder.endpoint_url(ep.trim());
    }
  }
  let conf = conf_builder.build();
  let client = s3::Client::from_conf(conf);

  client
    .delete_object()
    .bucket(req.bucket.clone())
    .key(req.key.clone())
    .send()
    .await
    .map_err(|e| format!("delete_object error: {e}"))?;

  // 2) 本地历史中移除对应记录（按 bucket+key 匹配）
  use std::fs;

  let path = uploader_history_path(&app)?;
  let bucket = req.bucket.clone();
  let key = req.key.clone();
  tauri::async_runtime::spawn_blocking(move || {
    if !path.exists() {
      return Ok::<(), String>(());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("read error: {e}"))?;
    let mut list: Vec<UploadedImageRecord> = serde_json::from_str(&text).unwrap_or_default();
    let before = list.len();
    list.retain(|r| !(r.bucket == bucket && r.key == key));
    if list.len() != before {
      let json = serde_json::to_string_pretty(&list).map_err(|e| format!("serialize error: {e}"))?;
      fs::write(&path, json.as_bytes()).map_err(|e| format!("write error: {e}"))?;
    }
    Ok(())
  })
  .await
  .map_err(|e| format!("join error: {e}"))??;

  Ok(())
}

// ImgLa（Lsky Pro+）图床：相册/图片列表与删除
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImgLaAuthReq {
  base_url: String,
  token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImgLaListImagesReq {
  base_url: String,
  token: String,
  #[serde(default)]
  album_id: Option<u64>,
  #[serde(default)]
  page: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImgLaDeleteReq {
  base_url: String,
  token: String,
  key: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImgLaUploadReq {
  base_url: String,
  token: String,
  strategy_id: u64,
  #[serde(default)]
  album_id: Option<u64>,
  file_name: String,
  #[serde(default)]
  content_type: Option<String>,
  // 前端可传 Uint8Array -> Vec<u8>
  bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
struct ImgLaUploadResp {
  key: u64,
  pathname: String,
  public_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ImgLaAlbum {
  id: u64,
  name: String,
  #[serde(default)]
  intro: Option<String>,
  #[serde(default)]
  image_num: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
struct ImgLaStrategy {
  id: u64,
  name: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  intro: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  r#type: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  driver: Option<String>,
}

fn imgla_join(base_url: &str, path: &str) -> String {
  let b = base_url.trim().trim_end_matches('/');
  let p = path.trim().trim_start_matches('/');
  format!("{}/{}", b, p)
}

#[tauri::command]
async fn flymd_imgla_upload(req: ImgLaUploadReq) -> Result<ImgLaUploadResp, String> {
  use reqwest::multipart::{Form, Part};
  use serde_json::Value;

  fn short_text(s: &str, max: usize) -> String {
    if s.len() <= max { return s.to_string(); }
    let mut out = String::with_capacity(max + 32);
    for (i, ch) in s.chars().enumerate() {
      if i >= max { break; }
      out.push(ch);
    }
    out.push_str(&format!("…(len={})", s.len()));
    out
  }

  let base = req.base_url.trim().trim_end_matches('/').to_string();
  if base.is_empty() {
    return Err("baseUrl 为空".into());
  }
  let token = req.token.trim().to_string();
  if token.is_empty() {
    return Err("token 为空".into());
  }
  if req.strategy_id == 0 {
    return Err("strategyId 非法".into());
  }
  if req.bytes.is_empty() {
    return Err("bytes 为空".into());
  }

  let url = imgla_join(&base, "/api/v1/upload");
  let ct = req
    .content_type
    .unwrap_or_else(|| "application/octet-stream".to_string());

  let file_part = Part::bytes(req.bytes)
    .file_name(req.file_name.clone())
    .mime_str(&ct)
    .map_err(|e| format!("mime error: {e}"))?;

  let mut form = Form::new()
    .part("file", file_part)
    .text("strategy_id", req.strategy_id.to_string())
    .text("permission", "0");
  if let Some(aid) = req.album_id {
    if aid > 0 {
      form = form.text("album_id", aid.to_string());
    }
  }

  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(40))
    .build()
    .map_err(|e| format!("client error: {e}"))?;

  let resp = client
    .post(&url)
    .header("Accept", "application/json")
    .bearer_auth(&token)
    .multipart(form)
    .send()
    .await
    .map_err(|e| format!("send error: {e}"))?;

  let status = resp.status();
  let text = resp.text().await.unwrap_or_default();
  if !status.is_success() {
    return Err(format!("HTTP {}: {}", status.as_u16(), short_text(&text, 800)));
  }

  let v: Value = serde_json::from_str(&text).map_err(|e| {
    if cfg!(debug_assertions) {
      format!("json error: {e}; raw={}", short_text(&text, 800))
    } else {
      format!("json error: {e}")
    }
  })?;
  let ok = v.get("status").and_then(|x| x.as_bool()).unwrap_or(false);
  if !ok {
    let msg = v.get("message").and_then(|x| x.as_str()).unwrap_or("upload failed");
    let code = v.get("code").and_then(|x| x.as_i64()).unwrap_or(0);
    if cfg!(debug_assertions) {
      return Err(format!("ImgLa status=false code={} message={} raw={}", code, msg, short_text(&text, 800)));
    }
    return Err(msg.to_string());
  }

  let data = v.get("data").cloned().unwrap_or(Value::Null);
  let key = data.get("key").and_then(|x| x.as_u64()).unwrap_or(0);
  let pathname = data
    .get("pathname")
    .and_then(|x| x.as_str())
    .unwrap_or("")
    .to_string();
  let public_url = data
    .get("links")
    .and_then(|x| x.get("url"))
    .and_then(|x| x.as_str())
    .unwrap_or("")
    .to_string();

  if key == 0 || public_url.is_empty() {
    return Err("ImgLa 返回数据不完整（缺少 url/key）".into());
  }

  Ok(ImgLaUploadResp { key, pathname, public_url })
}

#[tauri::command]
async fn flymd_imgla_list_albums(req: ImgLaAuthReq) -> Result<Vec<ImgLaAlbum>, String> {
  use std::collections::HashSet;
  use serde_json::Value;

  let base = req.base_url.trim().trim_end_matches('/').to_string();
  if base.is_empty() {
    return Err("baseUrl 为空".into());
  }
  let token = req.token.trim().to_string();
  if token.is_empty() {
    return Err("token 为空".into());
  }

  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(20))
    .build()
    .map_err(|e| format!("client error: {e}"))?;

  let mut url = imgla_join(&base, "/api/v1/albums?page=1&order=earliest");
  let mut out: Vec<ImgLaAlbum> = Vec::new();
  let mut seen: HashSet<u64> = HashSet::new();

  for _ in 0..50 {
    let resp = client
      .get(&url)
      .header("Accept", "application/json")
      .bearer_auth(&token)
      .send()
      .await
      .map_err(|e| format!("send error: {e}"))?;

    let status = resp.status();
    let v: Value = resp.json().await.map_err(|e| format!("json error: {e}"))?;
    if !status.is_success() {
      return Err(format!("HTTP {}: {}", status.as_u16(), v));
    }

    let data = v.get("data").cloned().unwrap_or(Value::Null);
    if let Some(arr) = data.get("data").and_then(|x| x.as_array()) {
      for a in arr {
        let id = a.get("id").and_then(|x| x.as_u64()).unwrap_or(0);
        if id == 0 || seen.contains(&id) { continue; }
        let name = a.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let intro = a.get("intro").and_then(|x| x.as_str()).map(|s| s.to_string());
        let image_num = a.get("image_num").and_then(|x| x.as_u64());
        out.push(ImgLaAlbum { id, name, intro, image_num });
        seen.insert(id);
      }
    }

    let next = data.get("next_page_url").and_then(|x| x.as_str()).unwrap_or("").trim();
    if next.is_empty() || next == "null" { break; }
    url = if next.starts_with("http://") || next.starts_with("https://") {
      next.to_string()
    } else {
      imgla_join(&base, next)
    };
  }

  Ok(out)
}

#[tauri::command]
async fn flymd_imgla_list_strategies(req: ImgLaAuthReq) -> Result<Vec<ImgLaStrategy>, String> {
  use serde_json::Value;

  fn short_text(s: &str, max: usize) -> String {
    if s.len() <= max { return s.to_string(); }
    let mut out = String::with_capacity(max + 32);
    for (i, ch) in s.chars().enumerate() {
      if i >= max { break; }
      out.push(ch);
    }
    out.push_str(&format!("…(len={})", s.len()));
    out
  }
  fn v_to_u64(v: &Value) -> u64 {
    if let Some(n) = v.as_u64() { return n; }
    if let Some(s) = v.as_str() {
      if let Ok(n) = s.trim().parse::<u64>() { return n; }
    }
    0
  }
  fn v_to_string(v: Option<&Value>) -> Option<String> {
    let Some(v) = v else { return None; };
    if let Some(s) = v.as_str() {
      let t = s.trim();
      if !t.is_empty() { return Some(t.to_string()); }
    }
    None
  }
  fn find_first_id_array<'a>(root: &'a Value) -> Option<&'a Vec<Value>> {
    // 宽松兜底：有些部署返回结构不是 data/data，直接 BFS 找“像策略列表”的数组
    let mut q: Vec<&'a Value> = Vec::new();
    q.push(root);
    for _ in 0..4096 {
      let Some(cur) = q.pop() else { break; };
      if let Some(arr) = cur.as_array() {
        let mut ok = false;
        for it in arr {
          if let Some(obj) = it.as_object() {
            if obj.contains_key("id") {
              ok = true;
              break;
            }
          }
        }
        if ok {
          return Some(arr);
        }
        // 继续向下探测
        for it in arr {
          q.push(it);
        }
      } else if let Some(obj) = cur.as_object() {
        for (_, v) in obj {
          q.push(v);
        }
      }
    }
    None
  }

  let base = req.base_url.trim().trim_end_matches('/').to_string();
  if base.is_empty() {
    return Err("baseUrl 为空".into());
  }
  let token = req.token.trim().to_string();
  if token.is_empty() {
    return Err("token 为空".into());
  }

  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(20))
    .build()
    .map_err(|e| format!("client error: {e}"))?;

  let url = imgla_join(&base, "/api/v1/strategies");
  let resp = client
    .get(&url)
    .header("Accept", "application/json")
    .bearer_auth(&token)
    .send()
    .await
    .map_err(|e| format!("send error: {e}"))?;

  let status = resp.status();
  let text = resp.text().await.unwrap_or_default();
  let v: Value = serde_json::from_str(&text).map_err(|e| {
    if cfg!(debug_assertions) {
      format!("json error: {e}; raw={}", short_text(&text, 800))
    } else {
      format!("json error: {e}")
    }
  })?;
  if !status.is_success() {
    return Err(format!("HTTP {}: {}", status.as_u16(), v));
  }
  let ok = v.get("status").and_then(|x| x.as_bool()).unwrap_or(false);
  if !ok {
    let msg = v.get("message").and_then(|x| x.as_str()).unwrap_or("list strategies failed");
    return Err(msg.to_string());
  }

  // 兼容两种结构：data: [] 或 data: { data: [] }
  let data = v.get("data").cloned().unwrap_or(Value::Null);
  let arr: Vec<Value> = if let Some(a) = data.as_array() {
    a.clone()
  } else if let Some(a) = data.get("data").and_then(|x| x.as_array()) {
    a.clone()
  } else if let Some(a) = find_first_id_array(&v) {
    a.clone()
  } else {
    Vec::new()
  };
  if arr.is_empty() {
    if cfg!(debug_assertions) {
      return Err(format!("策略列表为空或无法解析; raw={}", short_text(&text, 800)));
    }
    return Err("策略列表为空或无法解析".into());
  }

  let mut out: Vec<ImgLaStrategy> = Vec::new();
  for it in arr {
    let id = it.get("id").map(v_to_u64).unwrap_or(0);
    if id == 0 { continue; }
    let name = it
      .get("name")
      .and_then(|x| x.as_str())
      .map(|s| s.trim().to_string())
      .filter(|s| !s.is_empty())
      .unwrap_or_else(|| format!("#{id}"));
    let intro = v_to_string(it.get("intro"));
    let ty = v_to_string(it.get("type"));
    let driver = v_to_string(it.get("driver"));
    out.push(ImgLaStrategy { id, name, intro, r#type: ty, driver });
  }
  if out.is_empty() {
    if cfg!(debug_assertions) {
      return Err(format!("策略列表解析为空（id 可能异常）; raw={}", short_text(&text, 800)));
    }
    return Err("策略列表解析为空（id 可能异常）".into());
  }
  Ok(out)
}

#[tauri::command]
async fn flymd_imgla_list_images(req: ImgLaListImagesReq) -> Result<Vec<UploadedImageRecord>, String> {
  use serde_json::Value;

  let base = req.base_url.trim().trim_end_matches('/').to_string();
  if base.is_empty() {
    return Err("baseUrl 为空".into());
  }
  let token = req.token.trim().to_string();
  if token.is_empty() {
    return Err("token 为空".into());
  }

  let page = req.page.unwrap_or(1).max(1);
  let mut url = imgla_join(&base, &format!("/api/v1/images?page={}", page));
  if let Some(aid) = req.album_id {
    url.push_str(&format!("&album_id={}", aid));
  }

  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(25))
    .build()
    .map_err(|e| format!("client error: {e}"))?;

  let resp = client
    .get(&url)
    .header("Accept", "application/json")
    .bearer_auth(&token)
    .send()
    .await
    .map_err(|e| format!("send error: {e}"))?;

  let status = resp.status();
  let v: Value = resp.json().await.map_err(|e| format!("json error: {e}"))?;
  if !status.is_success() {
    return Err(format!("HTTP {}: {}", status.as_u16(), v));
  }

  let mut out: Vec<UploadedImageRecord> = Vec::new();
  let data = v.get("data").cloned().unwrap_or(Value::Null);
  let arr = data.get("data").and_then(|x| x.as_array()).cloned().unwrap_or_default();
  for it in arr {
    let remote_key = it.get("key").and_then(|x| x.as_u64()).unwrap_or(0);
    if remote_key == 0 { continue; }
    let name = it.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let pathname = it.get("pathname").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let uploaded_at = it.get("date").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let size = it.get("size").and_then(|x| x.as_u64());
    let public_url = it
      .get("links")
      .and_then(|x| x.get("url"))
      .and_then(|x| x.as_str())
      .unwrap_or("")
      .to_string();

    out.push(UploadedImageRecord {
      id: format!("imgla-{}", remote_key),
      bucket: "imgla".to_string(),
      key: if !pathname.is_empty() { pathname } else { remote_key.to_string() },
      public_url,
      uploaded_at,
      file_name: if name.is_empty() { None } else { Some(name) },
      content_type: it.get("mimetype").and_then(|x| x.as_str()).map(|s| s.to_string()),
      size,
      provider: Some("imgla".into()),
      remote_key: Some(remote_key),
      album_id: req.album_id,
    });
  }

  Ok(out)
}

#[tauri::command]
async fn flymd_imgla_delete_image(app: tauri::AppHandle, req: ImgLaDeleteReq) -> Result<(), String> {
  use std::fs;
  use serde_json::Value;

  let base = req.base_url.trim().trim_end_matches('/').to_string();
  if base.is_empty() {
    return Err("baseUrl 为空".into());
  }
  let token = req.token.trim().to_string();
  if token.is_empty() {
    return Err("token 为空".into());
  }
  if req.key == 0 {
    return Err("key 非法".into());
  }

  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(25))
    .build()
    .map_err(|e| format!("client error: {e}"))?;

  // Lsky Pro+ 新旧接口并存（而且不同部署可能只支持其中一个）：
  // - 新版（用户侧）：DELETE /api/v2/user/photos，Body 为 [id, ...]，成功通常是 204
  // - 兼容新版（部分部署）：DELETE /api/v1/user/photos，Body 为 [id, ...]
  // - 旧版（兼容）：DELETE /api/v1/images/{key}
  // 现实很残酷：你只能兼容它。
  fn parse_status_or_error(text: &str) -> Result<(), String> {
    // Lsky/兰空常见坑：失败也可能返回 200 + { status:false, message:"..." }
    // 另一个坑：token 失效时可能给你返回 200 + HTML（登录页/错误页），这也不能算成功。
    let t = text.trim();
    if t.is_empty() {
      // 空 body：很多接口会这么干（尤其 204）
      return Ok(());
    }
    let v: Value = serde_json::from_str(t).map_err(|_| {
      // 非 JSON：十有八九是 HTML/文本错误页，别自欺欺人。
      "响应不是 JSON（可能是 token 无效返回的 HTML）".to_string()
    })?;
    let ok = v.get("status").and_then(|x| x.as_bool()).unwrap_or(false);
    if ok {
      return Ok(());
    }
    let msg = v
      .get("message")
      .and_then(|x| x.as_str())
      .unwrap_or("delete failed");
    Err(msg.to_string())
  }

  async fn send_delete(
    client: &reqwest::Client,
    token: &str,
    url: &str,
    body_ids: Option<Vec<u64>>,
    expect_204_only: bool,
  ) -> Result<(), String> {
    let mut req = client
      .delete(url)
      .header("Accept", "application/json")
      .bearer_auth(token);
    if let Some(ids) = body_ids {
      req = req.json(&ids);
    }

    let resp = req.send().await.map_err(|e| format!("send error: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if expect_204_only {
      // 你给我的证据很清楚：204 才是成功。那就别瞎“成功”了。
      if status.as_u16() != 204 {
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
      }
      return Ok(());
    }

    if status.as_u16() == 204 {
      return Ok(());
    }
    if !status.is_success() {
      return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }
    // 2xx 但不是 204：必须是 JSON 且 status=true，否则一律当失败，避免 200+HTML 假成功。
    parse_status_or_error(&text)?;
    Ok(())
  }

  let ids = vec![req.key];
  let candidates: Vec<(String, Option<Vec<u64>>)> = vec![
    // 新版优先：/api/v2/user/photos（204）
    (imgla_join(&base, "/api/v2/user/photos"), Some(ids.clone())),
    // 兼容：部分旧部署还是 v1
    (imgla_join(&base, "/api/v1/user/photos"), Some(ids.clone())),
    (imgla_join(&base, "/user/photos"), Some(ids.clone())),
    // 旧版：/api/v1/images/{key}
    (imgla_join(&base, &format!("/api/v1/images/{}", req.key)), None),
    (imgla_join(&base, &format!("/images/{}", req.key)), None),
  ];

  let mut errs: Vec<String> = Vec::new();
  for (url, body) in candidates {
    let expect_204_only = url.contains("/api/v2/user/photos");
    match send_delete(&client, &token, &url, body, expect_204_only).await {
      Ok(()) => {
        errs.clear();
        break;
      }
      Err(e) => {
        errs.push(format!("{url} -> {e}"));
      }
    }
  }
  if !errs.is_empty() {
    return Err(format!("删除图片失败（已尝试多个接口）：{}", errs.join(" | ")));
  }

  // 同步从本地上传历史中移除（若存在）
  let path = uploader_history_path(&app)?;
  let key = req.key;
  tauri::async_runtime::spawn_blocking(move || {
    if !path.exists() {
      return Ok::<(), String>(());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("read error: {e}"))?;
    let mut list: Vec<UploadedImageRecord> = serde_json::from_str(&text).unwrap_or_default();
    let before = list.len();
    list.retain(|r| {
      // provider 缺失的旧记录默认视为 s3，不影响
      if r.provider.as_deref() == Some("imgla") {
        return r.remote_key.unwrap_or(0) != key;
      }
      // 兼容早期写入 bucket=imgla 但未写 provider 的记录
      if r.bucket == "imgla" {
        return r.remote_key.unwrap_or(0) != key;
      }
      true
    });
    if list.len() != before {
      let json = serde_json::to_string_pretty(&list).map_err(|e| format!("serialize error: {e}"))?;
      fs::write(&path, json.as_bytes()).map_err(|e| format!("write error: {e}"))?;
    }
    Ok(())
  })
  .await
  .map_err(|e| format!("join error: {e}"))??;

  Ok(())
}


#[derive(Debug, Deserialize)]
struct XmlHttpReq {
  url: String,
  xml: String,
}

#[tauri::command]
async fn http_xmlrpc_post(req: XmlHttpReq) -> Result<String, String> {
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(20))
    .build()
    .map_err(|e| format!("client error: {e}"))?;
  let res = client
    .post(&req.url)
    .header("Content-Type", "text/xml; charset=UTF-8")
    .header("Accept", "text/xml, */*;q=0.1")
    .header("User-Agent", "flymd-typecho-publisher/0.1")
    .body(req.xml)
    .send()
    .await
    .map_err(|e| format!("send error: {e}"))?;
  let status = res.status();
  let text = res.text().await.map_err(|e| format!("read error: {e}"))?;
  if !status.is_success() {
    return Err(format!("HTTP {}: {}", status.as_u16(), text));
  }
  Ok(text)
}

// AI 小说引擎后端代理：绕过 WebView CORS/OPTIONS 预检限制（仅允许固定后端与固定路径前缀）
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiNovelApiReq {
  path: String,
  method: String,
  #[serde(default)]
  token: String,
  #[serde(default)]
  body: Option<serde_json::Value>,
}

fn ai_novel_default_base_url() -> &'static str {
  "https://flymd.llingfei.com/xiaoshuo"
}

fn ai_novel_validate_path(path: &str) -> Result<String, String> {
  let p = path.trim().trim_start_matches('/');
  if p.is_empty() {
    return Err("path 为空".into());
  }
  // 插件不可信：拒绝绝对 URL 和路径穿越
  if p.contains("://") {
    return Err("禁止传入绝对 URL".into());
  }
  if p.contains("..") {
    return Err("禁止路径穿越".into());
  }
  let allow = ["auth/", "billing/", "ai/proxy/"];
  if !allow.iter().any(|pre| p.starts_with(pre)) {
    return Err("非法 path：仅允许 auth/ billing/ ai/proxy/".into());
  }
  Ok(p.to_string())
}

#[tauri::command]
async fn ai_novel_api(req: AiNovelApiReq) -> Result<serde_json::Value, String> {
  let path = ai_novel_validate_path(&req.path)?;
  let method = req.method.trim().to_uppercase();
  if method != "GET" && method != "POST" {
    return Err("仅支持 GET/POST".into());
  }

  let base = ai_novel_default_base_url().trim_end_matches('/');
  let url = format!("{}/{}", base, path);
  // 插件所有接口统一放宽超时：网络差/上游慢时避免误判失败
  let req_timeout = Duration::from_secs(180);

  fn is_retryable_send_error(e: &reqwest::Error) -> bool {
    // 经验：部分服务器/中间层会直接断开 TLS（不发 close_notify），会被 rustls 识别为 UnexpectedEof；重试一次通常就好。
    let s = format!("{e:?}");
    s.contains("UnexpectedEof")
      || s.contains("peer closed connection")
      || s.contains("connection closed")
      || s.contains("broken pipe")
      || s.contains("ConnectionReset")
      || s.contains("SendRequest")
  }

  let make_client = || {
    reqwest::Client::builder()
      .connect_timeout(Duration::from_secs(30))
      // 很多 CDN/反代在 HTTP/2 下会“粗暴断流”（不发 close_notify），导致 rustls 报 UnexpectedEof。
      // 这里强制降级到 HTTP/1.1，让 Connection: close 真正生效，并规避一堆 h2/ALPN 兼容性坑。
      .http1_only()
      // 避免复用“半死不活”的 TLS 连接（最常见的 UnexpectedEof 来源）
      .pool_max_idle_per_host(0)
      .build()
  };

  let client = make_client().map_err(|e| format!("client error: {e:?}"))?;

  let token = req.token.trim().to_string();
  let payload = req.body.unwrap_or_else(|| serde_json::json!({}));

  let build_rb = |c: &reqwest::Client| -> reqwest::RequestBuilder {
    let mut rb = if method == "GET" { c.get(&url) } else { c.post(&url) };
    // 直接关闭连接：避免服务端/中间层对 keep-alive 的不标准关闭导致 UnexpectedEof
    rb = rb.header("Connection", "close");
    if !token.is_empty() {
      rb = rb.header("Authorization", format!("Bearer {}", token));
    }
    if method == "POST" {
      rb = rb.header("Content-Type", "application/json").json(&payload);
    }
    rb.timeout(req_timeout)
  };

  let mut res: Option<reqwest::Response> = None;
  let mut last_err: Option<reqwest::Error> = None;

  // 首次用已构建的 client，失败后再用新 client 退避重试
  match build_rb(&client).send().await {
    Ok(r) => res = Some(r),
    Err(e) => last_err = Some(e),
  }

  if res.is_none() {
    let backoffs = [250u64, 800u64, 1500u64];
    for ms in backoffs {
      let le = last_err.as_ref().unwrap();
      if !is_retryable_send_error(le) {
        return Err(format!("send error: {le:?}"));
      }

      std::thread::sleep(Duration::from_millis(ms));
      let client2 = make_client().map_err(|e2| format!("client error: {e2:?}"))?;
      match build_rb(&client2).send().await {
        Ok(r2) => {
          res = Some(r2);
          break;
        }
        Err(e2) => last_err = Some(e2),
      }
    }
  }

  let res = match res {
    Some(r) => r,
    None => {
      let le = last_err.expect("last_err must exist when res is None");
      return Err(format!(
        "send error: {le:?}；提示：这是对端/中间层粗暴断开 TLS（常见于 CDN/HTTP2），建议对 /xiaoshuo/ai/proxy/* 关闭 CDN 加速或切 DNS-only，并确保 Nginx/网关不会提前断开连接。"
      ));
    }
  };
  let status = res.status();
  let text = res.text().await.map_err(|e| format!("read error: {e:?}"))?;

  let json: Option<serde_json::Value> = if text.trim().is_empty() {
    None
  } else {
    serde_json::from_str(&text).ok()
  };

  if !status.is_success() {
    if let Some(j) = &json {
      let msg = j
        .get("error")
        .and_then(|v| v.as_str())
        .or_else(|| j.get("message").and_then(|v| v.as_str()))
        .unwrap_or("");
      if !msg.trim().is_empty() {
        return Err(msg.trim().to_string());
      }
    }
    return Err(format!("HTTP {}: {}", status.as_u16(), text));
  }

  let j = json.ok_or_else(|| "后端返回非 JSON".to_string())?;
  if let Some(false) = j.get("ok").and_then(|v| v.as_bool()) {
    let msg = j.get("error").and_then(|v| v.as_str()).unwrap_or("error");
    return Err(msg.to_string());
  }
  Ok(j)
}

// PicList HTTP 代理：在后端通过 reqwest 调用本地 PicList 内置服务器，避免前端 HTTP scope 限制
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PicListUploadReq {
  host: String,
  #[serde(default)]
  key: String,
  #[serde(default)]
  picbed: String,
  #[serde(default)]
  config_name: String,
  path: String,
}

#[tauri::command]
async fn flymd_piclist_upload(req: PicListUploadReq) -> Result<String, String> {
  use serde_json::Value;
  use url::form_urlencoded;

  fn enc_q(s: &str) -> String {
    form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>()
  }

  let mut host = req.host.trim().to_string();
  if host.is_empty() {
    return Err("PicList host 为空".into());
  }
  if !host.starts_with("http://") && !host.starts_with("https://") {
    host = format!("http://{}", host);
  }
  let mut url = format!("{}/upload", host.trim_end_matches('/'));

  let mut qs: Vec<String> = Vec::new();
  if !req.key.trim().is_empty() {
    qs.push(format!("key={}", enc_q(req.key.trim())));
  }
  if !req.picbed.trim().is_empty() {
    qs.push(format!("picbed={}", enc_q(req.picbed.trim())));
  }
  if !req.config_name.trim().is_empty() {
    qs.push(format!("configName={}", enc_q(req.config_name.trim())));
  }
  if !qs.is_empty() {
    url.push('?');
    url.push_str(&qs.join("&"));
  }

  let payload = serde_json::json!({
    "list": [req.path]
  });

  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(30))
    .build()
    .map_err(|e| format!("build client error: {e}"))?;

  let res = client
    .post(&url)
    .json(&payload)
    .send()
    .await
    .map_err(|e| format!("send error: {e}"))?;

  let status = res.status();
  let v: Value = res.json().await.map_err(|e| format!("json error: {e}"))?;

  if !status.is_success() {
    return Err(format!("HTTP {}: {}", status.as_u16(), v));
  }

  let ok = v
    .get("success")
    .and_then(|x| x.as_bool())
    .unwrap_or(false);
  if !ok {
    return Err(format!("PicList 返回失败: {}", v));
  }

  let url_field = v
    .get("result")
    .and_then(|r| {
      if r.is_array() {
        r.get(0)
      } else {
        Some(r)
      }
    })
    .and_then(|x| x.as_str())
    .ok_or_else(|| format!("PicList 响应缺少 result 字段: {}", v))?;

  Ok(url_field.to_string())
}

// 为插件提供的“全库 Markdown 扫描”命令：在给定根目录下递归枚举所有 md/markdown/txt 文件
#[tauri::command]
async fn flymd_list_markdown_files(root: String) -> Result<Vec<String>, String> {
  use std::fs;
  use std::path::{Path, PathBuf};

  let root_path = PathBuf::from(root.clone());
  if !root_path.is_dir() {
    return Err(format!("root 不是有效目录: {}", root));
  }

  // 在后台线程递归遍历，避免阻塞 async runtime
  let result = tauri::async_runtime::spawn_blocking(move || {
    fn walk_dir(dir: &Path, acc: &mut Vec<String>) -> Result<(), String> {
      let entries = fs::read_dir(dir)
        .map_err(|e| format!("read_dir error ({}): {}", dir.display(), e))?;
      for entry in entries {
        let entry = entry.map_err(|e| format!("read_dir entry error: {e}"))?;
        let path = entry.path();
        if path.is_dir() {
          walk_dir(&path, acc)?;
        } else if crate::is_markdown_like_path(&path) {
          if let Some(s) = path.to_str() {
            acc.push(s.to_string());
          }
        }
      }
      Ok(())
    }

    let mut acc = Vec::<String>::new();
    walk_dir(&root_path, &mut acc)?;
    Ok::<Vec<String>, String>(acc)
  })
  .await
  .map_err(|e| format!("join error: {e}"))??;

  Ok(result)
}

// 为插件提供的“任意目录列表”命令：用于兼容缺失 latest.json 时从快照目录推断最新备份
#[derive(serde::Serialize)]
struct FlymdDirEntryLite {
  name: String,
  path: String,
  is_dir: bool,
  is_file: bool,
}

#[tauri::command]
async fn list_dir_any(path: String) -> Result<Vec<FlymdDirEntryLite>, String> {
  use std::fs;
  use std::path::PathBuf;

  let dir = PathBuf::from(path.clone());
  if !dir.is_dir() {
    return Err(format!("path 不是有效目录: {}", path));
  }

  let entries = tauri::async_runtime::spawn_blocking(move || {
    let mut out: Vec<FlymdDirEntryLite> = Vec::new();
    let rd = fs::read_dir(&dir).map_err(|e| format!("read_dir error ({}): {}", dir.display(), e))?;
    for entry in rd {
      let entry = entry.map_err(|e| format!("read_dir entry error: {e}"))?;
      let p = entry.path();
      let ft = entry
        .file_type()
        .map_err(|e| format!("file_type error ({}): {e}", p.display()))?;
      let name = entry.file_name().to_string_lossy().to_string();
      out.push(FlymdDirEntryLite {
        name,
        path: p.to_string_lossy().to_string(),
        is_dir: ft.is_dir(),
        is_file: ft.is_file(),
      });
    }
    Ok::<Vec<FlymdDirEntryLite>, String>(out)
  })
  .await
  .map_err(|e| format!("join error: {e}"))??;

  Ok(entries)
}

fn main() {
  // 必须在任何 X 连接建立之前调用，让 Xlib 线程安全（否则 WebKitGTK 渲染线程
  // 与圆角 shape 的 X 调用竞争会触发 XCB 断言崩溃）。
  #[cfg(target_os = "linux")]
  init_x11_threads();
  #[cfg(target_os = "linux")]
  init_linux_render_env();

  let builder = tauri::Builder::default()
    .manage(PendingOpenPath::default())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_window_state::Builder::default().build());

  #[cfg(target_os = "macos")]
  let builder = builder.plugin(init_macos_open_plugin());

  // 桌面端：不使用原生 Menu（Linux/GTK 会在窗口顶部生成 menubar），
  // 所有菜单与快捷键入口统一放在前端 UI 内实现。
  //
  // 例外：Windows 上 PDF 预览使用 iframe 加载本地 PDF，键盘事件不会冒泡到主文档，
  // 仅靠前端监听容易失效；这里保留一个“隐藏菜单 + 原生加速键”，用于稳定呼出命令面板。
  #[cfg(all(desktop, target_os = "windows"))]
  let builder = builder
    .menu(|handle| {
      use tauri::menu::{Menu, MenuItem, Submenu};

      let menu = Menu::default(handle)?;
      let cmd = MenuItem::with_id(
        handle,
        "flymd.command_palette",
        "命令面板",
        true,
        Some("CmdOrCtrl+Shift+P"),
      )?;
      let sub = Submenu::with_id_and_items(handle, "flymd.menu", "FastNote", true, &[&cmd])?;
      menu.append_items(&[&sub])?;
      Ok(menu)
    })
    .on_menu_event(|app, event| {
      if event.id() != "flymd.command_palette" {
        return;
      }
      if let Some(win) = app.get_webview_window("main") {
        let _ = win.emit("flymd://command-palette", ());
      }
    });

  let builder = builder
    .invoke_handler(tauri::generate_handler![
        upload_to_s3,
        presign_put,
        flymd_record_uploaded_image,
        flymd_list_uploaded_images,
        flymd_delete_uploaded_image,
        flymd_imgla_list_albums,
        flymd_imgla_list_strategies,
        flymd_imgla_list_images,
        flymd_imgla_delete_image,
        flymd_imgla_upload,
        move_to_trash,
        force_remove_path,
        read_text_file_any,
        write_text_file_any,
        write_text_file_any_keep_mtime,
        list_dir_any,
      get_pending_open_path,
      http_xmlrpc_post,
      ai_novel_api,
      flymd_piclist_upload,
      flymd_list_markdown_files,
      check_update,
      download_file,
      git_status_summary,
      git_file_history,
      git_file_diff,
      git_init_repo,
      git_commit_snapshot,
      git_restore_file_version,
      run_installer,
      set_network_proxy,
      get_network_proxy,
      // Android SAF 命令
      android_pick_document,
      android_create_document,
      android_read_uri,
      android_write_uri,
      android_persist_uri_permission,
      get_cli_args,
      get_platform,
      get_virtual_screen_size,
      open_as_sticky_note
    ])
    .setup(|app| {
      init_startup_log(&app.handle());
      write_startup_log("[setup] begin");

      // Windows "打开方式/默认程序" 传入的文件参数处理
      #[cfg(target_os = "windows")]
      {
        use std::env;
        use std::path::PathBuf;
        let args: Vec<PathBuf> = env::args_os().skip(1).map(PathBuf::from).collect();
        if let Some(p) = args.into_iter().find(|p| crate::is_supported_doc_path(p)) {
          let app_handle = app.handle();
          dispatch_open_file_event(&app_handle, &p);
        }
      }
      // macOS：Finder 通过“打开方式/双击”传入的文件参数处理
      #[cfg(target_os = "macos")]
      {
        use std::env;
        use std::path::PathBuf;
        let args: Vec<PathBuf> = env::args_os().skip(1).map(PathBuf::from).collect();
        if let Some(p) = args.into_iter().find(|p| crate::is_supported_doc_path(p)) {
          let app_handle = app.handle();
          dispatch_open_file_event(&app_handle, &p);
        }
      }
      // 其它初始化逻辑
      if let Some(win) = app.get_webview_window("main") {
        // Windows：隐藏 menubar 但保留加速键（用于 PDF iframe 场景下也能呼出命令面板）。
        #[cfg(target_os = "windows")]
        {
          let _ = app.handle().hide_menu();
          let _ = win.hide_menu();
        }

        #[cfg(target_os = "windows")]
        {
          install_windows_maximized_resizable_workaround(&win);

          // Windows：默认等前端首屏就绪后自行 show。
          // 这里只保留一个兜底，防止前端异常时窗口永远不可见。
          let win_clone = win.clone();
          std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(2500));
            let _ = win_clone.show();
          });
        }
        #[cfg(not(target_os = "windows"))]
        {
          let _ = win.show();
          let _ = win.set_focus();
          // Linux：应用原生圆角形状（不依赖窗口透明合成）
          #[cfg(target_os = "linux")]
          install_linux_rounded_corners(&win);
        }
      }

      write_startup_log("[setup] end");
      Ok(())
    });

  builder
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[derive(Debug, Serialize)]
struct VirtualScreenSize {
  width: u32,
  height: u32,
  monitors: usize,
}

#[tauri::command]
async fn get_virtual_screen_size(app: tauri::AppHandle) -> Result<VirtualScreenSize, String> {
  // Android 暂不支持多屏信息：直接返回错误，前端回退到仅下限保护逻辑
  #[cfg(target_os = "android")]
  {
    let _ = app;
    return Err("virtual screen size not supported on android".into());
  }

  #[cfg(not(target_os = "android"))]
  {
    let monitors = app
      .available_monitors()
      .map_err(|e| format!("获取显示器信息失败: {e}"))?;
    if monitors.is_empty() {
      return Err("no monitors".into());
    }

    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;

    for m in &monitors {
      let pos = m.position();
      let size = m.size();
      if pos.x < min_x { min_x = pos.x; }
      if pos.y < min_y { min_y = pos.y; }
      let right = pos.x.saturating_add(size.width as i32);
      let bottom = pos.y.saturating_add(size.height as i32);
      if right > max_x { max_x = right; }
      if bottom > max_y { max_y = bottom; }
    }

    let width = max_x.saturating_sub(min_x).max(0) as u32;
    let height = max_y.saturating_sub(min_y).max(0) as u32;

    Ok(VirtualScreenSize {
      width,
      height,
      monitors: monitors.len(),
    })
  }
}

#[tauri::command]
async fn get_cli_args() -> Result<Vec<String>, String> {
  // 返回启动参数（去除可执行文件本身），用于 macOS 兜底打开文件
  use std::env;
  let args: Vec<String> = env::args_os()
    .skip(1)
    .map(|s| s.to_string_lossy().to_string())
    .collect();
  Ok(args)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAssetInfo {
  name: String,
  size: u64,
  direct_url: String,
  proxy_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckUpdateResp {
  has_update: bool,
  current: String,
  latest: String,
  release_name: String,
  notes: String,
  html_url: String,
  // Windows 推荐资产
  asset_win: Option<UpdateAssetInfo>,
  // Linux 双资产
  asset_linux_appimage: Option<UpdateAssetInfo>,
  asset_linux_deb: Option<UpdateAssetInfo>,
  // macOS 双资产（Intel / Apple Silicon）
  asset_macos_x64: Option<UpdateAssetInfo>,
  asset_macos_arm: Option<UpdateAssetInfo>,
}

fn norm_ver(v: &str) -> (i64, i64, i64, i64) {
  // 版本比较：major.minor.patch + 权重（fix>无后缀>预发行）
  let s = v.trim().trim_start_matches('v');
  let mut parts = s.splitn(2, '-');
  let core = parts.next().unwrap_or("");
  let suffix = parts.next().unwrap_or("").to_ascii_lowercase();
  let mut nums = core.split('.').take(3).map(|x| x.parse::<i64>().unwrap_or(0)).collect::<Vec<_>>();
  while nums.len() < 3 { nums.push(0); }
  let weight = if suffix.starts_with("fix") { 2 } else if suffix.is_empty() { 1 } else { 0 };
  (nums[0], nums[1], nums[2], weight)
}

fn is_better(a: &(i64,i64,i64,i64), b: &(i64,i64,i64,i64)) -> bool {
  // a > b ?
  a.0 > b.0 || (a.0==b.0 && (a.1 > b.1 || (a.1==b.1 && (a.2 > b.2 || (a.2==b.2 && a.3 > b.3)))))
}

#[derive(Debug, Deserialize)]
struct GhAsset {
  name: String,
  browser_download_url: String,
  size: Option<u64>,
  #[allow(dead_code)]
  content_type: Option<String>,
}
#[derive(Debug, Deserialize)]
struct GhRelease {
  tag_name: String,
  name: Option<String>,
  body: Option<String>,
  draft: bool,
  prerelease: bool,
  html_url: String,
  assets: Vec<GhAsset>,
}

fn gh_proxy_url(raw: &str) -> String {
  // 代理前缀：按“https://gh-proxy.comb/原始URL”拼接
  let prefix = "https://gh-proxy.com/";
  if raw.starts_with(prefix) { raw.to_string() } else { format!("{}{}", prefix, raw) }
}

fn os_arch_tag() -> (&'static str, &'static str) {
  let os = {
    #[cfg(target_os = "windows")] { "windows" }
    #[cfg(target_os = "linux")] { "linux" }
    #[cfg(target_os = "macos")] { "macos" }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))] { "other" }
  };
  let arch = {
    #[cfg(target_arch = "x86_64")] { "x86_64" }
    #[cfg(target_arch = "aarch64")] { "aarch64" }
    #[cfg(target_arch = "x86")] { "x86" }
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "x86")))] { "other" }
  };
  (os, arch)
}

fn match_linux_assets(assets: &[GhAsset]) -> (Option<&GhAsset>, Option<&GhAsset>) {
  // 返回 (AppImage, Deb)
  let mut appimage: Option<&GhAsset> = None;
  let mut deb: Option<&GhAsset> = None;
  for a in assets {
    let n = a.name.to_ascii_lowercase();
    // 排除 ARM 相关
    let is_arm = n.contains("arm64") || n.contains("aarch64") || n.contains("armv7");
    if is_arm { continue; }
    if n.ends_with(".appimage") && (n.contains("x86_64") || n.contains("amd64")) {
      if appimage.is_none() { appimage = Some(a); }
    } else if n.ends_with(".deb") && (n.contains("x86_64") || n.contains("amd64")) {
      if deb.is_none() { deb = Some(a); }
    }
  }
  (appimage, deb)
}

fn match_windows_asset(assets: &[GhAsset]) -> Option<&GhAsset> {
  for a in assets {
    let n = a.name.to_ascii_lowercase();
    let is_arm = n.contains("arm64") || n.contains("aarch64") || n.contains("armv7");
    if is_arm { continue; }
    if (n.ends_with(".exe") || n.ends_with(".msi")) && (n.contains("x64") || n.contains("x86_64") || n.contains("amd64")) {
      return Some(a);
    }
  }
  None
}

#[tauri::command]
async fn check_update(_force: Option<bool>, include_prerelease: Option<bool>) -> Result<CheckUpdateResp, String> {
  // 当前版本：与 tauri.conf.json 一致（构建时可由环境注入，这里直接读取 Cargo.toml 同步版本）
  let current = env!("CARGO_PKG_VERSION").to_string();
  let (os_tag, _arch_tag) = os_arch_tag();

  // 节流留空：简单实现始终请求（前端可决定调用频率）

  let url = "https://api.github.com/repos/flyhunterl/flymd/releases";
  let client = reqwest::Client::builder()
    .user_agent("flymd-updater")
    .timeout(Duration::from_secs(10))
    .build()
    .map_err(|e| format!("build client error: {e}"))?;
  let resp = client
    .get(url)
    .header("Accept", "application/vnd.github+json")
    .send().await.map_err(|e| format!("request error: {e}"))?;
  if !resp.status().is_success() { return Err(format!("http status {}", resp.status())); }
  let releases: Vec<GhRelease> = resp.json().await.map_err(|e| format!("json error: {e}"))?;
  let include_pre = include_prerelease.unwrap_or(false);
  let latest = releases.into_iter().find(|r| !r.draft && (include_pre || !r.prerelease))
    .ok_or_else(|| "no release found".to_string())?;

  // 统一版本号语义：从 tag_name 中剥离前缀 v，仅保留纯版本号（例如 v0.5.0 -> 0.5.0）
  let latest_tag = latest.tag_name.trim().trim_start_matches('v').to_string();
  let n_cur = norm_ver(&current);
  let n_new = norm_ver(&latest_tag);
  let has_update = is_better(&n_new, &n_cur);

  // 组装资产信息
  let mut asset_win = None;
  let mut asset_linux_appimage = None;
  let mut asset_linux_deb = None;
  let mut asset_macos_x64 = None;
  let mut asset_macos_arm = None;
  if os_tag == "windows" {
    if let Some(a) = match_windows_asset(&latest.assets) {
      asset_win = Some(UpdateAssetInfo{
        name: a.name.clone(),
        size: a.size.unwrap_or(0),
        direct_url: a.browser_download_url.clone(),
        proxy_url: gh_proxy_url(&a.browser_download_url),
      });
    }
  } else if os_tag == "linux" {
    let (ai, deb) = match_linux_assets(&latest.assets);
    if let Some(a) = ai {
      asset_linux_appimage = Some(UpdateAssetInfo{
        name: a.name.clone(),
        size: a.size.unwrap_or(0),
        direct_url: a.browser_download_url.clone(),
        proxy_url: gh_proxy_url(&a.browser_download_url),
      });
    }
    if let Some(a) = deb {
      asset_linux_deb = Some(UpdateAssetInfo{
        name: a.name.clone(),
        size: a.size.unwrap_or(0),
        direct_url: a.browser_download_url.clone(),
        proxy_url: gh_proxy_url(&a.browser_download_url),
      });
    }
  } else if os_tag == "macos" {
    let (x64, arm) = match_macos_assets(&latest.assets);
    if let Some(a) = x64 {
      asset_macos_x64 = Some(UpdateAssetInfo{
        name: a.name.clone(),
        size: a.size.unwrap_or(0),
        direct_url: a.browser_download_url.clone(),
        proxy_url: gh_proxy_url(&a.browser_download_url),
      });
    }
    if let Some(a) = arm {
      asset_macos_arm = Some(UpdateAssetInfo{
        name: a.name.clone(),
        size: a.size.unwrap_or(0),
        direct_url: a.browser_download_url.clone(),
        proxy_url: gh_proxy_url(&a.browser_download_url),
      });
    }
  }

  let notes = latest.body.unwrap_or_default();
  let name = latest.name.unwrap_or_else(|| latest_tag.clone());

  Ok(CheckUpdateResp{
    has_update,
    current,
    latest: latest_tag,
    release_name: name,
    notes,
    html_url: latest.html_url,
    asset_win,
    asset_linux_appimage,
    asset_linux_deb,
    asset_macos_x64,
    asset_macos_arm,
  })
}

#[tauri::command]
#[allow(unused_assignments)]
async fn download_file(url: String, use_proxy: Option<bool>) -> Result<String, String> {
  let client = reqwest::Client::builder()
    .user_agent("flymd-updater")
    .timeout(Duration::from_secs(120))
    .build()
    .map_err(|e| format!("build client error: {e}"))?;

  // 解析文件名
  let (direct, proxy) = {
    let u = url::Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?;
    let fname = u
      .path_segments()
      .and_then(|mut s| s.next_back())
      .unwrap_or("download.bin")
      .to_string();
        // 保存到用户下载目录（不可用时回退到临时目录）
    #[cfg(target_os = "windows")]
    let base_download = std::env::var("USERPROFILE")
      .map(|p| std::path::PathBuf::from(p).join("Downloads"))
      .unwrap_or_else(|_| std::env::temp_dir());
    #[cfg(not(target_os = "windows"))]
    let base_download = std::env::var("HOME")
      .map(|p| std::path::PathBuf::from(p).join("Downloads"))
      .unwrap_or_else(|_| std::env::temp_dir());
    let mut path = base_download.clone();
    path.push(&fname);
    let direct = (u, path);
    let proxy = (
      url::Url::parse(&gh_proxy_url(&url)).map_err(|e| format!("invalid proxy url: {e}"))?,
      base_download.join(&fname)
    );
    (direct, proxy)
  };

  // 下载函数
  async fn do_fetch(client: &reqwest::Client, url: &url::Url, save: &std::path::Path) -> Result<(), String> {
    let resp = client.get(url.clone()).send().await.map_err(|e| format!("request error: {e}"))?;
    if !resp.status().is_success() { return Err(format!("http status {}", resp.status())); }
    let mut f = std::fs::File::create(save).map_err(|e| format!("create file error: {e}"))?;
    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
      let bytes = chunk.map_err(|e| format!("read chunk error: {e}"))?;
      std::io::Write::write_all(&mut f, &bytes).map_err(|e| format!("write error: {e}"))?;
    }
    Ok(())
  }

  let want_proxy = use_proxy.unwrap_or(false);
  let mut last_err: Option<String> = None;
  if want_proxy {
    if let Err(e) = do_fetch(&client, &proxy.0, &proxy.1).await { last_err = Some(e); } else { return Ok(proxy.1.to_string_lossy().to_string()); }
    // 代理失败 -> 尝试直连
    if let Err(e) = do_fetch(&client, &direct.0, &direct.1).await { last_err = Some(e); } else { return Ok(direct.1.to_string_lossy().to_string()); }
  } else {
    if let Err(e) = do_fetch(&client, &direct.0, &direct.1).await { last_err = Some(e); } else { return Ok(direct.1.to_string_lossy().to_string()); }
    // 直连失败 -> 尝试代理
    if let Err(e) = do_fetch(&client, &proxy.0, &proxy.1).await { last_err = Some(e); } else { return Ok(proxy.1.to_string_lossy().to_string()); }
  }
  Err(last_err.unwrap_or_else(|| "download failed".into()))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitStatusSummary {
  is_repo: bool,
  repo_root: Option<String>,
  branch: Option<String>,
  head: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitCommitEntry {
  hash: String,
  summary: String,
  author: String,
  author_email: Option<String>,
  date: String,
}

fn git_command() -> std::process::Command {
  let mut cmd = std::process::Command::new("git");

  // Windows 下从 GUI 进程拉起 console 子进程时，可能会弹出一闪而过的 cmd/PowerShell 窗口。
  // 这不是“Git 插件”的业务逻辑问题，是进程创建的默认行为问题。
  // 这里统一加无窗口标志，不改变输出/行为，只消掉闪烁。
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }

  cmd
}

#[tauri::command]
async fn git_status_summary(repo_path: String) -> Result<GitStatusSummary, String> {
  let res = tauri::async_runtime::spawn_blocking(move || {
    use std::path::Path;

    let path = Path::new(&repo_path);
    if !path.exists() {
      return Ok::<GitStatusSummary, String>(GitStatusSummary {
        is_repo: false,
        repo_root: None,
        branch: None,
        head: None,
      });
    }

    let output = git_command()
      .args(["rev-parse", "--show-toplevel"])
      .current_dir(path)
      .output()
      .map_err(|e| format!("git rev-parse error: {e}"))?;

    if !output.status.success() {
      return Ok(GitStatusSummary {
        is_repo: false,
        repo_root: None,
        branch: None,
        head: None,
      });
    }

    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if root.is_empty() {
      return Ok(GitStatusSummary {
        is_repo: false,
        repo_root: None,
        branch: None,
        head: None,
      });
    }

    let mut branch: Option<String> = None;
    let mut head: Option<String> = None;

    let out_branch = git_command()
      .args(["rev-parse", "--abbrev-ref", "HEAD"])
      .current_dir(&root)
      .output()
      .map_err(|e| format!("git rev-parse --abbrev-ref error: {e}"))?;
    if out_branch.status.success() {
      let s = String::from_utf8_lossy(&out_branch.stdout).trim().to_string();
      if !s.is_empty() {
        branch = Some(s);
      }
    }

    let out_head = git_command()
      .args(["rev-parse", "HEAD"])
      .current_dir(&root)
      .output()
      .map_err(|e| format!("git rev-parse HEAD error: {e}"))?;
    if out_head.status.success() {
      let s = String::from_utf8_lossy(&out_head.stdout).trim().to_string();
      if !s.is_empty() {
        head = Some(s);
      }
    }

    Ok(GitStatusSummary {
      is_repo: true,
      repo_root: Some(root),
      branch,
      head,
    })
  })
  .await
  .map_err(|e| format!("join error: {e}"))?;

  res
}

#[tauri::command]
async fn git_restore_file_version(
  repo_path: String,
  file_path: String,
  commit: String,
) -> Result<(), String> {
  let res = tauri::async_runtime::spawn_blocking(move || {
    use std::fs;
    use std::path::PathBuf;

    let root = PathBuf::from(&repo_path);
    if !root.exists() {
      return Err("路径不存在".into());
    }

    let file = PathBuf::from(&file_path);
    if !file.exists() {
      return Err("目标文件不存在".into());
    }

    let rel = file.strip_prefix(&root).unwrap_or(&file);
    let rel_str = rel.to_string_lossy().replace('\\', "/");

    let output = git_command()
      .arg("show")
      .arg(format!("{commit}:{rel_str}"))
      .current_dir(&root)
      .output()
      .map_err(|e| format!("git show error: {e}"))?;
    if !output.status.success() {
      let msg = String::from_utf8_lossy(&output.stderr).to_string();
      return Err(if msg.is_empty() { "git show failed".into() } else { msg });
    }

    fs::write(&file, &output.stdout).map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(())
  })
  .await
  .map_err(|e| format!("join error: {e}"))?;

  res
}

#[tauri::command]
async fn git_file_history(
  repo_path: String,
  file_path: String,
  max_count: Option<u32>,
) -> Result<Vec<GitCommitEntry>, String> {
  let res = tauri::async_runtime::spawn_blocking(move || {
    use std::path::PathBuf;

    let root = PathBuf::from(&repo_path);
    if !root.exists() {
      return Ok::<Vec<GitCommitEntry>, String>(Vec::new());
    }
    let file = PathBuf::from(&file_path);
    let rel = file.strip_prefix(&root).unwrap_or(&file);

    let max = max_count.unwrap_or(50).max(1);

    let mut cmd = git_command();
    cmd.arg("log");
    cmd.arg(format!("--max-count={}", max));
    cmd.args([
      "--date=iso-strict",
      "--pretty=format:%H%x09%an%x09%ae%x09%ad%x09%s",
      "--",
    ]);
    cmd.arg(rel);

    let output = cmd
      .current_dir(&root)
      .output()
      .map_err(|e| format!("git log error: {e}"))?;
    if !output.status.success() {
      return Ok(Vec::new());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut items: Vec<GitCommitEntry> = Vec::new();
    for line in text.lines() {
      let t = line.trim();
      if t.is_empty() {
        continue;
      }
      let parts: Vec<&str> = t.split('\t').collect();
      if parts.len() < 5 {
        continue;
      }
      let hash = parts[0].trim().to_string();
      let author = parts[1].trim().to_string();
      let email_str = parts[2].trim();
      let date = parts[3].trim().to_string();
      let summary = parts[4].trim().to_string();
      let author_email = if email_str.is_empty() {
        None
      } else {
        Some(email_str.to_string())
      };
      items.push(GitCommitEntry {
        hash,
        summary,
        author,
        author_email,
        date,
      });
    }
    Ok(items)
  })
  .await
  .map_err(|e| format!("join error: {e}"))?;

  res
}

#[tauri::command]
async fn git_file_diff(
  repo_path: String,
  file_path: String,
  commit: Option<String>,
  context_lines: Option<u32>,
) -> Result<String, String> {
  let ctx = context_lines.unwrap_or(3);
  let commit_arg = commit.clone();

  let res = tauri::async_runtime::spawn_blocking(move || {
    use std::path::PathBuf;

    let root = PathBuf::from(&repo_path);
    if !root.exists() {
      return Ok::<String, String>(String::new());
    }
    let file = PathBuf::from(&file_path);
    let rel = file.strip_prefix(&root).unwrap_or(&file);

    let ctx_lines = if ctx == 0 { 1 } else { ctx };

    let mut cmd = git_command();
    if let Some(cmt) = commit_arg {
      cmd.arg("show");
      cmd.arg(format!("--unified={}", ctx_lines));
      cmd.arg(cmt);
      cmd.arg("--");
      cmd.arg(rel);
    } else {
      cmd.arg("diff");
      cmd.arg(format!("--unified={}", ctx_lines));
      cmd.arg("HEAD");
      cmd.arg("--");
      cmd.arg(rel);
    }

    let output = cmd
      .current_dir(&root)
      .output()
      .map_err(|e| format!("git diff error: {e}"))?;
    if !output.status.success() {
      return Ok(String::new());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
  })
  .await
  .map_err(|e| format!("join error: {e}"))?;

  res
}

#[tauri::command]
async fn git_init_repo(repo_path: String) -> Result<(), String> {
  let res = tauri::async_runtime::spawn_blocking(move || {
    use std::path::PathBuf;

    let root = PathBuf::from(&repo_path);
    if !root.exists() {
      return Err("路径不存在".into());
    }

    let output = git_command()
      .arg("init")
      .current_dir(&root)
      .output()
      .map_err(|e| format!("git init error: {e}"))?;
    if !output.status.success() {
      let msg = String::from_utf8_lossy(&output.stderr).to_string();
      return Err(if msg.is_empty() { "git init failed".into() } else { msg });
    }
    Ok(())
  })
  .await
  .map_err(|e| format!("join error: {e}"))?;

  res
}

#[tauri::command]
async fn git_commit_snapshot(
  repo_path: String,
  file_path: Option<String>,
  message: String,
  all: Option<bool>,
) -> Result<(), String> {
  let res = tauri::async_runtime::spawn_blocking(move || {
    use std::path::PathBuf;

    let root = PathBuf::from(&repo_path);
    if !root.exists() {
      return Err("路径不存在".into());
    }

    let scope_all = all.unwrap_or(false) || file_path.is_none();

    let mut add_cmd = git_command();
    add_cmd.arg("add");
    if scope_all {
      add_cmd.arg("--all");
    } else if let Some(fp) = &file_path {
      let file = PathBuf::from(fp);
      let rel = file.strip_prefix(&root).unwrap_or(&file);
      add_cmd.arg(rel);
    }
    let add_out = add_cmd
      .current_dir(&root)
      .output()
      .map_err(|e| format!("git add error: {e}"))?;
    if !add_out.status.success() {
      let msg = String::from_utf8_lossy(&add_out.stderr).to_string();
      return Err(if msg.is_empty() { "git add failed".into() } else { msg });
    }

    let mut commit_cmd = git_command();
    commit_cmd.arg("commit").arg("-m").arg(message);
    let commit_out = commit_cmd
      .current_dir(&root)
      .output()
      .map_err(|e| format!("git commit error: {e}"))?;
    if !commit_out.status.success() {
      let msg = String::from_utf8_lossy(&commit_out.stderr).to_string();
      if msg.contains("nothing to commit") {
        return Ok(());
      }
      return Err(if msg.is_empty() { "git commit failed".into() } else { msg });
    }

    Ok(())
  })
  .await
  .map_err(|e| format!("join error: {e}"))?;

  res
}

#[tauri::command]
async fn read_text_file_any(path: String) -> Result<String, String> {
  use std::fs::File;
  use std::io::Read;
  use std::path::PathBuf;

  let pathbuf = PathBuf::from(path);
  if !pathbuf.exists() {
    return Err("path not found".into());
  }

  // 后台线程读取，避免阻塞异步运行时
  let res = tauri::async_runtime::spawn_blocking(move || {
    let mut f = File::open(&pathbuf).map_err(|e| format!("open error: {e}"))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).map_err(|e| format!("read error: {e}"))?;
    let s = String::from_utf8_lossy(&buf).to_string();
    Ok::<String, String>(s)
  })
  .await
  .map_err(|e| format!("join error: {e}"))?;

  res
}

#[tauri::command]
async fn write_text_file_any(path: String, content: String) -> Result<(), String> {
  use std::fs;
  use std::path::PathBuf;

  let pathbuf = PathBuf::from(path);
  // 后台线程写入，避免阻塞异步执行器
  tauri::async_runtime::spawn_blocking(move || {
    if let Some(parent) = pathbuf.parent() {
      fs::create_dir_all(parent).map_err(|e| format!("create_dir_all error: {e}"))?;
    }
    fs::write(&pathbuf, content.as_bytes()).map_err(|e| format!("write error: {e}"))?;
    Ok::<(), String>(())
  })
  .await
  .map_err(|e| format!("join error: {e}"))??;

  Ok(())
}

// 写入任意文本文件，并把修改时间设为指定时间戳（毫秒）。
// 用途：日记与待办按「文件名日期 → front matter → mtime」定位当天条目；
// 若无日期文件被写在别的日子改名/改动，标记完成会刷新 mtime，条目就会从原日期
// 跳到今天。这里在改写正文后把 mtime 还原，保证日期不漂移。
#[tauri::command]
async fn write_text_file_any_keep_mtime(
  path: String,
  content: String,
  mtime_ms: Option<f64>,
) -> Result<(), String> {
  use std::fs;
  use std::path::PathBuf;

  let pathbuf = PathBuf::from(path);
  // 后台线程写入，避免阻塞异步执行器
  tauri::async_runtime::spawn_blocking(move || {
    if let Some(parent) = pathbuf.parent() {
      fs::create_dir_all(parent).map_err(|e| format!("create_dir_all error: {e}"))?;
    }
    fs::write(&pathbuf, content.as_bytes()).map_err(|e| format!("write error: {e}"))?;

    if let Some(ms) = mtime_ms.filter(|v| v.is_finite() && *v > 0.0) {
      let secs = (ms / 1000.0) as u64;
      let nanos = ((ms % 1000.0) * 1_000_000.0).round() as u32;
      let nanos = if nanos >= 1_000_000_000 { 999_999_999 } else { nanos };
      if let Some(t) = std::time::UNIX_EPOCH.checked_add(std::time::Duration::new(secs, nanos)) {
        // 失败不视为致命错误：内容已经写入，只是日期可能回退到 mtime
        let _ = filetime_set_mtime(&pathbuf, t);
      }
    }
    Ok::<(), String>(())
  })
  .await
  .map_err(|e| format!("join error: {e}"))??;

  Ok(())
}

// 设置文件修改时间（跨平台，不引入额外依赖）
#[cfg(unix)]
fn filetime_set_mtime(path: &std::path::Path, t: std::time::SystemTime) -> std::io::Result<()> {
  use std::os::unix::ffi::OsStrExt;
  let dur = t
    .duration_since(std::time::UNIX_EPOCH)
    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
  let times = [
    libc_timespec {
      tv_sec: dur.as_secs() as i64,
      tv_nsec: dur.subsec_nanos() as i64,
    },
    libc_timespec {
      tv_sec: dur.as_secs() as i64,
      tv_nsec: dur.subsec_nanos() as i64,
    },
  ];
  let cpath = std::ffi::CString::new(path.as_os_str().as_bytes())
    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
  extern "C" {
    fn utimensat(
      dirfd: std::os::raw::c_int,
      pathname: *const std::os::raw::c_char,
      times: *const libc_timespec,
      flags: std::os::raw::c_int,
    ) -> std::os::raw::c_int;
  }
  #[repr(C)]
  struct libc_timespec {
    tv_sec: i64,
    tv_nsec: i64,
  }
  // AT_FDCWD = -100：相对当前工作目录解析路径（这里传的是绝对路径）
  let rc = unsafe { utimensat(-100, cpath.as_ptr(), times.as_ptr(), 0) };
  if rc == 0 {
    Ok(())
  } else {
    Err(std::io::Error::last_os_error())
  }
}

#[cfg(windows)]
fn filetime_set_mtime(path: &std::path::Path, t: std::time::SystemTime) -> std::io::Result<()> {
  use std::os::windows::io::AsRawHandle;
  let f = std::fs::OpenOptions::new().write(true).open(path)?;
  let dur = t
    .duration_since(std::time::UNIX_EPOCH)
    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
  // FILETIME：自 1601-01-01 起的 100ns 数
  const EPOCH_DIFF_100NS: u64 = 116_444_736_000_000_000;
  let ticks = EPOCH_DIFF_100NS + dur.as_secs() * 10_000_000 + (dur.subsec_nanos() as u64) / 100;
  #[repr(C)]
  struct FileTime {
    low: u32,
    high: u32,
  }
  let ft = FileTime {
    low: (ticks & 0xffff_ffff) as u32,
    high: (ticks >> 32) as u32,
  };
  extern "system" {
    fn SetFileTime(
      handle: *mut std::os::raw::c_void,
      creation: *const FileTime,
      access: *const FileTime,
      write: *const FileTime,
    ) -> std::os::raw::c_int;
  }
  let handle = f.as_raw_handle() as *mut std::os::raw::c_void;
  let rc = unsafe { SetFileTime(handle, std::ptr::null(), std::ptr::null(), &ft) };
  if rc != 0 {
    Ok(())
  } else {
    Err(std::io::Error::last_os_error())
  }
}

// 前端兜底查询：获取并清空待打开路径，避免事件竞态丢失
#[tauri::command]
async fn get_pending_open_path(state: State<'_, PendingOpenPath>) -> Result<Option<String>, ()> {
  if let Ok(mut slot) = state.0.lock() {
    Ok(slot.take())
  } else {
    Ok(None)
  }
}

#[tauri::command]
async fn move_to_trash(path: String) -> Result<(), String> {
  // 使用 trash crate 跨平台移动到回收站
  tauri::async_runtime::spawn_blocking(move || {
    trash::delete(path).map_err(|e| format!("move_to_trash error: {e}"))
  })
  .await
  .map_err(|e| format!("join error: {e}"))??;
  Ok(())
}

#[tauri::command]
async fn force_remove_path(path: String) -> Result<(), String> {
  use std::fs;
  use std::path::PathBuf;
  let pathbuf = PathBuf::from(path);
  tauri::async_runtime::spawn_blocking(move || {
    if pathbuf.is_dir() {
      fs::remove_dir_all(&pathbuf).map_err(|e| format!("remove_dir_all error: {e}"))
    } else {
      fs::remove_file(&pathbuf).map_err(|e| format!("remove_file error: {e}"))
    }
  })
  .await
  .map_err(|e| format!("join error: {e}"))??;
  Ok(())
}

#[tauri::command]
async fn run_installer(_path: String) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    use std::process::Command;
    // 使用 PowerShell 以管理员权限启动安装程序
    let status = Command::new("powershell")
      .args([
        "-NoProfile",
        "-Command",
        "Start-Process",
        "-FilePath",
        &_path,
        "-Verb",
        "runas",
      ])
      .status()
      .map_err(|e| format!("spawn error: {e}"))?;
    let _ = status; // 忽略返回码，由安装器自行处理
    Ok(())
  }
  #[cfg(not(target_os = "windows"))]
  {
    Err("run_installer only supports Windows".into())
  }
}

// ============ Android SAF 文件操作命令（移动端专用） ============
// 这些命令在 Android 上通过 JNI 调用原生 SAF API
// 桌面版返回错误提示

#[tauri::command]
async fn android_pick_document() -> Result<String, String> {
  #[cfg(target_os = "android")]
  {
    // TODO: 实现 JNI 调用 Intent ACTION_OPEN_DOCUMENT
    // 返回 content:// URI
    Err("android_pick_document: JNI implementation pending".into())
  }
  #[cfg(not(target_os = "android"))]
  {
    Err("android_pick_document only available on Android".into())
  }
}

#[tauri::command]
async fn android_create_document(_filename: String, _mime_type: String) -> Result<String, String> {
  #[cfg(target_os = "android")]
  {
    // TODO: 实现 JNI 调用 Intent ACTION_CREATE_DOCUMENT
    // 返回 content:// URI
    let _ = filename;
    let _ = mime_type;
    Err("android_create_document: JNI implementation pending".into())
  }
  #[cfg(not(target_os = "android"))]
  {
    Err("android_create_document only available on Android".into())
  }
}

#[tauri::command]
async fn android_read_uri(_uri: String) -> Result<String, String> {
  #[cfg(target_os = "android")]
  {
    // TODO: 实现 JNI 调用 ContentResolver.openInputStream
    // 读取 URI 内容并返回文本
    let _ = uri;
    Err("android_read_uri: JNI implementation pending".into())
  }
  #[cfg(not(target_os = "android"))]
  {
    Err("android_read_uri only available on Android".into())
  }
}

#[tauri::command]
async fn android_write_uri(_uri: String, _content: String) -> Result<(), String> {
  #[cfg(target_os = "android")]
  {
    // TODO: 实现 JNI 调用 ContentResolver.openOutputStream
    // 写入内容到 URI
    let _ = uri;
    let _ = content;
    Err("android_write_uri: JNI implementation pending".into())
  }
  #[cfg(not(target_os = "android"))]
  {
    Err("android_write_uri only available on Android".into())
  }
}

#[tauri::command]
async fn android_persist_uri_permission(_uri: String) -> Result<(), String> {
  #[cfg(target_os = "android")]
  {
    // TODO: 实现 JNI 调用 takePersistableUriPermission
    // 持久化 URI 访问权限
    let _ = uri;
    Err("android_persist_uri_permission: JNI implementation pending".into())
  }
  #[cfg(not(target_os = "android"))]
  {
    Err("android_persist_uri_permission only available on Android".into())
  }
}

// 便签模式：以新实例打开文件并自动进入便签模式
#[tauri::command]
async fn open_as_sticky_note(path: String) -> Result<(), String> {
  use std::process::Command;
  use std::env;

  let exe = env::current_exe().map_err(|e| format!("获取可执行文件路径失败: {e}"))?;

  Command::new(exe)
    .arg("--sticky-note")
    .arg(&path)
    .spawn()
    .map_err(|e| format!("启动便签实例失败: {e}"))?;

  Ok(())
}

#[tauri::command]
async fn get_platform() -> Result<String, String> {
  // 返回当前平台标识，前端用于条件分支
  #[cfg(target_os = "android")]
  {
    Ok("android".into())
  }
  #[cfg(target_os = "windows")]
  {
    Ok("windows".into())
  }
  #[cfg(target_os = "linux")]
  {
    Ok("linux".into())
  }
  #[cfg(target_os = "macos")]
  {
    Ok("macos".into())
  }
  #[cfg(not(any(target_os = "android", target_os = "windows", target_os = "linux", target_os = "macos")))]
  {
    Ok("unknown".into())
  }
}

fn match_macos_assets(assets: &[GhAsset]) -> (Option<&GhAsset>, Option<&GhAsset>) {
  // 返回 (x64, arm64)；优先使用 macOS 专用包，避免误选 Windows 便携 ZIP
  let mut x64: Option<&GhAsset> = None;
  let mut arm: Option<&GhAsset> = None;
  for a in assets {
    let n = a.name.to_ascii_lowercase();
    // 仅考虑 macOS 常见包后缀：
    // - .dmg / .pkg：安装包
    // - .app.zip：打包后的 .app（避免把 Windows 便携版 zip 当成 mac 包）
    let is_macos_pkg = n.ends_with(".dmg") || n.ends_with(".pkg") || n.ends_with(".app.zip");
    if !is_macos_pkg { continue; }

    // 通用（universal）包：同时填充 x64 / arm，前端统一走“立即更新”
    let is_universal = n.contains("universal");
    if is_universal {
      if x64.is_none() { x64 = Some(a); }
      if arm.is_none() { arm = Some(a); }
      continue;
    }

    if (n.contains("arm64") || n.contains("aarch64")) && arm.is_none() {
      arm = Some(a);
      continue;
    }
    if (n.contains("x86_64") || n.contains("x64") || n.contains("amd64")) && x64.is_none() {
      x64 = Some(a);
      continue;
    }
  }
  (x64, arm)
}
