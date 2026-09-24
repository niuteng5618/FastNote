// 扩展管理面板与列表 UI 模块
// 从 main.ts 拆分：负责扩展 overlay + 列表 + 市场 UI

import type { Store } from '@tauri-apps/plugin-store'
import { open } from '@tauri-apps/plugin-dialog'
import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs'
import { createPluginMarket, FALLBACK_INSTALLABLES, compareInstallableItems, type InstallableItem } from './market'
import {
  loadInstalledPlugins,
  saveInstalledPlugins,
  getPluginUpdateStates,
  fetchTextSmart,
  type InstalledPlugin,
  type PluginUpdateState,
} from './runtime'
import { t } from '../i18n'
import { appendLog } from '../core/logger'
import { isLikelyLocalPath } from '../core/pathUtils'

// 宿主依赖：通过注入避免与 main.ts 形成循环引用
export interface ExtensionsPanelHost {
  getStore(): Store | null
  pluginNotice(msg: string, level?: 'ok' | 'err', ms?: number): void
  showError(msg: string, err?: unknown): void
  confirmNative(message: string): Promise<boolean>
  openUploaderDialog(): void | Promise<void>
  openWebdavSyncDialog(): void | Promise<void>
  getWebdavSyncConfig(): Promise<{ enabled: boolean }>
  openInBrowser(url: string): void | Promise<void>
  installPluginFromGit(ref: string, opt?: { enabled?: boolean; showInMenuBar?: boolean }): Promise<InstalledPlugin>
  installPluginFromLocal(path: string, opt?: { enabled?: boolean; showInMenuBar?: boolean }): Promise<InstalledPlugin>
  activatePlugin(p: InstalledPlugin): Promise<void>
  deactivatePlugin(id: string): Promise<void>
  getActivePluginModule(id: string): any
  coreAiExtensionId: string
  markCoreExtensionBlocked(id: string): Promise<void>
  // 由宿主负责删除插件目录（内部使用 AppLocalData 等路径信息）
  removePluginDir(dir: string): Promise<void>
  // 打开插件设置：由宿主构造上下文并调用 mod.openSettings
  openPluginSettings(p: InstalledPlugin): Promise<void>
}

let host: ExtensionsPanelHost | null = null

// 官方扩展在市场中的多语言映射（按插件 id → i18n key）
const MARKET_OFFICIAL_I18N: Record<string, { name: string; author: string; desc: string }> = {
  'ai-assistant': {
    name: 'ext.ai.name',
    author: 'ext.ai.author',
    desc: 'ext.ai.desc',
  },
  'markdown-table': {
    name: 'ext.markdownTable.name',
    author: 'ext.markdownTable.author',
    desc: 'ext.markdownTable.desc',
  },
  'editor-enhancer': {
    name: 'ext.editorEnhancer.name',
    author: 'ext.editorEnhancer.author',
    desc: 'ext.editorEnhancer.desc',
  },
  'batch-pdf': {
    name: 'ext.pdf.name',
    author: 'ext.pdf.author',
    desc: 'ext.pdf.desc',
  },
  'typecho-publisher-flymd': {
    name: 'ext.typechoPub.name',
    author: 'ext.typechoPub.author',
    desc: 'ext.typechoPub.desc',
  },
  wordcount: {
    name: 'ext.wordcount.name',
    author: 'ext.wordcount.author',
    desc: 'ext.wordcount.desc',
  },
  'git-history': {
    name: 'ext.gitHistory.name',
    author: 'ext.gitHistory.author',
    desc: 'ext.gitHistory.desc',
  },
  'flymd-backlinks': {
    name: 'ext.backlinks.name',
    author: 'ext.backlinks.author',
    desc: 'ext.backlinks.desc',
  },
  'flymd-graph-view': {
    name: 'ext.graphView.name',
    author: 'ext.graphView.author',
    desc: 'ext.graphView.desc',
  },
  'office-importer': {
    name: 'ext.officeImporter.name',
    author: 'ext.officeImporter.author',
    desc: 'ext.officeImporter.desc',
  },
  's3-gallery': {
    name: 'ext.s3Gallery.name',
    author: 'ext.s3Gallery.author',
    desc: 'ext.s3Gallery.desc',
  },
  autoyaml: {
    name: 'ext.autoyaml.name',
    author: 'ext.autoyaml.author',
    desc: 'ext.autoyaml.desc',
  },
  'typecho-manager': {
    name: 'ext.typechoManager.name',
    author: 'ext.typechoManager.author',
    desc: 'ext.typechoManager.desc',
  },
  'xxtui-todo-push': {
    name: 'ext.todoPush.name',
    author: 'ext.todoPush.author',
    desc: 'ext.todoPush.desc',
  },
  mineru: {
    name: 'ext.mineru.name',
    author: 'ext.mineru.author',
    desc: 'ext.mineru.desc',
  },
  pdf2doc: {
    name: 'ext.pdf2doc.name',
    author: 'ext.pdf2doc.author',
    desc: 'ext.pdf2doc.desc',
  },
  'whiteboard-view': {
    name: 'ext.whiteboardView.name',
    author: 'ext.whiteboardView.author',
    desc: 'ext.whiteboardView.desc',
  },
  'blinko-snap': {
    name: 'ext.blinkoSnap.name',
    author: 'ext.blinkoSnap.author',
    desc: 'ext.blinkoSnap.desc',
  },
  'floating-toolbar': {
    name: 'ext.floatingToolbar.name',
    author: 'ext.floatingToolbar.author',
    desc: 'ext.floatingToolbar.desc',
  },
  'property-view': {
    name: 'ext.propertyView.name',
    author: 'ext.propertyView.author',
    desc: 'ext.propertyView.desc',
  },
  'xhs-copywriter': {
    name: 'ext.xhsCopywriter.name',
    author: 'ext.xhsCopywriter.author',
    desc: 'ext.xhsCopywriter.desc',
  },
  'local-collab-os': {
    name: 'ext.localCollab.name',
    author: 'ext.localCollab.author',
    desc: 'ext.localCollab.desc',
  },
}

