// 便签模式宿主：配置读写与外观控制（透明度/颜色面板）

import type { Store } from '@tauri-apps/plugin-store'
import {
  type StickyNotePrefs,
  type StickyNoteColor,
  type StickyNotePrefsDeps,
  loadStickyNotePrefsCore,
  saveStickyNotePrefsCore,
  applyStickyNoteAppearance,
} from './stickyNote'

// 便签配置宿主依赖：由 main.ts 注入具体实现
export type StickyNotePrefsHostDeps = {
  appLocalDataDir: () => Promise<string>
  readTextFileAnySafe: (p: string) => Promise<string>
  writeTextFileAnySafe: (p: string, content: string) => Promise<void>
  getStore: () => Store | null | Promise<Store | null>

  getOpacity: () => number
  setOpacity: (v: number) => void
  getColor: () => StickyNoteColor
  setColor: (c: StickyNoteColor) => void
}

export type StickyNotePrefsHost = {
  loadStickyNotePrefs: () => Promise<StickyNotePrefs>
  saveStickyNotePrefs: (prefs: StickyNotePrefs, skipStore?: boolean) => Promise<void>
  setStickyNoteOpacity: (opacity: number) => Promise<void>
  setStickyNoteColor: (color: StickyNoteColor) => Promise<void>
  toggleStickyOpacitySlider: (btn: HTMLButtonElement) => void
  toggleStickyColorPicker: (btn: HTMLButtonElement) => void
}

