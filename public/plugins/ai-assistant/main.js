// AI 助手（Agent / tool_call 版）
// 定位：只做「填写待办、编写日记并自动生成对应文件」的智能体。
// - 纯自定义接口：OpenAI 兼容（/chat/completions）或 Anthropic 兼容（/v1/messages）
// - 以 tool_call 方式驱动：模型自行决定调用工具读取当前文件/库路径、写入待办/日记
// - 所有「写文件」工具在执行前都会在对话里弹确认卡片，用户点确认才落盘
// - UI：右下角浮动圆钮（FAB），点击展开对话弹窗，支持清屏 / 折叠
// - 文件落点复用宿主内置「日记与待办」目录规范与模板（window.flymdDiaryTasks 桥接）

const CFG_KEY = 'ai.config'
const SES_KEY = 'ai.session.default'
const MAX_TURNS = 6            // Agent 单次提问内最多的模型往返（防死循环）
const DEFAULT_MAX_CTX_CHARS = 24000

const DEFAULT_CFG = {
  apiFormat: 'openai',         // 'openai' | 'anthropic'
  baseUrl: '',
  apiKey: '',
  model: '',
  proxy: '',                   // 可选 HTTP 代理，如 http://127.0.0.1:7890（经 Tauri http 插件生效）
  maxCtxChars: DEFAULT_MAX_CTX_CHARS,
}

let __CTX__ = null
let __CFG__ = null
let __SESSION__ = { messages: [] }
let __OPEN__ = false
let __DISPOSERS__ = []
let __GREETED__ = false

// ========== 工具函数 ==========
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
function pad2(n) { return String(n).padStart(2, '0') }
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function isDateStr(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) }
function nowInfo() {
  const d = new Date()
  const wd = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()]
  return {
    date: todayStr(),
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    datetime: `${todayStr()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`,
    weekday: wd,
    timestamp: d.getTime(),
  }
}
function shortPath(p) {
  const s = String(p || '')
  const parts = s.split(/[/\\]/)
  return parts.slice(-3).join('/') || s
}
function toast(msg, level, ms) {
  try { __CTX__ && __CTX__.ui && __CTX__.ui.notice(String(msg), level || 'ok', ms || 2200) } catch {}
}

// ========== 配置存取 ==========
function normalizeCfg(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const fmt = c.apiFormat === 'anthropic' ? 'anthropic' : 'openai'
  return {
    apiFormat: fmt,
    baseUrl: typeof c.baseUrl === 'string' ? c.baseUrl : '',
    apiKey: typeof c.apiKey === 'string' ? c.apiKey : '',
    model: typeof c.model === 'string' ? c.model : '',
    proxy: typeof c.proxy === 'string' ? c.proxy : '',
    maxCtxChars: Number(c.maxCtxChars) > 0 ? Number(c.maxCtxChars) : DEFAULT_MAX_CTX_CHARS,
  }
}
async function loadCfg(context) {
  try { __CFG__ = normalizeCfg(await context.storage.get(CFG_KEY)) }
  catch { __CFG__ = normalizeCfg(null) }
  return __CFG__
}
async function saveCfg(context, cfg) {
  __CFG__ = normalizeCfg(cfg)
  try { await context.storage.set(CFG_KEY, __CFG__) } catch {}
  return __CFG__
}
async function loadSession(context) {
  try {
    const s = await context.storage.get(SES_KEY)
    if (s && Array.isArray(s.messages)) return { messages: s.messages }
  } catch {}
  return { messages: [] }
}
async function saveSession(context) {
  try { await context.storage.set(SES_KEY, { messages: __SESSION__.messages.slice(-40) }) } catch {}
}


// ========== 网络层（走 Tauri http 绕过 CORS，失败回退原生 fetch） ==========
function pickTauriHttpFetch() {
  try {
    const tauri = (globalThis && globalThis.__TAURI__) ? globalThis.__TAURI__ : null
    if (!tauri) return null
    if (tauri.plugin && tauri.plugin.http && typeof tauri.plugin.http.fetch === 'function') return tauri.plugin.http.fetch
    if (tauri.http && typeof tauri.http.fetch === 'function') return tauri.http.fetch
    return null
  } catch { return null }
}
async function aiFetch(url, options) {
  const tf = pickTauriHttpFetch()
  if (tf) {
    try {
      const opt = (options && typeof options === 'object') ? { ...options } : {}
      try { if (opt.signal) delete opt.signal } catch {}
      return await tf(url, opt)
    } catch {}
  }
  return await fetch(url, options)
}