// 扩展分类多语言映射：索引中的中文分类 → i18n key
const MARKET_CATEGORY_I18N: Record<string, string> = {
  '发布/同步': 'ext.category.publishSync',
  '编辑增强': 'ext.category.editing',
  '文档工具': 'ext.category.docTools',
  '协同/版本': 'ext.category.collab',
  AI: 'ext.category.ai',
  '图床上传': 'ext.category.imageHosting',
  '知识管理': 'ext.category.knowledge',
}

type VendorKind = 'official' | 'thirdParty'

function normalizeAuthor(raw?: string | null): string {
  try {
    let v = String(raw || '')
      .toLowerCase()
      .replace(/\s+/g, '')
    // 去掉常见前缀，避免把“作者：xxx / By: xxx”误判为名字的一部分
    v = v.replace(/^(作者|author|by)[：:]/, '')
    return v
  } catch {
    return ''
  }
}

function isOfficialAuthor(raw?: string | null): boolean {
  const v = normalizeAuthor(raw)
  if (!v) return false
  // 规则：作者包含 flymd / 飞速markdown 即视为官方
  // 但只接受“以 flymd / 飞速markdown 开头”，避免“adapted from flymd ...”这类误判
  return v.startsWith('flymd') || v.startsWith('飞速markdown')
}

function getVendorKindByAuthor(author?: string | null): VendorKind {
  return isOfficialAuthor(author) ? 'official' : 'thirdParty'
}

function createVendorTag(kind: VendorKind, authorRaw?: string | null): HTMLSpanElement {
  const tag = document.createElement('span')
  tag.className = 'ext-tag ext-vendor-tag'
  tag.setAttribute('data-vendor', kind)
  tag.textContent = kind === 'official'
    ? t('ext.vendor.official' as any)
    : t('ext.vendor.thirdParty' as any)
  try {
    if (kind === 'thirdParty') {
      tag.title = t('ext.thirdParty.notice' as any)
    } else if (authorRaw) {
      tag.title = String(authorRaw)
    }
  } catch {}
  return tag
}

function resolveMarketAuthorById(id: string): string {
  try {
    for (const it of _extLastMarketItems || []) {
      if (!it || it.id !== id) continue
      if (it.author) return String(it.author)
      return ''
    }
  } catch {}
  return ''
}

function resolveInstalledAuthor(p: InstalledPlugin): string {
  try {
    if (p && (p as any).author) return String((p as any).author)
  } catch {}
  return resolveMarketAuthorById(p?.id || '')
}

function getCategoryLabel(raw: string): string {
  try {
    const key = MARKET_CATEGORY_I18N[raw]
    if (key) return t(key as any)
  } catch {}
  return raw
}

// 注：图床管理 / WebDAV 同步是写死在宿主里的功能（非真扩展，逻辑编译进主程序），
// 曾在此用 builtinPlugins 影子条目伪装成扩展显示在扩展管理列表里；现按「轻量、不伪装」原则
// 移除该展示，功能本身保留，入口收敛到左侧「插件」下拉菜单（pluginRuntimeHost.ts 的 addToPluginsMenu）。
// 若未来要做成真正可安装的扩展，需要自建市场源（原市场无这两个插件）。

// 扩展管理面板内部状态
let _extOverlayEl: HTMLDivElement | null = null
let _extListHost: HTMLDivElement | null = null
let _extInstallInput: HTMLInputElement | null = null
let _extMarketSearchText = ''
let _extMarketCategory = ''
let _extLastMarketItems: InstallableItem[] = []
// 室内缓存：已安装映射与可更新状态，避免频繁网络请求阻塞 UI
let _extLastInstalledMap: Record<string, InstalledPlugin> = {}
let _extLastUpdateMap: Record<string, PluginUpdateState> = {}
let _extMarketInstalledOnly = false // 是否仅显示已安装（隐藏市场区块）
let _extUpdatesOnly = false  // 是否仅显示可更新扩展（已安装区块过滤）
let _extGlobalOrder: Record<string, number> = {} // 扩展卡片统一排序顺序
let _extOverlayRenderedOnce = false  // 是否已完成首次渲染
let _extApplyMarketFilter: ((itemsOverride?: InstallableItem[] | null) => Promise<void>) | null = null

type ExtPanelUiPrefs = {
  // 扩展市场：仅显示已安装
  marketInstalledOnly?: boolean
  // 已安装区块：仅显示可更新
  updatesOnly?: boolean
}

async function loadExtPanelUiPrefs(): Promise<ExtPanelUiPrefs> {
  try {
    if (!host) return {}
    const store = host.getStore()
    if (!store) return {}
    const plugins = ((await store.get('plugins')) as any) || {}
    const ui = plugins && typeof plugins === 'object' ? (plugins as any).ui : null
    if (!ui || typeof ui !== 'object') return {}
    return {
      marketInstalledOnly: typeof ui.marketInstalledOnly === 'boolean' ? ui.marketInstalledOnly : undefined,
      updatesOnly: typeof ui.updatesOnly === 'boolean' ? ui.updatesOnly : undefined,
    }
  } catch {
    return {}
  }
}

