// 便签模式 UI 集成：图标生成、编辑/阅读切换、自动返回与窗口控制条
// 通过依赖注入使用 main.ts 中的状态，避免在入口文件里堆过多逻辑

type Mode = 'edit' | 'preview'

import type { StickyNoteWindowHost, StickyNoteWindowHostDeps } from './stickyNoteHost'
import { createStickyNoteWindowHost } from './stickyNoteHost'

// 便签 UI 所需依赖（由 main.ts 注入具体实现）
export type StickyNoteUiDeps = {
  // 模式与所见状态
  getMode: () => Mode
  setMode: (m: Mode) => void
  getStickyNoteMode: () => boolean
  getStickyTodoAutoPreview: () => boolean
  setStickyTodoAutoPreview: (v: boolean) => void
  isWysiwygActive: () => boolean

  // 文本编辑与预览区域
  getEditor: () => HTMLTextAreaElement | null
  getPreview: () => HTMLDivElement | null

  // 脏标记与状态刷新
  markDirtyAndRefresh: () => void
  // 便签自动保存：用于在切换回阅读模式前强制落盘，避免“刚改完就切换/关闭”丢数据
  flushAutoSave?: () => Promise<void> | void

  // 渲染与模式通知
  renderPreview: () => Promise<void> | void
  syncToggleButton: () => void
  notifyModeChange: () => void

  // 便签窗口锁定 / 置顶 状态
  getStickyNoteLocked: () => boolean
  setStickyNoteLocked: (v: boolean) => void
  getStickyNoteOnTop: () => boolean
  setStickyNoteOnTop: (v: boolean) => void

  // 窗口控制
  getCurrentWindow: () => any
  importDpi: () => Promise<{ LogicalSize: any }>

  // 透明度 / 颜色面板控制
  toggleStickyOpacitySlider: (btn: HTMLButtonElement) => void
  toggleStickyColorPicker: (btn: HTMLButtonElement) => void
}

export type StickyNoteUiHandles = {
  // 图标生成
  getStickyLockIcon: (locked: boolean) => string
  getStickyTopIcon: (onTop: boolean) => string
  getStickyOpacityIcon: () => string
  getStickyColorIcon: () => string
  getStickyEditIcon: (editing: boolean) => string

  // 编辑/阅读切换与自动返回
  maybeAutoReturnStickyPreview: () => Promise<void>
  addStickyTodoLine: (editBtn: HTMLButtonElement) => Promise<void>
  toggleStickyEditMode: (btn: HTMLButtonElement) => Promise<void>

  // 窗口控制条相关操作
  toggleStickyWindowLock: (btn: HTMLButtonElement) => void
  toggleStickyWindowOnTop: (btn: HTMLButtonElement) => Promise<void>
  adjustStickyWindowHeight: () => Promise<void>
  scheduleAdjustStickyHeight: () => void
  createStickyNoteControls: () => void
}

