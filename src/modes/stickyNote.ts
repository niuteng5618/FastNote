// 便签模式基础类型与常量（配置 + 颜色定义）

import type { Store } from '@tauri-apps/plugin-store'

export type StickyNoteColor =
  | 'white'
  | 'gray'
  | 'black'
  | 'yellow'
  | 'pink'
  | 'blue'
  | 'green'
  | 'orange'
  | 'purple'
  | 'red'

export type StickyNotePrefs = {
  opacity: number
  color: StickyNoteColor
}

// 便签模式配置文件（仅存储颜色和透明度）
export const STICKY_NOTE_PREFS_FILE = 'flymd-sticky-note.json'

export const STICKY_NOTE_DEFAULT_OPACITY = 0.85

export const STICKY_NOTE_DEFAULT_COLOR: StickyNoteColor = 'white'

export const STICKY_NOTE_VALID_COLORS: StickyNoteColor[] = [
  'white',
  'gray',
  'black',
  'yellow',
  'pink',
  'blue',
  'green',
  'orange',
  'purple',
  'red',
]

// 便签配置读写依赖（环境抽象，便于在 main.ts 中注入实现）
export type StickyNotePrefsDeps = {
  appLocalDataDir: () => Promise<string>
  readTextFileAnySafe: (p: string) => Promise<string>
  writeTextFileAnySafe: (p: string, content: string) => Promise<void>
  getStore: () => Store | null | Promise<Store | null>
}

export type StickyNotePrefsResult = StickyNotePrefs

async function getPrefsPath(deps: StickyNotePrefsDeps): Promise<string> {
  try {
    const dir = await deps.appLocalDataDir()
    if (dir && typeof dir === 'string') {
      const sep = dir.includes('\\') ? '\\' : '/'
      return dir.replace(/[\\/]+$/, '') + sep + STICKY_NOTE_PREFS_FILE
    }
  } catch {}
  return STICKY_NOTE_PREFS_FILE
}

// 读取便签模式配置（颜色和透明度），带 Store 兼容回退
export async function loadStickyNotePrefsCore(
  deps: StickyNotePrefsDeps,
): Promise<StickyNotePrefsResult> {
  // 1) 首选：本地 JSON 配置文件
  try {
    const path = await getPrefsPath(deps)
    const text = await deps.readTextFileAnySafe(path)
    if (text && text.trim()) {
      const obj = JSON.parse(text) as any
      const rawOpacity =
        typeof obj.opacity === 'number'
          ? obj.opacity
          : STICKY_NOTE_DEFAULT_OPACITY
      const rawColor =
        typeof obj.color === 'string'
          ? obj.color
          : STICKY_NOTE_DEFAULT_COLOR
      const opacity = Math.max(0, Math.min(1, rawOpacity))
      const color = STICKY_NOTE_VALID_COLORS.includes(
        rawColor as StickyNoteColor,
      )
        ? (rawColor as StickyNoteColor)
        : STICKY_NOTE_DEFAULT_COLOR

      return { opacity, color }
    }
  } catch {}

  // 2) 兼容旧版：从 Store 读取一次，并同步写入本地配置文件
  try {
    const store = await deps.getStore()
    if (store) {
      const savedOpacity = (await store.get(
        'stickyNoteOpacity',
      )) as number | null
      const savedColor = (await store.get(
        'stickyNoteColor',
      )) as string | null
      let opacity = STICKY_NOTE_DEFAULT_OPACITY
      let color: StickyNoteColor = STICKY_NOTE_DEFAULT_COLOR
      if (typeof savedOpacity === 'number' && Number.isFinite(savedOpacity)) {
        opacity = Math.max(0, Math.min(1, savedOpacity))
      }
      if (
        savedColor &&
        STICKY_NOTE_VALID_COLORS.includes(savedColor as StickyNoteColor)
      ) {
        color = savedColor as StickyNoteColor
      }
      const prefs: StickyNotePrefs = { opacity, color }
      try {
        await saveStickyNotePrefsCore(deps, prefs, true)
      } catch {}
      return prefs
    }
  } catch {}

  // 3) 默认值
  return {
    opacity: STICKY_NOTE_DEFAULT_OPACITY,
    color: STICKY_NOTE_DEFAULT_COLOR,
  }
}

