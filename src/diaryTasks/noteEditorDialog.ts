// 写待办 / 写日记 的 markdown 编辑弹窗
// - 日期固定为打开时选定的那一天（只读展示，避免改日期造成内容错位）
// - 当天文件已存在 → 载入原内容继续编辑（保存即覆盖同一天文件）
// - 当天还没有文件 → 用模板展开一份新内容

import { t } from '../i18n'
import { buildTaskFilePath, writeTaskFile } from './taskFiles'
import { readTextFileAnySafe } from '../core/fsSafe'
import { loadTemplates, renderTemplate, type DiaryTaskKind } from './templates'
import { isTopLayer, popLayer, pushLayer } from './layers'

export type NoteEditorDeps = {
  notice: (msg: string, level?: 'ok' | 'err', ms?: number) => void
  confirm: (message: string, title?: string) => Promise<boolean>
}

export type NoteEditorOptions = {
  kind: DiaryTaskKind
  date: string
  root: string
}

export type NoteEditorResult = {
  path: string
  date: string
  existed: boolean
}

// 目标文件存在则载入原内容，否则用模板按日期展开
export async function resolveContent(
  kind: DiaryTaskKind,
  date: string,
  root: string,
): Promise<{ path: string; content: string; existed: boolean }> {
  const path = buildTaskFilePath(root, kind, date)
  try {
    const raw = await readTextFileAnySafe(path)
    if (raw !== null && raw !== undefined && String(raw).length > 0) {
      return { path, content: String(raw), existed: true }
    }
  } catch {}
  const tpls = await loadTemplates()
  const tpl = kind === 'todo' ? tpls.todo : tpls.diary
  return { path, content: renderTemplate(tpl, kind, date), existed: false }
}

export async function openNoteEditorDialog(
  opts: NoteEditorOptions,
  deps: NoteEditorDeps,
): Promise<NoteEditorResult | null> {
  const loaded = await resolveContent(opts.kind, opts.date, opts.root)

  return await new Promise<NoteEditorResult | null>((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'dt-overlay'

    const dialog = document.createElement('div')
    dialog.className = 'dt-dialog dt-editor'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')

    const date = opts.date
    const path = loaded.path
    let baseline = loaded.content
    let closing = false
    const layer = pushLayer()

    const header = document.createElement('div')
    header.className = 'dt-header'
    const title = document.createElement('div')
    title.textContent = t(
      loaded.existed
        ? (opts.kind === 'todo' ? 'diaryTasks.editor.editTodo' : 'diaryTasks.editor.editDiary')
        : (opts.kind === 'todo' ? 'diaryTasks.editor.newTodo' : 'diaryTasks.editor.newDiary'),
    )
    const btnClose = document.createElement('button')
    btnClose.type = 'button'
    btnClose.className = 'dt-btn dt-btn-close'
    btnClose.textContent = '×'
    header.appendChild(title)
    header.appendChild(btnClose)

    // 日期只展示，不可改：改日期等于换文件，容易把内容写到错误的一天
    const bar = document.createElement('div')
    bar.className = 'dt-editor-bar'
    const dateChip = document.createElement('span')
    dateChip.className = 'dt-editor-date'
    dateChip.textContent = date
    bar.appendChild(dateChip)
    const fileHint = document.createElement('span')
    fileHint.className = 'dt-editor-file'
    fileHint.textContent = loaded.existed
      ? t('diaryTasks.editor.continueTip')
      : t('diaryTasks.editor.newTip')
    bar.appendChild(fileHint)

    const textarea = document.createElement('textarea')
    textarea.className = 'dt-editor-text'
    textarea.spellcheck = false
    textarea.value = baseline

    const hint = document.createElement('div')
    hint.className = 'dt-editor-hint'
    hint.textContent = t('diaryTasks.editor.hint', { path })

    const footer = document.createElement('div')
    footer.className = 'dt-editor-footer'
    const btnCancel = document.createElement('button')
    btnCancel.type = 'button'
    btnCancel.className = 'dt-btn'
    btnCancel.textContent = t('diaryTasks.editor.cancel')
    const btnSave = document.createElement('button')
    btnSave.type = 'button'
    btnSave.className = 'dt-btn dt-btn-primary'
    btnSave.textContent = t('diaryTasks.editor.save')
    footer.appendChild(btnCancel)
    footer.appendChild(btnSave)

    dialog.appendChild(header)
    dialog.appendChild(bar)
    dialog.appendChild(textarea)
    dialog.appendChild(hint)
    dialog.appendChild(footer)
    overlay.appendChild(dialog)
    document.body.appendChild(overlay)

    const isDirty = () => textarea.value !== baseline

    function close(result: NoteEditorResult | null) {
      if (closing) return
      closing = true
      popLayer(layer)
      try { document.removeEventListener('keydown', onKey, true) } catch {}
      try { overlay.remove() } catch {}
      resolve(result)
    }

    async function requestClose(result: NoteEditorResult | null) {
      if (result === null && isDirty()) {
        const ok = await deps.confirm(t('diaryTasks.editor.discard'))
        if (!ok) return
      }
      close(result)
    }

    async function save() {
      const content = String(textarea.value ?? '')
      try {
        await writeTaskFile(path, content)
      } catch (e) {
        try { console.error('[diaryTasks] 保存失败', e) } catch {}
        deps.notice(t('diaryTasks.editor.failed'), 'err', 2600)
        return
      }
      baseline = content
      deps.notice(t('diaryTasks.saved', { path }), 'ok', 2000)
      close({ path, date, existed: true })
    }

    function onKey(ev: KeyboardEvent) {
      // 只响应最上层的弹窗：编辑弹窗叠在面板之上，两处 Esc 监听都要按层级过滤
      if (!isTopLayer(layer)) return
      if (ev.key === 'Escape') {
        ev.preventDefault()
        ev.stopPropagation()
        void requestClose(null)
        return
      }
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === 's' || ev.key === 'Enter')) {
        ev.preventDefault()
        ev.stopPropagation()
        void save()
      }
    }
    document.addEventListener('keydown', onKey, true)

    btnClose.onclick = () => { void requestClose(null) }
    btnCancel.onclick = () => { void requestClose(null) }
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) void requestClose(null)
    })
    btnSave.onclick = () => { void save() }

    try { textarea.focus() } catch {}
  })
}