async function saveExtPanelUiPrefs(patch: ExtPanelUiPrefs): Promise<void> {
  try {
    if (!host) return
    const store = host.getStore()
    if (!store) return
    const raw = (await store.get('plugins')) as any
    const old = raw && typeof raw === 'object' ? raw : {}
    const ui = old.ui && typeof old.ui === 'object' ? old.ui : {}
    if (typeof patch.marketInstalledOnly === 'boolean') ui.marketInstalledOnly = patch.marketInstalledOnly
    if (typeof patch.updatesOnly === 'boolean') ui.updatesOnly = patch.updatesOnly
    old.ui = ui
    await store.set('plugins', old)
    await store.save()
  } catch {}
}

// 插件市场实例（专供扩展管理 UI 使用）
const pluginMarket = createPluginMarket({
  getStore: () => {
    try { return host?.getStore() || null } catch { return null }
  },
  fetchTextSmart,
})

export function initExtensionsPanel(h: ExtensionsPanelHost): void {
  host = h
}

export async function loadInstallablePlugins(force = false): Promise<InstallableItem[]> {
  try {
    return await pluginMarket.loadInstallablePlugins(force)
  } catch {
    // 兜底：无网络或索引失败时使用内置列表
    return FALLBACK_INSTALLABLES.slice()
  }
}

// 统一获取/写入已安装扩展映射（只依赖宿主提供的 Store）
async function getInstalledPluginsFromStore(): Promise<Record<string, InstalledPlugin>> {
  try {
    if (!host) return {}
    const store = host.getStore()
    const map = await loadInstalledPlugins(store)
    _extLastInstalledMap = map || {}
    return map
  } catch {
    _extLastInstalledMap = {}
    return {}
  }
}

async function setInstalledPluginsToStore(map: Record<string, InstalledPlugin>): Promise<void> {
  try {
    if (!host) return
    const store = host.getStore()
    await saveInstalledPlugins(store, map)
    _extLastInstalledMap = map || {}
  } catch {}
}

async function backfillInstalledAuthors(installedMap: Record<string, InstalledPlugin>): Promise<void> {
  try {
    if (!installedMap || !host) return
    const updates: Record<string, string> = {}

    const tasks = Object.values(installedMap).map(async (p) => {
      try {
        if (!p || p.builtin) return
        if ((p as any).author) return
        if (!p.dir) return

        const manifestPath = `${p.dir}/manifest.json`
        const text = await readTextFile(manifestPath as any, {
          baseDir: BaseDirectory.AppLocalData,
        } as any)
        const json = JSON.parse(String(text || '')) as any
        const author = json && typeof json.author === 'string' ? json.author.trim() : ''
        if (!author) return
        updates[p.id] = author
      } catch {}
    })

    await Promise.all(tasks)
    const ids = Object.keys(updates)
    if (!ids.length) return

    for (const id of ids) {
      const p = installedMap[id]
      if (!p) continue
      ;(p as any).author = updates[id]
      installedMap[id] = p
    }

    await setInstalledPluginsToStore(installedMap)
  } catch {}
}

// 获取扩展卡片在统一网格中的排序序号（越小越靠前）
function getPluginOrder(id: string, name?: string, bias = 0): number {
  try {
    const key = id || ''
    if (key && Object.prototype.hasOwnProperty.call(_extGlobalOrder, key)) {
      return _extGlobalOrder[key]
    }
    const base = 50_000 + bias
    const label = String(name || id || '').toLowerCase()
    if (!label) return base
    const ch = label.charCodeAt(0)
    return base + (Number.isFinite(ch) ? ch : 0)
  } catch {
    return 99_999
  }
}

// 升级已安装扩展：卸载旧版本并在原位置重装
async function updateInstalledPlugin(p: InstalledPlugin, info: PluginUpdateState): Promise<InstalledPlugin> {
  if (!host) throw new Error('ExtensionsPanelHost 未初始化')
  const enabled = !!p.enabled
  const showInMenuBar =
    typeof p.showInMenuBar === 'boolean' ? p.showInMenuBar : true
  try { await host.deactivatePlugin(p.id) } catch {}
  try { await host.removePluginDir(p.dir) } catch {}
  const rec = await host.installPluginFromGit(info.manifestUrl, {
    enabled,
    showInMenuBar,
  })
  try {
    if (enabled) await host.activatePlugin(rec)
  } catch {}
  return rec
}

// 创建扩展市场加载指示器
function createLoadingIndicator(): HTMLElement {
  const container = document.createElement('div')
  container.className = 'ext-loading'

  const spinner = document.createElement('div')
  spinner.className = 'ext-loading-spinner'

  const text = document.createElement('div')
  text.className = 'ext-loading-text'
  text.textContent = t('ext.market.loading')

  container.appendChild(spinner)
  container.appendChild(text)

  return container
}

// 仅刷新“已安装扩展”区块（避免每次操作都重建市场列表）
export async function refreshInstalledExtensionsUI(): Promise<void> {
  try {
    if (!_extListHost) return
    const hostEl = _extListHost
    const unifiedList = hostEl.querySelector('.ext-list') as HTMLDivElement | null
    if (!unifiedList) return

    let installedMap: Record<string, InstalledPlugin> = {}
	    try {
	      installedMap = await getInstalledPluginsFromStore()
	    } catch {
	      installedMap = {}
	    }
	    try { await backfillInstalledAuthors(installedMap) } catch {}
	    _extLastInstalledMap = installedMap

	    const updateMap: Record<string, PluginUpdateState> = _extLastUpdateMap || {}

    renderInstalledExtensions(unifiedList, installedMap, updateMap)

    // 内置扩展（图床 / WebDAV 同步）已不在扩展列表显示，无需再刷新其状态标签
  } catch {}
}

