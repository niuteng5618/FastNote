


<p align="center">
  <a href="README.md">简体中文</a> | <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/niuteng5618/FastNote/releases/latest"><img src="https://img.shields.io/github/v/release/niuteng5618/FastNote" alt="GitHub Release" /></a>
  <a href="https://github.com/niuteng5618/FastNote/releases/latest"><img src="https://img.shields.io/github/release-date/niuteng5618/FastNote" alt="Release Date" /></a>
  <a href="https://github.com/niuteng5618/FastNote/actions/workflows/build.yml"><img src="https://github.com/niuteng5618/FastNote/actions/workflows/build.yml/badge.svg" alt="Build Status" /></a>
  <a href="https://github.com/niuteng5618/FastNote/stargazers"><img src="https://img.shields.io/github/stars/niuteng5618/FastNote" alt="GitHub Stars" /></a>
  <img src="https://img.shields.io/github/downloads/niuteng5618/FastNote/total" alt="GitHub Downloads" />
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-green" alt="License: GPL-3.0" /></a>
  <a href="https://github.com/niuteng5618/FastNote"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg" alt="Platform" /></a>
</p>

---

## 简介

FastNote 是一款轻量级、高性能的本地 Markdown 编辑器,支持 PDF 高精度解析、AI 待办/日记助手、日历与待办等功能。本地优先,数据安全可控,开箱即用。

