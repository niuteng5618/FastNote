// 库侧栏右键菜单 UI 模块
// 从 main.ts 拆分：负责文件树右键菜单的 DOM 与交互

import { t } from '../i18n'
import type { LibSortMode } from '../core/librarySort'
import { openRenameDialog } from './linkDialogs'
import { newFileSafe, newFolderSafe } from '../fileTree'
import { showLibraryDeleteDialog } from '../dialog'
import { dispatchPathDeleted } from '../core/pathEvents'
import { registerMenuCloser, closeAllMenus } from './menuManager'

// 模块级关闭函数引用
let _closeLibraryContextMenu: (() => void) | null = null

// 导出关闭函数供外部调用
export function closeLibraryContextMenu(): void {
  if (_closeLibraryContextMenu) _closeLibraryContextMenu()
}

// 注册到全局菜单管理器
registerMenuCloser('libraryContextMenu', closeLibraryContextMenu)

export type LibraryContextMenuDeps = {
  getCurrentFilePath(): string | null
  isDirty(): boolean
  normalizePath(p: string): string
  getLibraryRoot(): Promise<string | null>
  renameFileSafe(path: string, newName: string): Promise<string>
  deleteFileSafe(path: string, toTrash: boolean): Promise<void>
  openFile(path: string): Promise<void>
  ensureTreeInitialized(): Promise<void>
  refreshTree(): Promise<void>
  updateTitle(): void
  confirmNative(msg: string): Promise<boolean>
  exists(path: string): Promise<boolean>
  askOverwrite(msg: string): Promise<boolean>
  moveFileSafe(src: string, dst: string): Promise<void>
  getCurrentSort(): Promise<LibSortMode>
  setSort(mode: LibSortMode): Promise<void>
  applySortToTree(mode: LibSortMode): Promise<void>
  clearFolderOrderForParent(path: string): Promise<void>
  onAfterDeleteCurrent(): void
}

let _libCtxKeyHandler: ((e: KeyboardEvent) => void) | null = null