// 自动检测 / 补全 endpoint：用户可只填域名，也可填完整路径
function resolveEndpoint(cfg) {
  const raw = String(cfg.baseUrl || '').trim().replace(/\s+/g, '')
  const clean = raw.replace(/\/+$/, '')
  if (!clean) return ''
  if (/\/chat\/completions$/i.test(clean)) return clean
  if (/\/messages$/i.test(clean)) return clean
  if (cfg.apiFormat === 'anthropic') {
    return /\/v1$/i.test(clean) ? clean + '/messages' : clean + '/v1/messages'
  }
  return /\/v1$/i.test(clean) ? clean + '/chat/completions' : clean + '/v1/chat/completions'
}
// 若 URL 已明确指向某协议，则以 URL 为准（避免用户选错格式）
function effectiveFormat(cfg) {
  const clean = String(cfg.baseUrl || '').trim().replace(/\/+$/, '')
  if (/\/messages$/i.test(clean)) return 'anthropic'
  if (/\/chat\/completions$/i.test(clean)) return 'openai'
  return cfg.apiFormat === 'anthropic' ? 'anthropic' : 'openai'
}
function buildHeaders(cfg, fmt) {
  const h = { 'Content-Type': 'application/json' }
  if (fmt === 'anthropic') {
    if (cfg.apiKey) h['x-api-key'] = cfg.apiKey
    h['anthropic-version'] = '2023-06-01'
  } else if (cfg.apiKey) {
    h['Authorization'] = 'Bearer ' + cfg.apiKey
  }
  return h
}


// ========== 工具定义（中立 schema，按格式转换） ==========
const TOOLS = [
  { name: 'get_current_time', readOnly: true, label: '获取当前日期与时间（年月日 时:分 星期）',
    description: '获取此刻的日期、时间与星期。需要“今天/现在几号几点星期几”时调用。',
    parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'get_workspace_context', readOnly: true, label: '读取当前文件路径、库目录、今日待办/日记是否已存在',
    description: '获取当前工作区信息：当前打开的文件路径与文件名、库根目录、今天日期与星期、今日待办/日记文件是否已存在。回答“当前文件/该存到哪”一类问题前应先调用。',
    parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'read_current_document', readOnly: true, label: '读取当前正在编辑的文档正文',
    description: '读取用户当前正在编辑的文档正文（可能被截断）。需要基于当前文件内容生成待办/日记时调用。',
    parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'list_todo_or_diary', readOnly: true, label: '查看某天已有的待办 / 日记内容',
    description: '读取某日期已有的待办或日记文件内容（默认今天）。写入前想先看看已有内容时调用。',
    parameters: { type: 'object', properties: {
      date: { type: 'string', description: '日期 YYYY-MM-DD，缺省为今天' },
      kind: { type: 'string', enum: ['todo', 'diary'], description: 'todo=待办, diary=日记' } }, required: ['kind'] } },
  { name: 'write_todos', write: true, label: '生成/追加待办，写入「日记与待办」目录（需确认）',
    description: '把待办事项写入 <库>/日记与待办/<年-月>/<日期>-待办.md（会请用户确认）。items 为纯文本任务，勿自带勾选框。',
    parameters: { type: 'object', properties: {
      date: { type: 'string', description: '日期 YYYY-MM-DD，缺省为今天' },
      items: { type: 'array', items: { type: 'string' }, description: '待办任务文本列表' },
      mode: { type: 'string', enum: ['append', 'replace'], description: 'append=追加(默认), replace=覆盖当天待办' } }, required: ['items'] } },
  { name: 'write_diary', write: true, label: '生成/追加日记，写入「日记与待办」目录（需确认）',
    description: '把日记正文写入 <库>/日记与待办/<年-月>/<日期>-日记.md（会请用户确认）。content 为完整 Markdown 正文。',
    parameters: { type: 'object', properties: {
      date: { type: 'string', description: '日期 YYYY-MM-DD，缺省为今天' },
      content: { type: 'string', description: '日记正文（Markdown）' },
      mode: { type: 'string', enum: ['append', 'replace'], description: 'replace=覆盖(默认), append=追加到当天日记' } }, required: ['content'] } },
]


// ========== 协议适配器：openai / anthropic ==========
function openaiTools() {
  return TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
}
function anthropicTools() {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
}
function safeParseArgs(s) {
  if (s && typeof s === 'object') return s
  try { return JSON.parse(String(s || '{}')) } catch { return {} }
}
const openaiAdapter = {
  buildBody(cfg, sys, messages) {
    return { model: cfg.model, messages: [{ role: 'system', content: sys }, ...messages],
      tools: openaiTools(), tool_choice: 'auto', temperature: 0.3, stream: false }
  },
  parse(data) {
    const m = (data && data.choices && data.choices[0] && data.choices[0].message) || {}
    const toolCalls = (m.tool_calls || []).map((tc) => ({ id: tc.id, name: tc.function && tc.function.name, args: safeParseArgs(tc.function && tc.function.arguments) }))
    return { text: String(m.content || ''), toolCalls, raw: m }
  },
  pushAssistant(messages, raw) { messages.push({ role: 'assistant', content: raw.content || '', tool_calls: raw.tool_calls || [] }) },
  pushToolResults(messages, results) { results.forEach((r) => messages.push({ role: 'tool', tool_call_id: r.id, content: r.content })) },
}
const anthropicAdapter = {
  buildBody(cfg, sys, messages) {
    return { model: cfg.model, system: sys, messages, tools: anthropicTools(), max_tokens: 2048, stream: false }
  },
  parse(data) {
    const blocks = (data && Array.isArray(data.content)) ? data.content : []
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('')
    const toolCalls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input || {} }))
    return { text, toolCalls, raw: blocks }
  },
  pushAssistant(messages, raw) { messages.push({ role: 'assistant', content: raw }) },
  pushToolResults(messages, results) { messages.push({ role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content })) }) },
}
function adapterOf(fmt) { return fmt === 'anthropic' ? anthropicAdapter : openaiAdapter }

