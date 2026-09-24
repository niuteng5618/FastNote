// 所见模式 V2：基于 Milkdown 的真实所见编辑视图
// 暴露 enable/disable 与 setMarkdown/getMarkdown 能力，供主流程挂接

import { history } from '@milkdown/plugin-history'
import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx, editorViewCtx, commandsCtx, remarkStringifyOptionsCtx, parserCtx } from '@milkdown/core'
import { TextSelection, type Command } from '@milkdown/prose/state'
import { DOMParser as ProseDOMParser } from '@milkdown/prose/model'
import { convertFileSrc } from '@tauri-apps/api/core'
import { readFile } from '@tauri-apps/plugin-fs'
// 用于外部（main.ts）在所见模式下插入 Markdown（文件拖放时复用普通模式逻辑）
import { replaceAll, getMarkdown } from '@milkdown/utils'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { automd, inlineSyncConfig } from '@milkdown/plugin-automd'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { upload, uploadConfig } from '@milkdown/plugin-upload'
import { uploader } from './plugins/paste'
import { protectExcelDollarRefs, unprotectExcelDollarRefs } from '../../utils/excelFormula'
import { getPasteUrlTitleFetchEnabled } from '../../core/pasteUrlTitle'
import { getPasteRemoteImagesEnabled } from '../../core/pasteRemoteImages'
import { hasDownloadableMarkdownImages } from '../../core/htmlPasteImages'
import { guessSyncedDocImageAbsPath } from '../../utils/localImagePath'
import { resolveLocalImageAbsPathFromSrc } from '../../utils/localImageSrcResolve'
import { normalizeTabIndentText } from '../../utils/tabIndent'
import { getSymbolAutoCompletionEnabled } from '../../core/symbolAutoCompletion'
import { mermaidPlugin } from './plugins/mermaid'
import { mathInlineViewPlugin, mathBlockViewPlugin } from './plugins/math'
import { htmlMediaPlugin } from './plugins/htmlMedia'
import { maybeConvertHtmlTableBlocksToGfm } from './plugins/htmlTable'
import { guardStrongBoundaryForCommonMark, stripStrongBoundaryGuard } from '../../plugins/strongBoundaryCompat'
import { remarkMathPlugin, katexOptionsCtx, mathInlineSchema, mathBlockSchema, mathInlineInputRule, mathBlockInputRule } from '@milkdown/plugin-math'
import { liftListItem, sinkListItem } from 'prosemirror-schema-list'
import { deleteColumn, deleteRow } from 'prosemirror-tables'
// 注：保留 automd 插件以提供编辑功能，通过 CSS 隐藏其 UI 组件
// 引入富文本所见视图的必要样式（避免工具条/布局错乱导致不可编辑/不可滚动）
// 注：不直接导入 @milkdown/crepe/style.css，避免 Vite 对未导出的样式路径解析失败。

let _editor: Editor | null = null
let _root: HTMLElement | null = null
let _onChange: ((md: string) => void) | null = null
let _suppressInitialUpdate = false
let _lastMd = ''
let _imgObserver: MutationObserver | null = null
let _overlayTimer: number | null = null
let _overlayHost: HTMLDivElement | null = null
let _activeMermaidPre: HTMLElement | null = null
// 鼠标与光标分别记录，避免事件互相"顶掉"导致不渲染
// 优先级：光标所在（selection）优先于鼠标悬停（mouse）
let _activeMermaidPreBySelection: HTMLElement | null = null
let _activeMermaidPreByMouse: HTMLElement | null = null
// MutationObserver 用于监听 ProseMirror 清除我们插入的元素
let _mermaidObserver: MutationObserver | null = null
// 所见模式代码块复制按钮覆盖层
const _codeCopyWraps = new Map<HTMLElement, HTMLDivElement>()
let _codeCopyRaf: number | null = null
let _codeCopyHost: HTMLElement | null = null
let _codeCopyScrollHandler: (() => void) | null = null
let _codeCopyRoot: HTMLElement | null = null
let _codeCopyRootScrollCaptureHandler: (() => void) | null = null
let _codeCopyResizeObserver: ResizeObserver | null = null
let _codeCopyWindowResizeHandler: (() => void) | null = null
let _inlineCodeMouseTimer: number | null = null
let _rootMouseDownHandler: ((ev: MouseEvent) => void) | null = null

function hasDollarText(node: any): boolean {
  try { return String(node?.textContent || '').includes('$') } catch { return false }
}

function shouldSkipAutomdForDollar(payload: any): boolean {
  try {
    return hasDollarText(payload?.prevNode) ||
      hasDollarText(payload?.nextNode) ||
      String(payload?.text || '').includes('$')
  } catch {
    return false
  }
}

function isEscapedDollarSlash(text: string, slashIndex: number): boolean {
  if (text[slashIndex] !== '\\' || text[slashIndex + 1] !== '$') return false
  let count = 0
  for (let i = slashIndex; i >= 0 && text[i] === '\\'; i--) count++
  return (count & 1) === 1
}

function isEscapedDollar(text: string, dollarIndex: number): boolean {
  if (text[dollarIndex] !== '$') return false
  return dollarIndex > 0 && isEscapedDollarSlash(text, dollarIndex - 1)
}

function dollarContext(text: string, beforeEnd: number, afterStart: number): { before: string, after: string } {
  const size = 16
  const normalize = (s: string) => s.replace(/\\(?=\$)/g, '')
  return {
    before: normalize(text.slice(Math.max(0, beforeEnd - size), beforeEnd)),
    after: normalize(text.slice(afterStart, afterStart + size)),
  }
}

function contextMatchesEscapedDollar(
  token: { before: string, after: string },
  current: { before: string, after: string }
): boolean {
  const beforeOk = token.before.length >= 4 && token.before === current.before
  const afterOk = token.after.length >= 4 && token.after === current.after
  const shortOk = token.before === current.before && token.after === current.after
  return beforeOk || afterOk || shortOk
}

function restoreEscapedDollars(previousMd: string, nextMd: string): string {
  const prev = String(previousMd || '')
  const next = String(nextMd || '')
  if (!prev.includes('\\$') || !next.includes('$')) return next

  const tokens: Array<{ before: string, after: string, used: boolean }> = []
  for (let i = 0; i < prev.length - 1; i++) {
    if (!isEscapedDollarSlash(prev, i)) continue
    tokens.push({ ...dollarContext(prev, i, i + 2), used: false })
    i++
  }
  if (tokens.length < 1) return next

  let out = ''
  for (let i = 0; i < next.length; i++) {
    if (next[i] !== '$' || isEscapedDollar(next, i)) {
      out += next[i]
      continue
    }
    const current = dollarContext(next, i, i + 1)
    const token = tokens.find((item) => !item.used && contextMatchesEscapedDollar(item, current))
    if (token) {
      token.used = true
      out += '\\$'
    } else {
      out += '$'
    }
  }
  return out
}

async function applyHtmlTableToGfmIfEnabled(): Promise<void> {
  if (!_editor) return
  try {
    const mdNow = await (_editor as any).action(getMarkdown())
    const current = stripStrongBoundaryGuard(String(mdNow || ''))
    const next = maybeConvertHtmlTableBlocksToGfm(current)
    if (next !== current) {
      await (_editor as any).action(replaceAll(guardStrongBoundaryForCommonMark(next)))
    }
  } catch {}
}

// 主题面板开关：无需重启所见模式也能立即生效
try {
  if (typeof window !== 'undefined') {
    window.addEventListener('flymd:wysiwyg:htmlTableToMd', () => {
      void applyHtmlTableToGfmIfEnabled()
    })
  }
} catch {}

// 根据 DOM 元素删除 Milkdown 文档中的对应节点（仅用于所见模式内简易删除）
function deleteWysiwygNodeByDom(el: HTMLElement | null, typeNames: string[]): void {
  try {
    if (!_editor || !el || !typeNames.length) return
    void _editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { state } = view
      let pos: number
      try {
        pos = view.posAtDOM(el, 0)
      } catch {
        const parent = el.parentElement
        if (!parent) return
        try {
          pos = view.posAtDOM(parent, 0)
        } catch {
          return
        }
      }
      const $pos = state.doc.resolve(pos)
      for (let d = $pos.depth; d > 0; d--) {
        const node = $pos.node(d)
        const name = node.type?.name
        if (!name || !typeNames.includes(name)) continue
        const from = $pos.before(d)
        const to = $pos.after(d)
        view.dispatch(state.tr.delete(from, to).scrollIntoView())
        return
      }
    })
  } catch {}
}

function runWysiwygTableCommandByDom(target: HTMLElement | null, cmd: Command): boolean {
  try {
    const view = _getView()
    if (!view) return false
    const cell = target?.closest?.('td,th') as HTMLElement | null
    if (!cell) return false

    const state = view.state
    let pos = 0
    try {
      pos = view.posAtDOM(cell, 0)
    } catch {
      return false
    }

    const tr0 = state.tr.setSelection(TextSelection.near(state.doc.resolve(pos))) as any
    const st0 = state.apply(tr0)

    let nextTr: any | null = null
    const ok = cmd(st0 as any, (tr: any) => { nextTr = tr }, view)
    if (!ok || !nextTr) return false

    try { nextTr = nextTr.scrollIntoView() } catch {}
    view.dispatch(nextTr)
    try { view.focus() } catch {}
    return true
  } catch {
    return false
  }
}

// 所见模式：表格右键操作（基于当前右键命中的单元格）
export function wysiwygV2DeleteTableRow(target: HTMLElement | null): boolean {
  return runWysiwygTableCommandByDom(target, deleteRow as any)
}

export function wysiwygV2DeleteTableColumn(target: HTMLElement | null): boolean {
  return runWysiwygTableCommandByDom(target, deleteColumn as any)
}

function toLocalAbsFromSrc(src: string): string | null {
  try {
    if (!src) return null
    let s = String(src).trim()
    // 去掉 Markdown 尖括号 <...>
    if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1)
    // 尽量解码一次
    try { s = decodeURIComponent(s) } catch {}
    // data/blob/asset/http 跳过
    if (/^(data:|blob:|asset:|https?:)/i.test(s)) return null
    // file:// 解析
    if (/^file:/i.test(s)) {
      try {
        const u = new URL(s)
        let p = u.pathname || ''
        if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1)
        p = decodeURIComponent(p)
        if (/^[a-zA-Z]:\//.test(p)) p = p.replace(/\//g, '\\')
        return p
      } catch { /* fallthrough */ }
    }
    // Windows 盘符或 UNC
    if (/^[a-zA-Z]:[\\/]/.test(s)) return s.replace(/\//g, '\\')
    if (/^\\\\/.test(s)) return s.replace(/\//g, '\\')
    // 绝对路径（类 Unix）
    if (/^\//.test(s)) return s
    return null
  } catch { return null }
}

function fromFileUri(u: string): string | null {
  try {
    if (!/^file:/i.test(u)) return null
    const url = new URL(u)
    const host = url.hostname || ''
    let p = url.pathname || ''
    if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1)
    p = decodeURIComponent(p)
    if (host) {
      // UNC: file://server/share/path -> \\server\share\path
      const pathPart = p.replace(/^\//, '').replace(/\//g, '\\')
      return '\\' + '\\' + host + (pathPart ? '\\' + pathPart : '')
    }
    if (/^[a-zA-Z]:\//.test(p)) p = p.replace(/\//g, '\\')
    return p
  } catch { return null }
}
function isTauriRuntime(): boolean {
  try { return typeof (window as any).__TAURI__ !== 'undefined' } catch { return false }
}

function extractBaseUrlFromHtml(html: string): string | undefined {
  try {
    const m = String(html || '').match(/<base\s+href=["']([^"']+)["']/i)
    return m && m[1] ? m[1] : undefined
  } catch {
    return undefined
  }
}

function hasDownloadableHtmlImages(html: string, baseUrl?: string): boolean {
  try {
    if (!/<img\b/i.test(html || '')) return false
    const template = document.createElement('template')
    template.innerHTML = html
    const imgs = Array.from(template.content.querySelectorAll('img[src]')) as HTMLImageElement[]
    for (const img of imgs) {
      const raw = String(img.getAttribute('src') || '').trim()
      if (/^(data:image\/|https?:\/\/)/i.test(raw)) return true
      if (baseUrl) {
        try {
          const u = new URL(raw, baseUrl)
          if (/^https?:$/i.test(u.protocol)) return true
        } catch {}
      }
    }
  } catch {}
  return false
}

function insertHtmlAtSelection(view: any, html: string): boolean {
  try {
    const template = document.createElement('template')
    template.innerHTML = html
    const slice = ProseDOMParser.fromSchema(view.state.schema).parseSlice(template.content.cloneNode(true) as any)
    view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView())
    return true
  } catch {
    return false
  }
}

function insertMarkdownAtSelection(markdown: string): boolean {
  try {
    let inserted = false
    _editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const parser = ctx.get(parserCtx)
      const source = guardStrongBoundaryForCommonMark(String(markdown || ''))
      const slice = parser(source)
      if (!slice || typeof slice === 'string') {
        view.dispatch(view.state.tr.insertText(String(markdown || '')).scrollIntoView())
        inserted = true
        return
      }
      view.dispatch(view.state.tr.replaceSelection(slice as any).scrollIntoView())
      inserted = true
    })
    return inserted
  } catch {
    return false
  }
}