// 渲染“已安装扩展”区块（统一复用，支持局部刷新）
function renderInstalledExtensions(
  unifiedList: HTMLDivElement,
  installedMap: Record<string, InstalledPlugin>,
  updateMap: Record<string, PluginUpdateState>
): void {
  try {
    const installedRows = unifiedList.querySelectorAll('[data-type="installed"]')
    installedRows.forEach((row) => row.remove())
  } catch {}

  const keywordRaw = (_extMarketSearchText || '').trim().toLowerCase()
  let arr = Object.values(installedMap).filter((p) => {
    if (!keywordRaw) return true
    try {
      const parts: string[] = []
      if (p.name) parts.push(String(p.name))
      if (p.id) parts.push(String(p.id))
      if (p.description) parts.push(String(p.description))
      const hay = parts.join(' ').toLowerCase()
      return hay.includes(keywordRaw)
    } catch {
      return true
    }
  })

  if (_extUpdatesOnly) {
    arr = arr.filter((p) => !!updateMap[p.id])
  }

  // 按分类过滤已安装扩展（分类来源于市场索引 _extLastMarketItems），仅在选择了分类时生效
  const selectedCategory = (_extMarketCategory || '').trim()
  if (selectedCategory) {
    const catMap: Record<string, string> = {}
    try {
      for (const it of _extLastMarketItems || []) {
        if (!it || !(it as any).id) continue
        const c = (it as any).category
        if (typeof c === 'string' && c) {
          catMap[(it as any).id] = c
        }
      }
    } catch {}
    arr = arr.filter((p) => {
      try {
        const c = catMap[p.id]
        return c === selectedCategory
      } catch {
        return false
      }
    })
  }

  arr = arr.slice().sort((a, b) => {
    const na = String(a?.name || a?.id || '')
    const nb = String(b?.name || b?.id || '')
    const oa = getPluginOrder(a.id, na)
    const ob = getPluginOrder(b.id, nb)
    if (oa !== ob) return oa - ob
    return na.localeCompare(nb, 'en', { sensitivity: 'base' })
  })

  for (const p of arr) {
    const row = document.createElement('div')
    row.className = 'ext-item'
    row.setAttribute('data-type', 'installed')
    try { row.style.order = String(getPluginOrder(p.id, p.name || p.id)) } catch {}
    const meta = document.createElement('div'); meta.className = 'ext-meta'
    const name = document.createElement('div'); name.className = 'ext-name'
    const nameText = document.createElement('span')
    const official = MARKET_OFFICIAL_I18N[p.id]
    const baseName = official ? t(official.name as any) : (p.name || p.id)
    const fullName = `${baseName} ${p.version ? '(' + p.version + ')' : ''}`
    nameText.textContent = fullName
    nameText.title = fullName
    name.appendChild(nameText)

    const right = document.createElement('div')
    right.className = 'ext-name-right'
    const authorRaw = resolveInstalledAuthor(p)
    right.appendChild(createVendorTag(getVendorKindByAuthor(authorRaw), authorRaw))

    const installedTag = document.createElement('span')
    installedTag.className = 'ext-tag'
    installedTag.textContent = t('ext.filter.installedChip')
    installedTag.style.color = '#22c55e'
    right.appendChild(installedTag)
    const updateInfo = updateMap[p.id]
    if (updateInfo) {
      const badge = document.createElement('span'); badge.className = 'ext-update-badge'; badge.textContent = 'UP'
      right.appendChild(badge)
    }
    name.appendChild(right)
    const desc = document.createElement('div'); desc.className = 'ext-desc'
    const descText = official ? t(official.desc as any) : (p.description || p.dir)
    desc.textContent = descText
    meta.appendChild(name); meta.appendChild(desc)
    const actions = document.createElement('div'); actions.className = 'ext-actions'

    if (p.enabled && host) {
      const btnSet = document.createElement('button'); btnSet.className = 'btn'; btnSet.textContent = t('ext.settings')
      btnSet.addEventListener('click', async () => {
        try {
          await host.openPluginSettings(p)
        } catch {}
      })
      actions.appendChild(btnSet)
    }

    if (host) {
      const btnToggle = document.createElement('button'); btnToggle.className = 'btn'; btnToggle.textContent = p.enabled ? t('ext.toggle.disable') : t('ext.toggle.enable')
      btnToggle.addEventListener('click', async () => {
        try {
          p.enabled = !p.enabled
          installedMap[p.id] = p
          await setInstalledPluginsToStore(installedMap)
          if (p.enabled) await host.activatePlugin(p)
          else await host.deactivatePlugin(p.id)
          await refreshInstalledExtensionsUI()
        } catch (err) { host.showError(t('ext.toggle.fail'), err) }
      })
      const info = updateMap[p.id]
      if (info) {
        const btnUpdate = document.createElement('button'); btnUpdate.className = 'btn'; btnUpdate.textContent = t('ext.update.btn')
        btnUpdate.addEventListener('click', async () => {
          try {
            btnUpdate.textContent = t('ext.update.btn') + '...'; (btnUpdate as HTMLButtonElement).disabled = true
            await updateInstalledPlugin(p, info)
            try { delete _extLastUpdateMap[p.id] } catch {}
            await refreshInstalledExtensionsUI()
            host.pluginNotice(t('ext.update.ok'), 'ok', 1500)
          } catch (err) {
            try { btnUpdate.textContent = t('ext.update.btn') } catch {}
            try { (btnUpdate as HTMLButtonElement).disabled = false } catch {}
            host.showError(t('ext.update.fail'), err)
          }
        })
        actions.appendChild(btnUpdate)
      }
      const btnRemove = document.createElement('button'); btnRemove.className = 'btn warn'; btnRemove.textContent = t('ext.remove')
      btnRemove.addEventListener('click', async () => {
        if (!host) return
        const ok = await host.confirmNative(t('ext.remove.confirm', { name: p.name || p.id }))
        if (!ok) return
        try {
          await host.deactivatePlugin(p.id)
          await host.removePluginDir(p.dir)
          delete installedMap[p.id]; await setInstalledPluginsToStore(installedMap)
          if (p.id === host.coreAiExtensionId) {
            await host.markCoreExtensionBlocked(p.id)
          }
          await refreshExtensionsUI()
          host.pluginNotice(t('ext.removed'), 'ok', 1200)
        } catch (err) { host.showError(t('ext.remove.fail'), err) }
      })
      actions.appendChild(btnToggle)
      actions.appendChild(btnRemove)
    }

    row.appendChild(meta); row.appendChild(actions)
    unifiedList.appendChild(row)
  }
}