// 锁定图标（图钉）
function getStickyLockIcon(isLocked: boolean): string {
  if (isLocked) {
    // 锁定状态：实心图钉
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/>
    </svg>`
  }
  // 未锁定：空心图钉
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/>
  </svg>`
}

// 置顶图标（箭头向上）
function getStickyTopIcon(isOnTop: boolean): string {
  if (isOnTop) {
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/>
    </svg>`
  }
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/>
  </svg>`
}

function getStickyOpacityIcon(): string {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
    <path d="M12,2.69L17.33,8.02C19.13,9.82 20,11.87 20,14.23C20,16.59 19.13,18.64 17.33,20.44C15.53,22.24 13.5,23 12,23C10.5,23 8.47,22.24 6.67,20.44C4.87,18.64 4,16.59 4,14.23C4,11.87 4.87,9.82 6.67,8.02L12,2.69Z"/>
  </svg>`
}

function getStickyColorIcon(): string {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
    <rect x="3" y="3" width="8" height="8" rx="2" />
    <rect x="13" y="3" width="8" height="8" rx="2" />
    <rect x="8" y="13" width="8" height="8" rx="2" />
  </svg>`
}

// 编辑图标（笔）
function getStickyEditIcon(isEditing: boolean): string {
  if (isEditing) {
    // 编辑状态：实心笔
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
    </svg>`
  }
  // 阅读状态：空心笔
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
  </svg>`
}

// 便签 UI 入口：返回一组操作句柄，供 main.ts 使用
export function createStickyNoteUi(deps: StickyNoteUiDeps): StickyNoteUiHandles {
  // 在便签模式中根据需要自动返回阅读模式
  async function maybeAutoReturnStickyPreview(): Promise<void> {
    try {
      if (!deps.getStickyNoteMode() || !deps.getStickyTodoAutoPreview()) return
      deps.setStickyTodoAutoPreview(false)
      const btn = document.querySelector(
        '.sticky-note-edit-btn',
      ) as HTMLButtonElement | null
      if (!btn) return
      await toggleStickyEditMode(btn)
    } catch {}
  }

  // 在便签模式中在文末插入一行待办项 "- [ ] "
  async function addStickyTodoLine(editBtn: HTMLButtonElement): Promise<void> {
    try {
      // 所见模式下风险较高：暂不支持，避免破坏 WYSIWYG 状态
      if (deps.isWysiwygActive()) {
        try {
          alert('当前阅读模式下暂不支持快速待办插入，请先切换回源码模式。')
        } catch {}
        return
      }

      // 记录插入前模式，用于决定是否自动返回阅读模式
      const prevMode = deps.getMode()

      // 确保处于源码模式（必要时等价于用户点了一次“源码”按钮）
      if (prevMode !== 'edit') {
        try {
          await toggleStickyEditMode(editBtn)
        } catch {}
      }

      // 仅当从阅读模式切换过来时才开启自动返回阅读模式
      const shouldAuto =
        deps.getStickyNoteMode() && prevMode === 'preview'
      deps.setStickyTodoAutoPreview(shouldAuto)

      const ta = deps.getEditor()
      if (!ta) return

      const prev = String(ta.value || '')
      const needsNewline = prev.length > 0 && !prev.endsWith('\n')
      const insert = (needsNewline ? '\n' : '') + '- [ ] '
      const next = prev + insert

      ta.value = next
      const pos = next.length
      try {
        ta.selectionStart = pos
        ta.selectionEnd = pos
      } catch {}
      try {
        ta.focus()
      } catch {}

      try {
        deps.markDirtyAndRefresh()
      } catch {}
    } catch {}
  }

  // 切换便签编辑/阅读模式
  async function toggleStickyEditMode(btn: HTMLButtonElement): Promise<void> {
    const isCurrentlyEditing = deps.getMode() === 'edit'
    if (isCurrentlyEditing) {
      // 先落盘：别让用户以为“切回阅读=保存了”，结果啥也没写到磁盘
      try {
        await deps.flushAutoSave?.()
      } catch {}
      // 切换到阅读模式
      deps.setMode('preview')
      try {
        await deps.renderPreview()
      } catch {}
      try {
        deps.getPreview()?.classList.remove('hidden')
      } catch {}
    } else {
      // 切换到源码模式
      deps.setMode('edit')
      try {
        deps.getPreview()?.classList.add('hidden')
      } catch {}
      try {
        deps.getEditor()?.focus()
      } catch {}
    }
    try {
      deps.syncToggleButton()
    } catch {}
    // 更新按钮状态
    const newIsEditing = deps.getMode() === 'edit'
    btn.innerHTML = getStickyEditIcon(newIsEditing)
    btn.classList.toggle('active', newIsEditing)
    try {
      deps.notifyModeChange()
    } catch {}
  }

  // 便签窗口行为宿主：封装锁定/置顶/高度调整与控制条创建
  const hostDeps: StickyNoteWindowHostDeps = {
    getStickyNoteMode: () => deps.getStickyNoteMode(),
    getStickyNoteLocked: () => deps.getStickyNoteLocked(),
    setStickyNoteLocked: (v) => deps.setStickyNoteLocked(v),
    getStickyNoteOnTop: () => deps.getStickyNoteOnTop(),
    setStickyNoteOnTop: (v) => deps.setStickyNoteOnTop(v),

    getPreviewElement: () => deps.getPreview(),
    getCurrentWindow: () => deps.getCurrentWindow(),
    importDpi: () => deps.importDpi(),

    toggleStickyEditMode,
    addStickyTodoLine,
    toggleStickyOpacitySlider: (btn) => deps.toggleStickyOpacitySlider(btn),
    toggleStickyColorPicker: (btn) => deps.toggleStickyColorPicker(btn),

    getStickyLockIcon,
    getStickyTopIcon,
    getStickyOpacityIcon,
    getStickyColorIcon,
    getStickyEditIcon,
  }

  const stickyNoteWindowHost: StickyNoteWindowHost =
    createStickyNoteWindowHost(hostDeps)

  return {
    getStickyLockIcon,
    getStickyTopIcon,
    getStickyOpacityIcon,
    getStickyColorIcon,
    getStickyEditIcon,

    maybeAutoReturnStickyPreview,
    addStickyTodoLine,
    toggleStickyEditMode,

    toggleStickyWindowLock: stickyNoteWindowHost.toggleStickyWindowLock,
    toggleStickyWindowOnTop: stickyNoteWindowHost.toggleStickyWindowOnTop,
    adjustStickyWindowHeight: stickyNoteWindowHost.adjustStickyWindowHeight,
    scheduleAdjustStickyHeight:
      stickyNoteWindowHost.scheduleAdjustStickyHeight,
    createStickyNoteControls: stickyNoteWindowHost.createStickyNoteControls,
  }
}