function rewriteLocalImagesToAsset() {
  try {
    const host0 = _root as HTMLElement | null
    const host = (host0?.querySelector('.ProseMirror') as HTMLElement | null) || host0
    if (!host) return

    const getCurrentFilePath = async (): Promise<string | null> => {
      try {
        const fn = (window as any).flymdGetCurrentFilePath
        const v = typeof fn === 'function' ? await fn() : null
        return typeof v === 'string' && v ? v : null
      } catch { return null }
    }

    const toDataUrl = async (
      abs0: string
    ): Promise<{ dataUrl: string; absPath: string } | null> => {
      try {
        let abs = abs0
        let bytes: Uint8Array | null = null
        try {
          bytes = (await readFile(abs as any)) as any
        } catch {
          bytes = null
        }
        if (!bytes) {
          const cur = await getCurrentFilePath()
          if (cur) {
            const remapped = guessSyncedDocImageAbsPath(cur, abs0)
            if (remapped && remapped !== abs0) {
              try {
                bytes = (await readFile(remapped as any)) as any
                abs = remapped
              } catch {
                bytes = null
              }
            }
          }
        }
        if (!bytes) return null
        const mime = (() => {
          const m = (abs || '').toLowerCase().match(/\.([a-z0-9]+)$/)
          switch (m?.[1]) {
            case 'jpg':
            case 'jpeg': return 'image/jpeg'
            case 'png': return 'image/png'
            case 'gif': return 'image/gif'
            case 'webp': return 'image/webp'
            case 'bmp': return 'image/bmp'
            case 'avif': return 'image/avif'
            case 'ico': return 'image/x-icon'
            case 'svg': return 'image/svg+xml'
            default: return 'application/octet-stream'
          }
        })()
        const blob = new Blob([bytes], { type: mime })
        const dataUrl = await new Promise<string>((resolve, reject) => {
          try {
            const fr = new FileReader()
            fr.onerror = () => reject(fr.error || new Error('读取图片失败'))
            fr.onload = () => resolve(String(fr.result || ''))
            fr.readAsDataURL(blob)
          } catch (e) { reject(e as any) }
        })
        return { dataUrl, absPath: abs }
      } catch { return null }
    }

    const convertOne = (imgEl: HTMLImageElement) => {
      try {
        const raw = imgEl.getAttribute('src') || ''
        // 记录原始 src，供所见模式图片编辑弹窗显示/编辑真实路径，而不是 base64
        if (!imgEl.getAttribute('data-flymd-src-raw')) {
          imgEl.setAttribute('data-flymd-src-raw', raw)
        }
        void (async () => {
          // 快路径：绝对路径/file:// 可同步识别，无需取 currentFilePath
          const absFast = toLocalAbsFromSrc(raw)
          if (absFast) {
            const r = await toDataUrl(absFast)
            if (r?.dataUrl) {
              try { imgEl.setAttribute('data-abs-path', r.absPath) } catch {}
              if (imgEl.src !== r.dataUrl) imgEl.src = r.dataUrl
            }
            return
          }

          // 相对路径：依赖当前文档路径作为 base
          const cur = await getCurrentFilePath()
          const abs = resolveLocalImageAbsPathFromSrc(raw, cur)
          if (!abs) return
          const r = await toDataUrl(abs)
          if (r?.dataUrl) {
            try { imgEl.setAttribute('data-abs-path', r.absPath) } catch {}
            if (imgEl.src !== r.dataUrl) imgEl.src = r.dataUrl
          }
        })()
      } catch {}
    }

    host.querySelectorAll('img[src]').forEach((img) => { try { convertOne(img as HTMLImageElement) } catch {} })

    if (_imgObserver) { try { _imgObserver.disconnect() } catch {} }
    _imgObserver = new MutationObserver((list) => {
      try {
        for (const m of list) {
          if (m.type === 'attributes' && (m.target as any)?.tagName === 'IMG') {
            const el = m.target as HTMLImageElement
            if (!m.attributeName || m.attributeName.toLowerCase() === 'src') convertOne(el)
          } else if (m.type === 'childList') {
            m.addedNodes.forEach((n) => {
              try {
                if ((n as any)?.nodeType === 1) {
                  const el = n as Element
                  if (el.tagName === 'IMG') { convertOne(el as any) }
                  el.querySelectorAll?.('img[src]')?.forEach((img) => { try { convertOne(img as HTMLImageElement) } catch {} })
                }
              } catch {}
            })
          }
        }
      } catch {}
    })
    _imgObserver.observe(host, { subtree: true, attributes: true, attributeFilter: ['src'], childList: true })
  } catch {}
}

function cleanupEditorOnly() {
  try { if (_imgObserver) { _imgObserver.disconnect(); _imgObserver = null } } catch {}
  try { cleanupCodeCopyOverlay() } catch {}
  if (_editor) {
    try { _editor.destroy() } catch {}
    _editor = null
  }
}

export async function enableWysiwygV2(root: HTMLElement, initialMd: string, onChange: (md: string) => void) {
  // 规范化内容：空内容也是合法的（新文档或空文档）
  const content0 = normalizeTabIndentText((initialMd || '').toString())
  const content = maybeConvertHtmlTableBlocksToGfm(content0)
  // 保护 Excel 公式里的 `$`，避免被 remark-math / 输入规则误识别为行内数学
  const contentForEditor = guardStrongBoundaryForCommonMark(protectExcelDollarRefs(content))
  console.log('[WYSIWYG V2] enableWysiwygV2 called, content length:', content.length)

  // 仅销毁旧编辑器与观察器，保留外层传入的 root（避免被移除导致空白）
  cleanupEditorOnly()
  _root = root
  _onChange = onChange
  _suppressInitialUpdate = true
  _lastMd = content

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, contentForEditor)
      // 配置编辑器视图选项，确保可编辑
      ctx.set(editorViewOptionsCtx, { editable: () => true })
      // 配置上传：接入现有图床上传逻辑，同时允许从 HTML 粘贴的文件触发上传
      try {
        ctx.update(uploadConfig.key, (prev) => ({
          ...prev,
          uploader,
          enableHtmlFileUploader: true,
        }))
      } catch {}
      // 统一 Markdown 序列化时的无序列表标记为 '-'，避免 Milkdown 默认改写为 '*'
      try {
        ctx.update(remarkStringifyOptionsCtx, (prev) => ({
          ...prev,
          bullet: '-',
        } as any))
      } catch {}
      try {
        ctx.update(inlineSyncConfig.key, (prev: any) => {
          const shouldSyncNode = typeof prev?.shouldSyncNode === 'function'
            ? prev.shouldSyncNode
            : null
          return {
            ...prev,
            shouldSyncNode: (payload: any) => {
              if (shouldSkipAutomdForDollar(payload)) return false
              return shouldSyncNode ? shouldSyncNode(payload) : false
            },
          }
        })
      } catch {}
    })
    .use(commonmark)
    .use(gfm)
    .use(upload)
    .use(remarkMathPlugin)
    .use(katexOptionsCtx)
    .use(mathInlineSchema)
    .use(mathBlockSchema)
    .use(mathInlineInputRule)
    .use(mathBlockInputRule)
    .use(mathInlineViewPlugin)
    .use(mathBlockViewPlugin)
    .use(mermaidPlugin)
    .use(htmlMediaPlugin)
    .use(automd)
    .use(listener)
    .use(history)
    .create()

  try { rewriteLocalImagesToAsset() } catch {}

  try { rewriteLocalImagesToAsset() } catch {}
  // 初次渲染后聚焦
  try {
    const view = (editor as any).ctx.get(editorViewCtx)
    requestAnimationFrame(() => { try { view?.focus() } catch {} })
  } catch {}
  // 初次渲染后重写本地图片为 asset: url（仅影响 DOM，不改 Markdown）
  try { setTimeout(() => { try { rewriteLocalImagesToAsset() } catch {} }, 0) } catch {}
  // 首次挂载后运行一次增强渲染（Mermaid 块）- 已由 Milkdown 插件自动处理
  // try { setTimeout(() => { try { scheduleMermaidRender() } catch {} }, 60) } catch {}
  // try { window.addEventListener('resize', () => { try { scheduleMermaidRender() } catch {} }) } catch {}
  // 成功创建后清理占位文案（仅移除纯文本节点，不影响编辑器 DOM）
  try {
    if (_root && _root.firstChild && (_root.firstChild as any).nodeType === 3) {
      _root.removeChild(_root.firstChild)
    }
  } catch {}
  // 兜底：确保编辑区可见且占满容器
  try {
    const pm = _root?.querySelector('.ProseMirror') as HTMLElement | null
    if (pm) {
      pm.style.display = 'block'
      pm.style.minHeight = '100%'
      pm.style.width = '100%'
      // 所见模式内：中英文括号/引号成对补全/跳过/成对删除（仅限 ProseMirror 视图）
      try { setupBracketPairingForWysiwyg(pm) } catch {}
      // 滚动时刷新覆盖渲染（重定位 Mermaid 预览块）- 已由 Milkdown 插件处理
      // try { pm.addEventListener('scroll', () => { try { scheduleMermaidRender() } catch {} }) } catch {}
      // 鼠标/光标触发 Mermaid 渲染（非实时）- 注释掉按需渲染，改用全局渲染
      // try { pm.addEventListener('mousemove', (ev) => { try { onPmMouseMove(ev as any) } catch {} }, true) } catch {}
      // try { document.addEventListener('selectionchange', () => { try { onPmSelectionChange() } catch {} }, true) } catch {} 
      // 双击 KaTeX / Mermaid / 图片 进入源码编辑
      try { pm.addEventListener('dblclick', (ev) => {
  const t = ev.target as HTMLElement | null;
  const mathHit = t?.closest?.("div[data-type='math_block']") || t?.closest?.("span[data-type='math_inline']");
  if (mathHit) { ev.stopPropagation(); try { enterLatexSourceEdit(mathHit as HTMLElement) } catch {}; return; }
  const imgHit = t?.closest?.('img');
  if (imgHit) { ev.stopPropagation(); try { enterImageSourceEdit(imgHit as HTMLElement) } catch {}; return; }
}, true) } catch {} 
      try {
        pm.addEventListener('keydown', (ev) => {
          try {
            const kev = ev as KeyboardEvent
            if (kev.key === 'ArrowRight') {
              if (exitInlineCodeToRight()) {
                kev.preventDefault()
                try { kev.stopPropagation() } catch {}
                try { (kev as any).stopImmediatePropagation?.() } catch {}
              }
              return
            }
            if (kev.key === 'Enter') {
              tryHandleMathEnter(kev)
            }
          } catch {}
        }, true)
      } catch {}
      // 所见模式内粘贴 URL：支持和编辑模式一致的“抓取网页标题并插入链接”行为
      try {
        pm.addEventListener('paste', (ev: ClipboardEvent) => {
          try {
            const dt = ev.clipboardData
            if (!dt) return
            const plainText = dt.getData('text/plain') || dt.getData('text') || ''
            const plainTrim = plainText.trim()
            let pasteCombo: 'normal' | 'plain' | null = null
            try {
              const v = (window as any).__flymdLastPasteCombo
              pasteCombo = (v === 'normal' || v === 'plain') ? v : null
              ;(window as any).__flymdLastPasteCombo = null
            } catch {}
            if (pasteCombo === 'normal' && getPasteUrlTitleFetchEnabled() && plainTrim && /^https?:\/\/[^\s]+$/i.test(plainTrim)) {
              ev.preventDefault()
              void handleWysiwygPasteUrl(plainTrim)
              return
            }

            const html = dt.getData('text/html') || ''
            const baseUrl = extractBaseUrlFromHtml(html)
            if (pasteCombo !== 'plain' && getPasteRemoteImagesEnabled() && plainText && hasDownloadableMarkdownImages(plainText, baseUrl)) {
              ev.preventDefault()
              try { ev.stopPropagation() } catch {}
              try { (ev as any).stopImmediatePropagation?.() } catch {}
              void (async () => {
                let noticeId = ''
                try {
                  const rewriter = (window as any).flymdRewriteMarkdownImages
                  const rewritten = typeof rewriter === 'function'
                    ? await rewriter(plainText, {
                        baseUrl,
                        forceLocal: true,
                        onProgress: (done: number, total: number) => {
                          if (!total) return
                          try {
                            const nm = (window as any).NotificationManager
                            if (!noticeId && nm?.show) noticeId = nm.show('extension', `正在下载图片 0/${total}`, 0)
                            if (noticeId && nm?.updateMessage) nm.updateMessage(noticeId, `正在下载图片 ${Math.min(done, total)}/${total}`)
                          } catch {}
                        },
                      })
                    : { markdown: plainText }
                  const text = String(rewritten?.markdown || plainText)
                  if (!insertMarkdownAtSelection(text)) {
                    const view = _getView()
                    if (view) view.dispatch(view.state.tr.insertText(text).scrollIntoView())
                  }
                } catch {
                  try {
                    const view = _getView()
                    if (view) view.dispatch(view.state.tr.insertText(plainText).scrollIntoView())
                  } catch {}
                } finally {
                  try {
                    const nm = (window as any).NotificationManager
                    if (noticeId && nm?.hide) nm.hide(noticeId)
                  } catch {}
                }
              })()
              return
            }

            if (pasteCombo !== 'plain' && getPasteRemoteImagesEnabled() && html && hasDownloadableHtmlImages(html, baseUrl)) {
              ev.preventDefault()
              try { ev.stopPropagation() } catch {}
              try { (ev as any).stopImmediatePropagation?.() } catch {}
              void (async () => {
                let noticeId = ''
                try {
                  let safe = html
                  try {
                    const mod: any = await import('dompurify')
                    const DOMPurify = mod?.default || mod
                    safe = DOMPurify.sanitize(html)
                  } catch {}
                  const rewriter = (window as any).flymdRewriteHtmlImages
                  const rewritten = typeof rewriter === 'function'
                    ? await rewriter(safe, {
                        baseUrl,
                        forceLocal: true,
                        onProgress: (done: number, total: number) => {
                          if (!total) return
                          try {
                            const nm = (window as any).NotificationManager
                            if (!noticeId && nm?.show) noticeId = nm.show('extension', `正在下载图片 0/${total}`, 0)
                            if (noticeId && nm?.updateMessage) nm.updateMessage(noticeId, `正在下载图片 ${Math.min(done, total)}/${total}`)
                          } catch {}
                        },
                      })
                    : { html: safe }
                  const view = _getView()
                  if (!view) return
                  const ok = insertHtmlAtSelection(view, String(rewritten?.html || safe))
                  if (!ok && plainText) {
                    view.dispatch(view.state.tr.insertText(plainText).scrollIntoView())
                  }
                } catch {
                  try {
                    const view = _getView()
                    if (view && plainText) view.dispatch(view.state.tr.insertText(plainText).scrollIntoView())
                  } catch {}
                } finally {
                  try {
                    const nm = (window as any).NotificationManager
                    if (noticeId && nm?.hide) nm.hide(noticeId)
                  } catch {}
                }
              })()
            }
          } catch {}
        }, true)
      } catch {}
      try { pm.addEventListener('mouseup', () => { try { scheduleInlineCodeMouseExit() } catch {} }, true) } catch {}
      try { pm.addEventListener('touchend', () => { try { scheduleInlineCodeMouseExit() } catch {} }, true) } catch {}
      try { setupCodeCopyOverlay(pm) } catch {}
    }
    const host = _root?.firstElementChild as HTMLElement | null
    if (host) {
      host.style.display = host.style.display || 'block'
      host.style.minHeight = host.style.minHeight || '100%'
      host.style.width = host.style.width || '100%'
    }
  } catch {}
  // 监听内容更新并回写给外层（用于保存与切回源码视图）
  try {
    const ctx = (editor as any).ctx
    const lm = ctx.get(listenerCtx)
    try {
      lm.docChanged((_ctx) => {
        if (_suppressInitialUpdate) return
        // scheduleMermaidRender() // 已由 Milkdown 插件处理
        try { scheduleMathBlockReparse() } catch {}
      })
    } catch {}
    lm.markdownUpdated((_ctx, markdown) => {
      if (_suppressInitialUpdate) return
      // 统一 Windows/UNC/含空格路径的图片写法：在 Markdown 中为目标包上尖括号 <...>
      const md2 = (() => {
        try {
          return String(markdown).replace(/!\[[^\]]*\]\(([^)]+)\)/g, (m, g1) => {
            const s = String(g1 || '').trim()
            // 已经是 <...> 的不处理
            if (s.startsWith('<') && s.endsWith('>')) return m
            const dec = (() => { try { return decodeURIComponent(s) } catch { return s } })()
            const localFromFile = fromFileUri(dec)
            if (localFromFile) return m.replace(s, `<${localFromFile}>`)
            const looksLocal = /^(?:file:|[a-zA-Z]:[\\/]|\\\\|\/)/.test(dec)
            const hasSpaceOrSlash = /[\s()\\]/.test(dec)
            if (looksLocal && hasSpaceOrSlash) {
              return m.replace(s, `<${dec}>`)
            }
            return m
          })
        } catch { return markdown }
      })()
      // Markdown转义字符反转义处理：还原被 Milkdown/remark 转义的方括号
      const md3 = (() => {
        try {
          let s = String(md2)
          // 第1步：还原 Obsidian 双向链接 \[\[ -> [[
          // 必须先处理双方括号，避免后续单方括号处理影响它
          s = s.replace(/\\\[\[/g, '[[').replace(/\\\]\]/g, ']]')
          // 第2步：还原单个方括号的转义 \[ -> [ 和 \] -> ]
          // 使用简单的全局替换，因为双方括号已经在第1步处理过了
          s = s.replace(/\\\[/g, '[').replace(/\\\]/g, ']')
          return s
        } catch { return md2 }
      })()
      const md3Clean = stripStrongBoundaryGuard(md3)
      const md4 = normalizeTabIndentText(unprotectExcelDollarRefs(restoreEscapedDollars(_lastMd, md3Clean)))
      _lastMd = md4
      try { _onChange?.(md4) } catch {}
      try { setTimeout(() => { try { rewriteLocalImagesToAsset() } catch {} }, 0) } catch {}
      try { scheduleCodeCopyRefresh() } catch {}
      // Markdown 更新时，也刷新 Mermaid 渲染 - 已由 Milkdown 插件处理
      // scheduleMermaidRender()
    })
  } catch {}
  _suppressInitialUpdate = false
  _editor = editor
  // 初次内容渲染完成后再刷一次代码块按钮覆盖层，避免“打开文件按钮不出现直到首次编辑”
  try { setTimeout(() => { try { scheduleCodeCopyRefresh() } catch {} }, 0) } catch {}
}