export function initLibraryContextMenu(deps: LibraryContextMenuDeps): void {
  document.addEventListener('contextmenu', async (ev) => {
    const target = ev.target as HTMLElement
    const row = target?.closest?.('.lib-node') as HTMLElement | null
    if (!row) return
    const tree = document.getElementById('lib-tree') as HTMLDivElement | null
    if (!tree || !tree.contains(row)) return
    ev.preventDefault()
    // 读取当前排序模式，用于渲染排序项的正序/倒序状态（点击即切换）
    let curSort: LibSortMode
    try { curSort = await deps.getCurrentSort() } catch { curSort = 'mtime_asc' }
    const path = (row as any).dataset?.path as string || ''
    const isDir = row.classList.contains('lib-dir')

    let menu = document.getElementById('lib-ctx') as HTMLDivElement | null
    if (!menu) {
      menu = document.createElement('div') as HTMLDivElement
      menu.id = 'lib-ctx'
      menu.style.position = 'absolute'
      menu.style.zIndex = '9999'
      menu.style.background = getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#fff'
      menu.style.color = getComputedStyle(document.documentElement).getPropertyValue('--fg') || '#111'
      menu.style.border = '1px solid ' + (getComputedStyle(document.documentElement).getPropertyValue('--border') || '#e5e7eb')
      menu.style.borderRadius = '8px'
      menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)'
      menu.style.minWidth = '160px'
      menu.addEventListener('click', (e2) => e2.stopPropagation())
      document.body.appendChild(menu)
    }

    const mkItem = (txt: string, act: () => void, color?: string) => {
      const a = document.createElement('div') as HTMLDivElement
      a.textContent = txt
      if (color) a.style.color = color
      a.style.padding = '8px 12px'
      a.style.cursor = 'pointer'
      a.addEventListener('mouseenter', () => { a.style.background = 'rgba(127,127,127,0.12)' })
      a.addEventListener('mouseleave', () => { a.style.background = 'transparent' })
      a.addEventListener('click', () => { act(); hide() })
      return a
    }

    const hide = () => {
      if (menu) { menu.style.display = 'none' }
      document.removeEventListener('click', onDoc)
      if (_libCtxKeyHandler) {
        document.removeEventListener('keydown', _libCtxKeyHandler)
        _libCtxKeyHandler = null
      }
    }
    const onDoc = () => hide()

    // 设置模块级关闭函数引用，供全局菜单管理器调用
    _closeLibraryContextMenu = hide

    // 关闭所有其他菜单，确保同时只有一个菜单显示
    closeAllMenus('libraryContextMenu')

    menu.innerHTML = ''

    // 在系统文件管理器中打开（文件：打开所在目录；文件夹：打开该文件夹）
    menu.appendChild(mkItem(t('ctx.revealInExplorer'), async () => {
      try {
        const win = window as any
        const openFn = win?.flymdOpenInExplorer as ((p: string, isDir?: boolean) => Promise<void>) | undefined
        if (typeof openFn !== 'function') {
          alert('该功能需要在桌面端应用中使用')
          return
        }
        await openFn(path, isDir)
      } catch (e) {
        console.error('[库树] 打开资源管理器失败:', e)
      }
    }))

    // 文件节点专属操作：在新实例中打开 / 生成便签
    if (!isDir) {
      menu.appendChild(mkItem(t('ctx.openNewInstance'), async () => {
        try {
          const win = window as any
          const openFn = win?.flymdOpenInNewInstance as ((p: string) => Promise<void>) | undefined
          if (typeof openFn !== 'function') {
            alert('当前环境不支持新实例打开，请直接从系统中双击该文件。')
            return
          }
          try {
            const cur = deps.getCurrentFilePath() ? deps.normalizePath(deps.getCurrentFilePath() as string) : ''
            const target = deps.normalizePath(path)
            if (cur && cur === target && deps.isDirty()) {
              alert('当前文档有未保存的更改，禁止在新实例中打开。\n请先保存后再尝试。')
              return
            }
          } catch {}
          await openFn(path)
        } catch (e) {
          console.error('[库树] 新实例打开文档失败:', e)
        }
      }))

      menu.appendChild(mkItem(t('ctx.createSticky'), async () => {
        try {
          const win = window as any
          const createFn = win?.flymdCreateStickyNote as ((p: string) => Promise<void>) | undefined
          if (typeof createFn !== 'function') {
            alert('当前环境不支持便签功能。')
            return
          }
          try {
            const cur = deps.getCurrentFilePath() ? deps.normalizePath(deps.getCurrentFilePath() as string) : ''
            const target = deps.normalizePath(path)
            if (cur && cur === target && deps.isDirty()) {
              const saveFn = win?.flymdSaveFile as (() => Promise<void>) | undefined
              if (typeof saveFn === 'function') {
                try {
                  await saveFn()
                } catch (err) {
                  console.error('[库树] 自动保存失败:', err)
                  alert('自动保存失败，无法生成便签。')
                  return
                }
              }
            }
          } catch {}
          await createFn(path)
        } catch (e) {
          console.error('[库树] 生成便签失败:', e)
        }
      }))
    }

    if (isDir) {
      menu.appendChild(mkItem(t('ctx.newFile'), async () => {
        try {
          // 1. 先弹出命名对话框
          const defaultStem = '新建文档'
          const defaultExt = '.md'
          const newStem = await openRenameDialog(defaultStem, defaultExt)

          // 2. 用户取消则直接返回
          if (!newStem) return

          // 3. 创建文件（使用直接导入的函数）
          const fileName = newStem + defaultExt
          const fullPath = await newFileSafe(path, fileName)

          // 4. 打开文件
          await deps.openFile(fullPath)
        } catch (e) {
          console.error('新建文件失败', e)
        }
      }))

      menu.appendChild(mkItem(t('ctx.newFolder'), async () => {
        try {
          // 1. 先弹出命名对话框
          const defaultName = '新建目录'
          const newName = await openRenameDialog(defaultName, '')

          // 2. 用户取消则直接返回
          if (!newName) return

          // 3. 创建文件夹（使用直接导入的函数）
          await newFolderSafe(path, newName)

          // 4. 刷新树显示
          await deps.ensureTreeInitialized()
          await deps.refreshTree()
        } catch (e) {
          console.error('新建文件夹失败', e)
        }
      }))
    }

    menu.appendChild(mkItem(t('ctx.moveTo'), async () => {
      try {
        const root = await deps.getLibraryRoot()
        if (!root) {
          alert('请先选择库目录')
          return
        }
        const win = window as any
        const isInside = win?.flymdIsInside as ((root: string, p: string) => boolean) | undefined
        if (!isInside || !isInside(root, path)) {
          alert('仅允许移动库内文件/文件夹')
          return
        }
        const openDlg = win?.flymdOpenDirectory as ((defaultDir: string) => Promise<string>) | undefined
        if (typeof openDlg !== 'function') {
          alert('该功能需要在 Tauri 应用中使用')
          return
        }
        const defaultDir = path.replace(/[\\/][^\\/]*$/, '')
        const dest = await openDlg(defaultDir || root)
        if (!dest) return
        if (!isInside(root, dest)) {
          alert('仅允许移动到库目录内')
          return
        }
        const name = (path.split(/[\\/]+/).pop() || '')
        const sep = dest.includes('\\') ? '\\' : '/'
        const dst = dest.replace(/[\\/]+$/, '') + sep + name
        if (dst === path) return
        if (await deps.exists(dst)) {
          const ok = await deps.askOverwrite('目标已存在，是否覆盖？')
          if (!ok) return
        }
        await deps.moveFileSafe(path, dst)
        await deps.refreshTree()
      } catch (e) {
        console.error('移动失败', e)
      }
    }))

    const doRename = async () => {
      try {
        const win = window as any
        const rename = win?.flymdRenamePathWithDialog as ((p: string) => Promise<void>) | undefined
        if (typeof rename === 'function') {
          await rename(path)
        }
      } catch (e) {
        console.error('重命名失败', e)
      }
    }

    const doDelete = async () => {
      try {
        const name = (path.split(/[\\/]+/).pop() || '').trim()
        const ok = await showLibraryDeleteDialog(name, isDir)
        if (!ok) return
        await deps.deleteFileSafe(path, false)

        // 通知：某个路径已被删除（由标签系统订阅并决定是否关闭标签）
        dispatchPathDeleted(path, isDir)

        // 兜底：仅当“当前打开文档”被删除时，才清空编辑器（避免误伤其他打开文档）
        try {
          const cur = deps.getCurrentFilePath()
          if (cur) {
            const n = (p: string) => deps.normalizePath(p).replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
            const curN = n(cur)
            const delN = n(path)
            const hit = isDir ? (curN === delN || curN.startsWith(delN + '/')) : (curN === delN)
            if (hit) deps.onAfterDeleteCurrent()
          }
        } catch {}

        await deps.ensureTreeInitialized()
        await deps.refreshTree()
      } catch (e) {
        console.error('删除失败', e)
      }
    }

    menu.appendChild(mkItem(t('ctx.rename'), () => { void doRename() }))
    menu.appendChild(mkItem(t('ctx.delete'), () => { void doDelete() }, '#ef4444'))

    try {
      const sep = document.createElement('div') as HTMLDivElement
      sep.style.borderTop = '1px solid ' + (getComputedStyle(document.documentElement).getPropertyValue('--border') || '#e5e7eb')
      sep.style.margin = '6px 0'
      menu.appendChild(sep)
      // 排序：仅两个入口，点击在正序/倒序间切换（菜单上不显示方向）。
      // 应用排序时顺带清除该文件夹的手动拖拽顺序（替代原「恢复当前文件夹排序」），
      // 否则拖拽过的文件夹永远优先于全局排序，切换看起来「不生效」。
      const applySort = async (mode: LibSortMode) => {
        await deps.setSort(mode)
        await deps.applySortToTree(mode)
        try {
          const parent = isDir ? path : path.replace(/[\\/][^\\/]*$/, '')
          if (parent) await deps.clearFolderOrderForParent(parent)
        } catch {}
      }
      menu.appendChild(mkItem(t('ctx.sortByName'), () => {
        const next: LibSortMode = (curSort === 'name_asc') ? 'name_desc'
          : (curSort === 'name_desc') ? 'name_asc' : 'name_asc'
        void applySort(next)
      }))
      menu.appendChild(mkItem(t('ctx.sortByTime'), () => {
        const next: LibSortMode = (curSort === 'mtime_asc') ? 'mtime_desc'
          : (curSort === 'mtime_desc') ? 'mtime_asc' : 'mtime_asc'
        void applySort(next)
      }))
    } catch {}

    // 先临时展示再根据实际尺寸计算位置，避免菜单在窗口底部被截断
    menu.style.visibility = 'hidden'
    menu.style.display = 'block'

    const rect = menu.getBoundingClientRect()
    const margin = 8
    let left = ev.clientX
    let top = ev.clientY

    // 水平方向避免超出视口
    if (left + rect.width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - rect.width - margin)
    }

    // 垂直方向如果放不下则向上展开
    if (top + rect.height + margin > window.innerHeight) {
      top = Math.max(margin, ev.clientY - rect.height)
      if (top + rect.height + margin > window.innerHeight) {
        // 极端情况下仍然放不下，贴底展示
        top = Math.max(margin, window.innerHeight - rect.height - margin)
      }
    }

    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
    menu.style.visibility = 'visible'

    setTimeout(() => document.addEventListener('click', onDoc, { once: true }), 0)
  })
}