> 本项目基于开源项目 [flymd](https://github.com/flyhunterl/flymd) 开发。

<img width="1920" height="1080" alt="hero" src="https://github.com/user-attachments/assets/acf758c1-6c8e-4b4f-a313-d4ce2190394b" />

<p align="center">
  <a href="https://github.com/niuteng5618/FastNote/releases/latest">下载桌面版（Windows / macOS / Linux）</a>
  ·
  <a href="https://github.com/niuteng5618/FastNote/releases?q=android&expanded=true">下载安卓版（Beta）</a>
</p>

## 目录

- [核心特性](#核心特性)
- [功能演示](#功能演示)
- [PDF高精度解析（插件）](#pdf高精度解析插件)
- [安卓版（Beta）](#安卓版beta)
- [快速开始](#快速开始)
- [扩展开发](#扩展开发)
- [性能与技术](#性能与技术)
- [社区与支持](#社区与支持)
- [其他信息](#其他信息)

---

## 核心特性

### 编辑体验

- **源码/所见双模式** - 双模式自由切换,源码模式支持分屏
- **毫秒级启动与渲染** - DOM 就绪仅需 5ms,实测 8 万字笔记无卡顿
- **智能大纲导航** - 目录大纲支持左右切换,快速定位长文档

### 高级功能

- **AI 助手** - Agent 式待办/日记助手,通过 tool_call 自动整理待办、编写日记并生成文件,支持自定义 OpenAI / Anthropic 兼容接口,回复支持 Markdown 渲染
- **全文搜索 / 知识库搜索** - 库侧栏快速搜索支持 `:关键词` 全文搜索与 `::关键词` 知识库语义搜索(需 RAG 知识库索引插件)
- **日历与待办** - 内置日记与待办,自动识别 TODO,按日/周/月汇总管理,并提供日记、会议纪要等模板
- **高精度 PDF/图片解析** - 解析为 MD 或 Docx 格式,支持翻译
- **一键发布** - 支持 Typecho / WordPress / Halo 博客平台
- **协同编辑** - 通过扩展插件实现多人实时协同(需安装"协同编辑"扩展)
- **Git 版本控制** - 文档接入 Git,支持状态查询、历史查看与显式提交
- **iframe 嵌入** - 支持音乐、视频、地图、在线文档等外部内容
- **标签与便签工具** - 标签右键支持新实例打开、重命名,一键生成桌面便签

> 💡 AI 助手扩展会在首次启动后后台静默安装;如卸载,将不会再次自动安装。
>
> ⚠️ AI 助手需在扩展设置中填写自定义的 OpenAI / Anthropic 兼容接口后使用。



### 平台与格式

- **全平台支持** - Windows / Linux / macOS
- **多格式导出** - PDF / DOCX（PDF 导出已针对分页断行做优化；极端情况下可用“打印”作为兜底）
- **便携模式** - 所有配置写入应用根目录,适合 U 盘携带

> [!WARNING]
> **Linux(Arch 系发行版)提示**
> - 在 Arch / Manjaro 等基于 Arch 的发行版上,AppImage 版本可能因 WebKitGTK 或显卡驱动导致白屏;
> - 推荐优先使用 deb 安装包,或从源码自行构建。
>
> 旧的 deb → debtap / PKGBUILD 转 pacman 方案已不再推荐使用。
>


### 数据安全

- **本地优先** - 零后台网络,数据安全可控
- **图床支持** - S3/R2/兰空图床/三方图床（插件） 一键上传,自动插入图片链接,支持右键上传指定图片
- **WebDAV 同步** - 多设备、多文档库同步,支持端到端加密与 HTTP 主机白名单
- **扩展插件系统** - 支持自定义扩展,功能无限可能

---

## 功能演示

### 文档脑图



<img width="1920" height="1032" alt="20260209_070600_876" src="https://github.com/user-attachments/assets/f62cafb4-881e-4b8a-b3d1-cf1650167043" />



### 按日期汇总待办事项

**一份会议纪要 / 旅行计划 / 个人笔记 → AI 拟定待办 → 按日/周/月汇总待办事项 → 提供日记、会议纪要等模板**

<img width="1065" height="726" alt="按日期汇总待办事项" src="https://github.com/user-attachments/assets/dd82577d-eebf-415b-bcd3-96dc3e23ac7e" />

---

## PDF高精度解析（插件）

**示例为高精度解析插件，同时提供MinerU解析插件，根据需求自行选择**

<img width="1074" height="765" alt="PDF高精度解析" src="https://github.com/user-attachments/assets/9d9a845f-e75a-4ad3-a7bb-274017f64165" />

<img src="https://github.com/user-attachments/assets/2a512b4b-7083-41d9-9b84-f9b411b849f1" alt="PDF高精度解析翻译" width="800">

---

## 安卓版（Beta）

**已适配插件**
- WebDAV同步
- Rag知识库
- 待办日记（日记/待办）
- typecho管理
- AI助手

### 录音转文字/语音输入

<img src="https://github.com/user-attachments/assets/815d5bc2-d367-451a-bfa5-f54f5cc91c5a" alt="录音转文字演示" width="400">

---




## 快速开始

### 安装

从 [Releases](https://github.com/niuteng5618/FastNote/releases) 下载对应平台安装包:

| 平台 | 安装方式 |
|------|----------|
| **Windows** | 下载安装包(NSIS)或免安装 portable 版 |
| **Linux** | 支持主流桌面环境,提供 deb / AppImage 安装包 |
| **macOS** | 支持 Intel 和 Apple Silicon |

<details>
<summary><strong>macOS 安装注意事项</strong></summary>

由于应用暂未进行 Apple 公证,首次安装可能提示"已损坏,无法打开"。

**方法 1:终端命令(推荐)**
```bash
sudo xattr -r -d com.apple.quarantine /Applications/FastNote.app
```

**方法 2:系统设置方式**
1. 打开 Finder,找到下载的应用
2. **按住 Control 键点击**应用图标,选择"打开"
3. 在弹出的对话框中点击"打开"按钮

> ⚠️ FastNote 是开源软件,代码完全透明,"已损坏"提示仅因未进行 Apple 代码签名。

</details>

### 核心操作

| 操作 | 快捷键 | 操作 | 快捷键 |
|------|--------|------|--------|
| 新建文件 | `Ctrl+N` | 切换所见模式 | `Ctrl+W` |
| 打开文件 | `Ctrl+O` | 切换编辑/预览 | `Ctrl+E` |
| 保存文件 | `Ctrl+S` | 专注模式 | `Ctrl+Shift+F` |
| 新建标签页 | `Ctrl+T` | 查找替换 | `Ctrl+H` |
| 命令面板 | `Ctrl+Shift+P` | 库侧栏搜索 | 点击搜索按钮 |

**多标签页操作**:
- `Ctrl+T` - 开启空白标签页
- `Ctrl+Tab` / `Ctrl+Shift+Tab` - 循环切换标签
- `Ctrl + 点击文库文档` - 新标签打开并进入源码模式
- `Alt+W` - 关闭当前标签页

**配置与迁移**:
- 导出/导入配置 - 一键迁移完整环境(包含扩展与设置)
- 便携模式 - 所有配置写入应用根目录

**图片与同步**:
- 粘贴/拖拽自动处理图片,支持 S3/R2 图床上传
- WebDAV 同步多设备、多文档库,支持端到端加密

**页面操作**:
- `Shift + 滚轮` - 调整内容区宽度(页边距)
- `Ctrl + 滚轮` - 放大文字和图片
- `Shift + 鼠标右键` - 呼出原生菜单(当右键菜单被插件占用时)

**库侧栏搜索**:
- 默认：直接输入关键字，过滤文件名/路径
- 全文搜索：输入 `:关键词`，按 Enter 开始(可点“继续深度搜索”扫全文)
- 知识库搜索：输入 `::关键词`，按 Enter 开始(需安装/启用 RAG 知识库索引插件并完成索引)

---

## 扩展开发

FastNote 拥有丰富的插件生态,支持通过扩展插件无限扩展功能。

### 精选插件

**AI 与写作**:
- **AI 助手** - Agent 式待办/日记助手,通过 tool_call 自动整理待办、编写日记并生成文件,支持自定义 OpenAI / Anthropic 兼容接口
- **小红书文案生成** - 接入 AI,内置小红书爆款风格,支持一键润色、扩写与自定义提示词模板

**文档处理**:
- **PDF 高精度解析** - 使用大模型高精度识别 PDF 为 Markdown 或 Docx,支持手写、布局、公式和表格识别
- **Markdown 表格助手** - 在光标处快速插入 Markdown 表格,提升结构化内容编辑效率

**发布**:
- **Typecho 博文管理** - 从 Typecho 拉取博文列表并下载为本地 Markdown,支持按时间/分类筛选,并支持从当前文档覆盖远端文章

**知识管理**:
- **双向链接（Backlinks）** - 基于 [[标题]] 语法自动建立笔记间的正向/反向链接,并提供 AI 关联推荐
- **关系图谱（Graph View）** - 基于双向链接索引构建关系图谱视图,以当前文档为中心展示局部关系网络
- **RAG 知识库索引** - 为本地 Markdown/TXT 构建向量索引,提供语义检索与 RAG 知识库支持,可与 AI 助手联动使用

> 👉 [查看所有插件](https://github.com/niuteng5618/FastNote)

### 安装扩展

- 从扩展市场一键安装
- 从 GitHub 或 HTTP URL 安装社区扩展
- 开发自定义扩展,满足个性化需求

📚 **开发文档**:[扩展开发文档 (中文)](plugin.md) | [Extension Documentation (English)](plugin.en.md)

---

## 性能与技术

### 性能指标

| 指标 | 数值 |
|------|------|
| ⚡ 冷启动 | ≤ 300ms |
| 📦 安装包体积 | ≤ 10MB |
| 💾 常驻内存 | ≤ 50MB |
| 🔄 预览切换 | ≤ 16ms |

### 技术栈与致谢

**核心技术**:

| 项目 | 用途 |
|------|------|
| [Tauri](https://tauri.app/) | 跨平台框架 |
| [MilkDown](https://milkdown.dev/) | 所见所得编辑器 |
| [markdown-it](https://github.com/markdown-it/markdown-it) | Markdown 渲染 |
| [DOMPurify](https://github.com/cure53/DOMPurify) | HTML 安全清洗 |
| [highlight.js](https://highlightjs.org/) | 代码高亮 |
| [KaTeX](https://katex.org/) | 数学公式渲染 |
| [Mermaid](https://mermaid.js.org/) | 图表绘制 |

---

## 社区与支持

### 贡献指南

欢迎提交 Issue 和 Pull Request!

---

## 其他信息

### 路线图

详见:[ROADMAP.md](ROADMAP.md)

### 许可协议

本项目基于 [GNU 通用公共许可证 第 3 版 (GPL-3.0)](LICENSE) 发布。

- ✅ **允许**：在遵守 GPL-3.0 的前提下，任何用途（包括商业用途）的使用、修改、复制与再分发
- ❗ **约束**：若分发本项目或修改版本（无论是否收费），必须开放对应源代码并保留版权与许可信息

完整许可证：[LICENSE](LICENSE) | 第三方组件：[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)

### 常见问题

<details>
<summary><strong>macOS 提示"已损坏,无法打开"怎么办?</strong></summary>

执行:`sudo xattr -r -d com.apple.quarantine /Applications/FastNote.app`,或按住 Control 键点击应用选择"打开"。

</details>



<details>
<summary><strong>右键菜单被插件占用了怎么办?</strong></summary>

使用 `Shift + 鼠标右键` 呼出原生菜单。

</details>

<details>
<summary><strong>如何放大文章或修改页边距?</strong></summary>

- `Shift + 滚轮` 调整内容区宽度(页边距)
- `Ctrl + 滚轮` 放大文字和图片

</details>

<details>
<summary><strong>所见模式支持 TODO 列表吗?</strong></summary>

目前不支持 `- [ ]`/`- [x]` 待办语法,请在源码/预览模式中编辑待办。

</details>