export function wysiwygV2GetCaretMarkdownOffset(): number {
  try {
    if (!_editor) return -1
    const md = _lastMd || ''
    return _editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const head = view.state.selection.head
      const total = view.state.doc.content.size || 1
      return Math.round(Math.min(1, head / total) * md.length)
    })
  } catch { return -1 }
}

export function wysiwygV2FocusAtMarkdownOffset(offset: number): void {
  try {
    if (!_editor) return
    _editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const total = view.state.doc.content.size
      const mdLen = Math.max(1, String(_lastMd || '').length)
      const ratio = Math.min(1, Math.max(0, offset / mdLen))
      const pos = Math.max(1, Math.min(Math.max(1, total - 1), Math.round(ratio * total)))
      const sel = TextSelection.near(view.state.doc.resolve(pos))
      view.dispatch(view.state.tr.setSelection(sel).scrollIntoView())
      view.focus()
    })
  } catch {}
}

export async function disableWysiwygV2() {
  // 先立即隐藏根节点，避免长文本时 await 期间的视觉不一致
  try {
    const host = document.getElementById('md-wysiwyg-root') as HTMLElement | null
    if (host) host.style.display = 'none'
  } catch {}
  try {
    if (_editor) {
      try {
        const mdNow = await (_editor as any).action(getMarkdown())
        const clean = stripStrongBoundaryGuard(String(mdNow || ''))
        _lastMd = normalizeTabIndentText(unprotectExcelDollarRefs(restoreEscapedDollars(_lastMd, clean)))
      } catch {}
    }
  } catch {}
  try { if (_imgObserver) { _imgObserver.disconnect(); _imgObserver = null } } catch {}
  try { cleanupCodeCopyOverlay() } catch {}
  try { if (_overlayHost && _overlayHost.parentElement) { _overlayHost.parentElement.removeChild(_overlayHost); _overlayHost = null } } catch {}
  if (_editor) {
    try { await _editor.destroy() } catch {}
    _editor = null
  }
  try {
    // 隐藏并移除根节点，避免覆盖层残留拦截点击
    const host = document.getElementById('md-wysiwyg-root') as HTMLElement | null
    if (host) {
      try { host.style.display = 'none' } catch {}
      try { host.innerHTML = '' } catch {}
      try { host.parentElement?.removeChild(host) } catch {}
    }
  } catch {}
  _root = null
  _onChange = null
}

export function isWysiwygV2Enabled(): boolean { return !!_editor }

// 供外部调用：将整个文档替换为指定 Markdown（简易接口）
export async function wysiwygV2ReplaceAll(markdown: string) {
  if (!_editor) return
  try {
    const ctx: any = (_editor as any).ctx
    // 若 editorView 尚未就绪或已被销毁，直接跳过，避免 MilkdownError 冒泡
    try { ctx.get(editorViewCtx) } catch { return }
    const next0 = maybeConvertHtmlTableBlocksToGfm(String(markdown || ''))
    _lastMd = normalizeTabIndentText(next0)
    const next = protectExcelDollarRefs(normalizeTabIndentText(next0))
    await _editor.action(replaceAll(next))
  } catch {}
}

// =============== 所见模式：查找 / 替换（Ctrl+H 面板接入） ===============
// 说明：
// - 简化实现：仅在单个文本节点内匹配，不跨节点；
// - 支持大小写开关、前后查找；
// - 替换：当前选区精确匹配则替换，否则先定位到下一处再替换；
// - 全部替换：单事务从后往前批量替换，避免位置偏移；

function _getView(): any { try { return (_editor as any)?.ctx?.get?.(editorViewCtx) } catch { return null } }

// 所见模式：列表项 Tab/Shift+Tab 缩进（次级列表/反缩进）
// 返回 true 表示“当前选区在列表项中，已尝试处理（无论是否真正发生缩进）”，外层应停止再做段落缩进。
export function wysiwygV2HandleListTab(outdent: boolean): boolean {
  try {
    const view = _getView()
    if (!view) return false
    const state = view.state
    const listItemType: any = (state as any)?.schema?.nodes?.list_item
    if (!listItemType) return false
    const sel: any = state.selection as any
    const $from: any = sel?.$from
    if (!$from) return false
    let inListItem = false
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d)?.type === listItemType) { inListItem = true; break }
    }
    if (!inListItem) return false

    const cmd = outdent ? liftListItem(listItemType) : sinkListItem(listItemType)
    try { cmd(state as any, view.dispatch, view) } catch {}
    try { view.focus() } catch {}
    return true
  } catch { return false }
}
// 所见模式内“粘贴 URL 自动抓取标题”逻辑：在 ProseMirror 文档上直接构造/更新链接节点
async function handleWysiwygPasteUrl(url: string) {
  const href = String(url || '').trim()
  if (!href) return
  const placeholder = '正在抓取title'
  try { await wysiwygV2ApplyLink(href, placeholder) } catch {}
  let finalLabel = href
  try {
    const fn = (typeof window !== 'undefined') ? (window as any).flymdFetchPageTitle : null
    if (typeof fn === 'function') {
      const title = await fn(href)
      if (title && String(title).trim()) {
        const safe = String(title).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[\[\]]/g, '\\$&')
        if (safe) finalLabel = safe
      }
    }
  } catch {}
  if (!finalLabel || finalLabel === placeholder) return
  try { updateFirstLinkLabel(placeholder, finalLabel, href) } catch {}
}
// 在文档中找到第一个文本为 oldLabel 且 href 匹配的链接，并用 newLabel 替换其文本
function updateFirstLinkLabel(oldLabel: string, newLabel: string, href: string) {
  try {
    const view = _getView()
    if (!view) return
    const st = view.state
    const schema = st.schema as any
    const linkType = schema?.marks?.link
    if (!linkType) return
    let target: { from: number, to: number, node: any } | null = null
    st.doc.descendants((node: any, pos: number) => {
      if (!node?.isText) return true
      const text = String(node.text || '')
      if (text !== oldLabel) return true
      const hasLink = (node.marks || []).some((m: any) => m.type === linkType && String(m.attrs?.href || '') === href)
      if (!hasLink) return true
      target = { from: pos, to: pos + text.length, node }
      return false
    })
    if (!target) return
    // 提取现有 link mark 的属性
    const targetNode = target.node
    const existingLink = (targetNode.marks || []).find((m: any) => m.type === linkType)
    const attrs = existingLink?.attrs || { href }
    // 创建带 link mark 的新文本节点
    const textNode = schema.text(newLabel, [linkType.create(attrs)])
    // 用 replaceWith 替换，保留 link mark
    const tr = st.tr.replaceWith(target.from, target.to, textNode).scrollIntoView()
    view.dispatch(tr)
  } catch {}
}