export async function refreshExtensionsUI(): Promise<void> {
  if (!_extListHost) return
  const container = _extListHost
  container.innerHTML = ''

  // 先恢复筛选状态：避免更新/删除触发刷新后丢失选中态
  try {
    const prefs = await loadExtPanelUiPrefs()
    if (typeof prefs.marketInstalledOnly === 'boolean') _extMarketInstalledOnly = prefs.marketInstalledOnly
    if (typeof prefs.updatesOnly === 'boolean') _extUpdatesOnly = prefs.updatesOnly
  } catch {}

  // 1) 创建统一的扩展列表容器
  const unifiedSection = document.createElement('div')
  unifiedSection.className = 'ext-section'
  const hd = document.createElement('div')
  hd.className = 'ext-subtitle'
  const hdText = document.createElement('span')
  hdText.textContent = t('ext.header.manage')
  hd.appendChild(hdText)

  const loadingSpinner = document.createElement('span')
  loadingSpinner.className = 'ext-loading-spinner'
  loadingSpinner.style.cssText = 'display:inline-block;width:14px;height:14px;border:2px solid rgba(127,127,127,0.2);border-top-color:#2563eb;border-radius:50%;animation:ext-spin 0.8s linear infinite;margin-left:10px'
  hd.appendChild(loadingSpinner)

  // 仅显示已安装开关
  const installedOnlyWrap = document.createElement('label')
  installedOnlyWrap.className = 'ext-market-channel'
  installedOnlyWrap.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer'
  const installedOnlyCheckbox = document.createElement('input')
  installedOnlyCheckbox.type = 'checkbox'
  installedOnlyCheckbox.id = 'ext-installed-only'
  installedOnlyCheckbox.checked = _extMarketInstalledOnly
  installedOnlyCheckbox.style.cursor = 'pointer'
  installedOnlyCheckbox.addEventListener('change', () => {
    _extMarketInstalledOnly = installedOnlyCheckbox.checked
    void saveExtPanelUiPrefs({ marketInstalledOnly: _extMarketInstalledOnly })
    void applyMarketFilter()
  })
  const installedOnlyLabel = document.createElement('span')
  installedOnlyLabel.textContent = t('ext.filter.installedOnly')
  installedOnlyLabel.style.fontSize = '12px'
  installedOnlyWrap.appendChild(installedOnlyCheckbox)
  installedOnlyWrap.appendChild(installedOnlyLabel)
  hd.appendChild(installedOnlyWrap)

  // 仅显示“可更新”的已安装扩展
  const updatesOnlyWrap = document.createElement('label')
  updatesOnlyWrap.className = 'ext-market-channel'
  updatesOnlyWrap.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer'
  const updatesOnlyCheckbox = document.createElement('input')
  updatesOnlyCheckbox.type = 'checkbox'
  updatesOnlyCheckbox.id = 'ext-updates-only'
  updatesOnlyCheckbox.checked = _extUpdatesOnly
  updatesOnlyCheckbox.style.cursor = 'pointer'
  updatesOnlyCheckbox.addEventListener('change', () => {
    _extUpdatesOnly = updatesOnlyCheckbox.checked
    void saveExtPanelUiPrefs({ updatesOnly: _extUpdatesOnly })
    void (async () => {
      try { await refreshInstalledExtensionsUI() } catch {}
      try { await applyMarketFilter() } catch {}
    })()
  })
  const updatesOnlyLabel = document.createElement('span')
  updatesOnlyLabel.textContent = t('ext.filter.updatesOnly')
  updatesOnlyLabel.style.fontSize = '12px'
  updatesOnlyWrap.appendChild(updatesOnlyCheckbox)
  updatesOnlyWrap.appendChild(updatesOnlyLabel)
  hd.appendChild(updatesOnlyWrap)

  // 分类选择：仅当市场索引中存在分类信息时显示
  const categoryWrap = document.createElement('div')
  categoryWrap.className = 'ext-market-channel'
  categoryWrap.id = 'ext-category-wrap'
  const categoryLabel = document.createElement('span')
  categoryLabel.className = 'ext-market-channel-label'
  categoryLabel.textContent = t('ext.market.category.label')
  const categorySelect = document.createElement('select')
  categorySelect.className = 'ext-market-channel-select'
  categorySelect.id = 'ext-category-select'
  categorySelect.addEventListener('change', () => {
    _extMarketCategory = categorySelect.value || ''
    void (async () => {
      try { await refreshInstalledExtensionsUI() } catch {}
      try { await applyMarketFilter() } catch {}
    })()
  })
  categoryWrap.appendChild(categoryLabel)
  categoryWrap.appendChild(categorySelect)
  hd.appendChild(categoryWrap)

  // 渠道选择：GitHub / 官网
  const channelWrap = document.createElement('div')
  channelWrap.className = 'ext-market-channel'
  const channelLabel = document.createElement('span')
  channelLabel.className = 'ext-market-channel-label'
  channelLabel.textContent = t('ext.market.channel')
  const channelSelect = document.createElement('select')
  channelSelect.className = 'ext-market-channel-select'
  const optGithub = document.createElement('option')
  optGithub.value = 'github'
  optGithub.textContent = t('ext.market.channel.github')
  const optOfficial = document.createElement('option')
  optOfficial.value = 'official'
  optOfficial.textContent = t('ext.market.channel.official')
  channelSelect.appendChild(optGithub)
  channelSelect.appendChild(optOfficial)
  ;(async () => {
    try {
      const ch = await pluginMarket.getMarketChannel()
      channelSelect.value = ch === 'official' ? 'official' : 'github'
    } catch {
      channelSelect.value = 'github'
    }
  })()
  channelSelect.addEventListener('change', () => {
    const v = channelSelect.value === 'official' ? 'official' : 'github'
    void (async () => {
      await pluginMarket.setMarketChannel(v)
      await loadInstallablePlugins(true)
      await refreshExtensionsUI()
    })()
  })
  channelWrap.appendChild(channelLabel)
  channelWrap.appendChild(channelSelect)
  hd.appendChild(channelWrap)

  // 搜索框
  const searchWrap = document.createElement('div')
  searchWrap.className = 'ext-market-search'
  const searchInput = document.createElement('input')
  searchInput.type = 'text'
  searchInput.className = 'ext-market-search-input'
  searchInput.placeholder = t('ext.market.search.placeholder')
  if (_extMarketSearchText) searchInput.value = _extMarketSearchText
  searchInput.addEventListener('input', () => {
    _extMarketSearchText = searchInput.value || ''
    void (async () => {
      try { await refreshInstalledExtensionsUI() } catch {}
      try { await applyMarketFilter() } catch {}
    })()
  })
  searchWrap.appendChild(searchInput)
  hd.appendChild(searchWrap)

  const btnRefresh = document.createElement('button'); btnRefresh.className = 'btn'; btnRefresh.textContent = t('ext.refresh')
  btnRefresh.addEventListener('click', async () => {
    try {
      (btnRefresh as HTMLButtonElement).disabled = true
      await loadInstallablePlugins(true)
      await refreshExtensionsUI()
    } finally {
      (btnRefresh as HTMLButtonElement).disabled = false
    }
  })
  hd.appendChild(btnRefresh)
  unifiedSection.appendChild(hd)

  const thirdPartyNote = document.createElement('div')
  thirdPartyNote.className = 'ext-thirdparty-note'
  thirdPartyNote.textContent = t('ext.thirdParty.notice' as any)
  unifiedSection.appendChild(thirdPartyNote)

  // 统一的扩展列表
  const unifiedList = document.createElement('div')
  unifiedList.className = 'ext-list'
  unifiedSection.appendChild(unifiedList)
  container.appendChild(unifiedSection)

  // 2) 内置扩展（图床管理 / WebDAV 同步）不再在扩展管理列表中显示：
  //    它们是宿主内置功能而非真扩展（见文件顶部 builtinPlugins 注释），入口在「插件」下拉菜单。

  // 3) 并行加载“已安装扩展列表”和“市场索引”，避免无谓的串行等待
  let installedMap: Record<string, InstalledPlugin> = {}
  let marketItems: InstallableItem[] = []

  // 市场列表过滤与渲染（可选接受一份覆盖的索引，用于后台静默刷新）
  async function applyMarketFilter(itemsOverride?: InstallableItem[] | null): Promise<void> {
    try {
      const marketRows = unifiedList.querySelectorAll('[data-type="market"]')
      marketRows.forEach(r => r.remove())

      if (installedOnlyCheckbox.checked || _extUpdatesOnly) {
        return
      }

      const base = Array.isArray(itemsOverride) ? itemsOverride : marketItems
      let source = Array.isArray(base) ? base : []
      if (!source || source.length === 0) {
        const loadingRow = document.createElement('div')
        loadingRow.className = 'ext-item'
        loadingRow.setAttribute('data-type', 'market')
        loadingRow.appendChild(createLoadingIndicator())
        unifiedList.appendChild(loadingRow)
        return
      }

      let installedMapNow: Record<string, InstalledPlugin> = {}
      try {
        installedMapNow = await getInstalledPluginsFromStore()
      } catch {
        installedMapNow = {}
      }
      const installedIds = new Set(Object.keys(installedMapNow))

      const keywordRaw = (_extMarketSearchText || '').trim().toLowerCase()
      let items = source.filter((it) => {
        try {
          if (!it || !it.id) return false
          if (installedIds.has(it.id)) return false
          return true
        } catch {
          return true
        }
      })

      const category = (_extMarketCategory || '').trim()
      if (category) {
        items = items.filter((it) => {
          try {
            const c = (it as any).category
            return c === category
          } catch {
            return false
          }
        })
      }

      if (keywordRaw) {
        items = items.filter((it) => {
          try {
            const parts: string[] = []
            if (it.name) parts.push(String(it.name))
            if (it.id) parts.push(String(it.id))
            if (it.description) parts.push(String(it.description))
            if (it.author) parts.push(String(it.author))
            const hay = parts.join(' ').toLowerCase()
            return hay.includes(keywordRaw)
          } catch {
            return true
          }
        })
      }

      try {
        items = items.slice().sort(compareInstallableItems)
      } catch {}

      if (!items.length) {
        const hasOtherRows = unifiedList.querySelector('[data-type="installed"], [data-type="builtin"]')
        if (!hasOtherRows) {
          const empty = document.createElement('div')
          empty.className = 'ext-empty'
          empty.textContent = t('ext.market.empty.search')
          empty.setAttribute('data-type', 'market')
          unifiedList.appendChild(empty)
        }
        return
      }

      for (const it of items) {
        const row = document.createElement('div')
        row.className = 'ext-item'
        row.setAttribute('data-type', 'market')
        try { row.setAttribute('data-plugin-id', String(it.id || '')) } catch {}

        const meta = document.createElement('div'); meta.className = 'ext-meta'
        const name = document.createElement('div'); name.className = 'ext-name'
        const idStr = String(it.id || '')
        const official = MARKET_OFFICIAL_I18N[idStr]
        const fullName = official ? t(official.name as any) : String(it.name || it.id)
        try { row.style.order = String(getPluginOrder(idStr, fullName)) } catch {}
        const spanName = document.createElement('span')
        spanName.textContent = fullName
        spanName.title = fullName
        name.appendChild(spanName)

        try {
          if ((it as any).featured === true) {
            const badge = document.createElement('span')
            badge.className = 'ext-tag'
            badge.textContent = t('ext.tag.featured' as any)
            badge.style.marginLeft = '8px'
            badge.style.color = '#f97316'
            name.appendChild(badge)
          }
        } catch {}

        const desc = document.createElement('div'); desc.className = 'ext-desc'
        const descText = document.createElement('span')
        const descStr = official ? t(official.desc as any) : (it.description ? String(it.description) : '')
        if (descStr) {
          descText.textContent = descStr
          desc.appendChild(descText)
        }
        if (official || it.author || it.homepage) {
          const spacing = document.createTextNode('  ')
          desc.appendChild(spacing)
          if (official || it.author) {
            const authorSpan = document.createElement('span')
            if (official) {
              authorSpan.textContent = t(official.author as any)
            } else {
              authorSpan.textContent = t('ext.author') + (it.author || '')
            }
            desc.appendChild(authorSpan)
            if (it.homepage) { desc.appendChild(document.createTextNode(' ')) }
          }
          if (it.homepage && host) {
            const a = document.createElement('a'); a.href = it.homepage!; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = t('ext.homepage')
            a.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); try { void host.openInBrowser(it.homepage!) } catch {} })
            desc.appendChild(a)
          }
        }
        meta.appendChild(name); meta.appendChild(desc)

        const actions = document.createElement('div'); actions.className = 'ext-actions'
        if (host) {
          const right = document.createElement('div')
          right.className = 'ext-actions-right'
          right.appendChild(createVendorTag(getVendorKindByAuthor(it.author), it.author))

          const btnInstall = document.createElement('button'); btnInstall.className = 'btn primary'; btnInstall.textContent = t('ext.install.btn')
          btnInstall.addEventListener('click', async () => {
            try {
              btnInstall.textContent = t('ext.install.btn') + '...'; (btnInstall as HTMLButtonElement).disabled = true
              const rec = await host.installPluginFromGit(it.install.ref)
              await host.activatePlugin(rec)
              try {
                await refreshInstalledExtensionsUI()
                await applyMarketFilter()
              } catch {}
              host.pluginNotice(t('ext.install.ok'), 'ok', 1500)
            } catch (e) {
              try { btnInstall.textContent = t('ext.install.btn') } catch {}
              try { (btnInstall as HTMLButtonElement).disabled = false } catch {}
              void appendLog('ERROR', t('ext.install.fail'), e)
              const errMsg = (e instanceof Error) ? e.message : String(e)
              host.pluginNotice(t('ext.install.fail') + (errMsg ? ': ' + errMsg : ''), 'err', 3000)
            }
          })
          right.appendChild(btnInstall)
          actions.appendChild(right)
        }
        row.appendChild(meta); row.appendChild(actions)
        unifiedList.appendChild(row)
      }
    } catch {
      const marketRows = unifiedList.querySelectorAll('[data-type="market"]')
      marketRows.forEach(r => r.remove())
      const loadingRow = document.createElement('div')
      loadingRow.className = 'ext-item'
      loadingRow.setAttribute('data-type', 'market')
      loadingRow.appendChild(createLoadingIndicator())
      unifiedList.appendChild(loadingRow)
    }
  }

	  try {
	    installedMap = await getInstalledPluginsFromStore()
	  } catch { installedMap = {} }
	  try { await backfillInstalledAuthors(installedMap) } catch {}
	  try {
	    marketItems = await loadInstallablePlugins(false)
	  } catch {
	    marketItems = FALLBACK_INSTALLABLES.slice()
	  }

  // 根据最新的市场索引构建分类列表（如果存在分类字段）
  try {
    const categories = new Set<string>()
    for (const it of marketItems) {
      const c = (it as any)?.category
      if (c && typeof c === 'string') {
        categories.add(c)
      }
    }
    // 仅当真的有分类时才展示分类选择器，避免老索引/无分类场景下出现空的控件
    const anyCategory = categories.size > 0
    const categoryWrapEl = hd.querySelector('#ext-category-wrap') as HTMLDivElement | null
    const categorySelectEl = hd.querySelector('#ext-category-select') as HTMLSelectElement | null
    if (categoryWrapEl && categorySelectEl) {
      if (!anyCategory) {
        categoryWrapEl.style.display = 'none'
        _extMarketCategory = ''
      } else {
        categoryWrapEl.style.display = ''
        categorySelectEl.innerHTML = ''
        const optAll = document.createElement('option')
        optAll.value = ''
        optAll.textContent = t('ext.market.category.all')
        categorySelectEl.appendChild(optAll)
        const sortedCats = Array.from(categories).sort((a, b) => a.localeCompare(b, 'zh-CN'))
        for (const c of sortedCats) {
        const opt = document.createElement('option')
        opt.value = c
        opt.textContent = getCategoryLabel(c)
          categorySelectEl.appendChild(opt)
        }
        if (_extMarketCategory && categories.has(_extMarketCategory)) {
          categorySelectEl.value = _extMarketCategory
        } else {
          categorySelectEl.value = ''
          _extMarketCategory = ''
        }
      }
    }
  } catch {}

  _extLastMarketItems = marketItems
  _extGlobalOrder = {}
  try {
    const sortedForOrder = (marketItems || []).slice().sort(compareInstallableItems)
    let idx = 0
    for (const it of sortedForOrder) {
      if (!it || !it.id) continue
      _extGlobalOrder[it.id] = 100 + idx++
    }
  } catch {}
  // 内置扩展已不在列表显示，不再参与统一排序
  _extApplyMarketFilter = applyMarketFilter

  const arr = Object.values(installedMap)
  let updateMap: Record<string, PluginUpdateState> = {}
  if (arr.length > 0 && marketItems.length > 0) {
    try {
      updateMap = await getPluginUpdateStates(arr, marketItems)
    } catch { updateMap = {} }
  }

  _extLastInstalledMap = installedMap
  _extLastUpdateMap = updateMap

  renderInstalledExtensions(unifiedList, installedMap, updateMap)

  await applyMarketFilter()

  loadingSpinner.remove()
}

