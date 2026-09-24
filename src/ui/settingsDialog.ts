// 设置窗口：左侧菜单 + 右侧内容。把语言、主题、扩展、关于收进一个入口。

import { t, getLocalePref, setLocalePref, type LocalePref } from '../i18n'

export type SettingsSection = 'lang' | 'theme' | 'extensions' | 'templates' | 'about'

const SECTION_ORDER: SettingsSection[] = ['lang', 'theme', 'extensions', 'templates', 'about']

function sectionLabel(s: SettingsSection): string {
  switch (s) {
    case 'lang': return '语言'
    case 'theme': return '主题'
    case 'extensions': return '扩展'
    case 'templates': return '模板'
    case 'about': return '关于'
  }
}

let _overlay: HTMLDivElement | null = null
let _content: HTMLDivElement | null = null
let _current: SettingsSection = 'lang'
let _onShow: ((s: SettingsSection, host: HTMLDivElement) => void) | null = null

function renderLang(host: HTMLDivElement): void {
  const pref = getLocalePref()
  const options: Array<[LocalePref, string]> = [
    ['auto', '跟随系统'],
    ['zh', '简体中文'],
    ['en', 'English'],
  ]
  host.innerHTML = `
    <div class="settings-section-title">语言</div>
    <div class="settings-lang-list">
      ${options.map(([v, label]) => `
        <button type="button" class="settings-lang-item ${pref === v ? 'active' : ''}" data-locale="${v}">
          <span class="settings-lang-mark"></span><span>${label}</span>
        </button>
      `).join('')}
    </div>
  `
  host.querySelectorAll('.settings-lang-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = (btn as HTMLElement).dataset.locale as LocalePref
      try { setLocalePref(v) } catch {}
      try { (window as any).flymdApplyI18nUi?.() } catch {}
      renderLang(host)
    })
  })
}

function activate(section: SettingsSection): void {
  _current = section
  if (!_overlay || !_content) return
  _overlay.querySelectorAll('.settings-nav-item').forEach((el) => {
    el.classList.toggle('active', (el as HTMLElement).dataset.section === section)
  })
  _content.innerHTML = ''
  if (section === 'lang') {
    renderLang(_content)
    return
  }
  try { _onShow?.(section, _content) } catch {}
}

export function initSettingsDialog(onShow: (s: SettingsSection, host: HTMLDivElement) => void): void {
  _onShow = onShow
  if (_overlay) return
  const overlay = document.createElement('div')
  overlay.id = 'settings-overlay'
  overlay.className = 'settings-overlay hidden'
  overlay.innerHTML = `
    <div class="settings-dialog" role="dialog" aria-modal="true">
      <div class="settings-nav">
        <div class="settings-nav-title">设置</div>
        ${SECTION_ORDER.map((s) => `<button type="button" class="settings-nav-item" data-section="${s}">${sectionLabel(s)}</button>`).join('')}
      </div>
      <div class="settings-main">
        <button type="button" class="settings-close" title="关闭">×</button>
        <div class="settings-content" id="settings-content"></div>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  _overlay = overlay
  _content = overlay.querySelector('#settings-content') as HTMLDivElement

  overlay.addEventListener('click', (e) => { if (e.target === overlay) showSettings(false) })
  overlay.querySelector('.settings-close')?.addEventListener('click', () => showSettings(false))
  overlay.querySelectorAll('.settings-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => activate((btn as HTMLElement).dataset.section as SettingsSection))
  })
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && _overlay && !_overlay.classList.contains('hidden')) showSettings(false)
  })
}

export function showSettings(show: boolean, section?: SettingsSection): void {
  if (!_overlay) return
  if (show) {
    _overlay.classList.remove('hidden')
    activate(section || _current)
  } else {
    _overlay.classList.add('hidden')
  }
}