// 所见模式：中英文括号/引号成对补全 / 跳过右侧 / 成对删除（仅作用于 ProseMirror 视图，不影响源码模式逻辑）
function setupBracketPairingForWysiwyg(pm: HTMLElement | null) {
  try {
    if (!pm) return
  } catch { return }

  // 判断鼠标按下是否落在滚动条区域（否则会被“兜底 mousedown”误判为外部空白点击）
  const isMouseDownOnScrollbar = (ev: MouseEvent, el: HTMLElement): boolean => {
    try {
      const rc = el.getBoundingClientRect()
      const x = ev.clientX
      const y = ev.clientY
      if (x < rc.left || x > rc.right || y < rc.top || y > rc.bottom) return false

      const scrollableY = el.scrollHeight > el.clientHeight + 1
      const scrollableX = el.scrollWidth > el.clientWidth + 1
      if (!scrollableY && !scrollableX) return false

      // 非 overlay 滚动条：通过几何差值能准确拿到尺寸；overlay 场景差值可能为 0，用兜底宽度近似。
      const barW0 = Math.max(0, el.offsetWidth - el.clientWidth)
      const barH0 = Math.max(0, el.offsetHeight - el.clientHeight)
      const fallback = 20
      const barW = barW0 || (scrollableY ? fallback : 0)
      const barH = barH0 || (scrollableX ? fallback : 0)

      const onV = barW > 0 && x >= (rc.right - barW - 1)
      const onH = barH > 0 && y >= (rc.bottom - barH - 1)
      return onV || onH
    } catch { return false }
  }

  // 仅包含括号/引号类标点，不处理 * / _ / ~ 等 Markdown 语法
  const OPEN_TO_CLOSE: Record<string, string> = {
    '(': ')',
    '[': ']',
    '{': '}',
    '"': '"',
    "'": "'",
  }
  const CLOSERS = new Set<string>(Object.values(OPEN_TO_CLOSE))
  let prevSelFrom = 0
  let prevSelTo = 0
  let prevSelText = ''
  let _lastWrapTs = 0  // 记录上次环抱补全的时间戳，用于防抖

  const snapshotSelection = () => {
    try {
      const view = _getView()
      if (!view) return
      const st = view.state
      const sel = st.selection
      if (!(sel instanceof TextSelection)) return
      prevSelFrom = sel.from >>> 0
      prevSelTo = sel.to >>> 0
      if (prevSelFrom < prevSelTo) {
        prevSelText = st.doc.textBetween(prevSelFrom, prevSelTo, undefined, '\n')
      } else {
        prevSelText = ''
      }
    } catch {}
  }

  const handleBeforeInput = (ev: InputEvent) => {
    try {
      if (!getSymbolAutoCompletionEnabled()) return
      // 防抖：如果刚刚执行过环抱补全，跳过后续的 beforeinput 事件
      if (Date.now() - _lastWrapTs < 100) {
        ev.preventDefault()  // 必须阻止浏览器默认行为，否则会重复插入字符
        return
      }
      snapshotSelection()
      const data = (ev as any).data as string || ''
      if (!data || data.length !== 1) return
      // 组合输入阶段全部交给 IME；后续在 input(Composition*) 中统一处理
      if ((ev as any).isComposing) return

      const ch = data
      const isOpen = Object.prototype.hasOwnProperty.call(OPEN_TO_CLOSE, ch)
      const isClose = CLOSERS.has(ch)
      if (!isOpen && !isClose) return

      const view = _getView()
      if (!view) return
      const state = view.state
      const sel = state.selection
      if (!(sel instanceof TextSelection)) return
      // 代码块中不做括号自动补全，避免干扰源码输入
      const parent: any = sel.$from?.parent
      const typeName: string | undefined = parent?.type?.name
      if (typeName === 'code_block') return
      const from = sel.from >>> 0
      const to = sel.to >>> 0

      // 成对/环抱补全：插入 open+close，或用 open/close 环绕选区
      if (isOpen) {
        const closeCh = OPEN_TO_CLOSE[ch]
        ev.preventDefault()
        try { ev.stopPropagation() } catch {}
        let tr = state.tr
        if (from === to) {
          tr = tr.insertText(ch + closeCh, from, to)
          tr = tr.setSelection(TextSelection.create(tr.doc, from + ch.length)) as any
        } else {
          tr = tr.insertText(ch, from)
          tr = tr.insertText(closeCh, to + ch.length)
          const endPos = to + ch.length + closeCh.length
          tr = tr.setSelection(TextSelection.create(tr.doc, endPos)) as any
        }
        view.dispatch(tr)
        try { view.focus() } catch {}
        prevSelFrom = 0; prevSelTo = 0; prevSelText = ''
        return
      }

      // 右侧已存在相同闭合标点时：仅移动光标跳过，而不重复插入
      if (isClose && from === to) {
        const next = state.doc.textBetween(from, from + 1, undefined, '\n')
        if (next === ch) {
          ev.preventDefault()
          try { ev.stopPropagation() } catch {}
          const tr = state.tr.setSelection(TextSelection.create(state.doc, from + ch.length)) as any
          view.dispatch(tr)
          try { view.focus() } catch {}
        }
      }
    } catch {}
  }

  // 中文输入法等通过组合提交的括号/引号：在 input(Composition*) 阶段补全
  const handleInput = (ev: InputEvent) => {
    try {
      if (!getSymbolAutoCompletionEnabled()) return
      const data = (ev as any).data as string || ''
      if (!data) return
      const it = String((ev as any).inputType || '')
      // 仅处理组合相关提交，避免与普通按键路径重复
      if (!/Composition/i.test(it)) return

      const ch = data.length > 0 ? data[0] : ''
      const closeCh = OPEN_TO_CLOSE[ch]
      if (!closeCh) return

      const view = _getView()
      if (!view) return
      const state = view.state
      const sel = state.selection
      if (!(sel instanceof TextSelection)) return
      // 代码块中不做括号自动补全，避免干扰源码输入
      const parent: any = sel.$from?.parent
      const typeName: string | undefined = parent?.type?.name
      if (typeName === 'code_block') return

      // 组合输入 + 之前存在选区：环抱补全（ch + 选中文本 + closeCh）
      if (prevSelFrom < prevSelTo && prevSelText) {
        const from = prevSelFrom >>> 0
        const to = from + ch.length
        const seg = state.doc.textBetween(from, to, undefined, '\n')
        if (seg === ch) {
          let tr = state.tr.insertText(ch + prevSelText + closeCh, from, to)
          let endPos = from + ch.length + prevSelText.length + closeCh.length
          try {
            const extra = tr.doc.textBetween(endPos, endPos + ch.length + closeCh.length, undefined, '\n')
            if (extra === (ch + closeCh)) {
              tr = tr.delete(endPos, endPos + ch.length + closeCh.length)
            }
          } catch {}
          // 成对环抱后，将光标移到闭合符号之后
          tr = tr.setSelection(TextSelection.create(tr.doc, endPos)) as any
          view.dispatch(tr)
          prevSelFrom = 0; prevSelTo = 0; prevSelText = ''
          _lastWrapTs = Date.now()  // 记录环抱补全时间，用于防抖
          try { view.focus() } catch {}
          return
        }
      }

      // 无选区：组合输入后在右侧补全闭合符
      if (sel.empty) {
        const pos = sel.from >>> 0
        if (pos <= 0) return
        const prev = state.doc.textBetween(pos - 1, pos, undefined, '\n')
        if (prev !== ch) return
        const next = state.doc.textBetween(pos, pos + 1, undefined, '\n')
        if (next === closeCh) return
        let tr = state.tr.insertText(closeCh, pos, pos)
        tr = tr.setSelection(TextSelection.create(tr.doc, pos)) as any
        view.dispatch(tr)
        try { view.focus() } catch {}
      }
    } catch {}
  }

  const handleKeydown = (ev: KeyboardEvent) => {
    try {
      // 列表：行首 Backspace 退一层（或退出列表）
      // 目的：避免“删掉缩进后仍在缩进层级里继续输入”的诡异体验。
      if (ev.key === 'Backspace') {
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return
        if ((ev as any).isComposing) return
        const view = _getView()
        if (!view) return
        const state = view.state
        const sel: any = state.selection as any
        if (!(sel instanceof TextSelection)) return
        // 只在光标折叠且位于当前文本块行首时介入
        if (!sel.empty) return
        const $from: any = sel.$from
        if (!$from) return
        if (($from.parentOffset >>> 0) !== 0) return
        // 代码块里不要动
        const parent: any = $from.parent
        const typeName: string | undefined = parent?.type?.name
        if (typeName === 'code_block') return

        // 表格里 Backspace 交给编辑器默认行为
        for (let d = $from.depth; d > 0; d--) {
          const name = $from.node(d)?.type?.name
          if (!name) continue
          if (name === 'table' || name === 'table_row' || name === 'table_cell' || name === 'table_header') return
        }

        const listItemType: any = (state as any).schema?.nodes?.list_item
        if (listItemType) {
          let inListItem = false
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d)?.type === listItemType) { inListItem = true; break }
          }
          if (inListItem) {
            const handled = liftListItem(listItemType)(state as any, view.dispatch, view)
            if (handled) {
              ev.preventDefault()
              try { ev.stopPropagation() } catch {}
              try { (ev as any).stopImmediatePropagation?.() } catch {}
              try { view.focus() } catch {}
              return
            }
          }
        }
      }

      // 所见模式：列表 Tab 缩进到次级列表，Shift+Tab 反缩进
      // 只在列表项里接管 Tab，避免影响表格单元格 Tab 导航、以及其它既有 Tab 行为
      if (ev.key === 'Tab') {
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return

        const view = _getView()
        if (!view) return
        const state = view.state
        const sel: any = state.selection as any
        const $from: any = sel?.$from
        if (!$from) return

        // 表格中 Tab 通常用于单元格切换，这里完全不干预
        for (let d = $from.depth; d > 0; d--) {
          const name = $from.node(d)?.type?.name
          if (!name) continue
          if (name === 'table' || name === 'table_row' || name === 'table_cell' || name === 'table_header') return
        }

        const listItemType: any = (state as any).schema?.nodes?.list_item
        if (!listItemType) return

        const cmd = ev.shiftKey ? liftListItem(listItemType) : sinkListItem(listItemType)
        const handled = cmd(state as any, view.dispatch, view)
        if (handled) {
          ev.preventDefault()
          try { ev.stopPropagation() } catch {}
          try { (ev as any).stopImmediatePropagation?.() } catch {}
        }
        return
      }

      if (!getSymbolAutoCompletionEnabled()) return
      if (ev.key !== 'Backspace') return
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return
      // 组合输入阶段不介入
      if ((ev as any).isComposing) return

      const view = _getView()
      if (!view) return
      const state = view.state
      const sel = state.selection
      if (!(sel instanceof TextSelection)) return
      // 代码块中不做括号自动补全，避免干扰源码输入
      const parent: any = sel.$from?.parent
      const typeName: string | undefined = parent?.type?.name
      if (typeName === 'code_block') return
      if (!sel.empty) return

      const pos = sel.from >>> 0
      if (pos === 0) return
      const prev = state.doc.textBetween(pos - 1, pos, undefined, '\n')
      const next = state.doc.textBetween(pos, pos + 1, undefined, '\n')
      if (!prev || !next) return
      const expectedClose = OPEN_TO_CLOSE[prev]
      if (!expectedClose || expectedClose !== next) return

      ev.preventDefault()
      try { ev.stopPropagation() } catch {}
      let tr = state.tr.delete(pos - 1, pos + 1)
      const newPos = Math.max(0, pos - 1)
      tr = tr.setSelection(TextSelection.create(tr.doc, newPos)) as any
      view.dispatch(tr)
      try { view.focus() } catch {}
    } catch {}
  }

  // 接近底部输入时自动“吸底”，让文末留白自然生效（仅在光标位于文末时触发）
  let _stickWasNearBottomBeforeInput = false
  let _stickRaf = 0
  const _getLineHeightPx = (): number => {
    try {
      const style = window.getComputedStyle(pm)
      let lh = parseFloat(style.lineHeight || '')
      if (!lh || Number.isNaN(lh)) {
        const fs = parseFloat(style.fontSize || '16') || 16
        lh = fs * 1.6
      }
      return lh
    } catch { return 24 }
  }
  const _getScrollHost = (): HTMLElement => {
    try {
      const root = _root as HTMLElement | null
      const sv = root?.querySelector?.('.scrollView') as HTMLElement | null
      return (sv || root || pm) as HTMLElement
    } catch { return pm }
  }
  const _isNearBottom = (): boolean => {
    try {
      const host = _getScrollHost()
      const max = Math.max(0, host.scrollHeight - host.clientHeight)
      if (max <= 0) return true
      const th = Math.max(24, Math.round(_getLineHeightPx() * 2))
      return (max - host.scrollTop) <= th
    } catch { return false }
  }
  const _isCaretAtDocEnd = (): boolean => {
    try {
      const view = _getView()
      if (!view) return false
      const st: any = view.state
      const sel: any = st?.selection
      if (!sel || !sel.empty) return false
      const end = (st?.doc?.content?.size >>> 0) || 0
      const pos = sel.to >>> 0
      return end > 0 && Math.abs(end - pos) <= 1
    } catch { return false }
  }
  const _stickToBottom = () => {
    try {
      const near = _stickWasNearBottomBeforeInput || _isNearBottom()
      _stickWasNearBottomBeforeInput = false
      if (!near) return
      if (!_isCaretAtDocEnd()) return
      try { if (_stickRaf) cancelAnimationFrame(_stickRaf) } catch {}
      _stickRaf = requestAnimationFrame(() => {
        _stickRaf = 0
        try {
          const host = _getScrollHost()
          host.scrollTop = Math.max(0, host.scrollHeight - host.clientHeight)
        } catch {}
      })
    } catch {}
  }

  try { pm.addEventListener('beforeinput', (e) => { try { _stickWasNearBottomBeforeInput = _isNearBottom() } catch {} ; try { handleBeforeInput(e as any) } catch {} }, true) } catch {}
  try { pm.addEventListener('input', (e) => { try { handleInput(e as any) } catch {} ; try { _stickToBottom() } catch {} }, true) } catch {}
  try { pm.addEventListener('keydown', (e) => { try { handleKeydown(e as any) } catch {} }, true) } catch {}

  // 兜底：空白/内容较少时，点击编辑区域外围空白也能把光标放回文档末尾并保持焦点
  try {
    const rootEl = _root as HTMLElement | null
    if (rootEl) {
      if (_rootMouseDownHandler) {
        try { rootEl.removeEventListener('mousedown', _rootMouseDownHandler, true) } catch {}
      }
      _rootMouseDownHandler = (ev: MouseEvent) => {
        try {
          // 只处理左键，避免影响右键菜单等交互
          if ((ev as any).button != null && (ev as any).button !== 0) return
          const tgt = ev.target as HTMLElement | null
          // ProseMirror 内部点击完全交给编辑器自身处理
          if (tgt && tgt.closest('.ProseMirror')) return
          // 覆盖层（如 Katex 编辑弹层、代码复制按钮等）内部点击也不拦截，避免干扰 textarea 光标定位
          if (tgt && tgt.closest('.overlay-host')) return
          // 点击/拖拽滚动条（轨道/滑块）不能被当成“空白区点击”，否则会先 scrollIntoView 跳到底部
          const root = rootEl
          const sv = root?.querySelector?.('.scrollView') as HTMLElement | null
          if (tgt) {
            if (sv && tgt === sv && isMouseDownOnScrollbar(ev, sv)) return
            if (root && tgt === root && isMouseDownOnScrollbar(ev, root)) return
          }
          // 这段逻辑只想覆盖“内容较少/不滚动”的场景：可滚动时绝对不要动滚动位置
          const scrollBox = sv || root
          if (scrollBox && scrollBox.scrollHeight > scrollBox.clientHeight + 1) return
          const view = _getView()
          if (!view) return
          const state = view.state
          const doc = state.doc
          const safePos = doc.content.size >>> 0
          const tr = state.tr.setSelection(TextSelection.create(doc, safePos))
          view.dispatch(tr)
          try { view.focus() } catch {}
          ev.preventDefault()
          try { ev.stopPropagation() } catch {}
        } catch {}
      }
      rootEl.addEventListener('mousedown', _rootMouseDownHandler, true)
    }
  } catch {}
}
function exitInlineCodeToRight(focusView = true): boolean {
  try {
    const view = _getView()
    if (!view) return false
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
    const range = sel.getRangeAt(0)
    const codeEl = findInlineCodeAncestor(range.startContainer)
    if (!codeEl) return false
    if (!isCaretAtInlineCodeEnd(range, codeEl)) return false
    const parent = codeEl.parentNode
    if (!parent) return false
    const idx = Array.prototype.indexOf.call(parent.childNodes, codeEl)
    if (idx < 0) return false
    const pos = view.posAtDOM(parent as Node, idx + 1)
    const state = view.state
    const tr = state.tr.setSelection(TextSelection.create(state.doc, pos))
    view.dispatch(tr)
    if (focusView) {
      try { view.focus() } catch {}
    }
    return true
  } catch { return false }
}

