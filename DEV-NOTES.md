# FastNote 二次开发注意事项

本文档记录从 flyMD 派生为 FastNote 过程中的改动要点与约束，供后续维护参考。
日期：2026-09-24

---

## 一、产品与仓库

- 仓库名：`niuteng5618/FastNote`（由 omni-note 改名而来），本地 `origin` 已指向新地址。
- 产品名：**FastNote**（主打轻量、轻便）。界面可见处已全部改名，见下表。
- 版本号：`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 目前仍是 `1.4.4`，发版前需统一改（如 `1.0.0`）。
- 远程仓库是干净的单提交历史（「初始提交」），**本地保留完整 1662 次提交历史，与远程分叉**。推远程需 `git push --force`，不要随意 merge。

### 改名清单（已完成）

| 位置 | 内容 |
|---|---|
| `src-tauri/tauri.conf.json` | `productName: FastNote`、窗口 `title` |
| `tauri.linux.conf.json` / `tauri.macos.conf.json` | 窗口 `title` |
| `package.json` | `name: fastnote` |
| `index.html` | `<title>` |
| `src/main.ts` | OS 窗口标题后缀、配置备份文案 |
| `src/ui/aboutOverlay.ts` | 关于标题 |
| `src/i18n.ts` | 插件作者署名（第三方作者除外）、更新提示 |
| `src/extensions/runtime.ts` | 扩展版本提示 |
| `.github/workflows/*.yml` | 产物名全部改为 FastNote-xxx |

### 明确不能改的内部标识符（会丢数据/断功能）

- `identifier: "com.flymd"` —— 应用数据目录，改了设置、插件全失联。
- 所有 `flymd:` / `flymd.` / `flymd_` 前缀：localStorage 键、事件名、CSS 类、配置文件名（`flymd-settings.json`、`flymdconfig`）。
- `flymd_*` Rust 命令名、`flymd.tab-transfer.v1` 协议、文件关联 ProgID。
- 更新检查与插件市场 URL（`flyhunterl/flymd`、`flymd.llingfei.com`）——改了即断更新断市场，除非自建服务。

## 二、发布流程

- 工作流 `.github/workflows/build.yml`：
  - **推 `v*` 标签只编译 Windows**（用户需求：大部分场景 Windows）。
  - 手动触发（workflow_dispatch）可勾选「同时编译 Linux / macOS」，默认不编。
  - 已加 `permissions: contents: write`，否则创建 Release 时 403（v1.0.0 曾因此失败，安装包是用 `gh release` 手工补挂的）。
- 发版步骤：改三处版本号 → 提交 → 打 tag 推送 → 等 Actions → Release 为 **draft**，需手动 Publish。
- Windows 产物：`FastNote_x.y.z_x64-setup.exe`（NSIS 安装版）+ `FastNote_portable_x64.zip`（免安装绿色版，配便携模式使用）。
- macOS 产物未签名：用户需右键「打开」放行；正式分发需 Developer ID 签名 + 公证（Apple 开发者账号 $99/年）。

### v1.0.0/v1.0.1 发版踩坑（2026-09-25）

发 v1.0.0 时连续踩了三个坑，记录于此避免复发：

1. **job 级 `if` 不能引用 `matrix` 上下文** —— 曾写 `if: matrix.extra != false` 想「dispatch 时才跑 Linux/macOS」，但 GitHub 在 job 启动前评估 `if`，此时 `matrix` 不可用，导致**整个 workflow 解析失败**（所有 tag/dispatch 触发的构建 0s 即失败，Windows 也跟着死）。
   - **解法**：删掉 job 级 `if`，把 `workflow_dispatch && inputs.{linux,macos}` 条件下放到 Linux/macOS 各自的**依赖安装/编译/上传 step** 上；Windows step 不加条件，tag push 自然只编译 Windows。改动见 098c684 提交。
2. **portable zip 步骤写死 `FastNote.exe`** —— Tauri 二进制名取自 `Cargo.toml` 的 `[package] name = "flymd"`（内部标识符，不能改），实际产物是 `flymd.exe`，`FastNote.exe` 找不到 → portable zip 步骤 throw、job 失败（NSIS 安装包其实已正常生成）。
   - **解法**：workflow 里 exe 路径改为 `src-tauri/target/release/flymd.exe`；并在该行加注释说明二进制名为何是 flymd 而非 FastNote。改动见 89d08bb 提交。
3. **`softprops/action-gh-release@v1` 创建 Release 仍 403** —— 即便 `permissions: contents: write` 已加，该 action 仍报 403（疑似 action 版本/作用域问题）。
   - **解法**：不依赖该 action，改用 `gh api repos/<owner>/<repo>/releases --method POST` 建 Release + `gh release upload -R <owner>/<repo>` 传产物。注意 `gh` 不带 `-R` 时会按 git remote 顺序误打到 `flyhunterl/flymd` 上游仓库（`gh release create` 报 "already exists" 多半是打错 repo 了），**所有 release 命令都要带 `-R niuteng5618/FastNote`**。workflow 里的 `create-release` job 如要修，建议换成 `gh` CLI 步骤。

- **版本号不可重用**：远端已存在的 tag（哪怕指向孤儿提交）不能重新打同名 tag 发版——首次发 v1.0.0 时撞上远端已有的孤儿 v1.0.0 tag（旧「初始提交」），只能删旧 tag 重打。**下次发版直接递增（如 v1.0.1）更省事**，别碰已存在的 tag。
- **发版前必查**：`gh run list -R niuteng5618/FastNote --limit 3` 确认最新构建结论是 success 再发 Release；`gh api repos/niuteng5618/FastNote/releases` 确认没有残留 draft 再建。

## 三、界面交互改动（与原版 flyMD 的差异）

维护时注意这些行为是**本分支特意改的**，不要当作 bug 修回去：

1. **打开文件默认进入所见模式**（原版是阅读模式）。阅读模式仍在（Ctrl+R）但不再是默认。
2. **模式切换按钮在正文左下角**：`<`（侧边栏开关）+ 模式齿轮。点击齿轮向上弹出菜单：源码 / 所见 / 分屏，当前模式实心圆点标识。左侧 Ribbon 的模式按钮、扩展、关于、语言按钮均已移除。
3. **设置窗口**（`src/ui/settingsDialog.ts`）：左侧菜单（语言/主题/扩展/关于）+ 右侧内容区。主题面板、扩展对话框、关于浮层是**搬移进设置区的既有面板**，靠 `_settingsPanels` 持有引用——切换分区时面板会脱离文档，**不能用 `getElementById` 找它们**，必须走引用缓存，否则再次进入会空白。
4. **侧边栏**：常驻显示，仅左下角 `<` 按钮控制显隐（200ms JS 逐帧动画，滑出+正文让位同步）。悬停唤醒热区、点击外部收起、固定/浮动图钉、移到右侧等旧逻辑**已删除**。`setLibraryDocked`/`getLibraryDocked` 是空壳，仅供旧调用点不报错。
5. **分屏双向滚动**：任一侧滚动按比例带动另一侧，带 40ms 锁防抖。
6. **源码模式**：标题行按级别着色（覆盖层实现，`initSourceHeadingHighlight`）；行号在源码与分屏模式显示。
7. **检查更新**入口在「关于」标题行右侧（原 Ribbon 更新按钮已删）。
8. **语言切换即时生效**：`flymd:localeChanged` 事件触发三个面板销毁重建（`resetThemePanel` / `resetExtensionsPanel` / `resetAboutOverlay`），不用重启。
9. **扩展列表只渲染一次**：再次进入设置-扩展不重建 DOM，只有安装/卸载/更新才刷新。市场索引数据本身有本地缓存（默认 1 小时 TTL）。

## 四、平台与渲染（Linux 注意）

- **应用窗口是透明的**（`transparent: true` + 无边框），全界面圆角靠 `#app { border-radius: 14px }` + body 透明实现。
- **wry 的窗口透明只支持 X11，Wayland 下被忽略**（表现为圆角外露白底、看起来是直角）。
  - 解法：`src-tauri/src/main.rs` 的 `init_linux_render_env()` 强制 `GDK_BACKEND=x11`（走 XWayland），已有 `WEBKIT_DISABLE_DMABUF_RENDERER=1`。
  - 用户会话是 Wayland（VMware Ubuntu），如遇圆角失效先查这两个环境变量是否生效。
- 改 Rust 代码后 `npm run tauri:dev` 会重新编译（首次较慢）。
- 开发端口已从 5173 改为 **5391**（`vite.config.ts` + `tauri.conf.json devUrl`，两处必须一致）。

## 五、开发与调试

```bash
npm install && npm run tauri:dev   # 开发模式，改 src/ 自动热更新
```

- 需要 Rust（rustup）+ `libwebkit2gtk-4.1-dev` 等系统依赖。
- 本机 curl 记得 `--noproxy '*'`，环境有 http_proxy 会把 localhost 请求代理出去返回 503（假故障）。
- 调试 UI 可用 `playwright-cli`（chromium）直开 vite dev 页面验证 DOM/CSS；系统级截图在 Wayland 下用 `PrtSc` 键（X11 工具 xwd/import 不可用，GNOME dbus 截图接口被禁）。
- 本地残留文件：`LICENSE` 在工作区被删除未提交（GPL-3.0 义务问题待定夺，见下方风险）。

## 五点五、本次改动明细（按功能 → 文件）

> 行号为 2026-09-24 时点，后续改动会漂移，以函数名为准。

### 产品改名 FastNote
- `src-tauri/tauri.conf.json` — productName、窗口 title、devUrl(5391)
- `src-tauri/tauri.linux.conf.json` / `tauri.macos.conf.json` — 窗口 title
- `src-tauri/Cargo.toml` — description
- `package.json` / `package-lock.json` — name: fastnote
- `index.html` — `<title>`
- `src/main.ts` — OS 标题后缀、配置备份文案、启动日志
- `src/platform-integration.ts` — 移动端标题后缀
- `src/windows/editorWindows.ts` — 新窗口默认标题
- `src/ui/aboutOverlay.ts` — 关于标题
- `src/i18n.ts` / `src/extensions/runtime.ts` — 署名与提示文案
- `.github/workflows/build.yml` / `android-build.yml` — 产物命名

### 发版与 CI
- `.github/workflows/build.yml` — 加 `permissions: contents: write`；推 tag 只编 Windows，手动触发可勾选 Linux/macOS
- `.github/workflows/android-build.yml` — 产物改名

### 打开发布 v1.0.0
- `v1.0.0` tag 打在远程「初始提交」上；Release 及 6 个安装包由 `gh release create/upload` 手工完成（当时 workflow 缺权限失败）

### 开发体验
- `vite.config.ts` + `tauri.conf.json` — 开发端口 5173 → 5391

### 打开文件默认所见模式
- `src/main.ts` — `switchToPreviewAfterOpen()` 改为进所见（PDF 仍预览；「默认源码模式」设置优先）

### 左下角模式切换
- `src/main.ts` — DOM 加 `#mode-switch`（`<` 侧边栏按钮 + 模式齿轮 + 上拉菜单）；`initModeSwitch()`；删除旧 `btn-mode` 菜单绑定
- `src/theme.ts` — `initThemeUI()` 点击改为打开设置窗口；`ensureThemePanelReady` 改为 export
- `src/style.css` — `.mode-switch` / `.mode-pop` 样式

### 设置窗口（语言/主题/扩展/关于）
- `src/ui/settingsDialog.ts` — **新文件**，左菜单右内容
- `src/main.ts` — `initSettingsDialog` 回调把三个面板搬进右侧；`_settingsPanels` 引用缓存（关键：分区切换后面板脱离文档，不能 getElementById）；`flymd:localeChanged` 监听重建面板；Ribbon 删除扩展/关于/语言按钮
- `src/theme.ts` — `resetThemePanel()` export（语言切换重建）
- `src/extensions/extensionsPanel.ts` — `resetExtensionsPanel()` export
- `src/ui/aboutOverlay.ts` — 删除二维码/许可证/外链；标题行加「检查更新」；`resetAboutOverlay()` export

### 侧边栏行为重做
- `src/main.ts` — `showLibrary()` 重写：JS 逐帧 200ms 滑动动画（侧边栏+正文让位同一循环）；删悬停收起/点击外部收起/图钉固定/右移按钮/边缘热区；`btn-lib-collapse` 按钮与箭头切换；`libraryVisible` 为显隐唯一状态源
- `src/ui/librarySettingsDialog.ts` — 删「库切换位置」下拉及保存逻辑
- `src/style.css` — `.library` 过渡、`.mode-switch` 随正文让位移动

### 分屏
- `src/modes/sourcePreviewSplit.ts` — 滚动同步改为双向（比例同步 + 40ms 锁）

### 源码模式增强
- `src/main.ts` — `initSourceHeadingHighlight()` 标题行着色覆盖层
- `src/modes/sourceLineNumbers.ts` — 分屏模式也显示行号

### 所见模式光标衔接（Typora 交互遗留）
- `src/wysiwyg/v2/index.ts` — `wysiwygV2GetCaretMarkdownOffset` / `wysiwygV2FocusAtMarkdownOffset`（按比例近似映射）

### 应用外框圆角 + 主题组件
- `src/style.css` — 全局 radius 变量提到 8/12/16/20px；`body` 透明 + `#app` radius 14px；设置弹窗圆角；扩展卡片 `auto-fill minmax(300px,1fr)` 自适应、窄窗口三档降级；扩展工具条可换行；分类/渠道下拉加高；`.settings-content` 内面板去弹窗定位；扩展管理只渲染一次
- `src-tauri/src/main.rs` — `init_linux_render_env()` 加 `GDK_BACKEND=x11`（Wayland 下窗口透明/圆角失效的修复）

### 圆角改造（2026-09-24 二次）——Linux 原生兜底 + Windows 保持透明合成
- **背景**：无边框 + `transparent` 的圆角依赖合成器对窗口透明的支持；VMware + Wayland（即使强制 XWayland）常合成失败，表现为直角白底。改了几次 CSS 都无效，因为 CSS 只裁内容，背后的不透明窗口方块仍是直角。
- **Windows（主发行目标，保持不变）**：`transparent: true` + CSS（`clip-path: inset(0 round 14px)` + `#app { border-radius:14px }`）已能圆角，WebView2/DWM 合成 alpha 可靠。**不要动 Windows 这条路径**。
- **Linux（新增原生兜底）**：`src-tauri/src/main.rs` 新增 `build_rounded_region / apply_round_region / install_linux_rounded_corners`（均 `#[cfg(target_os="linux")]`）。用 gdk `shape_combine_region` 把 GTK 顶层窗口物理裁成 14px 圆角，**不依赖透明合成**，X11/XWayland/VM 都生效；最大化时传 `None` 复位为直角（与前端 `window-maximized` 类一致）；`connect_size_allocate` 里随尺寸变化重算。
  - 依赖：`src-tauri/Cargo.toml` 加 Linux-only `gtk / gdk / cairo-rs = "0.18"`（与 tauri 2 已锁定的传递依赖同版本，无新解析）。
  - 注意：shape region 是 X11 SHAPE 扩展能力，**依赖现有 `GDK_BACKEND=x11` 强制**（原生 Wayland 无 SHAPE 会失效）；半径 14px 与 CSS `--window-radius` 一致，合成可用时 CSS 提供抗锯齿边缘、兜底提供硬边圆角。
- **必读（踩过的坑）**：只加 shape region 会让应用**启动即崩**，报 `[xcb] Most likely this is a multi-threaded client and XInitThreads has not been called` + `poll_for_event: Assertion !xcb_xlib_threads_sequence_lost failed`。原因是 WebKitGTK 渲染线程与 shape 的 X 调用并发访问同一 X 连接。修法：`main()` 最前面（**任何 X 连接建立之前**）调用 `init_x11_threads()` → `XInitThreads()`（`#[link(name="X11")] extern "C"`，libX11 已由 GTK 传递链接，无需改 Cargo.toml）。**这段调用不能删、也不能挪到 GTK 初始化之后。**

### 日记与任务面板重构（2026-09-24）
- **文件**：`public/plugins/note-templates/main.js`（note-templates 扩展，保留原 ID / 开关 / 数据；开发态由 `src/extensions/pluginHost.ts` 的 `readPluginMainCode` 特判直接 fetch 该文件，改后需重载应用生效）。
- **数据模型未变（轻量、无新库）**：待办 = 全库 `.md` 里的 `- [ ] / - [x]`；日记 = 带日期 front matter 的笔记；日期来源 `@YYYY-MM-DD` → front matter date/created → 文件 mtime。
- `ntScanTasks` 扩展返回 `{ tasks, notes, dateStats }`：新增 `notes[]`（日记条目）与每日 `done/open` 计数（供日历着色 + 日记页）。
- `ntBuildCalendarGrid` 每个 cell 增加 `open/done/overdue/hasNote`，`overdue = 有未完成且日期 < 今天`。
- `ntOpenTasksPanel` 全量重写为**左历右列表 + 双 Tab（待办 / 日记）**：左侧紧凑月历（年/月下拉直接跳转 + 上/下月 + 今天 + 刷新），右侧待办表（未完成/已完成/逾期 颜色徽标）或日记列表（点开笔记）；日历用圆点表示当天待办状态（蓝=未完成/绿=已完成/红=逾期/紫=日记）。
- **交互 / 性能修复**：点日期只切换选中类 + 重渲染右侧列表（不再整表重建 + 重扫描，修卡顿）；关键词 160ms 防抖；农历/网格轻量化（去渐变/阴影/位移动画）。
- **保留**：推送到 xxtui、创建 xxtui 提醒、标记完成/未完成、全选、点标题打开文档；写今天的日记复用 `ntApplyTemplate('daily')`。
- **快速创建待办**：待办 Tab 顶部输入框 + 日期（默认取日历选中日/今天）+ 添加/回车 → 追加 `- [ ] 内容 @日期` 到 `<库根>/待办.md`（`getLibraryRoot()` + `write_text_file_any`），写后自动跳到该日期并刷新。
- **日记判定收紧**：只有带「显式日期」（front matter `date`/`created`）的笔记才算日记条目；`待办.md`、按 mtime 的普通笔记不再混入日记（待办本身仍按 mtime/`@date` 回退定位）。
- **主题**：面板改用真实主题变量（`--panel-bg/--fg/--border/--accent/...`），修掉原来 `--flymd-panel-bg` 不存在→暗色下永远白底的问题。

### 日记与任务面板 v2（2026-09-24 二次迭代，全在 `public/plugins/note-templates/main.js`）
- **日历改为「日程网格」**：左栏加宽为主区（`.nt-cal-col` flex:1），右栏收窄为固定 340px 详情列（`.nt-content-col`）；弹窗放大到 1040×680。每个日期单元格直接列出当天条目（`.nt-day-item`），最多 `MAX_CELL_ITEMS=3` 条，超出显示「+N 项/篇」（`.nt-day-more`）。
- **日历随 Tab 切换**：`setTab` 现在也 `renderCalendar()` + `renderLegend()`。待办 Tab → 单元格显示待办条目（未完成蓝 / 已完成绿+删除线 / 逾期红）；日记 Tab → 只显示紫色日记条目。**待办 Tab 不再显示日记紫点**（满足需求）。数据来自 `reloadTasks` 里新建的 `todosByDate` / `notesByDate` 索引。
- **右侧待办改为紧凑列表**（不再是 5 列表格，窄栏放不下）：`.nt-todo-item`（复选框 + 内容 + 状态徽标/日期/文档链接），左边框按状态着色。日记页仍是 `.nt-note-item` 列表。
- **选中态**改为强调边框 + 轻底色（不再实心填充），避免盖住单元格里的条目文字。
- 移除无用的 `.nt-cal-dots/.nt-dot*`、`.nt-task-table*` 样式与表格 DOM。
- **待办作用域＝按当前库**（已确认）：`getLibraryRoot()` 是当前激活库；`listLibraryFiles` 只扫当前库；快速添加写当前库根 `待办.md`。切库＝切一套待办/日记，不跨库聚合。

### 日记与待办面板 v3（2026-09-24 三次迭代）——从扩展迁移为内置功能 + 模板化新建

**这是当前实现，v1/v2 两节描述的 `public/plugins/note-templates/main.js` 已删除，仅作历史记录。**

- **内置化**：不再作为扩展加载。新目录 `src/diaryTasks/`（`lunar.ts` 农历/节气/月历、`scan.ts` 扫库、`templates.ts` 模板、`taskFiles.ts` 路径、`noteEditorDialog.ts` 编辑弹窗、`panel.ts` 面板、`settingsPanel.ts` 模板设置、`layers.ts` 弹窗层级栈、`diaryTasks.css`）。样式在 `main.ts` 里 `import`。
- **入口**：左侧 Ribbon 日历按钮 `#btn-diary-tasks`（名称为「日记与待办」/ Journals & Todos）。按钮由 `initDiaryTasks()` 在运行时创建并**用 MutationObserver 保持紧跟在「AI 助手」按钮下方**——插件按钮是启动后陆续注册、还会被菜单管理重排的，硬写在 DOM 模板里会被挤走；没有 AI 助手按钮时退回 `ribbon-top` 末尾。同时挂 `window.flymdOpenDiaryTasks`。
- **退役扩展**：`public/plugins/note-templates/` 已删除；`src/extensions/runtime.ts` 的 `RETIRED_PLUGIN_IDS` 过滤旧安装记录；`pluginHost.ts` 里对 `note-templates` 的 `public/` 特判、`extensionsPanel.ts` 的 `PLUGIN_I18N` 条目、`i18n.ts` 的 `ext.noteTemplates.*` 三处键一并移除。用户本地旧记录下次写回即自然清除。
- **存储路径（库根＝当前激活库）**：`<库根>/日记与待办/<年-月>/<年-月-日>-待办.md`、`.../<年-月-日>-日记.md`。顶层 `日记与待办/` 目录把自动生成的文件与用户笔记分开，避免污染文件树。`taskFiles.ts` 的 `DIARY_TASKS_DIR` 是唯一来源，拼路径自动识别 `\` / `/`。
- **写入与 mtime 保护（关键）**：`writeTaskFile(path, content, { keepMtimeMs })` 会优先调用后端命令 `write_text_file_any_keep_mtime`（`src-tauri/src/main.rs`，Linux 用 `utimensat`、Windows 用 `SetFileTime`），把 mtime 还原成写入前的值。
  - **为什么必须有**：没有显式日期的待办（例如用户自己笔记里的 `- [ ] xxx`）靠**文件 mtime** 定位日期。标记完成写文件会刷新 mtime → 条目日期变成「今天」→ 看起来就是「点了标记完成，条目从 23 号跳到了 24 号」。这是实际被用户报到的 bug，`keepMtimeMs` 是修复手段，**不要在标记完成/编辑保存时去掉它**。
  - 旧路径 `<库根>/<年-月>/` 下已存在的文件仍会被扫到（不丢数据），只是新建的内容写到新目录；不自动迁移。
- **写待办 / 写日记（不再是「添加待办」）**：面板右栏只剩一个按钮，文案随当天是否已有文件切换——没有文件显示「写待办 / 写日记」，已有文件显示「继续写待办 / 继续写日记」（`syncAddButton()`，数据来自扫描结果里的 `paths` 集合）。**同一天再点就是继续编辑同一份文件，不会新建第二个文档。**
- **弹窗（`noteEditorDialog.ts`）**：markdown textarea + 保存/取消，Ctrl+S 保存、Esc 取消、有改动时先确认关窗；标题区分「新建待办 / 编辑待办」。**日期是只读胶囊，不再提供日期选择器**（原来那个 `<input type=date>` 在无边框 Tauri 窗口里弹出后关不掉，且改日期等于换文件、容易把内容写错一天）；要换日期就先在日历里选。
- **保存后视图**：只更新选中日 + 年月下拉，**不重算 `currentMonth`**，避免视图从当前月份跳走。
- **模板可在系统中配置**：设置窗口左侧新增「模板」分区（`settingsUi` 的 `SettingsSection` 加 `'templates'`，在 `theme` 之后），可分别编辑**待办模板 / 日记模板**、恢复默认、保存。模板存 `flymd-settings.json` 的 `diaryTasks.templates`（走 `utils/sharedStore.ts` 的 `getSharedStore()`，随配置备份走）。变量：`{{date}} {{year}} {{month}} {{day}} {{datetime}} {{weekday}} {{lunar}} {{title}}`，未知变量原样保留。
- **模板极简原则**：用户看到的就是正文，日期由文件名承载，**模板里不需要任何日期字段**。
  - 日记默认模板只有 `## 今天做了什么` + `## 其他` 两节（7 行），不再有 `title/date/created` front matter——之前那套前置信息对用户来说是噪音。
  - 待办默认模板只有 `## 待办` + 一行 `- [ ] `。
  - 日记识别因此**改为先认文件名**：`-日记.md` 用文件名日期，其它笔记继续兼容 front matter 的 `date`/`created`（老数据不受影响）。别再要求日记模板写 `date:`。
  - 日记条目标题：front matter `title` → 正文第一个标题 → 文件名；这样没有 front matter 也能在列表/日历里显示可读标题。
- **数据模型（仍不新增存储）**：待办 = 全库 `.md` 的 `- [ ]` / `- [x]`（兼容 `*`）；日记 = **非 `-待办.md`** 且（front matter `date`/`created` 或**文件名以 `YYYY-MM-DD` 开头**）的笔记。待办日期回退链：行内 `@YYYY-MM-DD` → front matter → **文件名日期** → 文件 mtime；日记日期只用显式日期（front matter 或文件名），**不用 mtime**。
  - 这两条是刚需：新路径下的 `2026-09-24-待办.md` 若不算文件名日期，会被 mtime 统一算到「今天」，日历全挤在一起；反过来若不排除 `-待办.md`，日记 Tab 里会塞满待办文件。
  - 待办行号是**整文件行号**（带 front matter 时要加偏移），标记完成按行号直接改写原文件，否则会整体错位。
- **弹窗层级**：面板与编辑弹窗都会监听 Esc，`layers.ts` 维护一个栈，只有最上层响应 Esc / 遮罩点击，避免一次 Esc 关掉两层。
- **保留能力**：左历（flex:1）右详情（340px）+ 待办/日记双 Tab、日历随 Tab 重绘（待办 Tab 只显示待办条目、日记 Tab 只显示紫色日记条目）、单元格最多 3 条 + 「+N 项/篇」、年月下拉 / 上下月 / 今天 / 刷新、状态筛选 / 关键词 160ms 防抖 / 全选、标记完成·未完成、推送到 xxtui、创建提醒。
- **文案**：全部改走 `i18n.ts` 的 `diaryTasks.*`（约 70 键，zh/en 同步），不再用插件自带的 `ntText`/localStorage 语言探测。

### 设置窗口内弹窗被压在底下的层级修复（2026-09-24）

- **现象**：设置窗口（`.settings-overlay`，`position: fixed; z-index: 10000`）里点「图床管理 / WebDAV 同步」的设置按钮，弹窗（`.upl-overlay`，旧 z-index 65、`position: absolute` 挂在 `.container` 下）被压在设置窗口后面，要关掉设置才看得见。
- **修复（仅 `style.css` 3 处 z-index，不改结构）**：
  - `.link-overlay`：60 → **10010**（插入链接、重命名、检查更新 `#update-overlay`、插件菜单管理等）。
  - `.upl-overlay`：65 → **10020**（图床、WebDAV、同步日志、库设置）。
  - `#rename-overlay`：80 → **10030**（保持原相对顺序 link < upl < rename，重命名要盖住库设置）。
  - 全部高于设置窗口 10000，仍低于确认弹窗 99999、通知 999999、第三方插件设置弹窗（≥80000，本来就正常）。
- **同批排查结论**：设置窗口内会弹自家弹窗的按钮共三处——扩展管理两条内置项（图床/WebDAV）、关于页「检查更新」，均由本次修复覆盖；第三方插件设置弹窗 z ≥ 80000 不受影响。已知遗留：ai-assistant 插件的设置弹窗 `#ai-set-overlay`（z 100）在其停靠面板 `#ai-assist-win`（z 30）内时仍会被面板自身的层叠上下文压住，属插件内部问题，宿主侧无法干预。
- **注意**：`.upl-overlay` 现在（10020）高于命令面板（10001），两者同时开着时弹窗在上——模态弹窗居上属预期行为，勿把命令面板 z 调到 10020 以上。

### 库树右键菜单精简（2026-09-24）

- **文案**（`i18n.ts` 的 `ctx.*`，zh/en 同步）：`在此新建文档→新建文档`、`在此新建文件夹→新建目录`（新建目录弹窗的预填名同步改为「新建目录」）、`在资源管理器中打开→在资源管理器打开`、`移动到…→移动到`、`删除`改为红字（`#ef4444`，`mkItem` 加了可选颜色参数）。
- **排序入口 4 合 2**：只剩「按名称排序」「按修改时间排序」两项，菜单上**不显示方向**，点击即在正序/倒序间切换（i18n 键 `ctx.sortByName` / `ctx.sortByTime`）；当前为时间排序时点名称排序 → 默认进入名称正序，反之亦然。
- **默认排序改为 `mtime_asc`（按修改时间旧→新）**：`librarySort.ts` 的回退值、`fileTree.ts` 初始 `sortMode` 与兜底分支同步改。老用户 store 里已存的 `librarySort` 值仍优先生效。
- **删除「恢复当前文件夹排序」**：功能并入排序项——点任一排序项时顺带 `clearFolderOrderForParent`（右键目录为其自身，右键文件为其父目录）。原因：拖拽产生的手动顺序（`flymd:folderOrder`）对目录永远优先于全局排序，不清除的话切换排序在这些文件夹里「看起来不生效」。
- **顺手修了排序偏好从不持久化的原有 bug**：`main.ts` 里 `getLibrarySort()` / `setLibrarySort(mode)` 一直漏传 `store` 参数（签名要求 `store | null`），导致排序选择重启即丢、菜单永远显示默认值。现已改为 `getLibrarySort(store)` / `setLibrarySort(store, mode)`。

### 扩展管理列表不再显示内置功能（2026-09-24）

- **背景**：「图床管理」「WebDAV 同步」是写死在宿主里的功能（粘贴管线 / 启动关机钩子），并非真扩展；此前用 `builtinPlugins` 影子条目伪装成扩展显示在扩展管理列表（带 `(builtin)` 标签和设置按钮）。且插件市场（原作者控制）没有这两个插件，「删除内置、改为市场安装」不可行。
- **处理**：仅从扩展管理列表移除这两行（`extensionsPanel.ts`：删 `builtinPlugins` 数组、行渲染块、状态标签刷新块、统一排序赋值；`main.ts`：删无消费方的同名死数组），功能本身不动，**入口保留在左侧「插件」下拉菜单**（`pluginRuntimeHost.ts` 的 `addToPluginsMenu('builtin-webdav-sync' / 'builtin-uploader-s3')`）。
- **注意**：`i18n.ts` 的 `ext.builtin.*` 键要保留——插件菜单的条目名还在引用；`.upl-overlay` 等样式与图床无关（库设置/重命名等也在用），勿连带删除。老用户 store 里若残留 `uploader-s3` 的安装记录，`backfillInstalledAuthors` 的 `p.builtin` 守卫仍会跳过，无副作用。

## 六、待办 / 风险

- [ ] 版本号三处仍是 1.4.4，未与 tag 对齐。
- [ ] 本地全部改动未提交推送（改名、工作流、交互、圆角、Rust 环境变量等）。
- [ ] 库根旧 `待办.md`、旧目录 `<库根>/<年-月>/` 未自动迁移：都仍会被扫到（照常显示、可标记完成），只是新内容写到 `<库根>/日记与待办/<年-月>/`，需要时手工搬过去。
- [ ] `LICENSE` 已从仓库删除——原项目是 GPL-3.0 派生，**分发二进制时有 GPL 合规风险**，建议法律上确认后再决定。
- [ ] 关于页/更新弹层仍指向原作者链接（`update-extra.json`、许可证链接）；i18n 中部分第三方插件作者保留原名。
- [ ] iOS 未适配（需 macOS + Apple 开发者账号 + `tauri ios init`，无法像 APK 直接分发）。
