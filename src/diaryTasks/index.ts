// 日记与待办：内置入口（Ribbon 日历按钮）
// 原先由 note-templates 扩展提供，现改为应用内置功能，始终可用、无需在扩展里开关
// 按钮位置：紧跟「AI 助手」按钮下方；插件按钮会随菜单管理重排，故用观察器保持位置

import { t } from '../i18n'
import { ribbonIcons } from '../icons'
import { openDiaryTasksPanel, type PanelDeps } from './panel'

let _deps: PanelDeps | null = null
let _opening = false
let _observed = false

function ribbonTop(): HTMLElement | null {
  return document.querySelector('#ribbon .ribbon-top') as HTMLElement | null
}

// 把按钮放到 AI 助手按钮之后；没有该按钮时退回工具条末尾。
// 幂等：位置正确时不动 DOM，避免观察器自激循环。
export function placeDiaryTasksButton(): void {
  const top = ribbonTop()
  const btn = document.getElementById('btn-diary-tasks')
  if (!top || !btn) return
  const ai = top.querySelector('[data-plugin-id="ai-assistant"]')
  if (ai && ai.parentElement === top) {
    if (ai.nextElementSibling !== btn) top.insertBefore(btn, ai.nextElementSibling)
    return
  }
  if (top.lastElementChild !== btn) top.appendChild(btn)
}

function schedulePlace(): void {
  // 合并同一帧内的多次 DOM 变更（插件注册 / 重排会连续触发）
  try {
    requestAnimationFrame(() => { try { placeDiaryTasksButton() } catch {} })
  } catch {
    setTimeout(() => { try { placeDiaryTasksButton() } catch {} }, 0)
  }
}

export function initDiaryTasks(deps: PanelDeps): void {
  _deps = deps

  let btn = document.getElementById('btn-diary-tasks') as HTMLButtonElement | null
  if (!btn) {
    btn = document.createElement('button')
    btn.className = 'ribbon-btn'
    btn.id = 'btn-diary-tasks'
    btn.title = t('diaryTasks.open.tip')
    btn.innerHTML = ribbonIcons.calendar
    const top = ribbonTop()
    if (top) top.appendChild(btn)
  }
  if (btn && !(btn as any).__dtBound) {
    ;(btn as any).__dtBound = true
    btn.addEventListener('click', () => { void openPanel() })
  }
  placeDiaryTasksButton()

  // 插件按钮是启动后陆续注册的，位置会变；监听工具条子节点变化重新摆位
  if (!_observed) {
    const top = ribbonTop()
    if (top && typeof MutationObserver !== 'undefined') {
      _observed = true
      try {
        new MutationObserver(() => { schedulePlace() }).observe(top, { childList: true })
      } catch {}
    }
  }

  try {
    ;(window as any).flymdOpenDiaryTasks = () => { void openPanel() }
  } catch {}
}

export async function openPanel(): Promise<void> {
  if (!_deps) return
  // 面板是独立弹窗，打开过程中重复点击直接忽略，避免叠加多层遮罩
  if (_opening) return
  _opening = true
  try {
    await openDiaryTasksPanel(_deps)
  } catch (e) {
    try { console.error('[diaryTasks] 打开面板失败', e) } catch {}
  } finally {
    _opening = false
  }
}