function scheduleInlineCodeMouseExit() {
  try {
    if (_inlineCodeMouseTimer != null) { window.clearTimeout(_inlineCodeMouseTimer); _inlineCodeMouseTimer = null }
  } catch {}
  _inlineCodeMouseTimer = window.setTimeout(() => {
    _inlineCodeMouseTimer = null
    try { exitInlineCodeToRight() } catch {}
  }, 0)
}

// 所见模式下：输入 $$ 回车 后自动打开 KaTeX 源码编辑框
function tryHandleMathEnter(ev: KeyboardEvent) {
  try {
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return
    if (!_editor) return
    const view: any = (_editor as any)?.ctx?.get?.(editorViewCtx)
    if (!view) return
    const state = view.state
    const $from = state.selection.$from
    const parent: any = $from.parent
    const text = String(parent?.textContent || '').trim()
    if (text !== '$$') return

    // 让 Milkdown 先处理输入规则（mathBlockInputRule），再定位到新建的 math_block 节点
    window.setTimeout(() => {
      try {
        const viewNow: any = (_editor as any)?.ctx?.get?.(editorViewCtx)
        if (!viewNow) return
        const st = viewNow.state
        const $pos = st.selection.$from
        for (let d = $pos.depth; d >= 0; d--) {
          const node: any = $pos.node(d)
          if (node && node.type?.name === 'math_block') {
            const nodePos = $pos.before(d)
            let dom: HTMLElement | null = null
            try { dom = viewNow.nodeDOM(nodePos) as HTMLElement | null } catch {}
            if (dom) {
              try { (dom as any).dataset.flymdNewMath = '1' } catch {}
              try { enterLatexSourceEdit(dom) } catch {}
            }
            break
          }
        }
      } catch {}
    }, 0)
  } catch {}
}

function findInlineCodeAncestor(node: Node | null): HTMLElement | null {
  try {
    let cur: Node | null = node
    while (cur) {
      if (cur instanceof HTMLElement) {
        if (cur.tagName === 'CODE' && !cur.closest('pre')) return cur
      }
      cur = cur.parentNode
    }
    return null
  } catch { return null }
}

function isCaretAtInlineCodeEnd(range: Range, codeEl: HTMLElement): boolean {
  try {
    const probe = document.createRange()
    probe.selectNodeContents(codeEl)
    probe.collapse(false)
    return range.compareBoundaryPoints(Range.START_TO_START, probe) === 0
  } catch { return false }
}
function _norm(s: string, cs: boolean): string { return cs ? s : s.toLowerCase() }

function _find(term: string, cs: boolean, backwards = false): { from: number, to: number } | null {
  try {
    const view = _getView()
    if (!view || !term) return null
    const state = view.state
    const needle = _norm(String(term), cs)
    const selFrom = state.selection.from >>> 0
    let found: { from: number, to: number } | null = null

    const scan = (startPos: number, endPos: number) => {
      let hit: { from: number, to: number } | null = null
      state.doc.descendants((node: any, pos: number) => {
        if (!backwards && hit) return false
        if (!node?.isText) return true
        const text: string = String(node.text || '')
        if (!text) return true
        const absStart = pos >>> 0
        const absEnd = (pos + text.length) >>> 0
        if (absEnd <= startPos || absStart >= endPos) return true
        const localStart = Math.max(0, startPos - absStart)
        const localEnd = Math.min(text.length, endPos - absStart)
        const segment = text.slice(0, localEnd)
        if (!backwards) {
          const idx = _norm(segment, cs).indexOf(needle, localStart)
          if (idx >= 0) { const from = absStart + idx; hit = { from, to: from + term.length }; return false }
        } else {
          const idx = _norm(segment, cs).lastIndexOf(needle, Math.max(0, Math.min(localEnd - 1, selFrom - absStart)))
          if (idx >= 0 && idx < localEnd) { const from = absStart + idx; hit = { from, to: from + term.length }; return true }
        }
        return true
      })
      if (hit) { found = hit; return true }
      return false
    }

    if (!backwards) {
      if (!scan(state.selection.to >>> 0, state.doc.content.size >>> 0)) scan(0, selFrom)
    } else {
      if (!scan(0, selFrom)) scan(selFrom, state.doc.content.size >>> 0)
    }
    return found
  } catch { return null }
}

function _selectAndScroll(from: number, to: number): boolean {
  try {
    const view = _getView()
    if (!view) return false
    const st = view.state
    const tr = st.tr.setSelection(TextSelection.create(st.doc, from, to)).scrollIntoView()
    view.dispatch(tr)
    try { view.focus() } catch {}
    return true
  } catch { return false }
}

export function wysiwygV2FindNext(term: string, caseSensitive = false): boolean {
  const hit = _find(String(term || ''), !!caseSensitive, false)
  if (!hit) return false
  return _selectAndScroll(hit.from, hit.to)
}

export function wysiwygV2FindPrev(term: string, caseSensitive = false): boolean {
  const hit = _find(String(term || ''), !!caseSensitive, true)
  if (!hit) return false
  return _selectAndScroll(hit.from, hit.to)
}

export function wysiwygV2ReplaceOne(term: string, replacement: string, caseSensitive = false): boolean {
  try {
    const view = _getView()
    if (!view) return false
    const st = view.state
    const cur = st.doc.textBetween(st.selection.from, st.selection.to)
    const match = !!term && (caseSensitive ? cur === term : cur.toLowerCase() === term.toLowerCase())
    if (!match) {
      if (!wysiwygV2FindNext(term, caseSensitive)) return false
    }
    const st2 = view.state
    const tr = st2.tr.insertText(String(replacement || ''), st2.selection.from, st2.selection.to).scrollIntoView()
    view.dispatch(tr)
    try { view.focus() } catch {}
    return true
  } catch { return false }
}

export function wysiwygV2ReplaceAllInDoc(term: string, replacement: string, caseSensitive = false): number {
  try {
    const view = _getView()
    if (!view || !term) return 0
    const st = view.state
    const needle = _norm(String(term), !!caseSensitive)
    const matches: Array<{ from: number, to: number }> = []
    st.doc.descendants((node: any, pos: number) => {
      if (!node?.isText) return true
      const text = String(node.text || '')
      if (!text) return true
      const hay = _norm(text, !!caseSensitive)
      let i = 0
      for (;;) {
        const idx = hay.indexOf(needle, i)
        if (idx < 0) break
        const from = (pos >>> 0) + idx
        matches.push({ from, to: from + term.length })
        i = idx + Math.max(1, term.length)
      }
      return true
    })
    if (!matches.length) return 0
    let tr = st.tr
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i]
      tr = tr.insertText(String(replacement || ''), m.from, m.to)
    }
    view.dispatch(tr.scrollIntoView())
    try { view.focus() } catch {}
    return matches.length
  } catch { return 0 }
}

// =============== 自动渲染覆盖层：Mermaid 代码块 ===============
// 全局渲染节流定时器
let _renderThrottleTimer: number | null = null
// 记录已渲染的 Mermaid 图表，避免重复渲染导致闪烁
const _renderedMermaid = new WeakMap<HTMLElement, string>()

function scheduleMermaidRender() {
  console.log('[DEBUG] scheduleMermaidRender 被调用')
  try { if (_renderThrottleTimer != null) { clearTimeout(_renderThrottleTimer); _renderThrottleTimer = null } } catch {}
  // 使用节流：300ms 内多次调用只执行一次
  _renderThrottleTimer = window.setTimeout(() => { try { renderMermaidNow() } catch {} }, 300)
}

function getHost(): HTMLElement | null {
  try {
    const host0 = _root as HTMLElement | null
    return (host0?.querySelector('.ProseMirror') as HTMLElement | null) || host0
  } catch { return null }
}

function ensureOverlayHost(): HTMLDivElement | null {
  try {
    const root = _root
    if (!root) return null
    if (_overlayHost && _overlayHost.parentElement) return _overlayHost
    const ov = document.createElement('div')
    ov.className = 'overlay-host'
    ov.style.position = 'absolute'
    ov.style.inset = '0'
    ov.style.zIndex = '5'
    ov.style.pointerEvents = 'none'
    root.appendChild(ov)
    _overlayHost = ov
    return ov
  } catch { return null }
}

function scheduleCodeCopyRefresh() {
  try {
    if (_codeCopyRaf != null) return
    _codeCopyRaf = window.requestAnimationFrame(() => {
      _codeCopyRaf = null
      try { refreshCodeCopyButtonsNow() } catch {}
    })
  } catch {}
}

function cleanupCodeCopyOverlay() {
  try {
    if (_codeCopyHost && _codeCopyScrollHandler) { _codeCopyHost.removeEventListener('scroll', _codeCopyScrollHandler) }
  } catch {}
  try {
    if (_codeCopyRoot && _codeCopyRootScrollCaptureHandler) {
      try { _codeCopyRoot.removeEventListener('scroll', _codeCopyRootScrollCaptureHandler, true) } catch {}
      try { _codeCopyRoot.removeEventListener('scroll', _codeCopyRootScrollCaptureHandler as any) } catch {}
    }
  } catch {}
  _codeCopyScrollHandler = null
  _codeCopyHost = null
  _codeCopyRootScrollCaptureHandler = null
  _codeCopyRoot = null
  try {
    if (_codeCopyResizeObserver) { _codeCopyResizeObserver.disconnect(); _codeCopyResizeObserver = null }
  } catch {}
  if (_codeCopyWindowResizeHandler) {
    try { window.removeEventListener('resize', _codeCopyWindowResizeHandler) } catch {}
    _codeCopyWindowResizeHandler = null
  }
  if (_codeCopyRaf != null) {
    try { cancelAnimationFrame(_codeCopyRaf) } catch {}
    _codeCopyRaf = null
  }
  for (const wrap of _codeCopyWraps.values()) {
    try { wrap.remove() } catch {}
  }
  _codeCopyWraps.clear()
}

function setupCodeCopyOverlay(host: HTMLElement | null) {
  cleanupCodeCopyOverlay()
  let scrollHost: HTMLElement | null = null
  try {
    const root = _root as HTMLElement | null
    // 优先使用 .scrollView，其次是 .ProseMirror
    const sv = root?.querySelector('.scrollView') as HTMLElement | null
    const pm = root?.querySelector('.ProseMirror') as HTMLElement | null
    scrollHost = sv || pm || host || root
  } catch {
    scrollHost = host
  }
  if (!scrollHost) return
  _codeCopyHost = scrollHost
  const onScroll = () => { scheduleCodeCopyRefresh() }
  _codeCopyScrollHandler = onScroll
  // 绑定到 scrollHost
  try {
    scrollHost.addEventListener('scroll', onScroll, { passive: true })
  } catch {
    try { scrollHost.addEventListener('scroll', onScroll) } catch {}
  }
  // scroll 事件不冒泡：额外在 root 上用 capture 捕获后代滚动（否则覆盖层会“钉死在顶部”）
  try {
    const root = _root as HTMLElement | null
    if (root) {
      _codeCopyRoot = root
      _codeCopyRootScrollCaptureHandler = onScroll
      try {
        root.addEventListener('scroll', onScroll, { passive: true, capture: true } as any)
      } catch {
        try { root.addEventListener('scroll', onScroll, true) } catch {}
      }
    }
  } catch {}
  if (typeof ResizeObserver !== 'undefined') {
    try {
      _codeCopyResizeObserver = new ResizeObserver(() => { scheduleCodeCopyRefresh() })
      _codeCopyResizeObserver.observe(scrollHost)
    } catch {}
  }
  const onResize = () => { scheduleCodeCopyRefresh() }
  _codeCopyWindowResizeHandler = onResize
  window.addEventListener('resize', onResize)
  // 初次挂载时 ProseMirror 的 DOM 可能还没把 <pre> 真正插进来：多刷一帧避免“打开文件看不到按钮”
  scheduleCodeCopyRefresh()
  try { requestAnimationFrame(() => { try { scheduleCodeCopyRefresh() } catch {} }) } catch {}
}