// 保存便签模式配置到本地文件，并可选写回 Store（兼容旧版本）
export async function saveStickyNotePrefsCore(
  deps: StickyNotePrefsDeps,
  prefs: StickyNotePrefs,
  skipStore = false,
): Promise<void> {
  const opacity = Math.max(
    0,
    Math.min(1, Number(prefs.opacity) || STICKY_NOTE_DEFAULT_OPACITY),
  )
  const color = STICKY_NOTE_VALID_COLORS.includes(prefs.color)
    ? prefs.color
    : STICKY_NOTE_DEFAULT_COLOR

  const safe: StickyNotePrefs = { opacity, color }

  try {
    const path = await getPrefsPath(deps)
    await deps.writeTextFileAnySafe(path, JSON.stringify(safe))
  } catch (e) {
    console.warn('[便签模式] 保存便签配置文件失败:', e)
  }

  if (!skipStore) {
    try {
      const store = await deps.getStore()
      if (!store) return
      await store.set('stickyNoteOpacity', safe.opacity)
      await store.set('stickyNoteColor', safe.color)
      await store.save()
    } catch (e) {
      console.warn('[便签模式] 保存便签配置到 Store 失败:', e)
    }
  }
}

// 将便签颜色/透明度应用到 DOM（仅通过 CSS 变量控制样式，不做持久化）
export function applyStickyNoteAppearance(
  color: StickyNoteColor,
  opacityRaw: number,
): void {
  try {
    const root = document.documentElement
    const opacity = Math.max(0, Math.min(1, Number(opacityRaw) || 0))

    // 透明度：通过 CSS 变量控制整体 rgba() 背景
    root.style.setProperty('--sticky-opacity', String(opacity))

    // 背景色：映射到固定 RGB，避免 HSL 之类的奇技淫巧
    let rgb = '255, 255, 255' // 默认白色
    let fg: string | null = null

    if (color === 'gray') {
      rgb = '229, 231, 235' // 灰色
    } else if (color === 'black') {
      rgb = '15, 23, 42' // 深色
      fg = '#e5e7eb' // 浅字色，增强对比度
    } else if (color === 'yellow') {
      rgb = '252, 211, 77' // 便签黄
    } else if (color === 'pink') {
      rgb = '252, 231, 243' // 粉色
    } else if (color === 'blue') {
      rgb = '219, 234, 254' // 蓝色
    } else if (color === 'green') {
      rgb = '209, 250, 229' // 绿色
    } else if (color === 'orange') {
      rgb = '254, 215, 170' // 橙色
    } else if (color === 'purple') {
      rgb = '233, 213, 255' // 紫色
    } else if (color === 'red') {
      rgb = '254, 202, 202' // 红色
    }

    root.style.setProperty('--sticky-rgb', rgb)
    if (fg) root.style.setProperty('--sticky-fg', fg)
    else root.style.removeProperty('--sticky-fg')

    // 根据背景色和透明度动态调整文字阴影，保证低透明度下仍可读
    if (color === 'black') {
      // 黑色背景直接用浅色文字，不需要阴影
      root.style.removeProperty('--sticky-text-shadow')
      return
    }

    // 透明度 < 0.6（超过 40% 透明）时，为浅色背景加一点“外发光”增强对比度
    if (opacity < 0.6) {
      const shadowStrength = Math.max(0, (0.6 - opacity) * 2) // 0 到 ~0.8
      const shadowBlur = 2 + shadowStrength * 3 // 2px 到 ~5px
      const shadowColor = `rgba(255, 255, 255, ${
        0.8 + shadowStrength * 0.2
      })` // 0.8 到 1.0
      root.style.setProperty(
        '--sticky-text-shadow',
        `0 0 ${shadowBlur}px ${shadowColor}, 0 0 ${
          shadowBlur * 1.5
        }px ${shadowColor}`,
      )
    } else {
      root.style.removeProperty('--sticky-text-shadow')
    }
  } catch {
    // DOM 不可用时静默失败（比如在某些测试环境下）
  }
}

