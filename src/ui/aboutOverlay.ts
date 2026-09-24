// 关于对话框 UI 模块
// 从 main.ts 拆分：负责 about-overlay 的 DOM 构建与内容渲染

import { t } from '../i18n'
import { APP_VERSION } from '../core/appInfo'

type ShortcutRow = {
  action: string
  keys: string
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderShortcutKeysCell(keys: string): string {
  // 用 / 分隔多个快捷键组合，每个组合整体显示为一个 kbd
  const parts = keys.split('/').map(s => s.trim()).filter(Boolean)
  const kbds = parts.map(p => `<kbd>${escapeHtml(p)}</kbd>`).join('')
  return `<span class="about-sc-keys-wrapper">${kbds}</span>`
}

function getShortcutRows(): ShortcutRow[] {
  // 这里的“所有快捷键”以 README 的快捷键段落 + 应用实际支持的常用快捷键为准。
  // Ctrl+Shift+Z 只在 Windows/Linux 使用 Ctrl，不抢 macOS 的 Cmd+Shift+Z 重做。
  return [
    { action: t('sc.newFile'), keys: 'Ctrl+N' },
    { action: t('sc.openFile'), keys: 'Ctrl+O' },
    { action: t('sc.saveFile'), keys: 'Ctrl+S' },
    { action: t('sc.saveAs'), keys: 'Ctrl+Shift+S' },
    { action: t('sc.toggleWysiwyg'), keys: 'Ctrl+W' },
    { action: t('sc.toggleEditPreview'), keys: 'Ctrl+E' },
    { action: t('sc.focusMode'), keys: 'Ctrl+Shift+F' },
    { action: t('sc.newTab'), keys: 'Ctrl+T' },
    { action: t('sc.findReplace'), keys: 'Ctrl+H' },
    { action: t('sc.commandPalette'), keys: 'Ctrl+Shift+P' },
    { action: t('sc.toggleFileTree'), keys: 'Ctrl+Shift+Z' },
    { action: t('sc.print'), keys: 'Ctrl+P' },
    { action: t('sc.insertLink'), keys: 'Ctrl+K' },
    { action: t('sc.bold'), keys: 'Ctrl+B' },
    { action: t('sc.italic'), keys: 'Ctrl+I' },
    { action: t('sc.splitPreview'), keys: 'Ctrl+Shift+E' },
    { action: t('sc.closeTab'), keys: 'Alt+W' },
    { action: t('sc.cycleTabs'), keys: 'Ctrl+Tab' },
    { action: t('sc.cycleTabs'), keys: 'Ctrl+Shift+Tab' },
    { action: t('sc.adjustWidth'), keys: 'Shift+Wheel' },
    { action: t('sc.zoom'), keys: 'Ctrl+Wheel' },
    { action: t('sc.nativeMenu'), keys: 'Shift+Right Click' },
  ]
}

// 初始化/重建关于对话框（幂等，实现多次调用不重复注入 footer）
export function initAboutOverlay(): void {
  try {
    const containerEl = document.querySelector('.container') as HTMLDivElement | null
    if (!containerEl) return

    let about = document.getElementById('about-overlay') as HTMLDivElement | null
    if (!about) {
      about = document.createElement('div')
      about.id = 'about-overlay'
      about.className = 'about-overlay hidden'
      about.innerHTML = `
        <div class="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
          <div class="about-header">
            <div id="about-title">${t('about.title')}  v${APP_VERSION}</div>
            <button id="about-check-update" type="button" class="about-update-btn">检查更新</button>
            <button id="about-close" class="about-close" title="${t('about.close')}">×</button>
          </div>
          <div class="about-body">
            <p>${t('about.tagline')}</p>
          </div>
        </div>
      `
      containerEl.appendChild(about)
    }

    try {
      const aboutBody = about.querySelector('.about-body') as HTMLDivElement | null
      if (aboutBody) {
        const scRows = getShortcutRows()
        // 将快捷键分成两列显示
        const rowPairs: Array<[ShortcutRow, ShortcutRow | null]> = []
        for (let i = 0; i < scRows.length; i += 2) {
          rowPairs.push([scRows[i], scRows[i + 1] || null])
        }

        const scTable = `
          <div class="about-subtitle">${t('about.shortcuts')}</div>
          <table class="about-sc-table">
            <tbody>
              ${rowPairs.map(([r1, r2]) => `
                <tr>
                  <td class="about-sc-action">${escapeHtml(r1.action)}</td>
                  <td class="about-sc-keys">${renderShortcutKeysCell(r1.keys)}</td>
                  <td class="about-sc-action">${r2 ? escapeHtml(r2.action) : ''}</td>
                  <td class="about-sc-keys">${r2 ? renderShortcutKeysCell(r2.keys) : ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `
        aboutBody.innerHTML = `
          ${scTable}
        `
      }

      const aboutTitle = about.querySelector('#about-title') as HTMLDivElement | null
      if (aboutTitle) aboutTitle.textContent = `${t('about.title')} FastNote v${APP_VERSION}`
      const aboutClose = about.querySelector('#about-close') as HTMLButtonElement | null
      if (aboutClose) { aboutClose.textContent = '×'; aboutClose.title = t('about.close') }
    } catch {}
  } catch {}
}

// 显示/隐藏关于对话框
export function showAbout(show: boolean): void {
  try {
    const overlay = document.getElementById('about-overlay') as HTMLDivElement | null
    if (!overlay) return
    if (show) overlay.classList.remove('hidden')
    else overlay.classList.add('hidden')
  } catch {}
}

// 语言切换后需按新语言重建
export function resetAboutOverlay(): void {
  try { document.getElementById('about-overlay')?.remove() } catch {}
}