function getCodeCopyText(pre: HTMLElement): string | null {
  if (!pre || !pre.isConnected) return null
  if (!pre.offsetParent) return null
  if (pre.closest('.mermaid-node-wrapper')) return null
  const codeEl = pre.querySelector('code') as HTMLElement | null
  if (!codeEl) return null
  const raw = codeEl.textContent || ''
  if (!raw.trim()) return null

  // 只复制纯代码文本，不附带 ``` 或语言标记
  return raw
}

function positionCodeCopyWrap(pre: HTMLElement, wrap: HTMLDivElement, rootRc: DOMRect) {
  try {
    const preRc = pre.getBoundingClientRect()
    // 如果代码块完全在视口之上或之下，则隐藏对应按钮，避免在顶部堆积
    if (preRc.bottom <= rootRc.top || preRc.top >= rootRc.bottom) {
      wrap.style.display = 'none'
      return
    }
    // 代码块在可视区域内时，确保按钮可见（flex 布局）
    wrap.style.display = 'flex'
    // 使用整个容器的宽度（包含 Delete + Copy 按钮）
    const wrapW = wrap.offsetWidth || 60
    // 所见模式下滚动发生在内部 scrollView，pre 与 root 的相对位置已经包含滚动偏移
    const left = Math.max(0, (preRc.left - rootRc.left) + Math.max(0, preRc.width - wrapW - 16))
    const top = Math.max(0, (preRc.top - rootRc.top) + 14)
    wrap.style.left = left + 'px'
    wrap.style.top = top + 'px'
  } catch {}
}

function refreshCodeCopyButtonsNow() {
  try {
    const host = getHost()
    const root = _root as HTMLElement | null
    const ov = ensureOverlayHost()
    if (!host || !root || !ov) return
    const rootRc = root.getBoundingClientRect()
    const pres = Array.from(host.querySelectorAll('pre')) as HTMLElement[]
    const alive = new Set<HTMLElement>()
    for (const pre of pres) {
      const copyText = getCodeCopyText(pre)
      if (copyText == null) continue
      alive.add(pre)
      let wrap = _codeCopyWraps.get(pre)
      if (!wrap || !wrap.parentElement) {
        wrap = document.createElement('div')
        wrap.className = 'ov-codecopy'
        wrap.style.position = 'absolute'
        wrap.style.pointerEvents = 'none'
        wrap.style.zIndex = '8'
        wrap.style.display = 'flex'
        wrap.style.gap = '8px'
        // Delete 按钮（左侧，需二次确认）
        const delBtn = document.createElement('button')
        delBtn.type = 'button'
        delBtn.className = 'code-delete'
        delBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>'
        delBtn.style.pointerEvents = 'auto'
        ;(delBtn as any).__targetPre = pre
        ;(delBtn as any).__deleteArmed = false
        // 保存原始 SVG 图标用于重置
        const delBtnOriginalHTML = delBtn.innerHTML
        delBtn.addEventListener('click', (ev) => {
          ev.preventDefault()
          ev.stopPropagation()
          const btn = ev.currentTarget as HTMLButtonElement
          // 第一次点击只进入"待确认"状态，第二次点击才真正删除
          if (!(btn as any).__deleteArmed) {
            ;(btn as any).__deleteArmed = true
            btn.textContent = '确认'
            btn.classList.add('armed')
            return
          }
          const targetPre = (btn as any).__targetPre as HTMLElement | null
          if (targetPre) deleteWysiwygNodeByDom(targetPre, ['code_block'])
        })
        // 失焦时重置确认状态
        delBtn.addEventListener('blur', () => {
          if ((delBtn as any).__deleteArmed) {
            ;(delBtn as any).__deleteArmed = false
            delBtn.innerHTML = delBtnOriginalHTML
            delBtn.classList.remove('armed')
          }
        })
        wrap.appendChild(delBtn)
        // Copy 按钮（右侧）
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'code-copy'
        btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'
        btn.style.pointerEvents = 'auto'
        ;(btn as any).__copyText = copyText
        wrap.appendChild(btn)
        ov.appendChild(wrap)
        _codeCopyWraps.set(pre, wrap)
      } else {
        const btn = wrap.querySelector('button.code-copy') as HTMLButtonElement | null
        if (btn) {
          ;(btn as any).__copyText = copyText
        }
      }
      positionCodeCopyWrap(pre, wrap, rootRc)
    }
    for (const [pre, wrap] of Array.from(_codeCopyWraps.entries())) {
      if (!alive.has(pre) || !pre.isConnected) {
        try { wrap.remove() } catch {}
        _codeCopyWraps.delete(pre)
      }
    }
  } catch {}
}

async function renderMermaidInto(el: HTMLDivElement, code: string) {
  try {
    const mod: any = await import('mermaid')
    const mermaid = mod?.default || mod
    // 所见模式：静默 mermaid 内部错误与日志，避免在输入中提示干扰
    try { (mermaid as any).parseError = () => {} } catch {}
    try { if ((mermaid as any).mermaidAPI) (mermaid as any).mermaidAPI.parseError = () => {} } catch {}
    try {
      mermaid.initialize?.({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: 'default',
        logLevel: 'fatal' as any,
        fontSize: 16 as any,
        flowchart: { useMaxWidth: true } as any,
        themeVariables: { fontFamily: 'Segoe UI, Helvetica, Arial, sans-serif', fontSize: '16px' } as any,
      })
    } catch {}
    const id = 'mmd-' + Math.random().toString(36).slice(2)
    const { svg } = await mermaid.render(id, code || '')
    // 包装为带工具条的容器
    el.innerHTML = ''
    const wrap = document.createElement('div')
    wrap.innerHTML = svg
    const svgEl = wrap.firstElementChild as SVGElement | null
    if (svgEl) {
      const fig = document.createElement('div')
      fig.className = 'mmd-figure'
      fig.appendChild(svgEl)
      try {
        const mk: any = (window as any).createMermaidToolsFor
        if (typeof mk === 'function') {
          const tools = mk(svgEl)
          if (tools) fig.appendChild(tools)
        }
      } catch {}
      el.appendChild(fig)
    }
    try {
      const svgEl = el.querySelector('svg') as SVGElement | null
      if (svgEl) {
        try { (svgEl.style as any).display = 'block'; (svgEl.style as any).maxWidth = '100%'; (svgEl.style as any).height = 'auto' } catch {}
        try { if (!svgEl.getAttribute('preserveAspectRatio')) svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet') } catch {}
        try {
          const vb = svgEl.getAttribute('viewBox') || ''
          if (!/(\d|\s)\s*(\d|\s)/.test(vb)) {
            const w = parseFloat(svgEl.getAttribute('width') || '')
            const h = parseFloat(svgEl.getAttribute('height') || '')
            if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`)
          }
        } catch {}
        try { if (svgEl.hasAttribute('width')) svgEl.removeAttribute('width') } catch {}
        try { if (svgEl.hasAttribute('height')) svgEl.removeAttribute('height') } catch {}
        setTimeout(() => {
          try {
            const bb = (svgEl as any).getBBox ? (svgEl as any).getBBox() : null
            if (bb && bb.width > 0 && bb.height > 0) {
              const pad = (() => { try { return Math.max(2, Math.min(24, Math.round(Math.max(bb.width, bb.height) * 0.02))) } catch { return 8 } })()
              const vx = Math.floor(bb.x) - pad
              const vy = Math.floor(bb.y) - pad
              const vw = Math.ceil(bb.width) + pad * 2
              const vh = Math.ceil(bb.height) + pad * 2
              svgEl.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`)
              const host = el.parentElement as HTMLElement | null
              const pbW = Math.max(0, host?.clientWidth || el.clientWidth || 0)
              const targetW = vw
              let scale = 0.75
              try { const sv = localStorage.getItem('flymd:mermaidScale'); const n = sv ? parseFloat(sv) : NaN; if (Number.isFinite(n) && n > 0) scale = n } catch {}
              const base = pbW > 0 ? Math.min(pbW, targetW) : targetW
              const finalW = Math.max(10, Math.round(base * scale))
              ;(svgEl.style as any).width = finalW + 'px'
            }
          } catch {}
        }, 0)
      }
    } catch {}
  } catch (e) {
    // 所见模式：隐藏渲染失败提示（保持空内容，不覆盖底下的源码输入）
    try { el.innerHTML = '' } catch {}
  }
}


function onPmMouseMove(ev: MouseEvent) {
  try {
    const t = ev.target as HTMLElement | null
    const pre = t?.closest?.('pre') as HTMLElement | null
    const hit = (() => {
      if (!pre) return null
      const codeEl = pre.querySelector('code') as HTMLElement | null
      const langFromClass = codeEl ? /\\blanguage-([\\w-]+)\\b/.exec(codeEl.className || '')?.[1] : ''
      const langFromAttr = (pre.getAttribute('data-language') || pre.getAttribute('data-lang') || '').toLowerCase()
      const lang = (langFromAttr || langFromClass || '').toLowerCase()
      return lang === 'mermaid' ? pre : null
    })()
    // 鼠标只是辅助手段：仅在没有光标命中的情况下生效
    _activeMermaidPreByMouse = hit
    const next = _activeMermaidPreBySelection || _activeMermaidPreByMouse
    if (next !== _activeMermaidPre) { _activeMermaidPre = next; scheduleMermaidRender() }
  } catch {}
}

function onPmSelectionChange() {
  try {
    const sel = window.getSelection()
    const n = sel?.focusNode as (Node & { parentElement?: HTMLElement }) | null
    const el = (n && (n as any).nodeType === 1 ? (n as any as HTMLElement) : n?.parentElement) as HTMLElement | null
    const pre = el?.closest?.('pre') as HTMLElement | null
    const codeEl = pre?.querySelector?.('code') as HTMLElement | null
    const langFromClass = codeEl ? /\\blanguage-([\\w-]+)\\b/.exec(codeEl.className || '')?.[1] : ''
    const langFromAttr = pre ? (pre.getAttribute('data-language') || pre.getAttribute('data-lang') || '').toLowerCase() : ''
    const lang = (langFromAttr || langFromClass || '').toLowerCase()
    const hit = (lang === 'mermaid' ? pre : null) as HTMLElement | null
    // 光标优先级最高：直接覆盖选择源，再与鼠标源合并计算
    _activeMermaidPreBySelection = hit
    const next = _activeMermaidPreBySelection || _activeMermaidPreByMouse
    if (next !== _activeMermaidPre) { _activeMermaidPre = next; scheduleMermaidRender() }
  } catch {}
}

// ===== Latex 源码编辑：在 KaTeX 上方叠加一个 textarea 进行就地编辑，保存后仅更新该数学节点 =====