async function performRequest(cfg, fmt, body) {
  const url = resolveEndpoint(cfg)
  if (!url) throw new Error('未配置 Base URL')
  const opt = { method: 'POST', headers: buildHeaders(cfg, fmt), body: JSON.stringify(body) }
  // 可选：经本地代理访问（仅 Tauri http 插件生效；浏览器 fetch 会忽略该字段）
  const proxy = String(cfg.proxy || '').trim()
  if (proxy) opt.proxy = { all: proxy }
  const res = await aiFetch(url, opt)
  if (!res.ok) {
    let msg = 'API 调用失败：HTTP ' + res.status
    try { const t = await res.text(); if (t) msg = t } catch {}
    throw new Error(msg)
  }
  try { return await res.json() } catch { throw new Error('响应不是有效 JSON') }
}


// ========== 工具执行 ==========
function getBridge() { try { return (typeof window !== 'undefined') ? window.flymdDiaryTasks : null } catch { return null } }
function getCurrentPath(context) {
  try { if (typeof context.getCurrentFilePath === 'function') return context.getCurrentFilePath() || null } catch {}
  try { if (window.flymdGetCurrentFilePath) return window.flymdGetCurrentFilePath() || null } catch {}
  return null
}
async function getRoot(context) {
  try { if (typeof context.getLibraryRoot === 'function') return await context.getLibraryRoot() } catch {}
  return null
}
function fallbackPath(root, kind, date) {
  const sep = String(root).includes('\\') ? '\\' : '/'
  const base = String(root).replace(/[\\/]+$/, '')
  const name = `${date}-${kind === 'todo' ? '待办' : '日记'}.md`
  return [base, '日记与待办', date.slice(0, 7), name].join(sep)
}
async function toolWorkspaceContext(context) {
  const cur = getCurrentPath(context)
  const root = await getRoot(context)
  const date = todayStr()
  const wd = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][new Date().getDay()]
  const bridge = getBridge()
  let todoExists = false, diaryExists = false
  try { if (bridge) { const t = await bridge.readFile('todo', date); todoExists = !!(t && t.content != null) } } catch {}
  try { if (bridge) { const d = await bridge.readFile('diary', date); diaryExists = !!(d && d.content != null) } } catch {}
  return {
    currentFilePath: cur || null,
    currentFileName: cur ? String(cur).split(/[/\\]/).pop() : null,
    libraryRoot: root || null,
    today: date, weekday: wd,
    todoFileExistsToday: todoExists, diaryFileExistsToday: diaryExists,
  }
}
function toolReadCurrent(context) {
  let text = ''
  try { text = String(context.getEditorValue ? (context.getEditorValue() || '') : '') } catch {}
  const max = (__CFG__ && __CFG__.maxCtxChars) || DEFAULT_MAX_CTX_CHARS
  if (text.length > max) text = text.slice(0, max) + '\n…(已截断)'
  return text || '(当前没有打开文档或文档为空)'
}
async function toolList(context, args) {
  const kind = args && args.kind === 'diary' ? 'diary' : 'todo'
  const date = isDateStr(args && args.date) ? args.date : todayStr()
  const bridge = getBridge()
  if (bridge) { const r = await bridge.readFile(kind, date); return JSON.stringify({ date, kind, path: r && r.path, content: (r && r.content) || null }) }
  const root = await getRoot(context)
  if (!root) return JSON.stringify({ date, kind, content: null, note: '未设置库目录' })
  const path = fallbackPath(root, kind, date)
  let content = null
  try { content = await context.invoke('read_text_file_any', { path }) } catch {}
  return JSON.stringify({ date, kind, path, content })
}