export function createStickyNotePrefsHost(deps: StickyNotePrefsHostDeps): StickyNotePrefsHost {
  const coreDeps: StickyNotePrefsDeps = {
    appLocalDataDir: deps.appLocalDataDir,
    readTextFileAnySafe: deps.readTextFileAnySafe,
    writeTextFileAnySafe: deps.writeTextFileAnySafe,
    getStore: deps.getStore,
  }

  async function loadStickyNotePrefs(): Promise<StickyNotePrefs> {
    const prefs = await loadStickyNotePrefsCore(coreDeps)
    deps.setOpacity(prefs.opacity)
    deps.setColor(prefs.color)
    return { ...prefs }
  }

  async function saveStickyNotePrefs(prefs: StickyNotePrefs, skipStore = false): Promise<void> {
    if (typeof prefs.opacity === 'number') deps.setOpacity(prefs.opacity)
    if (prefs.color) deps.setColor(prefs.color as StickyNoteColor)
    await saveStickyNotePrefsCore(
      coreDeps,
      { opacity: deps.getOpacity(), color: deps.getColor() },
      skipStore,
    )
  }

  async function setStickyNoteOpacity(opacity: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, opacity))
    deps.setOpacity(clamped)
    applyStickyNoteAppearance(deps.getColor(), clamped)
    await saveStickyNotePrefs({ opacity: clamped, color: deps.getColor() })
  }

  async function setStickyNoteColor(color: StickyNoteColor): Promise<void> {
    deps.setColor(color)
    applyStickyNoteAppearance(color, deps.getOpacity())
    await saveStickyNotePrefs({ opacity: deps.getOpacity(), color })
  }

  function toggleStickyOpacitySlider(btn: HTMLButtonElement): void {
    const existing = document.getElementById('sticky-opacity-slider-container')
    if (existing) {
      existing.remove()
      btn.classList.remove('active')
      return
    }

    const container = document.createElement('div')
    container.id = 'sticky-opacity-slider-container'
    container.className = 'sticky-opacity-slider-container'

    const label = document.createElement('div')
    label.className = 'sticky-opacity-label'
    const initialPercent = Math.round((1 - deps.getOpacity()) * 100)
    label.textContent = `透明度: ${initialPercent}%`

    const slider = document.createElement('input')
    slider.type = 'range'
    slider.className = 'sticky-opacity-slider'
    slider.min = '0'
    slider.max = '100'
    slider.value = String(initialPercent)

    slider.addEventListener('input', async (e) => {
      const value = parseInt((e.target as HTMLInputElement).value)
      label.textContent = `透明度: ${value}%`
      await setStickyNoteOpacity(1 - value / 100)
    })

    container.appendChild(label)
    container.appendChild(slider)

    container.addEventListener('click', (e) => {
      e.stopPropagation()
    })

    const closePanel = (e: MouseEvent) => {
      if (!container.contains(e.target as Node) && e.target !== btn) {
        container.remove()
        btn.classList.remove('active')
        document.removeEventListener('click', closePanel)
      }
    }

    setTimeout(() => {
      document.addEventListener('click', closePanel)
    }, 0)

    document.body.appendChild(container)
    btn.classList.add('active')
  }

  function toggleStickyColorPicker(btn: HTMLButtonElement): void {
    const existing = document.getElementById('sticky-color-picker-container')
    if (existing) {
      existing.remove()
      btn.classList.remove('active')
      return
    }

    const container = document.createElement('div')
    container.id = 'sticky-color-picker-container'
    container.className = 'sticky-color-picker-container'

    const colors: Array<{ key: StickyNoteColor; title: string }> = [
      { key: 'white', title: '白色背景' },
      { key: 'gray', title: '灰色背景' },
      { key: 'black', title: '黑色背景' },
      { key: 'yellow', title: '便签黄' },
      { key: 'pink', title: '粉色' },
      { key: 'blue', title: '蓝色' },
      { key: 'green', title: '绿色' },
      { key: 'orange', title: '橙色' },
      { key: 'purple', title: '紫色' },
      { key: 'red', title: '红色' },
    ]

    colors.forEach(({ key, title }) => {
      const swatch = document.createElement('button')
      swatch.type = 'button'
      swatch.className =
        `sticky-color-swatch sticky-color-${key}` +
        (key === deps.getColor() ? ' active' : '')
      swatch.title = title
      swatch.addEventListener('click', (e) => {
        e.stopPropagation()
        const all = container.querySelectorAll('.sticky-color-swatch')
        all.forEach((el) => el.classList.remove('active'))
        swatch.classList.add('active')
        void setStickyNoteColor(key)
      })
      container.appendChild(swatch)
    })

    container.addEventListener('click', (e) => {
      e.stopPropagation()
    })

    const closePanel = (e: MouseEvent) => {
      if (!container.contains(e.target as Node) && e.target !== btn) {
        container.remove()
        btn.classList.remove('active')
        document.removeEventListener('click', closePanel)
      }
    }

    setTimeout(() => {
      document.addEventListener('click', closePanel)
    }, 0)

    document.body.appendChild(container)

    const btnRect = btn.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const windowWidth = window.innerWidth
    const windowHeight = window.innerHeight

    let top = btnRect.bottom + 8
    let left = btnRect.left + btnRect.width / 2 - containerRect.width / 2

    if (left + containerRect.width > windowWidth - 10) {
      left = windowWidth - containerRect.width - 10
    }
    if (left < 10) {
      left = 10
    }
    if (top + containerRect.height > windowHeight - 10) {
      top = btnRect.top - containerRect.height - 8
    }
    if (top < 10) {
      top = btnRect.bottom + 8
    }

    container.style.top = `${top}px`
    container.style.left = `${left}px`
    container.style.right = 'auto'
    btn.classList.add('active')
  }

  return {
    loadStickyNotePrefs,
    saveStickyNotePrefs,
    setStickyNoteOpacity,
    setStickyNoteColor,
    toggleStickyOpacitySlider,
    toggleStickyColorPicker,
  }
}

// 便签窗口行为宿主：锁定/置顶/高度调整与控制条
export type StickyNoteWindowHostDeps = {
  getStickyNoteMode: () => boolean
  getStickyNoteLocked: () => boolean
  setStickyNoteLocked: (v: boolean) => void
  getStickyNoteOnTop: () => boolean
  setStickyNoteOnTop: (v: boolean) => void

  getPreviewElement: () => HTMLElement | null
  getCurrentWindow: () => any
  importDpi: () => Promise<{ LogicalSize: any }>

  toggleStickyEditMode: (btn: HTMLButtonElement) => Promise<void>
  addStickyTodoLine: (editBtn: HTMLButtonElement) => Promise<void>
  toggleStickyOpacitySlider: (btn: HTMLButtonElement) => void
  toggleStickyColorPicker: (btn: HTMLButtonElement) => void

  getStickyLockIcon: (locked: boolean) => string
  getStickyTopIcon: (onTop: boolean) => string
  getStickyOpacityIcon: () => string
  getStickyColorIcon: () => string
  getStickyEditIcon: (editing: boolean) => string
}

export type StickyNoteWindowHost = {
  toggleStickyWindowLock: (btn: HTMLButtonElement) => void
  toggleStickyWindowOnTop: (btn: HTMLButtonElement) => Promise<void>
  adjustStickyWindowHeight: () => Promise<void>
  scheduleAdjustStickyHeight: () => void
  createStickyNoteControls: () => void
}

