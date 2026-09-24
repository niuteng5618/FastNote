// 日记与待办面板：左侧「日程日历」为主区，右侧待办 / 日记 双 Tab 详情
// 日历随 Tab 切换：待办 Tab 显示待办条目，日记 Tab 只显示日记条目
// 新建待办 / 日记走 markdown 编辑弹窗（带模板），写入 <库根>/<年-月>/<年-月-日>-待办.md

import { getLocale, t } from '../i18n'
import { buildCalendarGrid, formatYMD, type CalendarCell } from './lunar'
import { scanLibrary, type DiaryNote, type DiaryTask } from './scan'
import { buildTaskFilePath, mtimeMsOf, writeTaskFile } from './taskFiles'
import { readTextFileAnySafe } from '../core/fsSafe'
import { openNoteEditorDialog } from './noteEditorDialog'
import { isTopLayer, popLayer, pushLayer } from './layers'
import type { DiaryTaskKind } from './templates'

export type XxtuiApi = {
  pushToXxtui: (title: string, content: string) => Promise<boolean>
  parseAndCreateReminders: (markdown: string) => Promise<{ success?: number; failed?: number }>
  createReminder: (...args: any[]) => Promise<any>
}

export type PanelDeps = {
  getLibraryRoot: () => Promise<string | null>
  openFileByPath: (path: string) => void | Promise<void>
  getXxtuiApi: () => XxtuiApi | null
  notice: (msg: string, level?: 'ok' | 'err', ms?: number) => void
  confirm: (message: string, title?: string) => Promise<boolean>
}

// 日历单元格里每天最多显示几条，超出用「+N」提示
const MAX_CELL_ITEMS = 3

type Tab = 'todo' | 'diary'