function fmtTodoLines(items) {
  return (items || []).map((s) => String(s || '').trim()).filter(Boolean)
    .map((s) => /^-\s*\[[ xX]\]/.test(s) ? s : `- [ ] ${s}`)
}
async function fallbackWrite(context, kind, date, args, mode) {
  const root = await getRoot(context)
  if (!root) throw new Error('未设置库目录，无法写入')
  const path = fallbackPath(root, kind, date)
  let existing = ''
  try { existing = String((await context.invoke('read_text_file_any', { path })) || '') } catch {}
  let body
  if (kind === 'todo') {
    const lines = fmtTodoLines(args.items).join('\n')
    body = (mode === 'replace' || !existing.trim())
      ? `## 待办\n\n${lines}\n`
      : existing.replace(/\n*$/, '') + '\n' + lines + '\n'
  } else {
    const text = String(args.content || '').replace(/\n*$/, '')
    body = (mode === 'append' && existing.trim())
      ? existing.replace(/\n*$/, '') + '\n\n' + text + '\n'
      : text + '\n'
  }
  await context.invoke('write_text_file_any', { path, content: body })
  return path
}
async function toolWrite(context, kind, args) {
  const bridge = getBridge()
  const date = isDateStr(args && args.date) ? args.date : todayStr()
  let path, preview, mode
  if (kind === 'todo') {
    const items = Array.isArray(args && args.items) ? args.items : []
    if (!items.length) return '没有待办内容可写入'
    mode = args && args.mode === 'replace' ? 'replace' : 'append'
    path = bridge ? await bridge.buildPath('todo', date) : fallbackPath(await getRoot(context), 'todo', date)
    preview = fmtTodoLines(items).join('\n')
  } else {
    const content = String((args && args.content) || '').trim()
    if (!content) return '没有日记内容可写入'
    mode = args && args.mode === 'append' ? 'append' : 'replace'
    path = bridge ? await bridge.buildPath('diary', date) : fallbackPath(await getRoot(context), 'diary', date)
    preview = content
  }
  const ok = await confirmWriteCard(kind, date, mode, path, preview)
  if (!ok) return '用户已取消，未写入任何文件。'
  let written
  if (bridge) {
    written = kind === 'todo' ? await bridge.writeTodos(date, args.items, mode) : await bridge.writeDiary(date, String(args.content || ''), mode)
  } else {
    written = await fallbackWrite(context, kind, date, args, mode)
  }
  toast('已写入 ' + shortPath(written), 'ok')
  return '已成功写入文件：' + written
}
async function executeTool(context, call) {
  const name = call && call.name
  const args = (call && call.args) || {}
  try {
    if (name === 'get_current_time') return JSON.stringify(nowInfo())
    if (name === 'get_workspace_context') return JSON.stringify(await toolWorkspaceContext(context))
    if (name === 'read_current_document') return toolReadCurrent(context)
    if (name === 'list_todo_or_diary') return await toolList(context, args)
    if (name === 'write_todos') return await toolWrite(context, 'todo', args)
    if (name === 'write_diary') return await toolWrite(context, 'diary', args)
    return '未知工具：' + name
  } catch (e) { return '工具执行失败：' + ((e && e.message) || e) }
}


// ========== 能力介绍 + system prompt ==========
// 简短问候（一两句）——首次打开 / 清屏后显示
const GREETING = '👋 我是 AI 助手。直接说需求即可，例如「根据当前文件帮我列今天的待办」。点上方「能力」查看全部工具。'

function systemPrompt() {
  const n = nowInfo()
  return [
    '你是 FastNote 里的 AI 助手，只负责两件事：帮用户整理待办、编写日记，并写入本地「日记与待办」目录。',
    `现在是 ${n.datetime} ${n.weekday}。需要精确时间请调用 get_current_time。`,
    '工作方式：优先用工具而不是空谈。',
    '- 需要基于“当前文件”时，先调用 get_workspace_context 获取当前文件路径，再用 read_current_document 读正文。',
    '- 生成待办用 write_todos，生成日记用 write_diary；不要把内容只贴在聊天里而不落盘（除非用户只是提问）。',
    '- 写文件工具会由系统弹窗请用户确认，你只管发起调用即可。',
    '- 待办项要短句、可执行；日记用自然中文 Markdown。',
    '- 与待办/日记无关的请求（翻译、润色、写代码等）礼貌说明你只做待办与日记。',
    '始终用简体中文回复。',
  ].join('\n')
}

// ========== Agent 主循环 ==========
async function runAgent(context, userText) {
  const cfg = await loadCfg(context)
  const fmt = effectiveFormat(cfg)
  if (!cfg.baseUrl) { addMessage('assistant', '⚠️ 还没配置 Base URL，请点右上角「设置」。'); return }
  if (!cfg.apiKey) { addMessage('assistant', '⚠️ 还没配置 API Key，请点右上角「设置」。'); return }
  if (!cfg.model) { addMessage('assistant', '⚠️ 还没填写模型名，请点右上角「设置」。'); return }

  const adapter = adapterOf(fmt)
  const pending = addMessage('assistant', '思考中…', { pending: true })
  const messages = __SESSION__.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.text }))

  try {
    let finalText = ''
    for (let i = 0; i < MAX_TURNS; i++) {
      const body = adapter.buildBody(cfg, systemPrompt(), messages)
      const data = await performRequest(cfg, fmt, body)
      const { text, toolCalls, raw } = adapter.parse(data)
      if (!toolCalls.length) { finalText = text || '(空回复)'; break }
      setMessageText(pending, text ? text + '\n\n_正在执行操作…_' : '_正在执行操作…_')
      adapter.pushAssistant(messages, raw)
      const results = []
      for (const call of toolCalls) results.push({ id: call.id, name: call.name, content: await executeTool(context, call) })
      adapter.pushToolResults(messages, results)
      if (i === MAX_TURNS - 1) finalText = text || '(已达到最大步数，请再说一次需求)'
    }
    // 移除“思考中”占位，把最终回复追加到底部（确保出现在确认卡片之后）
    try { pending && pending.remove() } catch {}
    addMessage('assistant', finalText)
  } catch (e) {
    setMessageText(pending, '⚠️ 请求失败：' + ((e && e.message) || e))
  }
}


