// 待办 / 日记 模板：默认值、持久化、变量展开
// 模板存在 flymd-settings.json（key: diaryTasks.templates），与其它设置一致，随配置备份走
// 变量：{{date}} {{year}} {{month}} {{day}} {{datetime}} {{weekday}} {{lunar}} {{title}}
// 注意：日期也会写进文件名，模板里通常不需要再写 date 字段

import { getLocale } from '../i18n'
import { getSharedStore } from '../utils/sharedStore'
import { getLunarInfo } from './lunar'

export type DiaryTaskKind = 'todo' | 'diary'

export type DiaryTaskTemplates = {
  todo: string
  diary: string
}

const STORE_KEY = 'diaryTasks.templates'

const DEFAULT_TODO_ZH = [
  '## 待办',
  '',
  '- [ ] ',
  '',
].join('\n')

const DEFAULT_TODO_EN = [
  '## Todos',
  '',
  '- [ ] ',
  '',
].join('\n')

// 日记模板保持极简：日期由文件名（<年-月-日>-日记.md）承载，无需 front matter，
// 用户打开就是「今天做了什么」+「其他」，不让前置信息挡住正文。
const DEFAULT_DIARY_ZH = [
  '## 今天做了什么',
  '',
  '- ',
  '',
  '## 其他',
  '',
  '',
].join('\n')

const DEFAULT_DIARY_EN = [
  '## What I did today',
  '',
  '- ',
  '',
  '## Notes',
  '',
  '',
].join('\n')

export function getDefaultTemplates(): DiaryTaskTemplates {
  const zh = getLocale() !== 'en'
  return {
    todo: zh ? DEFAULT_TODO_ZH : DEFAULT_TODO_EN,
    diary: zh ? DEFAULT_DIARY_ZH : DEFAULT_DIARY_EN,
  }
}

function normalizeTemplates(raw: any): DiaryTaskTemplates {
  const def = getDefaultTemplates()
  const obj = raw && typeof raw === 'object' ? raw : {}
  const pick = (v: any, fallback: string) =>
    typeof v === 'string' && v.trim() ? v : fallback
  return {
    todo: pick(obj.todo, def.todo),
    diary: pick(obj.diary, def.diary),
  }
}

export async function loadTemplates(): Promise<DiaryTaskTemplates> {
  try {
    const store = await getSharedStore()
    const raw = await store.get(STORE_KEY)
    return normalizeTemplates(raw)
  } catch {
    return getDefaultTemplates()
  }
}

export async function saveTemplates(next: DiaryTaskTemplates): Promise<void> {
  const store = await getSharedStore()
  await store.set(STORE_KEY, {
    todo: String(next.todo ?? ''),
    diary: String(next.diary ?? ''),
  })
  await store.save()
}

// 清空某项即回落默认值（设置面板里的「恢复默认」）
export async function resetTemplate(kind: DiaryTaskKind): Promise<DiaryTaskTemplates> {
  const cur = await loadTemplates()
  const def = getDefaultTemplates()
  const next = { ...cur, [kind]: def[kind] }
  await saveTemplates(next)
  return next
}

const WEEKDAYS_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// 用给定日期展开模板变量；date 为 YYYY-MM-DD
export function renderTemplate(
  tpl: string,
  kind: DiaryTaskKind,
  date: string,
): string {
  const [ys, ms, ds] = String(date || '').split('-')
  const y = Number(ys) || new Date().getFullYear()
  const mo = Number(ms) || 1
  const d = Number(ds) || 1
  const dt = new Date(y, mo - 1, d)
  const pad = (n: number) => String(n).padStart(2, '0')

  const lunar = getLunarInfo(y, mo, d)
  const isZh = getLocale() !== 'en'
  const weekday = dt.getDay()
  const title = isZh
    ? `${date} ${kind === 'todo' ? '待办' : '日记'}`
    : `${kind === 'todo' ? 'Todos' : 'Journal'} ${date}`

  const vars: Record<string, string> = {
    date,
    year: String(y),
    month: pad(mo),
    day: pad(d),
    datetime: `${date} ${pad(new Date().getHours())}:${pad(new Date().getMinutes())}:${pad(new Date().getSeconds())}`,
    weekday: isZh ? WEEKDAYS_ZH[weekday] : WEEKDAYS_EN[weekday],
    lunar: isZh ? `农历${lunar.month}${lunar.day}` : lunar.day,
    title,
  }

  return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (raw, key: string) => {
    const v = vars[key.toLowerCase()]
    return v === undefined ? raw : v
  })
}