export function createStickyNoteWindowHost(
  deps: StickyNoteWindowHostDeps,
): StickyNoteWindowHost {
  const STICKY_MIN_HEIGHT = 150
  const STICKY_MAX_HEIGHT = 600
  let _stickyAutoHeightTimer: number | null = null

  function toggleStickyWindowLock(btn: HTMLButtonElement): void {
    const locked = !deps.getStickyNoteLocked()
    deps.setStickyNoteLocked(locked)
    btn.innerHTML = deps.getStickyLockIcon(locked)
    btn.classList.toggle('active', locked)
    btn.title = locked ? '解除锁定' : '锁定窗口位置'

    const dragRegions = document.querySelectorAll(
      '.custom-titlebar-drag, .titlebar, [data-tauri-drag-region]',
    )
    dragRegions.forEach((el) => {
      const htmlEl = el as HTMLElement
      if (locked) {
        el.removeAttribute('data-tauri-drag-region')
        htmlEl.style.setProperty(
          '-webkit-app-region',
          'no-drag',
          'important',
        )
        htmlEl.style.setProperty('app-region', 'no-drag', 'important')
        htmlEl.style.cursor = 'default'
        htmlEl.classList.add('sticky-drag-locked')
      } else {
        if (el.classList.contains('custom-titlebar-drag')) {
          el.setAttribute('data-tauri-drag-region', '')
        }
        htmlEl.style.removeProperty('-webkit-app-region')
        htmlEl.style.removeProperty('app-region')
        htmlEl.style.cursor = 'move'
        htmlEl.classList.remove('sticky-drag-locked')
      }
    })
  }

  async function toggleStickyWindowOnTop(btn: HTMLButtonElement): Promise<void> {
    const next = !deps.getStickyNoteOnTop()
    deps.setStickyNoteOnTop(next)
    btn.innerHTML = deps.getStickyTopIcon(next)
    btn.classList.toggle('active', next)
    btn.title = next ? '取消置顶' : '窗口置顶'

    try {
      const win = deps.getCurrentWindow()
      await win.setAlwaysOnTop(next)
    } catch (e) {
      console.error('[便签模式] 设置置顶失败:', e)
    }
  }

  async function adjustStickyWindowHeight(): Promise<void> {
    if (!deps.getStickyNoteMode()) return
    try {
      const previewEl = deps.getPreviewElement()
      if (!previewEl) return
      // 预览被隐藏时（切到源码模式）scrollHeight 可能变成 0；此时调整窗口高度只会把窗口“吸”到最小值。
      try {
        if (previewEl.classList.contains('hidden')) return
        const st = window.getComputedStyle(previewEl)
        if (st.display === 'none' || st.visibility === 'hidden') return
      } catch {}
      const previewBody = previewEl.querySelector(
        '.preview-body',
      ) as HTMLElement | null
      if (!previewBody) return

      // 便签待办的 tooltip 是绝对定位元素：在某些浏览器里会参与 scrollHeight 计算，
      // 导致“点一下复选框窗口高度就跳”的错觉。测量时临时隐藏它们，避免抖动。
      let contentHeight = 0
      try {
        document.body.classList.add('sticky-note-measuring')
        // 让样式有机会落地（尤其是 transition/transform 被禁用时），避免读到“半动画”的 scrollHeight。
        await new Promise<void>((resolve) => {
          try {
            requestAnimationFrame(() => resolve())
          } catch {
            resolve()
          }
        })
        contentHeight = previewBody.scrollHeight
      } finally {
        try {
          document.body.classList.remove('sticky-note-measuring')
        } catch {}
      }
      if (!contentHeight || contentHeight <= 0) return
      const controlsHeight = 50
      const padding = 30

      let targetHeight = contentHeight + controlsHeight + padding
      // 便签的高度上限应该贴近屏幕可用高度：否则内容一多就开始滚动，固定按钮区域会遮挡内容。
      // 用 screen.availHeight（CSS 像素）限制即可，别跟 Tauri 的物理像素/逻辑像素在这里死磕。
      const screenAvailH = Math.round(
        Number(window?.screen?.availHeight || window?.screen?.height || 0),
      )
      const stickyMaxHeight =
        screenAvailH > 0
          ? Math.max(STICKY_MIN_HEIGHT, Math.round(screenAvailH - 80))
          : STICKY_MAX_HEIGHT
      targetHeight = Math.max(
        STICKY_MIN_HEIGHT,
        Math.min(stickyMaxHeight, targetHeight),
      )

      // 关键点：别在这里纠结“物理像素 vs 逻辑像素”。
      // 便签高度自适应的输入（scrollHeight）本身就是 CSS 逻辑像素；
      // 多显示器混合缩放下，Tauri 的 innerSize/scaleFactor 在某些机器上可能会短暂不一致，
      // 导致我们用错单位去做比较/取整，从而出现“点一下复选框窗口就跳一下”的离谱行为。
      // 用当前 WebView 的 viewport（window.innerWidth/innerHeight）做比较与保宽，单位天然一致。
      const viewportW = Math.round(Number(window.innerWidth) || 0)
      const viewportH = Math.round(Number(window.innerHeight) || 0)
      if (!viewportW || !viewportH) return

      const win = deps.getCurrentWindow()
      if (Math.abs(viewportH - targetHeight) > 10) {
        const { LogicalSize } = await deps.importDpi()
        await win.setSize(
          new LogicalSize(viewportW, Math.round(targetHeight)),
        )
      }
    } catch (e) {
      console.error('[便签模式] 调整窗口高度失败:', e)
    }
  }

  function scheduleAdjustStickyHeight(): void {
    if (!deps.getStickyNoteMode()) return
    if (_stickyAutoHeightTimer) {
      clearTimeout(_stickyAutoHeightTimer)
    }
    _stickyAutoHeightTimer = window.setTimeout(() => {
      _stickyAutoHeightTimer = null
      void adjustStickyWindowHeight()
    }, 100)
  }

  function createStickyNoteControls(): void {
    const existing = document.getElementById('sticky-note-controls')
    if (existing) existing.remove()

    const container = document.createElement('div')
    container.id = 'sticky-note-controls'
    container.className = 'sticky-note-controls'

    const editBtn = document.createElement('button')
    editBtn.className = 'sticky-note-btn sticky-note-edit-btn'
    editBtn.title = '切换到源码模式'
    editBtn.innerHTML = deps.getStickyEditIcon(false)
    editBtn.addEventListener('click', async () => {
      await deps.toggleStickyEditMode(editBtn)
    })

    const lockBtn = document.createElement('button')
    lockBtn.className = 'sticky-note-btn sticky-note-lock-btn'
    lockBtn.title = '锁定窗口位置'
    lockBtn.innerHTML = deps.getStickyLockIcon(false)
    lockBtn.addEventListener('click', () => toggleStickyWindowLock(lockBtn))

    const topBtn = document.createElement('button')
    topBtn.className = 'sticky-note-btn sticky-note-top-btn'
    topBtn.title = '窗口置顶'
    topBtn.innerHTML = deps.getStickyTopIcon(false)
    topBtn.addEventListener('click', async () => {
      await toggleStickyWindowOnTop(topBtn)
    })

    const opacityBtn = document.createElement('button')
    opacityBtn.className = 'sticky-note-btn sticky-note-opacity-btn'
    opacityBtn.title = '调整透明度'
    opacityBtn.innerHTML = deps.getStickyOpacityIcon()
    opacityBtn.addEventListener('click', () => {
      deps.toggleStickyOpacitySlider(opacityBtn)
    })

    const colorBtn = document.createElement('button')
    colorBtn.className = 'sticky-note-btn sticky-note-color-btn'
    colorBtn.title = '切换背景颜色'
    colorBtn.innerHTML = deps.getStickyColorIcon()
    colorBtn.addEventListener('click', () => {
      deps.toggleStickyColorPicker(colorBtn)
    })

    const todoBtn = document.createElement('button')
    todoBtn.className = 'sticky-note-btn'
    todoBtn.title = '添加待办'
    todoBtn.textContent = '+'
    todoBtn.addEventListener('click', async () => {
      await deps.addStickyTodoLine(editBtn)
    })

    container.appendChild(editBtn)
    container.appendChild(lockBtn)
    container.appendChild(topBtn)
    container.appendChild(opacityBtn)
    container.appendChild(colorBtn)
    container.appendChild(todoBtn)
    document.body.appendChild(container)
  }

  return {
    toggleStickyWindowLock,
    toggleStickyWindowOnTop,
    adjustStickyWindowHeight,
    scheduleAdjustStickyHeight,
    createStickyNoteControls,
  }
}
