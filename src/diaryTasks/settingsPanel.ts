// 设置窗口「模板」分区：管理待办模板 / 日记模板
// 模板用于「新建待办 / 写日记」时填充编辑弹窗，存 flymd-settings.json

import { t } from '../i18n'
import { pluginNotice } from '../core/pluginNotice'
import { getDefaultTemplates, loadTemplates, saveTemplates } from './templates'

export async function renderTemplatesPanel(host: HTMLElement): Promise<void> {
  host.innerHTML = ''
  const tpls = await loadTemplates()
  const defaults = getDefaultTemplates()

  const root = document.createElement('div')

  const title = document.createElement('div')
  title.className = 'settings-section-title'
  title.textContent = t('diaryTasks.tpl.title')
  root.appendChild(title)

  type Row = { kind: 'todo' | 'diary'; label: string; value: string; tip?: string }
  const rows: Row[] = [
    { kind: 'todo', label: t('diaryTasks.tpl.todo'), value: tpls.todo },
    { kind: 'diary', label: t('diaryTasks.tpl.diary'), value: tpls.diary },
  ]

  const editors: Record<string, HTMLTextAreaElement> = {}

  rows.forEach((row) => {
    const block = document.createElement('div')
    block.className = 'dt-tpl-block'

    const head = document.createElement('div')
    head.className = 'dt-tpl-head'
    const name = document.createElement('div')
    name.className = 'dt-tpl-name'
    name.textContent = row.label
    const actions = document.createElement('div')
    actions.className = 'dt-tpl-actions'
    const btnReset = document.createElement('button')
    btnReset.type = 'button'
    btnReset.className = 'dt-btn'
    btnReset.textContent = t('diaryTasks.tpl.reset')
    actions.appendChild(btnReset)
    head.appendChild(name)
    head.appendChild(actions)

    const area = document.createElement('textarea')
    area.className = 'dt-tpl-editor'
    area.spellcheck = false
    area.value = row.value
    editors[row.kind] = area

    block.appendChild(head)
    block.appendChild(area)

    {
      const tip = document.createElement('div')
      tip.className = 'dt-tip'
      tip.textContent = t(
        row.kind === 'todo' ? 'diaryTasks.tpl.todoTip' : 'diaryTasks.tpl.diaryTip',
      )
      block.appendChild(tip)
    }

    btnReset.onclick = async () => {
      area.value = defaults[row.kind]
      await saveTemplates({ ...(await loadTemplates()), [row.kind]: defaults[row.kind] })
      pluginNotice(t('diaryTasks.tpl.resetDone'), 'ok', 1800)
    }

    root.appendChild(block)
  })

  const hint = document.createElement('div')
  hint.className = 'dt-tip'
  hint.textContent = `${t('diaryTasks.tpl.hint')}\n${t('diaryTasks.tpl.path')}`
  root.appendChild(hint)

  const footer = document.createElement('div')
  footer.className = 'dt-tpl-head'
  const spacer = document.createElement('div')
  spacer.className = 'dt-cal-spacer'
  const btnSave = document.createElement('button')
  btnSave.type = 'button'
  btnSave.className = 'dt-btn dt-btn-primary'
  btnSave.textContent = t('diaryTasks.tpl.save')
  btnSave.onclick = async () => {
    try {
      await saveTemplates({
        todo: editors.todo?.value ?? '',
        diary: editors.diary?.value ?? '',
      })
      pluginNotice(t('diaryTasks.tpl.saved'), 'ok', 1800)
    } catch (e) {
      try { console.error('[diaryTasks] 保存模板失败', e) } catch {}
    }
  }
  footer.appendChild(spacer)
  footer.appendChild(btnSave)
  root.appendChild(footer)

  host.appendChild(root)
}