// ========== UI：右下角 FAB + 对话弹窗 ==========
const STYLE_ID = 'ai-assistant-style'
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return
  const css = [
    '#ai-fab{position:fixed;right:16px;bottom:16px;width:40px;height:40px;border-radius:50%;',
    'background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;cursor:pointer;',
    'box-shadow:0 4px 14px rgba(99,102,241,.4);display:flex;align-items:center;justify-content:center;z-index:99998;transition:transform .15s}',
    '#ai-fab:hover{transform:scale(1.08)}',
    '#ai-pop{position:fixed;right:16px;bottom:64px;width:360px;height:520px;max-height:calc(100vh - 96px);',
    'background:#fff;color:#0f172a;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 40px rgba(2,6,23,.28);',
    'display:none;flex-direction:column;overflow:hidden;z-index:99999;font-size:14px}',
    '#ai-pop.open{display:flex}',
    '.ai-pop-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #eef2f7;background:#fafafa}',
    '.ai-pop-head .ai-title{font-weight:600;flex:1}',
    '.ai-pop-head button{border:none;background:transparent;color:#64748b;cursor:pointer;font-size:13px;padding:4px 6px;border-radius:6px}',
    '.ai-pop-head button:hover{background:#eef2f7;color:#0f172a}',
    '.ai-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;background:#fff}',
    '.ai-msg{max-width:88%;padding:9px 12px;border-radius:12px;line-height:1.55;white-space:normal;word-break:break-word}',
    '.ai-msg.user{align-self:flex-end;background:#6366f1;color:#fff;border-bottom-right-radius:4px}',
    '.ai-msg.assistant{align-self:flex-start;background:#f1f5f9;color:#0f172a;border-bottom-left-radius:4px}',
    // AI 回复内的 Markdown 排版
    '.ai-msg.assistant p{margin:.3em 0}',
    '.ai-msg.assistant>*:first-child{margin-top:0}.ai-msg.assistant>*:last-child{margin-bottom:0}',
    '.ai-msg.assistant h1,.ai-msg.assistant h2,.ai-msg.assistant h3,.ai-msg.assistant h4{margin:.5em 0 .3em;line-height:1.3}',
    '.ai-msg.assistant h1{font-size:1.25em}.ai-msg.assistant h2{font-size:1.15em}.ai-msg.assistant h3{font-size:1.05em}.ai-msg.assistant h4{font-size:1em}',
    '.ai-msg.assistant ul,.ai-msg.assistant ol{margin:.3em 0;padding-left:1.4em}.ai-msg.assistant li{margin:.15em 0}',
    '.ai-msg.assistant code{background:#e2e8f0;color:#be185d;padding:1px 5px;border-radius:4px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em}',
    '.ai-msg.assistant pre{background:#0f172a;color:#e2e8f0;padding:10px 12px;border-radius:8px;overflow-x:auto;margin:.4em 0}',
    '.ai-msg.assistant pre code{background:none;color:inherit;padding:0;font-size:.85em}',
    '.ai-msg.assistant blockquote{margin:.4em 0;padding:.2em .8em;border-left:3px solid #cbd5e1;color:#475569}',
    '.ai-msg.assistant a{color:#4f46e5;text-decoration:underline}',
    '.ai-msg.assistant hr{border:none;border-top:1px solid #e2e8f0;margin:.6em 0}',
    '.ai-msg.assistant strong{font-weight:600}',
    '.ai-msg.pending{opacity:.7}',
    '.ai-cap{max-width:100%;align-self:stretch;background:#f8fafc;border:1px solid #e5e7eb}',
    '.ai-cap-title{font-weight:600;margin-bottom:6px}',
    '.ai-cap-grid{display:grid;grid-template-columns:auto auto 1fr;gap:5px 8px;align-items:center;font-size:12.5px}',
    '.ai-cap-grid code{background:#eef2ff;color:#4338ca;padding:1px 6px;border-radius:5px;font-size:12px;white-space:nowrap;justify-self:start}',
    '.ai-cap-desc{color:#475569;line-height:1.4}',
    '.ai-cap-badge{width:22px;height:18px;line-height:18px;text-align:center;border-radius:5px;font-size:11px;color:#fff;justify-self:center}',
    '.ai-cap-badge.r{background:#0ea5e9}.ai-cap-badge.w{background:#f59e0b}',
    '.ai-cap-foot{margin-top:8px;font-size:12px;color:#94a3b8}',
    '.ai-confirm{align-self:stretch;max-width:100%;border:1px solid #fca5a5;background:#fff7f7;border-radius:12px;padding:10px 12px}',
    '.ai-confirm .t{font-weight:600;color:#b91c1c;margin-bottom:4px}',
    '.ai-confirm .p{font-size:12px;color:#64748b;margin-bottom:6px;word-break:break-all}',
    '.ai-confirm pre{max-height:180px;overflow:auto;background:#0f172a;color:#e2e8f0;padding:8px;border-radius:8px;font-size:12px;white-space:pre-wrap;margin:6px 0}',
    '.ai-confirm .btns{display:flex;gap:8px;justify-content:flex-end;margin-top:6px}',
    '.ai-confirm button{border:none;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:13px}',
    '.ai-confirm .ok{background:#16a34a;color:#fff}.ai-confirm .no{background:#e5e7eb;color:#334155}',
    '.ai-input-bar{border-top:1px solid #eef2f7;padding:8px;display:flex;gap:8px;align-items:flex-end;background:#fafafa}',
    '.ai-input-bar textarea{flex:1;resize:none;border:1px solid #e5e7eb;border-radius:10px;padding:8px 10px;font:inherit;max-height:120px;outline:none}',
    '.ai-input-bar textarea:focus{border-color:#6366f1}',
    '.ai-input-bar .send{border:none;background:#6366f1;color:#fff;border-radius:10px;padding:8px 14px;cursor:pointer}',
    '.ai-input-bar .send:disabled{opacity:.5;cursor:default}',
    '#ai-set-mask{position:fixed;inset:0;background:rgba(2,6,23,.4);z-index:100000;display:flex;align-items:center;justify-content:center}',
    '#ai-set-box{width:420px;max-width:92vw;background:#fff;border-radius:12px;padding:16px;box-shadow:0 12px 40px rgba(2,6,23,.3)}',
    '#ai-set-box h3{margin:0 0 12px}#ai-set-box .row{margin-bottom:10px;display:flex;flex-direction:column;gap:4px}',
    '#ai-set-box label{font-size:12px;color:#64748b}#ai-set-box input,#ai-set-box select{border:1px solid #e5e7eb;border-radius:8px;padding:7px 9px;font:inherit;outline:none}',
    '#ai-set-box .acts{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}',
    '#ai-set-box .acts button{border:none;border-radius:8px;padding:7px 16px;cursor:pointer}',
    '#ai-set-box .acts .save{background:#6366f1;color:#fff}#ai-set-box .acts .cancel{background:#e5e7eb;color:#334155}',
  ].join('')
  const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = css
  document.head.appendChild(st)
}


