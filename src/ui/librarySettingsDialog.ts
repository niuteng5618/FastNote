// 库设置对话框：只做“库切换器显示/库顺序/WebDAV（启用+远端路径）”
// 关键点：不改库 id；不改已有 WebDAV 配置的默认兼容策略

import { t } from '../i18n'
import { getLibraries, getActiveLibraryId, applyLibrariesSettings, getLibSwitcherPosition, setLibSwitcherPosition, upsertLibrary, renameLibrary, removeLibrary, type LibSwitcherPosition } from '../utils/library'
import { getWebdavSyncConfigForLibrary, setWebdavSyncConfigForLibrary, openWebdavSyncDialog } from '../extensions/webdavSync'
import { openRenameDialog } from './linkDialogs'
import { ask, open } from '@tauri-apps/plugin-dialog'
import { normalizePath as normalizeFsPath } from '../core/fsSafe'

type Opts = {
  // 通知外部刷新 UI（例如库侧栏的库列表）
  onRefreshUi?: (opt?: { rebuildTree?: boolean }) => void | Promise<void>
}

function formatRootForDisplay(root: string): string {
  const s = String(root || '').trim()
  // 库路径在 store 内统一用 `/`，但 Windows 用户看到 `D:\` 更顺眼
  if (/^[A-Za-z]:\//.test(s) || s.startsWith('//')) return s.replace(/\//g, '\\')
  return s
}

function normalizeRootPathInput(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  let p = raw.replace(/\\/g, '/')
  if (!p.startsWith('/')) p = '/' + p
  p = p.replace(/\/+$/, '')
  return p || '/'
}

function showNotice(msg: string): void {
  try {
    const nm = (window as any).NotificationManager
    if (nm && typeof nm.show === 'function') {
      nm.show('extension', msg)
      return
    }
  } catch {}
  try { console.log('[库设置]', msg) } catch {}
}

async function confirmDialog(message: string, title: string): Promise<boolean> {
  try {
    if (typeof ask === 'function') {
      try { return !!(await ask(message, { title } as any)) } catch {}
    }
  } catch {}
  try { return typeof confirm === 'function' ? !!confirm(message) : false } catch { return false }
}

async function pickLibraryRoot(): Promise<string | null> {
  try {
    if (typeof open !== 'function') return null
    const sel = await open({ directory: true, multiple: false } as any)
    if (!sel) return null
    const raw = Array.isArray(sel) ? (sel[0] || '') : sel
    const p = String(normalizeFsPath(raw) || '').trim()
    return p || null
  } catch {
    return null
  }
}

export async function openLibrarySettingsDialog(opts: Opts = {}): Promise<void> {
  const existing = document.getElementById('lib-settings-overlay') as HTMLDivElement | null
  if (existing) {
    try { existing.classList.remove('hidden') } catch {}
    return
  }

  const overlay = document.createElement('div') as HTMLDivElement
  overlay.id = 'lib-settings-overlay'
  overlay.className = 'upl-overlay'
  overlay.innerHTML = `
    <div class="upl-dialog lib-settings-dialog" role="dialog" aria-modal="true">
      <div class="upl-header">
        <span>${t('lib.settings.title') || '库设置'}</span>
        <button id="lib-settings-close" title="${t('common.close') || '关闭'}">×</button>
      </div>
      <div class="upl-body">
        <div class="upl-grid">
          <label>${t('lib.settings.current') || '当前库'}</label>
          <div class="lib-settings-cur">
            <span id="lib-settings-cur-name"></span>
          </div>

          <label>WebDAV</label>
          <div class="upl-inline-row">
            <label class="switch" for="lib-settings-webdav-enabled">
              <input id="lib-settings-webdav-enabled" type="checkbox"/>
              <span class="slider"></span>
            </label>
            <span class="upl-hint">${t('lib.settings.webdav.hint') || '只配置当前库；账号/地址等详细项可在 WebDAV 设置中调整'}</span>
          </div>

          <label>${t('lib.settings.webdav.root') || '远端路径'}</label>
          <div>
            <input id="lib-settings-webdav-root" type="text" placeholder="/<库名>"/>
            <div class="lib-settings-webdav-actions">
              <button id="lib-settings-open-webdav" type="button" class="btn-secondary">${t('lib.settings.webdav.open') || '打开 WebDAV 详细设置…'}</button>
            </div>
          </div>
        </div>

        <div class="lib-settings-sep"></div>

        <div class="lib-settings-subtitle-row">
          <div class="lib-settings-subtitle">${t('lib.settings.order') || '库顺序与侧栏显示'}</div>
          <button id="lib-settings-add" type="button" class="btn-secondary lib-settings-add-btn">${t('lib.settings.add') || '新增库…'}</button>
        </div>
        <div id="lib-settings-list" class="lib-settings-list"></div>

        <div class="upl-actions">
          <button id="lib-settings-cancel" type="button" class="btn-secondary">${t('common.cancel') || '取消'}</button>
          <button id="lib-settings-save" type="button" class="btn-primary">${t('common.save') || '保存'}</button>
        </div>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  const close = () => {
    try { overlay.remove() } catch {}
  }

  overlay.addEventListener('click', (e) => {
    try {
      if (e.target === overlay) close()
    } catch {}
  })
  overlay.querySelector('#lib-settings-close')?.addEventListener('click', close)
  overlay.querySelector('#lib-settings-cancel')?.addEventListener('click', close)

  const elCurName = overlay.querySelector('#lib-settings-cur-name') as HTMLSpanElement
  const elWebdavEnabled = overlay.querySelector('#lib-settings-webdav-enabled') as HTMLInputElement
  const elWebdavRoot = overlay.querySelector('#lib-settings-webdav-root') as HTMLInputElement
  const elList = overlay.querySelector('#lib-settings-list') as HTMLDivElement
  const elOpenWebdav = overlay.querySelector('#lib-settings-open-webdav') as HTMLButtonElement | null

  let libs0 = await getLibraries()
  let activeId = await getActiveLibraryId()
  let selectedLibId = (activeId || libs0[0]?.id || null) as string | null

  // 对话框内的草稿状态：取消不落盘
  let draftOrderIds = libs0.map(l => l.id)
  const draftSidebarVisible = new Map<string, boolean>()
  for (const l of libs0) draftSidebarVisible.set(l.id, l.sidebarVisible !== false)

  const draftWebdav = new Map<string, { enabled: boolean; rootPathInput: string }>()
  const dirtyWebdav = new Set<string>()

  async function ensureWebdavDraftLoaded(id: string): Promise<void> {
    if (!id) return
    if (draftWebdav.has(id)) return
    const lib = libs0.find(x => x.id === id)
    const cfg = await (async () => {
      try {
        return await getWebdavSyncConfigForLibrary({ id, name: lib?.name, root: lib?.root })
      } catch {
        return null as any
      }
    })()
    if (!cfg) {
      draftWebdav.set(id, { enabled: false, rootPathInput: '' })
      return
    }
    draftWebdav.set(id, { enabled: !!cfg.enabled, rootPathInput: String(cfg.rootPath || '').trim() })
  }

  function syncSelectedUiFromDraft(): void {
    try {
      if (!selectedLibId) {
        elCurName.textContent = t('lib.settings.empty') || '暂无库'
        try { elWebdavEnabled.checked = false } catch {}
        try { elWebdavEnabled.disabled = true } catch {}
        try { elWebdavRoot.value = '' } catch {}
        try { elWebdavRoot.disabled = true } catch {}
        if (elOpenWebdav) {
          elOpenWebdav.disabled = true
          elOpenWebdav.title = ''
        }
        return
      }
      try { elWebdavEnabled.disabled = false } catch {}
      try { elWebdavRoot.disabled = false } catch {}
      const lib = libs0.find(x => x.id === selectedLibId)
      elCurName.textContent = lib?.name || (t('lib.menu') || '库')
      const w = draftWebdav.get(selectedLibId)
      if (w) {
        elWebdavEnabled.checked = !!w.enabled
        elWebdavRoot.value = w.rootPathInput || ''
        if (!elWebdavRoot.value) elWebdavRoot.placeholder = '/<库名>'
      }
      if (elOpenWebdav) {
        const isActive = !!(activeId && selectedLibId === activeId)
        elOpenWebdav.disabled = !isActive
        elOpenWebdav.title = isActive ? '' : '请先切换到该库再打开 WebDAV 详细设置'
      }
    } catch {}
  }

  async function selectLibraryForEditing(id: string): Promise<void> {
    const nextId = String(id || '').trim()
    if (!nextId) return
    selectedLibId = nextId
    await ensureWebdavDraftLoaded(nextId)
    syncSelectedUiFromDraft()
    renderList()
  }

  if (selectedLibId) {
    await ensureWebdavDraftLoaded(selectedLibId)
    syncSelectedUiFromDraft()
  }

  elWebdavEnabled.addEventListener('change', () => {
    try {
      if (!selectedLibId) return
      const cur = draftWebdav.get(selectedLibId) || { enabled: false, rootPathInput: '' }
      cur.enabled = !!elWebdavEnabled.checked
      draftWebdav.set(selectedLibId, cur)
      dirtyWebdav.add(selectedLibId)
    } catch {}
  })
  elWebdavRoot.addEventListener('input', () => {
    try {
      if (!selectedLibId) return
      const cur = draftWebdav.get(selectedLibId) || { enabled: false, rootPathInput: '' }
      cur.rootPathInput = String(elWebdavRoot.value || '')
      draftWebdav.set(selectedLibId, cur)
      dirtyWebdav.add(selectedLibId)
    } catch {}
  })

  function getDraftLibraries(): Array<{ id: string; name: string; root: string }> {
    const byId = new Map(libs0.map(l => [l.id, l] as const))
    const out: Array<{ id: string; name: string; root: string }> = []
    for (const id of draftOrderIds) {
      const l = byId.get(id)
      if (!l) continue
      out.push({ id: l.id, name: l.name, root: l.root })
    }
    // 补齐：避免草稿顺序丢库
    for (const l of libs0) {
      if (out.find(x => x.id === l.id)) continue
      out.push({ id: l.id, name: l.name, root: l.root })
    }
    return out
  }

  function renderList(): void {
    try {
      elList.innerHTML = ''
      const libs = getDraftLibraries()
      if (!libs || libs.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'pmm-empty'
        empty.textContent = t('lib.settings.empty') || '暂无库'
        elList.appendChild(empty)
        return
      }

      for (let i = 0; i < libs.length; i++) {
        const lib = libs[i]
        const row = document.createElement('div')
        row.className = 'lib-settings-row' + (lib.id === activeId ? ' active' : '') + (lib.id === selectedLibId ? ' selected' : '')

        const left = document.createElement('div')
        left.className = 'lib-settings-left'
        left.addEventListener('click', () => { void selectLibraryForEditing(lib.id) })

        const nameText = document.createElement('div')
        nameText.className = 'lib-settings-name-text'
        nameText.textContent = lib.name || lib.id

        const pathText = document.createElement('div')
        pathText.className = 'lib-settings-path'
        pathText.textContent = formatRootForDisplay(lib.root)
        pathText.title = lib.root

        left.appendChild(nameText)
        left.appendChild(pathText)

        const right = document.createElement('div')
        right.className = 'lib-settings-right'

        const btnRename = document.createElement('button')
        btnRename.type = 'button'
        btnRename.className = 'lib-settings-order-btn'
        btnRename.textContent = t('lib.settings.rename') || '重命名'
        btnRename.addEventListener('click', async (ev) => {
          try {
            ev.preventDefault()
            ev.stopPropagation()
            const oldName = String(lib.name || '').trim()
            const nextName = await openRenameDialog(oldName, '')
            if (!nextName || nextName === oldName) return
            await renameLibrary(lib.id, nextName)
            const idx = libs0.findIndex(x => x.id === lib.id)
            if (idx >= 0) libs0[idx] = { ...libs0[idx], name: nextName }
            if (opts.onRefreshUi) await opts.onRefreshUi({ rebuildTree: false })
            syncSelectedUiFromDraft()
            renderList()
            showNotice(t('lib.settings.renamed') || '已重命名')
          } catch {}
        })

        const btnRemove = document.createElement('button')
        btnRemove.type = 'button'
        btnRemove.className = 'lib-settings-order-btn danger'
        btnRemove.textContent = t('lib.settings.remove') || '删除'
        btnRemove.addEventListener('click', async (ev) => {
          try {
            ev.preventDefault()
            ev.stopPropagation()
            const name = String(lib.name || lib.id || '').trim() || lib.id
            const msg = t('lib.settings.remove.confirm', { name }) || `确认删除库“${name}”？此操作只会从列表移除，不会删除磁盘文件。`
            const ok = await confirmDialog(msg, t('lib.settings.remove') || '删除')
            if (!ok) return

            await removeLibrary(lib.id)

            libs0 = libs0.filter(x => x.id !== lib.id)
            draftOrderIds = draftOrderIds.filter(x => x !== lib.id)
            draftSidebarVisible.delete(lib.id)
            dirtyWebdav.delete(lib.id)
            draftWebdav.delete(lib.id)

            activeId = await getActiveLibraryId()
            if (selectedLibId === lib.id) selectedLibId = activeId || libs0[0]?.id || null
            if (selectedLibId) await ensureWebdavDraftLoaded(selectedLibId)

            if (opts.onRefreshUi) await opts.onRefreshUi({ rebuildTree: true })
            syncSelectedUiFromDraft()
            renderList()
            showNotice(t('lib.settings.removed') || '已删除')
          } catch {}
        })

        const cbWrap = document.createElement('label')
        cbWrap.className = 'lib-settings-cb'
        const cb = document.createElement('input')
        cb.type = 'checkbox'
        cb.checked = draftSidebarVisible.get(lib.id) !== false
        cb.addEventListener('change', () => {
          try {
            draftSidebarVisible.set(lib.id, !!cb.checked)
          } catch {}
        })
        const cbText = document.createElement('span')
        cbText.textContent = t('lib.settings.sidebar.short') || '显示'
        cbWrap.appendChild(cb)
        cbWrap.appendChild(cbText)

        const btnUp = document.createElement('button')
        btnUp.type = 'button'
        btnUp.className = 'lib-settings-order-btn'
        btnUp.textContent = '↑'
        btnUp.disabled = i === 0
        btnUp.title = t('lib.settings.order.up') || '上移'
        btnUp.addEventListener('click', () => {
          try {
            if (i <= 0) return
            const ids = getDraftLibraries().map(x => x.id)
            ;[ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]
            draftOrderIds = ids
            renderList()
          } catch {}
        })

        const btnDown = document.createElement('button')
        btnDown.type = 'button'
        btnDown.className = 'lib-settings-order-btn'
        btnDown.textContent = '↓'
        btnDown.disabled = i === libs.length - 1
        btnDown.title = t('lib.settings.order.down') || '下移'
        btnDown.addEventListener('click', () => {
          try {
            if (i >= libs.length - 1) return
            const ids = getDraftLibraries().map(x => x.id)
            ;[ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]
            draftOrderIds = ids
            renderList()
          } catch {}
        })

        right.appendChild(cbWrap)
        right.appendChild(btnRename)
        right.appendChild(btnRemove)
        right.appendChild(btnUp)
        right.appendChild(btnDown)

        row.appendChild(left)
        row.appendChild(right)
        elList.appendChild(row)
      }
    } catch {}
  }
  renderList()

  overlay.querySelector('#lib-settings-add')?.addEventListener('click', async () => {
    try {
      const root = await pickLibraryRoot()
      if (!root) return
      const lib = await upsertLibrary({ root })
      const idx = libs0.findIndex(x => x.id === lib.id)
      if (idx >= 0) libs0[idx] = { ...libs0[idx], ...lib }
      else libs0 = [...libs0, lib]

      if (!draftOrderIds.includes(lib.id)) draftOrderIds = [...draftOrderIds, lib.id]
      if (!draftSidebarVisible.has(lib.id)) draftSidebarVisible.set(lib.id, true)

      activeId = await getActiveLibraryId()
      selectedLibId = lib.id
      await ensureWebdavDraftLoaded(lib.id)

      if (opts.onRefreshUi) await opts.onRefreshUi({ rebuildTree: true })
      syncSelectedUiFromDraft()
      renderList()
      showNotice(t('lib.settings.added') || '已新增')
    } catch (e) {
      console.warn('[库设置] 新增库失败', e)
      showNotice('新增失败：请查看控制台日志')
    }
  })

  overlay.querySelector('#lib-settings-open-webdav')?.addEventListener('click', async () => {
    try {
      close()
      await openWebdavSyncDialog()
    } catch {}
  })

  overlay.querySelector('#lib-settings-save')?.addEventListener('click', async () => {
    try {
      const vis: Record<string, boolean> = {}
      for (const [k, v] of draftSidebarVisible.entries()) vis[k] = !!v
      await applyLibrariesSettings({ orderIds: draftOrderIds, sidebarVisibleById: vis })

      // WebDAV：按"用户真的改过"的库落盘
      for (const libId of dirtyWebdav) {
        const draft = draftWebdav.get(libId)
        if (!draft) continue
        const next: any = { enabled: !!draft.enabled }
        const rawInput = String(draft.rootPathInput || '').trim()
        if (rawInput.length === 0) {
          // 显式清空：移除自定义 rootPath，让读取端回退到默认策略
          next.rootPath = ''
        } else {
          next.rootPath = normalizeRootPathInput(rawInput)
        }
        await setWebdavSyncConfigForLibrary(libId, next)
      }

      if (opts.onRefreshUi) await opts.onRefreshUi({ rebuildTree: false })
      showNotice(t('common.saved') || '已保存')
      close()
    } catch (e) {
      console.warn('[库设置] 保存失败', e)
      showNotice(t('common.saveFailed') || '保存失败')
    }
  })
}
