/**
 * 同进程多窗口：窗口创建与命中判断
 *
 * 重要：这里不依赖 main.ts，避免把“窗口管理逻辑”塞进主入口。
 */

export type EditorWindowCreateOpts = {
  url?: string
  title?: string
  width?: number
  height?: number
  x?: number
  y?: number
}

function isWindowsPlatform(): boolean {
  const platform = (navigator.platform || '').toLowerCase()
  return platform.includes('win')
}

function supportsTransparentEditorWindow(): boolean {
  const platform = (navigator.platform || '').toLowerCase()
  return platform.includes('win') || platform.includes('linux')
}

export function isEditorWindowLabel(label: string): boolean {
  // 主窗口固定为 main；同进程新开的编辑器窗口统一用 main- 前缀
  return label === 'main' || label.startsWith('main-')
}

export async function getCurrentWebviewWindowLabel(): Promise<string | null> {
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    return WebviewWindow.getCurrent().label || null
  } catch {
    return null
  }
}

export async function findWebviewWindowLabelAtScreenPoint(
  screenX: number,
  screenY: number,
  opts?: { excludeLabel?: string; margin?: number },
): Promise<string | null> {
  const margin = typeof opts?.margin === 'number' ? opts!.margin : 0
  const excludeLabel = opts?.excludeLabel
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const wins = await WebviewWindow.getAll()
    for (const w of wins) {
      try {
        if (!isEditorWindowLabel(w.label)) continue
        if (excludeLabel && w.label === excludeLabel) continue
        const [pos, size, sf] = await Promise.all([
          w.outerPosition(),
          w.outerSize(),
          w.scaleFactor(),
        ])
        const factor = Number(sf) || 1
        const x = (Number(pos?.x) || 0) / factor
        const y = (Number(pos?.y) || 0) / factor
        const ww = (Number((size as any)?.width) || 0) / factor
        const hh = (Number((size as any)?.height) || 0) / factor
        if (
          screenX >= x - margin &&
          screenY >= y - margin &&
          screenX <= x + ww + margin &&
          screenY <= y + hh + margin
        ) {
          return w.label
        }
      } catch {
        // 某个窗口查询失败，忽略
      }
    }
  } catch {
    // 非 Tauri 环境
  }
  return null
}

export async function createEditorWebviewWindow(
  opts?: EditorWindowCreateOpts,
): Promise<{ label: string } | null> {
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const label =
      'main-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    const url = opts?.url || 'index.html'
    const title = opts?.title || 'FastNote'
    const width = typeof opts?.width === 'number' ? opts!.width : 960
    const height = typeof opts?.height === 'number' ? opts!.height : 640

    const w = new WebviewWindow(label, {
      url,
      title,
      width,
      height,
      resizable: true,
      decorations: false,
      transparent: supportsTransparentEditorWindow(),
      shadow: !isWindowsPlatform(),
      x: typeof opts?.x === 'number' ? opts!.x : undefined,
      y: typeof opts?.y === 'number' ? opts!.y : undefined,
    })

    return await new Promise((resolve) => {
      let done = false
      const finish = (ok: boolean) => {
        if (done) return
        done = true
        resolve(ok ? { label } : null)
      }
      try {
        w.once('tauri://created', () => finish(true))
        w.once('tauri://error', (err) => {
          try { console.error('[Window] 创建编辑器窗口失败', err) } catch {}
          finish(false)
        })
        // 兜底：避免某些平台事件不触发导致悬挂
        setTimeout(() => finish(true), 1200)
      } catch {
        // 如果事件 API 不可用，直接当作创建成功（后续发送端会重试等待 ACK）
        finish(true)
      }
    })
  } catch {
    return null
  }
}

export async function destroyWebviewWindowByLabel(label: string): Promise<void> {
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const w = await WebviewWindow.getByLabel(label)
    if (!w) return
    try { await w.destroy() } catch {}
  } catch {
    // 忽略
  }
}