// 用户输入：纯文本（转义 + 换行），不做块级 markdown 解析以免误伤
function renderInline(text) {
  let h = escapeHtml(text)
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  h = h.replace(/\n/g, '<br>')
  return h
}
// AI 回复：轻量 Markdown → HTML（标题/列表/引用/代码块/行内代码/加粗/斜体/链接/删除线/分隔线）
function mdInline(text) {
  return String(text).split(/(`[^`]+`)/g).map((p) => {
    if (/^`[^`]+`$/.test(p)) return '<code>' + escapeHtml(p.slice(1, -1)) + '</code>'
    let h = escapeHtml(p)
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, t, u) => `<a href="${u.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">${t}</a>`)
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    h = h.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    h = h.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>')
    h = h.replace(/~~([^~]+)~~/g, '<del>$1</del>')
    return h
  }).join('')
}
function renderMarkdown(src) {
  const lines = String(src || '').split(/\r?\n/)
  const out = []
  let i = 0
  let list = null
  let para = []
  const flushList = () => { if (list) { out.push(`<${list.tag}>` + list.items.map((x) => `<li>${mdInline(x)}</li>`).join('') + `</${list.tag}>`); list = null } }
  const flushPara = () => { if (para.length) { out.push('<p>' + para.map(mdInline).join('<br>') + '</p>'); para = [] } }
  while (i < lines.length) {
    const line = lines[i]
    const fence = line.match(/^\s*```(\w*)\s*$/)
    if (fence) {
      flushPara(); flushList()
      const lang = fence[1]; const buf = []; i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++ }
      i++
      out.push(`<pre><code${lang ? ` class="language-${lang}"` : ''}>` + escapeHtml(buf.join('\n')) + '</code></pre>')
      continue
    }
    if (!line.trim()) { flushPara(); flushList(); i++; continue }
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/)
    if (h) { flushPara(); flushList(); const lv = h[1].length; out.push(`<h${lv}>` + mdInline(h[2]) + `</h${lv}>`); i++; continue }
    if (/^\s{0,3}(---|\*\*\*|___)\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); i++; continue }
    const bq = line.match(/^\s{0,3}>\s?(.*)$/)
    if (bq) {
      flushPara(); flushList(); const buf = [bq[1]]; i++
      while (i < lines.length) { const m = lines[i].match(/^\s{0,3}>\s?(.*)$/); if (!m) break; buf.push(m[1]); i++ }
      out.push('<blockquote>' + renderMarkdown(buf.join('\n')) + '</blockquote>'); continue
    }
    const ul = line.match(/^\s{0,3}[-*+]\s+(.*)$/)
    const ol = line.match(/^\s{0,3}\d+[.)]\s+(.*)$/)
    if (ul || ol) { flushPara(); const tag = ul ? 'ul' : 'ol'; if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] } } list.items.push(ul ? ul[1] : ol[1]); i++; continue }
    flushList(); para.push(line.trim()); i++
  }
  flushPara(); flushList()
  return out.join('')
}
function renderMsg(role, text) { return role === 'user' ? renderInline(text) : renderMarkdown(text) }
function msgsEl() { return document.querySelector('#ai-pop .ai-msgs') }
function scrollBottom() { const m = msgsEl(); if (m) m.scrollTop = m.scrollHeight }
function addMessage(role, text, opts) {
  opts = opts || {}
  const m = msgsEl(); if (!m) return null
  const div = document.createElement('div')
  div.className = 'ai-msg ' + (role === 'user' ? 'user' : 'assistant') + (opts.pending ? ' pending' : '')
  div.innerHTML = renderMsg(role, text)
  m.appendChild(div); scrollBottom()
  const persist = opts.persist !== false && !opts.pending
  if (persist) { __SESSION__.messages.push({ role, text, ts: Date.now() }); if (__CTX__) saveSession(__CTX__) }
  return div
}
function setMessageText(el, text) { if (!el) return; el.classList.remove('pending'); el.innerHTML = renderMarkdown(text); scrollBottom() }

function confirmWriteCard(kind, date, mode, path, preview) {
  return new Promise((resolve) => {
    const m = msgsEl(); if (!m) { resolve(false); return }
    const card = document.createElement('div')
    card.className = 'ai-confirm'
    const label = kind === 'todo' ? '待办' : '日记'
    const modeLabel = mode === 'replace' ? '覆盖' : '追加'
    card.innerHTML = [
      `<div class="t">⚠️ 请确认写入${label}（${modeLabel}）</div>`,
      `<div class="p">目标：${escapeHtml(path || '(未知路径)')} · 日期 ${escapeHtml(date)}</div>`,
      `<pre>${escapeHtml(preview)}</pre>`,
      '<div class="btns"><button class="no">取消</button><button class="ok">确认写入</button></div>',
    ].join('')
    m.appendChild(card); scrollBottom()
    let done = false
    const finish = (v) => { if (done) return; done = true; try { card.querySelector('.btns').innerHTML = v ? '<span style="color:#16a34a;font-size:12px">已确认 ✓</span>' : '<span style="color:#94a3b8;font-size:12px">已取消</span>' } catch {}; resolve(v) }
    card.querySelector('.ok').addEventListener('click', () => finish(true))
    card.querySelector('.no').addEventListener('click', () => finish(false))
  })
}

function clearScreen(context) {
  __SESSION__.messages = []
  saveSession(context)
  const m = msgsEl(); if (m) m.innerHTML = ''
  __GREETED__ = false
  showGreetingIfNeeded()
}
function showGreetingIfNeeded() {
  if (__GREETED__) return
  __GREETED__ = true
  addMessage('assistant', GREETING, { persist: false })
}
// 「能力」按钮：以工具清单的形式展示（读/写标签 + 工具名 + 说明），而非一段介绍文本
function showCapabilityCard() {
  const m = msgsEl(); if (!m) return
  const cells = TOOLS.map((t) => {
    const rw = t.write ? '<span class="ai-cap-badge w">写</span>' : '<span class="ai-cap-badge r">读</span>'
    return `${rw}<code>${escapeHtml(t.name)}</code><span class="ai-cap-desc">${escapeHtml(t.label || '')}</span>`
  }).join('')
  const div = document.createElement('div')
  div.className = 'ai-msg assistant ai-cap'
  div.innerHTML = `<div class="ai-cap-title">🧰 可用能力（工具）</div><div class="ai-cap-grid">${cells}</div><div class="ai-cap-foot">带「写」的工具会在执行前请你确认。</div>`
  m.appendChild(div); scrollBottom()
}


const FAB_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>'

function renderSessionToDom() {
  const m = msgsEl(); if (!m) return
  m.innerHTML = ''
  for (const msg of __SESSION__.messages) {
    const div = document.createElement('div')
    div.className = 'ai-msg ' + (msg.role === 'user' ? 'user' : 'assistant')
    div.innerHTML = renderMsg(msg.role, msg.text)
    m.appendChild(div)
  }
  scrollBottom()
}

function buildUI(context) {
  injectStyle()
  if (document.getElementById('ai-fab')) return
  const fab = document.createElement('button')
  fab.id = 'ai-fab'; fab.title = 'AI 助手'; fab.innerHTML = FAB_ICON
  fab.addEventListener('click', () => toggleWindow(context))
  document.body.appendChild(fab)

  const pop = document.createElement('div')
  pop.id = 'ai-pop'
  pop.innerHTML = [
    '<div class="ai-pop-head"><span class="ai-title">AI 助手</span>',
    '<button data-act="cap" title="能力介绍">能力</button>',
    '<button data-act="clear" title="清屏">清屏</button>',
    '<button data-act="set" title="设置">设置</button>',
    '<button data-act="close" title="折叠">✕</button></div>',
    '<div class="ai-msgs"></div>',
    '<div class="ai-input-bar"><textarea rows="1" placeholder="说出你的待办或日记需求…"></textarea>',
    '<button class="send">发送</button></div>',
  ].join('')
  document.body.appendChild(pop)

  pop.querySelector('[data-act="cap"]').addEventListener('click', () => showCapabilityCard())
  pop.querySelector('[data-act="clear"]').addEventListener('click', () => clearScreen(context))
  pop.querySelector('[data-act="set"]').addEventListener('click', () => openSettings(context))
  pop.querySelector('[data-act="close"]').addEventListener('click', () => closePopup())

  const ta = pop.querySelector('textarea')
  const send = pop.querySelector('.send')
  const doSend = async () => {
    const text = String(ta.value || '').trim()
    if (!text) return
    ta.value = ''; ta.style.height = 'auto'
    addMessage('user', text)
    send.disabled = true
    try { await runAgent(context, text) } finally { send.disabled = false; ta.focus() }
  }
  send.addEventListener('click', doSend)
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend() } })
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px' })
}

function openPopup(context) {
  buildUI(context)
  const pop = document.getElementById('ai-pop'); if (!pop) return
  pop.classList.add('open'); __OPEN__ = true
  if (!msgsEl().children.length) { renderSessionToDom(); showGreetingIfNeeded() }
  try { pop.querySelector('textarea').focus() } catch {}
}
function closePopup() { const pop = document.getElementById('ai-pop'); if (pop) pop.classList.remove('open'); __OPEN__ = false }
async function toggleWindow(context) { if (__OPEN__) closePopup(); else openPopup(context) }


// ========== 设置弹窗 ==========
export async function openSettings(context) {
  const cfg = await loadCfg(context)
  if (document.getElementById('ai-set-mask')) return
  const mask = document.createElement('div'); mask.id = 'ai-set-mask'
  mask.innerHTML = [
    '<div id="ai-set-box"><h3>AI 助手设置</h3>',
    '<div class="row"><label>接口格式</label><select id="ai-set-fmt">',
    '<option value="openai">OpenAI 兼容（/chat/completions）</option>',
    '<option value="anthropic">Anthropic 兼容（/v1/messages）</option></select></div>',
    '<div class="row"><label>Base URL（可只填到 /v1，也可填完整路径）</label><input id="ai-set-url" type="text" placeholder="http://127.0.0.1:9997/v1"/></div>',
    '<div class="row"><label>API Key</label><input id="ai-set-key" type="password" placeholder="sk-..."/></div>',
    '<div class="row"><label>模型名</label><input id="ai-set-model" type="text" placeholder="Qwen3.6-27B"/></div>',
    '<div class="row"><label>HTTP 代理（可选，留空则直连）</label><input id="ai-set-proxy" type="text" placeholder="http://127.0.0.1:7890"/></div>',
    '<div class="acts"><button class="cancel">取消</button><button class="save">保存</button></div></div>',
  ].join('')
  document.body.appendChild(mask)
  mask.querySelector('#ai-set-fmt').value = cfg.apiFormat
  mask.querySelector('#ai-set-url').value = cfg.baseUrl
  mask.querySelector('#ai-set-key').value = cfg.apiKey
  mask.querySelector('#ai-set-model').value = cfg.model
  mask.querySelector('#ai-set-proxy').value = cfg.proxy
  const close = () => { try { mask.remove() } catch {} }
  mask.addEventListener('click', (e) => { if (e.target === mask) close() })
  mask.querySelector('.cancel').addEventListener('click', close)
  mask.querySelector('.save').addEventListener('click', async () => {
    await saveCfg(context, {
      apiFormat: mask.querySelector('#ai-set-fmt').value,
      baseUrl: mask.querySelector('#ai-set-url').value,
      apiKey: mask.querySelector('#ai-set-key').value,
      model: mask.querySelector('#ai-set-model').value,
      proxy: mask.querySelector('#ai-set-proxy').value,
      maxCtxChars: cfg.maxCtxChars,
    })
    toast('已保存设置', 'ok'); close()
  })
}

// ========== 插件入口 ==========
export async function activate(context) {
  __CTX__ = context
  try { await loadCfg(context) } catch {}
  try { __SESSION__ = await loadSession(context) } catch {}
  try { buildUI(context) } catch (e) { console.error('[AI] buildUI failed', e) }

  try {
    const mi = context.addMenuItem({ label: 'AI 助手', title: '打开 AI 助手', onClick: () => toggleWindow(context) })
    if (typeof mi === 'function') __DISPOSERS__.push(mi)
  } catch {}
  try {
    if (context.addRibbonButton) {
      const rb = context.addRibbonButton({ icon: FAB_ICON, title: 'AI 助手', onClick: () => toggleWindow(context) })
      if (typeof rb === 'function') __DISPOSERS__.push(rb)
    }
  } catch {}
}

export function deactivate() {
  try { closePopup() } catch {}
  for (const d of __DISPOSERS__) { try { d() } catch {} }
  __DISPOSERS__ = []
  for (const id of ['ai-fab', 'ai-pop', 'ai-set-mask', STYLE_ID]) {
    try { const el = document.getElementById(id); if (el) el.remove() } catch {}
  }
  __CTX__ = null; __OPEN__ = false; __GREETED__ = false
}