// 便签模式运行时依赖（模式切换 + 窗口行为），由 main.ts 注入具体实现
export type StickyNoteModeDeps = {
  // 配置与持久化
  loadPrefs: () => Promise<StickyNotePrefs>
  getStore: () => Store | null | Promise<Store | null>

  // 编辑器模式与预览
  getMode: () => 'edit' | 'preview'
  setMode: (m: 'edit' | 'preview') => void
  isWysiwygActive: () => boolean
  disableWysiwyg: () => Promise<void>
  renderPreview: () => Promise<void>
  showPreviewPanel: (show: boolean) => void
  syncToggleButton: () => void

  // 文件与 UI 行为
  openFile: (filePath: string) => Promise<void>
  toggleFocusMode: (enable: boolean) => Promise<void>
  showLibrary: (show: boolean, focus: boolean) => void | Promise<void>
  createControls: () => void

  // 主题与样式
  forceLightTheme: () => void
  addBodyStickyClass: () => void
  applyAppearance: (color: StickyNoteColor, opacity: number) => void
  scheduleAdjustHeight: () => void

  // 窗口控制（通过依赖注入解耦 Tauri）
  getCurrentWindow: () => any
  currentMonitor: () => Promise<any>
  importDpi: () => Promise<{ LogicalSize: any; LogicalPosition: any }>
  getScreenSize: () => { width: number; height: number } | null

  // 日志
  logError: (scope: string, e: unknown) => void
}

export type StickyNoteModeResult = {
  opacity: number
  color: StickyNoteColor
}

// 进入便签模式的核心流程（不依赖 main.ts 全局变量）
export async function enterStickyNoteModeCore(
  deps: StickyNoteModeDeps,
  filePath: string,
): Promise<StickyNoteModeResult> {
  // 0. 强制切换到亮色模式
  try {
    deps.forceLightTheme()
  } catch (e) {
    deps.logError('切换亮色模式失败', e)
  }

  // 1. 预先加载便签配置（透明度 / 颜色）
  let opacity = STICKY_NOTE_DEFAULT_OPACITY
  let color: StickyNoteColor = STICKY_NOTE_DEFAULT_COLOR
  try {
    const prefs = await deps.loadPrefs()
    opacity = prefs.opacity
    color = prefs.color
  } catch (e) {
    deps.logError('预加载配置失败', e)
  }

  // 2. 打开文件
  try {
    await deps.openFile(filePath)
  } catch (e) {
    deps.logError('打开文件失败', e)
  }

  // 3. 进入专注模式（仅当前便签窗口生效）
  try {
    await deps.toggleFocusMode(true)
  } catch (e) {
    deps.logError('进入专注模式失败', e)
  }

  // 4. 切换到阅读模式（记录之前的源码模式状态，并强制关闭所见模式）
  try {
    const store = await deps.getStore()
    if (store) {
      await store.set('editorModeBeforeSticky', {
        mode: deps.getMode(),
        wysiwygV2Active: deps.isWysiwygActive(),
      } as any)
      await store.save()
    }

    if (deps.isWysiwygActive()) {
      try {
        await deps.disableWysiwyg()
      } catch {}
    }

    deps.setMode('preview')
    try {
      deps.showPreviewPanel(true)
    } catch {}
    try {
      await deps.renderPreview()
    } catch {}
    try {
      deps.syncToggleButton()
    } catch {}
  } catch (e) {
    deps.logError('切换阅读模式失败', e)
  }

  // 5. 关闭库侧栏
  try {
    await deps.showLibrary(false, false)
  } catch (e) {
    deps.logError('关闭库侧栏失败', e)
  }

  // 6. 创建便签控制按钮 + 标记模式类
  try {
    deps.createControls()
  } catch {}
  try {
    deps.addBodyStickyClass()
  } catch {}

  // 7. 调整窗口大小和位置（移动到右上角，缩小为便签尺寸）
  try {
    const win = deps.getCurrentWindow()
    const { LogicalSize, LogicalPosition } = await deps.importDpi()

    // 先保存当前窗口大小和位置，供下次正常启动恢复
    try {
      const store = await deps.getStore()
      if (store) {
        const [currentSize, currentPos, scaleFactor] = await Promise.all([
          win.innerSize(),
          win.outerPosition(),
          typeof (win as any)?.scaleFactor === 'function'
            ? (win as any).scaleFactor()
            : Promise.resolve(1),
        ])
        if (currentSize && currentPos) {
          const factor = Number(scaleFactor) || 1
          await store.set('windowStateBeforeSticky', {
            // innerSize/outerPosition 返回物理像素；存储时统一转成逻辑像素，避免 Windows 缩放下恢复错位/变形。
            unit: 'logical',
            width: Math.round((Number(currentSize.width) || 0) / factor),
            height: Math.round((Number(currentSize.height) || 0) / factor),
            x: Math.round((Number(currentPos.x) || 0) / factor),
            y: Math.round((Number(currentPos.y) || 0) / factor),
          } as any)
          await store.save()
        }
      }
    } catch {}

    const stickyWidth = 340
    const stickyHeight = 300

    // 默认位置：右上角，右侧和顶部各留 20 像素边距（坐标强制约束在屏幕范围之内）
    let posX = 20
    let posY = 20

    // 优先使用当前显示器工作区信息，避免 DPI 缩放导致的位置计算偏差
    let placed = false
    try {
      const monitor = await deps.currentMonitor()
      const workArea = monitor?.workArea
      if (workArea && workArea.position && workArea.size) {
        const scale = monitor.scaleFactor || 1
        const workX = workArea.position.x / scale
        const workY = workArea.position.y / scale
        const workW = workArea.size.width / scale
        const workH = workArea.size.height / scale

        posX = Math.round(workX + workW - stickyWidth - 20)
        posY = Math.round(workY + 20)

        const minX = workX
        const maxX = workX + workW - stickyWidth
        const minY = workY
        const maxY = workY + workH - stickyHeight
        posX = Math.min(Math.max(posX, minX), maxX)
        posY = Math.min(Math.max(posY, minY), maxY)
        placed = true
      }
    } catch {
      // 忽略，回退到 screen 信息
    }

    if (!placed) {
      try {
        const screenSize = deps.getScreenSize()
        if (screenSize) {
          const { width: screenW, height: screenH } = screenSize
          posX = Math.round(screenW - stickyWidth - 20)
          posY = 20
          const minX = 0
          const maxX = screenW - stickyWidth
          const minY = 0
          const maxY = screenH - stickyHeight
          posX = Math.min(Math.max(posX, minX), maxX)
          posY = Math.min(Math.max(posY, minY), maxY)
        }
      } catch {}
    }

    await win.setSize(new LogicalSize(stickyWidth, stickyHeight))
    await win.setPosition(new LogicalPosition(posX, posY))

    // 便签模式：隐藏任务栏图标
    try {
      await win.setSkipTaskbar(true)
    } catch (e) {
      deps.logError('隐藏任务栏图标失败', e)
    }
  } catch (e) {
    deps.logError('调整窗口大小和位置失败', e)
  }

  // 8. 应用透明度和颜色设置
  try {
    deps.applyAppearance(color, opacity)
  } catch (e) {
    deps.logError('加载透明度失败', e)
  }

  // 9. 延迟调整窗口高度以适应内容
  setTimeout(() => {
    try {
      deps.scheduleAdjustHeight()
    } catch {}
  }, 300)

  return { opacity, color }
}