export async function openDiaryTasksPanel(deps: PanelDeps): Promise<void> {
  const overlay = document.createElement('div')
  overlay.className = 'dt-overlay'

  const dialog = document.createElement('div')
  dialog.className = 'dt-dialog dt-panel'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')

  // ===== 头部 =====
  const header = document.createElement('div')
  header.className = 'dt-header'
  const titleEl = document.createElement('div')
  titleEl.textContent = t('diaryTasks.title')
  const btnClose = document.createElement('button')
  btnClose.type = 'button'
  btnClose.className = 'dt-btn dt-btn-close'
  btnClose.textContent = '×'
  header.appendChild(titleEl)
  header.appendChild(btnClose)

  const body = document.createElement('div')
  body.className = 'dt-panel-main'

  const columns = document.createElement('div')
  columns.className = 'dt-columns'

  // ===== 左栏：日历 =====
  const calCol = document.createElement('div')
  calCol.className = 'dt-cal-col'

  const calHeader = document.createElement('div')
  calHeader.className = 'dt-calendar-header'
  const btnPrev = document.createElement('button')
  btnPrev.type = 'button'
  btnPrev.className = 'dt-cal-btn'
  btnPrev.textContent = '‹'
  btnPrev.title = t('diaryTasks.prevMonth')
  const yearSel = document.createElement('select')
  yearSel.className = 'dt-cal-select'
  const monthSel = document.createElement('select')
  monthSel.className = 'dt-cal-select'
  for (let mo = 1; mo <= 12; mo++) {
    const o = document.createElement('option')
    o.value = String(mo)
    o.textContent = t('diaryTasks.month', { n: String(mo).padStart(2, '0') })
    monthSel.appendChild(o)
  }
  const btnNext = document.createElement('button')
  btnNext.type = 'button'
  btnNext.className = 'dt-cal-btn'
  btnNext.textContent = '›'
  btnNext.title = t('diaryTasks.nextMonth')
  const calSpacer = document.createElement('div')
  calSpacer.className = 'dt-cal-spacer'
  const btnToday = document.createElement('button')
  btnToday.type = 'button'
  btnToday.className = 'dt-cal-btn dt-cal-btn-text'
  btnToday.textContent = t('diaryTasks.today')
  const btnRefresh = document.createElement('button')
  btnRefresh.type = 'button'
  btnRefresh.className = 'dt-cal-btn dt-cal-btn-text'
  btnRefresh.textContent = t('diaryTasks.refresh')
  calHeader.appendChild(btnPrev)
  calHeader.appendChild(yearSel)
  calHeader.appendChild(monthSel)
  calHeader.appendChild(btnNext)
  calHeader.appendChild(calSpacer)
  calHeader.appendChild(btnToday)
  calHeader.appendChild(btnRefresh)

  const calendar = document.createElement('div')
  calendar.className = 'dt-calendar'
  const legend = document.createElement('div')
  legend.className = 'dt-cal-legend'

  calCol.appendChild(calHeader)
  calCol.appendChild(calendar)
  calCol.appendChild(legend)

  // ===== 右栏：详情 =====
  const contentCol = document.createElement('div')
  contentCol.className = 'dt-content-col'

  const tabs = document.createElement('div')
  tabs.className = 'dt-tabs'
  const tabTodo = document.createElement('button')
  tabTodo.type = 'button'
  tabTodo.className = 'dt-tab dt-tab-active'
  tabTodo.textContent = t('diaryTasks.tab.todo')
  const tabDiary = document.createElement('button')
  tabDiary.type = 'button'
  tabDiary.className = 'dt-tab'
  tabDiary.textContent = t('diaryTasks.tab.diary')
  tabs.appendChild(tabTodo)
  tabs.appendChild(tabDiary)

  // 新建入口：只有按钮，日期取日历选中日（弹窗里可改）
  const actions = document.createElement('div')
  actions.className = 'dt-actions'
  const btnAdd = document.createElement('button')
  btnAdd.type = 'button'
  btnAdd.className = 'dt-btn dt-btn-primary'
  btnAdd.textContent = t('diaryTasks.add')
  actions.appendChild(btnAdd)

  const toolbar = document.createElement('div')
  toolbar.className = 'dt-toolbar'
  const statusSelect = document.createElement('select')
  for (const v of ['all', 'open', 'done', 'overdue'] as const) {
    const o = document.createElement('option')
    o.value = v
    o.textContent = t(`diaryTasks.status.${v}`)
    statusSelect.appendChild(o)
  }
  const kwInput = document.createElement('input')
  kwInput.type = 'text'
  kwInput.placeholder = t('diaryTasks.search')
  const selectAllLabel = document.createElement('label')
  selectAllLabel.className = 'dt-select-all'
  const selectAllInput = document.createElement('input')
  selectAllInput.type = 'checkbox'
  const selectAllText = document.createElement('span')
  selectAllText.textContent = t('diaryTasks.selectAll')
  selectAllLabel.appendChild(selectAllInput)
  selectAllLabel.appendChild(selectAllText)
  toolbar.appendChild(statusSelect)
  toolbar.appendChild(kwInput)
  toolbar.appendChild(selectAllLabel)

  const scopeLabel = document.createElement('div')
  scopeLabel.className = 'dt-scope'

  const listWrap = document.createElement('div')
  listWrap.className = 'dt-list-wrap'
  const todoListEl = document.createElement('div')
  todoListEl.className = 'dt-todo-list'
  listWrap.appendChild(todoListEl)

  const noteList = document.createElement('div')
  noteList.className = 'dt-note-list'
  noteList.style.display = 'none'

  contentCol.appendChild(tabs)
  contentCol.appendChild(actions)
  contentCol.appendChild(toolbar)
  contentCol.appendChild(scopeLabel)
  contentCol.appendChild(listWrap)
  contentCol.appendChild(noteList)

  columns.appendChild(calCol)
  columns.appendChild(contentCol)
  body.appendChild(columns)

  // ===== 底部 =====
  const footer = document.createElement('div')
  footer.className = 'dt-panel-footer'
  const footerInfo = document.createElement('div')
  footerInfo.className = 'dt-footer-info'
  const btnMarkDone = document.createElement('button')
  btnMarkDone.type = 'button'
  btnMarkDone.className = 'dt-btn'
  btnMarkDone.textContent = t('diaryTasks.markDone')
  const btnMarkOpen = document.createElement('button')
  btnMarkOpen.type = 'button'
  btnMarkOpen.className = 'dt-btn'
  btnMarkOpen.textContent = t('diaryTasks.markOpen')
  const btnPushNow = document.createElement('button')
  btnPushNow.type = 'button'
  btnPushNow.className = 'dt-btn'
  btnPushNow.textContent = t('diaryTasks.pushXxtui')
  const btnCreateReminders = document.createElement('button')
  btnCreateReminders.type = 'button'
  btnCreateReminders.className = 'dt-btn'
  btnCreateReminders.textContent = t('diaryTasks.createReminders')
  footer.appendChild(footerInfo)
  footer.appendChild(btnMarkDone)
  footer.appendChild(btnMarkOpen)
  footer.appendChild(btnPushNow)
  footer.appendChild(btnCreateReminders)

  dialog.appendChild(header)
  dialog.appendChild(body)
  dialog.appendChild(footer)
  overlay.appendChild(dialog)
  document.body.appendChild(overlay)

  // ===== 状态 =====
  let allTasks: DiaryTask[] = []
  let allNotes: DiaryNote[] = []
  let byDate = new Map<string, { notes: number; tasks: number; done: number; open: number }>()
  let currentMonth = new Date()
  currentMonth.setDate(1)
  currentMonth.setHours(0, 0, 0, 0)
  let activeDate = ''
  let activeTab: Tab = 'todo'
  const selectedKeys = new Set<string>()
  const cellByDate = new Map<string, HTMLElement>()
  let kwTimer: ReturnType<typeof setTimeout> | null = null
  let todosByDate = new Map<string, DiaryTask[]>()
  let notesByDate = new Map<string, DiaryNote[]>()
  // 已扫到的文件路径：判断某天是否已经有待办 / 日记文件
  let scannedPaths = new Set<string>()
  // 当前库根（构建目标路径用）
  let currentRoot = ''

  const todayStr = formatYMD(Date.now())
  const taskKey = (task: DiaryTask) => `${task.path}:${task.line}`

  function close() {
    popLayer(layer)
    try { overlay.remove() } catch {}
    try { document.removeEventListener('keydown', onKey) } catch {}
  }
  function onKey(ev: KeyboardEvent) {
    // 编辑弹窗叠加在面板之上时，Esc 交给最上层处理（否则会两层一起关）
    if (ev.key !== 'Escape' || !isTopLayer(layer)) return
    close()
  }
  const layer = pushLayer()
  document.addEventListener('keydown', onKey)
  btnClose.onclick = () => close()
  overlay.addEventListener('click', (ev) => {
    // 同上：上层弹窗存在时不响应遮罩点击
    if (ev.target === overlay && isTopLayer(layer)) close()
  })

  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

  function inScope(dateStr: string): boolean {
    if (!dateStr) return false
    if (activeDate) return dateStr === activeDate
    return String(dateStr).startsWith(monthKey(currentMonth))
  }

  function updateScopeLabel() {
    if (activeDate) {
      scopeLabel.textContent = t('diaryTasks.scopeDate', { d: activeDate })
    } else {
      scopeLabel.textContent = t('diaryTasks.scopeMonthHint', { m: monthKey(currentMonth) })
    }
    try { syncAddButton() } catch {}
  }

  function buildYearOptions() {
    const years = new Set<number>()
    const yNow = new Date().getFullYear()
    for (let y = yNow - 6; y <= yNow + 2; y++) years.add(y)
    years.add(currentMonth.getFullYear())
    const collect = (arr: Array<{ date?: string }>) => {
      arr.forEach((it) => {
        const m = /^(\d{4})-/.exec(String(it.date || ''))
        if (m) years.add(Number(m[1]))
      })
    }
    collect(allTasks)
    collect(allNotes)
    yearSel.innerHTML = ''
    Array.from(years)
      .filter((n) => n > 1900 && n < 3000)
      .sort((a, b) => b - a)
      .forEach((y) => {
        const o = document.createElement('option')
        o.value = String(y)
        o.textContent = t('diaryTasks.year', { n: String(y) })
        yearSel.appendChild(o)
      })
  }

  function syncMonthSelectors() {
    const y = currentMonth.getFullYear()
    let hasYear = false
    for (const o of Array.from(yearSel.options)) {
      if (Number(o.value) === y) { hasYear = true; break }
    }
    if (!hasYear) buildYearOptions()
    yearSel.value = String(y)
    monthSel.value = String(currentMonth.getMonth() + 1)
  }

  function applySelection(dateStr: string, on: boolean) {
    const el = cellByDate.get(dateStr)
    if (el) el.classList.toggle('dt-calendar-day-selected', !!on)
  }

  function renderLegend() {
    if (activeTab === 'todo') {
      legend.innerHTML =
        `<span><i class="dt-legend-open"></i>${t('diaryTasks.legend.open')}</span>` +
        `<span><i class="dt-legend-done"></i>${t('diaryTasks.legend.done')}</span>` +
        `<span><i class="dt-legend-overdue"></i>${t('diaryTasks.legend.overdue')}</span>`
    } else {
      legend.innerHTML = `<span><i class="dt-legend-note"></i>${t('diaryTasks.legend.diary')}</span>`
    }
  }

  function renderCalendar() {
    const cells = buildCalendarGrid(currentMonth, byDate, activeDate)
    // 星期表头从周一开始，英文环境用单字母
    const weekdays =
      getLocale() === 'en'
        ? ['M', 'T', 'W', 'T', 'F', 'S', 'S']
        : ['一', '二', '三', '四', '五', '六', '日']
    calendar.innerHTML = ''
    cellByDate.clear()
    weekdays.forEach((lbl, idx) => {
      const wd = document.createElement('div')
      wd.className = 'dt-calendar-weekday'
      if (idx >= 5) wd.classList.add('dt-calendar-weekday-weekend')
      wd.textContent = lbl
      calendar.appendChild(wd)
    })

    cells.forEach((c: CalendarCell) => {
      const el = document.createElement('div')
      el.className = 'dt-calendar-day'
      if (c.empty) {
        el.classList.add('dt-calendar-day-empty')
        calendar.appendChild(el)
        return
      }

      const head = document.createElement('div')
      head.className = 'dt-day-head'
      const solar = document.createElement('div')
      solar.className = 'dt-cal-solar'
      solar.textContent = String(c.day)
      const lunar = document.createElement('div')
      lunar.className = 'dt-cal-lunar'
      lunar.textContent = c.lunar ? c.lunar.displayText : ''
      head.appendChild(solar)
      head.appendChild(lunar)
      el.appendChild(head)

      const items = document.createElement('div')
      items.className = 'dt-day-items'
      const makeMore = (extra: number, kind: DiaryTaskKind) => {
        const more = document.createElement('div')
        more.className = 'dt-day-more'
        more.textContent = t(kind === 'todo' ? 'diaryTasks.more.todo' : 'diaryTasks.more.diary', { n: extra })
        return more
      }
      if (activeTab === 'todo') {
        const list = todosByDate.get(c.dateStr) || []
        list.slice(0, MAX_CELL_ITEMS).forEach((task) => {
          const it = document.createElement('div')
          const overdue = !task.done && task.date && task.date < todayStr
          it.className =
            'dt-day-item ' +
            (task.done ? 'dt-day-item-done' : overdue ? 'dt-day-item-overdue' : 'dt-day-item-open')
          it.textContent = task.text || ''
          it.title = (task.done ? '✓ ' : '') + (task.text || '')
          items.appendChild(it)
        })
        if (list.length > MAX_CELL_ITEMS) items.appendChild(makeMore(list.length - MAX_CELL_ITEMS, 'todo'))
      } else {
        const list = notesByDate.get(c.dateStr) || []
        list.slice(0, MAX_CELL_ITEMS).forEach((n) => {
          const it = document.createElement('div')
          it.className = 'dt-day-item dt-day-item-diary'
          it.textContent = n.title || n.relative || ''
          it.title = n.title || n.relative || ''
          items.appendChild(it)
        })
        if (list.length > MAX_CELL_ITEMS) items.appendChild(makeMore(list.length - MAX_CELL_ITEMS, 'diary'))
      }
      el.appendChild(items)

      if (c.isToday) el.classList.add('dt-calendar-day-today')
      if (c.isSelected) el.classList.add('dt-calendar-day-selected')
      if (c.lunar) {
        if (c.lunar.isWeekend) el.classList.add('dt-calendar-day-weekend')
        if (c.lunar.displayType === 'festival') el.classList.add('dt-calendar-day-festival')
        if (c.lunar.displayType === 'term') el.classList.add('dt-calendar-day-term')
      }

      el.onclick = () => {
        const prev = activeDate
        if (prev === c.dateStr) {
          activeDate = ''
          applySelection(prev, false)
        } else {
          if (prev) applySelection(prev, false)
          activeDate = c.dateStr
          applySelection(activeDate, true)
        }
        updateScopeLabel()
        renderList()
      }
      cellByDate.set(c.dateStr, el)
      calendar.appendChild(el)
    })
  }

  function getFilteredTodos(): DiaryTask[] {
    const kw = String(kwInput.value || '').trim().toLowerCase()
    const status = statusSelect.value
    let list = allTasks.filter((task) => inScope(task.date))
    if (status === 'open') list = list.filter((task) => !task.done)
    else if (status === 'done') list = list.filter((task) => task.done)
    else if (status === 'overdue') list = list.filter((task) => !task.done && task.date && task.date < todayStr)
    if (kw) {
      list = list.filter((task) =>
        `${task.text} ${task.title} ${task.relative}`.toLowerCase().includes(kw),
      )
    }
    list.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      return String(a.date || '').localeCompare(String(b.date || ''))
    })
    return list
  }

  function syncSelectAll() {
    const list = getFilteredTodos()
    const total = list.length
    const sel = list.filter((task) => selectedKeys.has(taskKey(task))).length
    if (!total || !sel) {
      selectAllInput.checked = false
      selectAllInput.indeterminate = false
    } else if (sel === total) {
      selectAllInput.checked = true
      selectAllInput.indeterminate = false
    } else {
      selectAllInput.checked = false
      selectAllInput.indeterminate = true
    }
  }

  function renderTodos() {
    const list = getFilteredTodos()
    todoListEl.innerHTML = ''
    if (!list.length) {
      const empty = document.createElement('div')
      empty.className = 'dt-empty'
      empty.textContent = t('diaryTasks.empty.todo')
      todoListEl.appendChild(empty)
    } else {
      list.forEach((task) => {
        const overdue = !task.done && task.date && task.date < todayStr
        const row = document.createElement('div')
        row.className =
          'dt-todo-item ' +
          (task.done ? 'dt-todo-done' : overdue ? 'dt-todo-overdue' : 'dt-todo-open')

        const cb = document.createElement('input')
        cb.type = 'checkbox'
        cb.className = 'dt-todo-check'
        const key = taskKey(task)
        cb.checked = selectedKeys.has(key)
        cb.onclick = (ev) => {
          ev.stopPropagation()
          if (cb.checked) selectedKeys.add(key)
          else selectedKeys.delete(key)
          syncSelectAll()
        }

        const bodyEl = document.createElement('div')
        bodyEl.className = 'dt-todo-body'
        const textEl = document.createElement('div')
        textEl.className = 'dt-todo-text'
        if (task.done) textEl.classList.add('dt-todo-text-done')
        textEl.textContent = task.text || ''
        const meta = document.createElement('div')
        meta.className = 'dt-todo-meta'
        const badge = document.createElement('span')
        badge.className =
          'dt-badge ' + (task.done ? 'dt-badge-done' : overdue ? 'dt-badge-overdue' : 'dt-badge-open')
        badge.textContent = t(
          task.done ? 'diaryTasks.badge.done' : overdue ? 'diaryTasks.badge.overdue' : 'diaryTasks.badge.open',
        )
        meta.appendChild(badge)
        if (task.date) {
          const dateEl = document.createElement('span')
          dateEl.className = 'dt-todo-date'
          dateEl.textContent = task.date
          meta.appendChild(dateEl)
        }
        if (task.title) {
          const link = document.createElement('span')
          link.className = 'dt-title-link'
          link.textContent = task.title
          link.title = task.relative || ''
          link.onclick = (ev) => {
            ev.stopPropagation()
            try {
              void deps.openFileByPath(task.path)
              close()
            } catch {}
          }
          meta.appendChild(link)
        }
        bodyEl.appendChild(textEl)
        bodyEl.appendChild(meta)

        row.appendChild(cb)
        row.appendChild(bodyEl)
        todoListEl.appendChild(row)
      })
    }
    syncSelectAll()
    footerInfo.textContent = t('diaryTasks.count.todo', { n: list.length })
  }

  function getFilteredNotes(): DiaryNote[] {
    const kw = String(kwInput.value || '').trim().toLowerCase()
    let list = allNotes.filter((n) => inScope(n.date))
    if (kw) list = list.filter((n) => `${n.title} ${n.relative}`.toLowerCase().includes(kw))
    list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    return list
  }

  function renderNotes() {
    noteList.innerHTML = ''
    const list = getFilteredNotes()
    if (!list.length) {
      const empty = document.createElement('div')
      empty.className = 'dt-empty'
      empty.textContent = t('diaryTasks.empty.diary')
      noteList.appendChild(empty)
    } else {
      list.forEach((n) => {
        const item = document.createElement('div')
        item.className = 'dt-note-item'
        const d = document.createElement('div')
        d.className = 'dt-note-date'
        d.textContent = n.date || ''
        const tt = document.createElement('div')
        tt.className = 'dt-note-title'
        tt.textContent = n.title || n.relative || ''
        item.appendChild(d)
        item.appendChild(tt)
        item.onclick = () => {
          try {
            void deps.openFileByPath(n.path)
            close()
          } catch {}
        }
        noteList.appendChild(item)
      })
    }
    footerInfo.textContent = t('diaryTasks.count.diary', { n: list.length })
  }

  function renderList() {
    if (activeTab === 'todo') renderTodos()
    else renderNotes()
  }

  function setTab(tab: Tab) {
    activeTab = tab === 'diary' ? 'diary' : 'todo'
    const isTodo = activeTab === 'todo'
    tabTodo.classList.toggle('dt-tab-active', isTodo)
    tabDiary.classList.toggle('dt-tab-active', !isTodo)
    statusSelect.style.display = isTodo ? '' : 'none'
    selectAllLabel.style.display = isTodo ? 'inline-flex' : 'none'
    listWrap.style.display = isTodo ? '' : 'none'
    noteList.style.display = isTodo ? 'none' : ''
    btnMarkDone.style.display = isTodo ? '' : 'none'
    btnMarkOpen.style.display = isTodo ? '' : 'none'
    btnPushNow.style.display = isTodo ? '' : 'none'
    btnCreateReminders.style.display = isTodo ? '' : 'none'
    // 日历随 Tab 同步切换（待办 Tab 不显示日记，只日记 Tab 显示紫色日记标签）
    renderLegend()
    renderCalendar()
    renderList()
    syncAddButton()
  }
  tabTodo.onclick = () => setTab('todo')
  tabDiary.onclick = () => setTab('diary')

  function goMonth(delta: number) {
    currentMonth.setMonth(currentMonth.getMonth() + delta)
    activeDate = ''
    syncMonthSelectors()
    updateScopeLabel()
    renderCalendar()
    renderList()
  }
  btnPrev.onclick = () => goMonth(-1)
  btnNext.onclick = () => goMonth(1)
  yearSel.onchange = () => {
    currentMonth.setFullYear(Number(yearSel.value) || currentMonth.getFullYear())
    activeDate = ''
    updateScopeLabel()
    renderCalendar()
    renderList()
  }
  monthSel.onchange = () => {
    currentMonth.setMonth((Number(monthSel.value) || 1) - 1)
    activeDate = ''
    updateScopeLabel()
    renderCalendar()
    renderList()
  }
  btnToday.onclick = () => {
    const now = new Date()
    currentMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    currentMonth.setHours(0, 0, 0, 0)
    activeDate = formatYMD(now.getTime())
    syncMonthSelectors()
    updateScopeLabel()
    renderCalendar()
    renderList()
  }

  statusSelect.onchange = () => renderList()
  kwInput.oninput = () => {
    if (kwTimer) clearTimeout(kwTimer)
    kwTimer = setTimeout(() => renderList(), 160)
  }
  selectAllInput.onchange = () => {
    const list = getFilteredTodos()
    if (selectAllInput.checked) list.forEach((task) => selectedKeys.add(taskKey(task)))
    else list.forEach((task) => selectedKeys.delete(taskKey(task)))
    renderTodos()
  }

  async function reloadTasks() {
    footerInfo.textContent = t('diaryTasks.scanning')
    try {
      let libRoot: string | null = null
      try { libRoot = await deps.getLibraryRoot() } catch { libRoot = null }
      currentRoot = libRoot || ''
      const res = await scanLibrary(libRoot)
      allTasks = res.tasks
      allNotes = res.notes
      byDate = res.byDate
      scannedPaths = new Set(res.paths)

      todosByDate = new Map()
      for (const task of allTasks) {
        if (!task.date) continue
        if (!todosByDate.has(task.date)) todosByDate.set(task.date, [])
        todosByDate.get(task.date)!.push(task)
      }
      for (const arr of todosByDate.values()) {
        arr.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))
      }
      notesByDate = new Map()
      for (const n of allNotes) {
        if (!n.date) continue
        if (!notesByDate.has(n.date)) notesByDate.set(n.date, [])
        notesByDate.get(n.date)!.push(n)
      }

      buildYearOptions()
      syncMonthSelectors()
      updateScopeLabel()
      renderCalendar()
      renderList()
      syncAddButton()
    } catch (e) {
      try { console.error('[diaryTasks] 扫描失败', e) } catch {}
      footerInfo.textContent = t('diaryTasks.scanFailed')
    }
  }
  btnRefresh.onclick = () => { void reloadTasks() }

  // 按钮文案：当天已有文件时显示「继续写」，让用户知道是编辑而不是新建
  function syncAddButton() {
    const kind: DiaryTaskKind = activeTab === 'todo' ? 'todo' : 'diary'
    const date = activeDate || todayStr
    let exists = false
    try { exists = scannedPaths.has(buildTaskFilePath(currentRoot, kind, date)) } catch {}
    const key =
      kind === 'todo'
        ? (exists ? 'diaryTasks.continueTodo' : 'diaryTasks.add')
        : (exists ? 'diaryTasks.continueDiary' : 'diaryTasks.addDiary')
    btnAdd.textContent = t(key)
  }

  // 写待办 / 写日记：弹 md 编辑窗（带模板，日期＝日历选中日），保存后跳到该日期并刷新。
  // 当天已有文件 → 按钮标记为「已写」，点击就是继续编辑同一份文件，不会另建新文档。
  btnAdd.onclick = async () => {
    const kind: DiaryTaskKind = activeTab === 'todo' ? 'todo' : 'diary'
    let root: string | null = null
    try { root = await deps.getLibraryRoot() } catch { root = null }
    if (!root) {
      deps.notice(t('diaryTasks.needLibrary'), 'err', 2600)
      return
    }
    const date = activeDate || todayStr
    const res = await openNoteEditorDialog(
      { kind, date, root },
      { notice: deps.notice, confirm: deps.confirm },
    )
    if (!res) return
    const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(res.date)
    if (p) {
      // 同时更新选中的日期，让用户看到刚写进哪一天（不重算 currentMonth，
      // 避免视图从当前月份跳走）
      const prev = activeDate
      if (prev && prev !== res.date) applySelection(prev, false)
      activeDate = res.date
      applySelection(activeDate, true)
      currentMonth = new Date(Number(p[1]), Number(p[2]) - 1, 1)
      currentMonth.setHours(0, 0, 0, 0)
      syncMonthSelectors()
    }
    await reloadTasks()
  }

  // 标记完成 / 未完成：按行号改写 checkbox
  async function markTodos(doneFlag: boolean) {
    const target = getFilteredTodos().filter((task) => selectedKeys.has(taskKey(task)))
    if (!target.length) {
      deps.notice(t('diaryTasks.needSelect'), 'err', 2200)
      return
    }
    const byPath = new Map<string, DiaryTask[]>()
    target.forEach((task) => {
      if (!task.path) return
      if (!byPath.has(task.path)) byPath.set(task.path, [])
      byPath.get(task.path)!.push(task)
    })

    let success = 0
    let failed = 0
    for (const [path, list] of byPath.entries()) {
      try {
        const text = await readTextFileAnySafe(path)
        const lines = String(text || '').split(/\r?\n/)
        list.forEach((task) => {
          const ln = task.line - 1
          if (ln < 0 || ln >= lines.length) {
            failed++
            return
          }
          const m = lines[ln].match(/^(\s*[-*]\s+)\[(\s|x|X)\](\s+.*)$/)
          if (!m) {
            failed++
            return
          }
          lines[ln] = `${m[1]}[${doneFlag ? 'x' : ' '}]${m[3]}`
          success++
        })
        // 保留原 mtime：没有显式日期的待办靠 mtime 定位日期，
        // 写入刷新时间会让条目从原日期跳到今天
        const keepMtime = await mtimeMsOf(path)
        await writeTaskFile(path, lines.join('\n'), { keepMtimeMs: keepMtime })
      } catch (e) {
        failed += list.length
        try { console.error('[diaryTasks] 标记待办失败', e) } catch {}
      }
    }

    selectedKeys.clear()
    await reloadTasks()
    if (success) {
      deps.notice(
        t(doneFlag ? 'diaryTasks.markedDone' : 'diaryTasks.markedOpen', { n: success }),
        failed ? 'err' : 'ok',
        2600,
      )
    } else {
      deps.notice(t('diaryTasks.markFailed'), 'err', 3200)
    }
  }
  btnMarkDone.onclick = () => { void markTodos(true) }
  btnMarkOpen.onclick = () => { void markTodos(false) }

  btnPushNow.onclick = async () => {
    const api = deps.getXxtuiApi()
    if (!api) {
      deps.notice(t('diaryTasks.err.xxtui'), 'err', 3200)
      return
    }
    const todos = getFilteredTodos().filter((task) => selectedKeys.has(taskKey(task)))
    if (!todos.length) {
      deps.notice(t('diaryTasks.err.pushNone'), 'err', 2200)
      return
    }
    const title = t('diaryTasks.title') + ` · ${todos.length}`
    const content = todos
      .map((task, idx) => `${idx + 1}. ${task.done ? '[x]' : '[ ]'} ${task.text}${task.date ? ` · ${task.date}` : ''}`)
      .join('\n')
    try {
      const ok = await api.pushToXxtui(title, content)
      if (ok) deps.notice(t('diaryTasks.pushOk', { n: todos.length }), 'ok', 2600)
      else deps.notice(t('diaryTasks.err.pushFail'), 'err', 2600)
    } catch (e) {
      try { console.error('[diaryTasks] 推送 xxtui 失败', e) } catch {}
      deps.notice(t('diaryTasks.err.pushFail'), 'err', 2600)
    }
  }

  btnCreateReminders.onclick = async () => {
    const api = deps.getXxtuiApi()
    if (!api) {
      deps.notice(t('diaryTasks.err.xxtui'), 'err', 3200)
      return
    }
    const todos = getFilteredTodos().filter((task) => !task.done && selectedKeys.has(taskKey(task)))
    if (!todos.length) {
      deps.notice(t('diaryTasks.err.pushNone'), 'err', 2600)
      return
    }
    const md = todos.map((task) => `- [ ] ${task.text}`).join('\n')
    try {
      const res = await api.parseAndCreateReminders(md)
      const succ = typeof res?.success === 'number' ? res.success : 0
      deps.notice(t('diaryTasks.remindOk', { n: succ }), succ ? 'ok' : 'err', 3200)
    } catch (e) {
      try { console.error('[diaryTasks] 创建提醒失败', e) } catch {}
      deps.notice(t('diaryTasks.err.remindFail'), 'err', 2600)
    }
  }

  // 初始渲染
  buildYearOptions()
  syncMonthSelectors()
  updateScopeLabel()
  renderCalendar()
  setTab('todo')
  void reloadTasks()
}