//  闭合后再渲染（不在输入起始处触发）
let _mathReparseTimer: number | null = null
let _suppressMathReparse = false // 在手动更新数学节点后临时阻止 reparse
function scheduleMathBlockReparse() {
  if (_suppressMathReparse) return // 阻止重复处理
  try { if (_mathReparseTimer != null) { clearTimeout(_mathReparseTimer); _mathReparseTimer = null } } catch {}
  _mathReparseTimer = window.setTimeout(async () => {
    if (_suppressMathReparse) return // 再次检查
    try {
      const mdNow = await (_editor as any).action(getMarkdown())
      const current = stripStrongBoundaryGuard(String(mdNow || ''))
      if (/\$\$[\s\S]*?\$\$/m.test(current)) {
        await (_editor as any).action(replaceAll(guardStrongBoundaryForCommonMark(current)))
      }
    } catch {}
  }, 240)
}
function updateMilkdownMathFromDom(
  mathEl: HTMLElement,
  newValue: string,
  insertParagraphAfter: boolean = false,
  cachedFrom: number = -1,
  cachedTo: number = -1
): any {
  try {
    // 阻止 scheduleMathBlockReparse 重复处理
    _suppressMathReparse = true
    setTimeout(() => { _suppressMathReparse = false }, 500)

    const view: any = (_editor as any)?.ctx?.get?.(editorViewCtx)
    if (!view || !mathEl) return view

    const isBlock = (mathEl.dataset?.type === 'math_block' || mathEl.tagName === 'DIV')
    const targetType = isBlock ? 'math_block' : 'math_inline'
    const isMath = (n: any) => !!n && (n.type?.name === 'math_inline' || n.type?.name === 'math_block')

    let from = cachedFrom, to = cachedTo

    // 如果没有缓存的位置，尝试动态查找
    if (from < 0 || to < 0) {
      let pos: number | null = null
      try { pos = view.posAtDOM(mathEl, 0) } catch {}
      if (pos == null || typeof pos !== 'number') return view
      const state = view.state
      const $pos = state.doc.resolve(pos)

      // 向上遍历深度找到 math 节点
      for (let d = $pos.depth; d >= 0; d--) {
        const node = $pos.node(d)
        if (node.type?.name === targetType) {
          from = $pos.before(d)
          to = $pos.after(d)
          break
        }
      }
      // 回退：检查 nodeAfter/nodeBefore
      if (from < 0) {
        if ($pos.nodeAfter && isMath($pos.nodeAfter)) {
          from = pos
          to = pos + $pos.nodeAfter.nodeSize
        } else if ($pos.nodeBefore && isMath($pos.nodeBefore)) {
          from = pos - $pos.nodeBefore.nodeSize
          to = pos
        }
      }
    }

    // 仍未找到则不执行
    if (from < 0 || to < 0 || from === to) {
      console.warn('[updateMilkdownMathFromDom] 无法找到 math 节点位置')
      return view
    }

    const state = view.state

    const schema = state.schema
    let node: any
    if (isBlock) {
      const t = schema.nodes['math_block']
      node = t?.create?.({ value: String(newValue || '') })
    } else {
      const t = schema.nodes['math_inline']
      const text = schema.text(String(newValue || ''))
      node = t?.create?.({}, text)
    }
    if (!node) return view

    let tr = state.tr.replaceRangeWith(from, to, node)

    // 如果需要在公式后插入新段落并移动光标
    if (insertParagraphAfter && isBlock) {
      const newMathEnd = from + node.nodeSize
      const paragraphType = schema.nodes['paragraph']
      if (paragraphType) {
        const newPara = paragraphType.create()
        tr = tr.insert(newMathEnd, newPara)
        // 设置光标到新段落内部（newMathEnd + 1 是段落开始位置）
        try {
          tr = tr.setSelection(TextSelection.create(tr.doc, newMathEnd + 1))
        } catch {}
      }
    }

    view.dispatch(tr.scrollIntoView())
    return view
  } catch (e) {
    console.error('[updateMilkdownMathFromDom] 错误:', e)
    return (_editor as any)?.ctx?.get?.(editorViewCtx)
  }
}
// 从图片 DOM 反向更新 Milkdown 文档中的 image 节点
function updateMilkdownImageFromDom(imgEl: HTMLImageElement, newSrc: string, newAlt: string) {
  try {
    const view: any = (_editor as any)?.ctx?.get?.(editorViewCtx)
    if (!view || !imgEl) return
    let pos: number | null = null
    try { pos = view.posAtDOM(imgEl, 0) } catch {}
    if (pos == null || typeof pos !== 'number') return
    const state = view.state
    const $pos = state.doc.resolve(pos)
    const isImage = (n: any) => !!n && n.type?.name === 'image'
    let nodePos = pos
    let node: any = $pos.nodeAfter
    if (!isImage(node) && $pos.nodeBefore && isImage($pos.nodeBefore)) {
      node = $pos.nodeBefore
      nodePos = pos - node.nodeSize
    }
    if (!isImage(node)) return
    const attrs: any = { ...(node.attrs || {}) }
    const src = String(newSrc || '').trim()
    if (src) attrs.src = src
    attrs.alt = String(newAlt || '')
    const tr = state.tr.setNodeMarkup(nodePos, node.type, attrs, node.marks)
    view.dispatch(tr.scrollIntoView())
  } catch {}
}

function deleteMilkdownImageFromDom(imgEl: HTMLImageElement) {
  try {
    const view: any = (_editor as any)?.ctx?.get?.(editorViewCtx)
    if (!view || !imgEl) return
    let pos: number | null = null
    try { pos = view.posAtDOM(imgEl, 0) } catch {}
    if (pos == null || typeof pos !== 'number') return
    const state = view.state
    const $pos = state.doc.resolve(pos)
    const isImage = (n: any) => !!n && n.type?.name === 'image'
    let nodePos = pos
    let node: any = $pos.nodeAfter
    if (!isImage(node) && $pos.nodeBefore && isImage($pos.nodeBefore)) {
      node = $pos.nodeBefore
      nodePos = pos - node.nodeSize
    }
    if (!isImage(node)) return
    const tr = state.tr.delete(nodePos, nodePos + node.nodeSize)
    view.dispatch(tr.scrollIntoView())
  } catch {}
}
// 图片源码编辑：在所见模式中双击图片，弹出 alt/src 编辑框
function enterImageSourceEdit(hitEl: HTMLElement) {
  try {
    const img = (hitEl.closest('img') as HTMLImageElement) || null
    if (!img) return
    const ov = ensureOverlayHost()
    if (!ov) return
    const hostRc = (_root as HTMLElement).getBoundingClientRect()
    const rc = img.getBoundingClientRect()
    const hostWidth = hostRc.width || 0

    const marginX = 16
    const baseWidth = rc.width || 0
    const minWidth = Math.max(320, baseWidth + 40)
    const maxWidth = Math.max(200, hostWidth - marginX * 2)
    const finalWidth = Math.min(maxWidth, minWidth)

    const wrap = document.createElement('div')
    wrap.className = 'ov-image'
    wrap.style.position = 'absolute'
    wrap.style.pointerEvents = 'none'
    const centerX = (rc.left - hostRc.left) + (rc.width / 2)
    let left = centerX - finalWidth / 2
    left = Math.max(marginX, Math.min(hostWidth - finalWidth - marginX, left))
    wrap.style.left = Math.max(0, Math.round(left)) + 'px'
    wrap.style.top = Math.max(8, Math.round(rc.bottom - hostRc.top + 8)) + 'px'
    wrap.style.width = Math.max(10, finalWidth) + 'px'

    const inner = document.createElement('div')
    inner.style.pointerEvents = 'auto'
    inner.style.background = 'var(--wysiwyg-bg)'
    inner.style.borderRadius = '4px'
    inner.style.padding = '6px'
    inner.style.boxSizing = 'border-box'
    inner.style.display = 'flex'
    inner.style.flexDirection = 'column'
    inner.style.rowGap = '4px'
    inner.style.position = 'relative'

    const altInput = document.createElement('input')
    altInput.type = 'text'
    altInput.value = img.getAttribute('alt') || ''
    altInput.placeholder = '替换文本（可选）'
    altInput.style.width = '100%'

    const urlInput = document.createElement('input')
    urlInput.type = 'text'
    // 优先使用记录下来的原始路径（file/本地相对路径等），避免展示 base64 / asset: 等转译结果
    urlInput.value = img.getAttribute('data-flymd-src-raw') || img.getAttribute('src') || ''
    urlInput.placeholder = '图片地址（必填）'
    urlInput.style.width = '100%'

    const btnRow = document.createElement('div')
    btnRow.style.display = 'flex'
    btnRow.style.justifyContent = 'flex-end'
    btnRow.style.columnGap = '8px'

    const btnDelete = document.createElement('button')
    btnDelete.type = 'button'
    btnDelete.textContent = 'Delete'

    const btnCancel = document.createElement('button')
    btnCancel.type = 'button'
    btnCancel.textContent = '取消'

    const btnOk = document.createElement('button')
    btnOk.type = 'button'
    btnOk.textContent = '确定'

    btnRow.appendChild(btnDelete)
    btnRow.appendChild(btnCancel)
    btnRow.appendChild(btnOk)

    inner.appendChild(altInput)
    inner.appendChild(urlInput)
    inner.appendChild(btnRow)
    wrap.appendChild(inner)
    ov.appendChild(wrap)

    const close = () => { try { ov.removeChild(wrap) } catch {} }
    const apply = () => {
      const src = urlInput.value.trim()
      const alt = altInput.value || ''
      if (!src) { try { urlInput.focus() } catch {}; return }
      try { img.setAttribute('data-flymd-src-raw', src) } catch {}
      try { updateMilkdownImageFromDom(img, src, alt) } catch {}
      close()
    }

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.preventDefault(); close(); return }
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); apply(); return }
    }

    altInput.addEventListener('keydown', onKey)
    urlInput.addEventListener('keydown', onKey)
    btnCancel.addEventListener('click', () => { close() })
    btnOk.addEventListener('click', () => { apply() })
    btnDelete.addEventListener('click', (ev) => {
      ev.preventDefault()
      // 第一次点击只进入"待确认"状态，第二次点击才真正删除图片
      if (!(btnDelete as any)._armed) {
        ;(btnDelete as any)._armed = true
        btnDelete.textContent = '确认删除'
        return
      }
      deleteMilkdownImageFromDom(img)
      close()
    })
    // 删除按钮失焦时重置确认状态
    btnDelete.addEventListener('blur', () => {
      if ((btnDelete as any)._armed) {
        ;(btnDelete as any)._armed = false
        btnDelete.textContent = 'Delete'
      }
    })

    setTimeout(() => { try { urlInput.focus(); urlInput.select() } catch {} }, 0)
  } catch {}
}