// 窗口状态恢复依赖与核心函数（用于退出便签模式后恢复大小/位置）
export type StickyNoteWindowDeps = {
  getStore: () => Store | null | Promise<Store | null>
  getCurrentWindow: () => any
  importDpi: () => Promise<{ LogicalSize: any; LogicalPosition: any }>
}

export async function restoreWindowStateBeforeStickyCore(
  deps: StickyNoteWindowDeps,
): Promise<void> {
  try {
    const store = await deps.getStore()
    if (!store) return
    const saved = (await store.get('windowStateBeforeSticky')) as
      | { width: number; height: number; x: number; y: number; unit?: string }
      | null
    if (!saved || !saved.width || !saved.height) return
    const win = deps.getCurrentWindow()
    const { LogicalSize, LogicalPosition } = await deps.importDpi()

    // 兼容旧数据：早期版本保存的是物理像素（没有 unit 字段）。
    let factor = 1
    try {
      if (typeof (win as any)?.scaleFactor === 'function') {
        factor = Number(await (win as any).scaleFactor()) || 1
      }
    } catch {}

    const isLogical = saved.unit === 'logical'
    const width = isLogical ? saved.width : saved.width / factor
    const height = isLogical ? saved.height : saved.height / factor
    const x = isLogical ? saved.x : saved.x / factor
    const y = isLogical ? saved.y : saved.y / factor

    await win.setSize(new LogicalSize(Math.round(width), Math.round(height)))
    if (typeof saved.x === 'number' && typeof saved.y === 'number') {
      await win.setPosition(new LogicalPosition(Math.round(x), Math.round(y)))
    }
    await store.delete('windowStateBeforeSticky')
    await store.save()
  } catch (e) {
    console.warn('[便签模式] 恢复窗口状态失败:', e)
  }
}