// 确保扩展面板完成一次完整渲染（可用于启动时后台预热）
async function ensureExtensionsPanelRenderedOnce(): Promise<void> {
  ensureExtensionsOverlayMounted()
  if (_extOverlayRenderedOnce) return
  _extOverlayRenderedOnce = true
  await refreshExtensionsUI()
}

function ensureExtensionsOverlayMounted(): void {
  if (_extOverlayEl) return
  const overlay = document.createElement('div')
  overlay.className = 'ext-overlay'
  overlay.id = 'extensions-overlay'
  overlay.innerHTML = `
    <div class="ext-dialog" role="dialog" aria-modal="true">
      <div class="ext-header">
        <div>${t('ext.title')}</div>
        <button class="ext-close" id="ext-close">×</button>
      </div>
      <div class="ext-body">
        <div class="ext-section">
          <div class="ext-subtitle">${t('ext.install.section')}</div>
          <div class="ext-install">
            <input type="text" id="ext-install-input" placeholder="${t('ext.install.placeholder')}">
            <button id="ext-browse-local-btn">${t('ext.install.browseLocal')}</button>
            <button class="primary" id="ext-install-btn">${t('ext.install.btn')}</button>
          </div>
        </div>
        <div class="ext-section" id="ext-list-host"></div>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  _extOverlayEl = overlay
  _extListHost = overlay.querySelector('#ext-list-host') as HTMLDivElement | null
  _extInstallInput = overlay.querySelector('#ext-install-input') as HTMLInputElement | null
  const btnClose = overlay.querySelector('#ext-close') as HTMLButtonElement | null
  const btnInstall = overlay.querySelector('#ext-install-btn') as HTMLButtonElement | null
  const btnBrowseLocal = overlay.querySelector('#ext-browse-local-btn') as HTMLButtonElement | null

  btnClose?.addEventListener('click', () => { void showExtensionsOverlay(false) })
  overlay.addEventListener('click', (e) => { if (e.target === overlay) void showExtensionsOverlay(false) })

  btnInstall?.addEventListener('click', async () => {
    if (!host) return
    const v = (_extInstallInput?.value || '').trim()
    if (!v) return
    try {
      let rec: InstalledPlugin
      if (isLikelyLocalPath(v)) {
        rec = await host.installPluginFromLocal(v)
      } else {
        rec = await host.installPluginFromGit(v)
      }
      await host.activatePlugin(rec)
      _extInstallInput!.value = ''
      try { await refreshExtensionsUI() } catch {}
      host.pluginNotice(t('ext.install.ok'), 'ok', 1500)
    } catch (e) {
      void appendLog('ERROR', t('ext.install.fail'), e)
      const errMsg = (e instanceof Error) ? e.message : String(e)
      host.pluginNotice(t('ext.install.fail') + (errMsg ? ': ' + errMsg : ''), 'err', 3000)
    }
  })

  async function browseLocalFolder() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('ext.chooseFolder.title')
      } as any)
      if (selected && typeof selected === 'string') {
        if (_extInstallInput) _extInstallInput.value = selected
      }
    } catch (e) {
      console.error('选择文件夹失败', e)
    }
  }

  btnBrowseLocal?.addEventListener('click', () => { void browseLocalFolder() })
}

// 启动后后台预热扩展面板：提前完成市场索引加载与 UI 构建
export async function prewarmExtensionsPanel(): Promise<void> {
  try {
    await ensureExtensionsPanelRenderedOnce()
  } catch {}
}

export async function showExtensionsOverlay(show: boolean): Promise<void> {
  ensureExtensionsOverlayMounted()
  if (!_extOverlayEl) return
  if (show) {
    _extOverlayEl.classList.add('show')
    if (!_extOverlayRenderedOnce) {
      await ensureExtensionsPanelRenderedOnce()
      return
    }
    try { await refreshInstalledExtensionsUI() } catch {}
    const fn = _extApplyMarketFilter
    if (fn) {
      void (async () => {
        try {
          const items = await loadInstallablePlugins(false)
          if (!Array.isArray(items) || items.length === 0) return
          _extLastMarketItems = items
          await fn(items)
        } catch {
          // 静默失败，不打扰用户
        }
      })()
    }
  } else {
    _extOverlayEl.classList.remove('show')
  }
}

// 语言切换后需按新语言重建面板
export function resetExtensionsPanel(): void {
  try { _extOverlayEl?.remove() } catch {}
  _extOverlayEl = null
  _extListHost = null
  _extOverlayRenderedOnce = false
}