function enterLatexSourceEdit(hitEl: HTMLElement) {
  try {
    const mathEl = (hitEl.closest("div[data-type='math_block']") as HTMLElement) || (hitEl.closest("span[data-type='math_inline']") as HTMLElement)
    if (!mathEl) return
    const isNew = !!(mathEl as any).dataset?.flymdNewMath
    try { delete (mathEl as any).dataset?.flymdNewMath } catch {}
    const rawCode = (mathEl.dataset?.value || mathEl.textContent || '')
    const code = String(rawCode || '').trim()
    const ov = ensureOverlayHost()

    // 缓存节点位置信息，避免 blur 时位置查找失败
    const view: any = (_editor as any)?.ctx?.get?.(editorViewCtx)
    let cachedFrom = -1, cachedTo = -1
    if (view) {
      try {
        const pos = view.posAtDOM(mathEl, 0)
        if (typeof pos === 'number') {
          const state = view.state
          const $pos = state.doc.resolve(pos)
          const isMath = (n: any) => !!n && (n.type?.name === 'math_inline' || n.type?.name === 'math_block')
          const isBlockType = (mathEl.dataset?.type === 'math_block' || mathEl.tagName === 'DIV')
          const targetType = isBlockType ? 'math_block' : 'math_inline'
          // 向上遍历深度找到 math 节点
          for (let d = $pos.depth; d >= 0; d--) {
            const node = $pos.node(d)
            if (node.type?.name === targetType) {
              cachedFrom = $pos.before(d)
              cachedTo = $pos.after(d)
              break
            }
          }
          // 回退检查
          if (cachedFrom < 0) {
            if ($pos.nodeAfter && isMath($pos.nodeAfter)) {
              cachedFrom = pos
              cachedTo = pos + $pos.nodeAfter.nodeSize
            } else if ($pos.nodeBefore && isMath($pos.nodeBefore)) {
              cachedFrom = pos - $pos.nodeBefore.nodeSize
              cachedTo = pos
            }
          }
        }
      } catch {}
    }
    const hostRc = (_root as HTMLElement).getBoundingClientRect()
    const rc = mathEl.getBoundingClientRect()
    const hostWidth = hostRc.width || 0
    const isBlock = (mathEl.dataset?.type === 'math_block' || mathEl.tagName === 'DIV')

    // 计算编辑弹层宽度：在公式自身宽度基础上增加余量，并限制在容器范围内
    const marginX = 16
    const baseWidth = rc.width || 0
    const minWidth = Math.max(320, baseWidth + 40)
    const maxWidth = Math.max(200, hostWidth - marginX * 2)
    const finalWidth = Math.min(maxWidth, minWidth)

    const wrap = document.createElement('div')
    wrap.className = 'ov-katex'
    wrap.style.position = 'absolute'
    wrap.style.pointerEvents = 'none'
    // 水平居中对齐当前公式，并保证不会超出容器
    const centerX = (rc.left - hostRc.left) + (rc.width / 2)
    let left = centerX - finalWidth / 2
    left = Math.max(marginX, Math.min(hostWidth - finalWidth - marginX, left))
    wrap.style.left = Math.max(0, Math.round(left)) + 'px'
    // 垂直位置：放在公式下方留一点空隙
    wrap.style.top = Math.max(8, Math.round(rc.bottom - hostRc.top + 8)) + 'px'
    wrap.style.width = Math.max(10, finalWidth) + 'px'

    const inner = document.createElement('div')
    inner.style.pointerEvents = 'auto'
    inner.style.background = 'var(--wysiwyg-bg)'
    inner.style.borderRadius = '4px'
    inner.style.padding = '6px'
    inner.style.boxSizing = 'border-box'
    inner.style.display = 'flex'
    inner.style.flexDirection = 'column'
    inner.style.alignItems = 'stretch'

    const header = document.createElement('div')
    header.style.display = 'flex'
    header.style.justifyContent = 'flex-end'
    header.style.marginBottom = '4px'

    const delBtn = document.createElement('button')
    delBtn.type = 'button'
    delBtn.textContent = 'Delete'

    header.appendChild(delBtn)
    inner.appendChild(header)

    const ta = document.createElement('textarea')
    const placeholder = '在此输入Katex公式'
    const displayCode = (isBlock && isNew && !code) ? placeholder : code
    ta.value = (isBlock ? ('$$\n' + (displayCode || '') + '\n$$') : ('$' + (displayCode || '') + '$'))
    ta.style.width = '100%'
    // 根据公式类型与渲染高度估算一个更宽松的编辑高度，避免复杂公式被挤在两行内
    const baseLines = isBlock ? 4 : 3
    const lineHeightPx = 20
    const renderH = rc.height || 0
    const minHeightPx = Math.max(baseLines * lineHeightPx, renderH + (isBlock ? 16 : 8))
    ta.style.minHeight = minHeightPx + 'px'
    ta.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
    ta.style.fontSize = '14px'
    ta.style.lineHeight = '1.4'
    ta.style.resize = 'vertical'

    inner.appendChild(ta)

    // 统一关闭逻辑：移除覆盖层并解绑文档级事件
    let docMouseDownHandler: ((ev: MouseEvent) => void) | null = null
    const closeOverlay = () => {
      try { ov?.removeChild(wrap) } catch {}
      if (docMouseDownHandler) {
        try { document.removeEventListener('mousedown', docMouseDownHandler, true) } catch {}
        docMouseDownHandler = null
      }
    }

    const apply = () => {
      let v = ta.value
      v = String(v || '').trim()
      const isBlk = (mathEl.dataset?.type === 'math_block' || mathEl.tagName === 'DIV')
      if (isBlk) {
        const m = v.match(/^\s*\$\$\s*[\r\n]?([\s\S]*?)\s*[\r\n]?\$\$\s*$/)
        if (m) v = m[1]
      } else {
        const m = v.match(/^\s*\$([\s\S]*?)\$\s*$/)
        if (m) v = m[1]
      }
      // 更新公式并在块级公式后插入新段落（使用缓存的位置信息）
      const resultView = updateMilkdownMathFromDom(mathEl, v, isBlk, cachedFrom, cachedTo)
      closeOverlay()
      // 恢复编辑器焦点
      if (resultView) {
        setTimeout(() => {
          try { resultView.focus() } catch {}
        }, 50)
      }
    }

    ta.addEventListener('keydown', (ev) => {
      const kev = ev as KeyboardEvent
      if (kev.key === 'Escape') {
        closeOverlay()
        // 恢复编辑器焦点
        const view: any = (_editor as any)?.ctx?.get?.(editorViewCtx)
        if (view) setTimeout(() => { try { view.focus() } catch {} }, 50)
        return
      }
      if (kev.key === 'Enter' && (kev.ctrlKey || kev.metaKey)) {
        kev.preventDefault()
        apply()
      }
    })
    // 文档级点击检测：点击覆盖层外部时自动应用并关闭；点击 Delete / 文本框等内部元素则不干预
    docMouseDownHandler = (ev: MouseEvent) => {
      try {
        const t = ev.target as HTMLElement | null
        if (!t) return
        // 点击在覆盖层内部：交给内部按钮 / 文本框处理
        if (wrap.contains(t)) return
        // 点击在外部：应用当前输入并关闭编辑框
        apply()
      } catch {}
    }
    try { document.addEventListener('mousedown', docMouseDownHandler, true) } catch {}

    let deleteArmed = false
    const resetDeleteState = () => {
      if (deleteArmed) {
        deleteArmed = false
        delBtn.textContent = 'Delete'
      }
    }
    delBtn.addEventListener('click', (ev) => {
      ev.preventDefault()
      // 第一次点击只进入"待确认"状态，第二次点击才真正删除公式
      if (!deleteArmed) {
        deleteArmed = true
        delBtn.textContent = '确认删除'
        return
      }
      deleteWysiwygNodeByDom(mathEl, ['math_inline', 'math_block'])
      closeOverlay()
    })
    // 删除按钮失焦时仅重置确认状态，不再负责关闭编辑框（关闭由文档级点击和 apply 控制）
    delBtn.addEventListener('blur', (ev) => {
      const related = (ev as FocusEvent).relatedTarget as HTMLElement | null
      resetDeleteState()
      // 焦点转移回 textarea 时，继续允许编辑；其它情况由文档级点击逻辑处理
      if (related === ta) return
    })

    wrap.appendChild(inner)
    ov?.appendChild(wrap)
    setTimeout(() => { try { ta.focus(); ta.select() } catch {} }, 0)
  } catch {}
}
function renderMermaidNow() {
  console.log('[DEBUG] renderMermaidNow 被调用')
  const host = getHost()
  const ov = ensureOverlayHost()
  console.log('[DEBUG] host:', host, 'ov:', ov)
  if (!host || !ov) return

  const hostRc = (_root as HTMLElement).getBoundingClientRect()

  // 方案：使用覆盖层 + 给 pre 设置 min-height
  try {
    const allPres = Array.from(host.querySelectorAll('pre')) as HTMLElement[]
    console.log('[DEBUG] 找到的所有 pre 元素数量:', allPres.length)

    const pres: HTMLElement[] = allPres.filter(pre => {
      const langFromAttr = (pre.getAttribute('data-language') || '').toLowerCase()
      return langFromAttr === 'mermaid'
    })

    console.log('[DEBUG] 过滤后的 mermaid 代码块数量:', pres.length)

    for (const pre of pres) {
      try {
        const codeEl = pre.querySelector('code') as HTMLElement | null
        if (!codeEl) continue

        const code = (codeEl.textContent || '').trim()
        if (!code) continue

        // 为每个 pre 元素分配唯一 ID
        if (!pre.dataset.mermaidId) {
          pre.dataset.mermaidId = 'mmd-' + Math.random().toString(36).slice(2)
        }
        const mermaidId = pre.dataset.mermaidId

        // 检查是否已经渲染过
        const cached = _renderedMermaid.get(pre)
        if (cached === code) {
          console.log('[DEBUG] 代码未变化，跳过渲染')
          // 更新覆盖层位置
          const exist = ov.querySelector(`.ov-mermaid[data-mermaid-id="${mermaidId}"]`) as HTMLDivElement | null
          if (exist) {
            const rc = pre.getBoundingClientRect()
            const codeRc = codeEl.getBoundingClientRect()
            exist.style.left = Math.max(0, rc.left - hostRc.left) + 'px'
            exist.style.top = Math.max(0, codeRc.bottom - hostRc.top + 8) + 'px'
            exist.style.width = Math.max(10, rc.width) + 'px'
          }
          continue
        }

        _renderedMermaid.set(pre, code)
        console.log('[DEBUG] 开始渲染 mermaid，id:', mermaidId)

        const rc = pre.getBoundingClientRect()
        const codeRc = codeEl.getBoundingClientRect()

        // 创建覆盖层
        const wrap = document.createElement('div')
        wrap.className = 'ov-mermaid'
        wrap.dataset.mermaidId = mermaidId
        wrap.style.position = 'absolute'
        wrap.style.left = Math.max(0, rc.left - hostRc.left) + 'px'
        wrap.style.top = Math.max(0, codeRc.bottom - hostRc.top + 8) + 'px'
        wrap.style.width = Math.max(10, rc.width) + 'px'
        wrap.style.pointerEvents = 'auto'
        wrap.style.zIndex = '10'

        const inner = document.createElement('div')
        inner.style.background = 'var(--wysiwyg-bg)'
        inner.style.borderRadius = '4px'
        inner.style.padding = '8px'
        inner.style.opacity = '0'
        inner.style.transition = 'opacity 0.15s ease-in'
        inner.style.boxSizing = 'border-box'

        wrap.appendChild(inner)
        ov.appendChild(wrap)

        // 双击切换回源代码
        wrap.addEventListener('dblclick', (e) => {
          e.stopPropagation()
          wrap.style.display = 'none'
          pre.scrollIntoView({ block: 'center', behavior: 'smooth' })
        })

        // 渲染图表
        void (async () => {
          try {
            await renderMermaidInto(inner, code)
            const renderedHeight = inner.getBoundingClientRect().height

            // 关键：设置 pre 的 min-height，使用 !important 防止被覆盖
            pre.style.setProperty('min-height', (renderedHeight + 32) + 'px', 'important')
            console.log('[DEBUG] 设置 pre min-height:', renderedHeight + 32, 'px')

            requestAnimationFrame(() => { inner.style.opacity = '1' })
          } catch (e) {
            console.error('[DEBUG] 渲染失败:', e)
          }
        })()

      } catch (e) {
        console.error('[DEBUG] 处理 pre 失败:', e)
      }
    }
  } catch (e) {
    console.error('[DEBUG] renderMermaidNow 失败:', e)
  }
}







// =============== 所见模式内编辑快捷：加粗 / 斜体 / 链接 ===============
// 方案：调用 Milkdown 命令，同时在“有选区”时自动把光标移到选区末尾，避免继续输入时覆盖原文本
export async function wysiwygV2ToggleBold() {
  if (!_editor) return
  const { toggleStrongCommand } = await import('@milkdown/preset-commonmark')
  await _editor.action((ctx) => {
    const commands = ctx.get(commandsCtx)
    const view = ctx.get(editorViewCtx)
    const { state } = view
    const { empty } = state.selection
    const hadRange = !empty
    commands.call((toggleStrongCommand as any).key)
      if (hadRange) {
        try {
          const st2 = view.state
          const pos = st2.selection.to >>> 0
          const safePos = Math.max(0, Math.min(st2.doc.content.size, pos))
          let tr = st2.tr.setSelection(TextSelection.create(st2.doc, safePos))
          try { (tr as any).setStoredMarks([]) } catch {}
          view.dispatch(tr.scrollIntoView())
        } catch {}
      }
  })
}

export async function wysiwygV2ToggleItalic() {
  if (!_editor) return
  const { toggleEmphasisCommand } = await import('@milkdown/preset-commonmark')
  await _editor.action((ctx) => {
    const commands = ctx.get(commandsCtx)
    const view = ctx.get(editorViewCtx)
    const { state } = view
    const { empty } = state.selection
    const hadRange = !empty
    commands.call((toggleEmphasisCommand as any).key)
    if (hadRange) {
      try {
        const st2 = view.state
        const pos = st2.selection.to >>> 0
        const safePos = Math.max(0, Math.min(st2.doc.content.size, pos))
        let tr = st2.tr.setSelection(TextSelection.create(st2.doc, safePos))
        try { (tr as any).setStoredMarks([]) } catch {}
        view.dispatch(tr.scrollIntoView())
      } catch {}
    }
  })
}
// 所见模式链接应用：
// - 兼容旧签名：wysiwygV2ApplyLink(href, title?)
// - 新用法：wysiwygV2ApplyLink(href, label) —— 在无选区时插入带文本的链接，有选区时用 label 覆盖选中文本
export async function wysiwygV2ApplyLink(href: string, labelOrTitle?: string, maybeTitle?: string) {
  if (!_editor) return
  const { toggleLinkCommand, updateLinkCommand } = await import('@milkdown/preset-commonmark')
  await _editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const commands = ctx.get(commandsCtx)
    const { state } = view
    const { empty } = state.selection as any
    const hadRange = !empty

    // 兼容：如果传入了第三个参数，则视为旧签名 (href, title)
    const hasTitle = typeof maybeTitle === 'string'
    const title = hasTitle ? (labelOrTitle as string | undefined) : (maybeTitle as string | undefined)
    const label = hasTitle ? undefined : (labelOrTitle as string | undefined)

    const schema = state.schema as any
    const linkType = schema.marks?.link
    const attrs: any = title ? { href, title } : { href }

    // 新行为：提供了 label 时，统一用 replaceSelectionWith 插入一整个带 link mark 的文本节点
    // 这样不会出现“最后一个字符漏掉”的偏移问题，同时兼容“有选区”和“无选区”两种情况
    if (typeof label === 'string' && label && linkType) {
      try {
        let tr = state.tr
        const textNode = schema.text(label, [linkType.create(attrs)])
        // 无论是否有选区，直接用链接文本替换当前选区 / 光标位置
        tr = tr.replaceSelectionWith(textNode, false)
        // 将光标放到插入文本的末尾，避免继续输入覆盖选中文本
        const pos = tr.selection.to >>> 0
        tr = tr.setSelection(TextSelection.create(tr.doc, pos))
        // 关键：清空 storedMarks，避免后续输入继续继承链接样式
        try { (tr as any).setStoredMarks([]) } catch {}
        view.dispatch(tr.scrollIntoView())
        return
      } catch {
        // 若手工事务失败，兜底退回旧逻辑
      }
    }

    // 旧行为（无 label）：调用 Milkdown 内置命令，并在“有选区”时把光标移到链接之后
    if (!commands.call((toggleLinkCommand as any).key, attrs)) {
      commands.call((updateLinkCommand as any).key, attrs)
      return
    }
    try {
      const st2 = view.state
      if (!st2.selection.empty) {
        const pos = st2.selection.to >>> 0
        const safePos = Math.max(0, Math.min(st2.doc.content.size, pos))
        let tr = st2.tr.setSelection(TextSelection.create(st2.doc, safePos))
        try { (tr as any).setStoredMarks([]) } catch {}
        view.dispatch(tr.scrollIntoView())
      }
    } catch {}
  })
}

// 获取当前选中的文本
export function wysiwygV2GetSelectedText(): string {
  if (!_editor) return ''
  try {
    const view = (_editor as any).ctx?.get?.(editorViewCtx)
    if (!view) return ''
    const { state } = view
    const { from, to } = state.selection
    const selectedText = state.doc.textBetween(from, to, ' ')
    return selectedText || ''
  } catch {
    return ''
  }
}




