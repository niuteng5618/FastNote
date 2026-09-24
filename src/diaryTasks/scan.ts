// 扫描当前库，产出待办 / 日记 / 每日统计
// 数据模型（不引入新存储）：
//   待办 = 全库 .md 里的 - [ ] / - [x]（与 xxtui-todo-push 同规则）
//   待办日期回退链：行内 @YYYY-MM-DD → front matter date/created → 文件名 YYYY-MM-DD → 文件 mtime
//   日记 = 非「-待办」文件，且（front matter 有 date/created 或文件名以 YYYY-MM-DD 开头）
// 待办日期与日记日期分开计算：共用一个日期会让 -待办.md 的 mtime 污染日历和日记 Tab

import { readDir, stat } from '@tauri-apps/plugin-fs'
import { readTextFileAnySafe } from '../core/fsSafe'
import { formatYMD, type DayStat } from './lunar'

export type DiaryTask = {
  path: string
  relative: string
  title: string
  text: string
  done: boolean
  date: string
  line: number
}

export type DiaryNote = {
  path: string
  relative: string
  title: string
  date: string
}

export type ScanResult = {
  tasks: DiaryTask[]
  notes: DiaryNote[]
  byDate: Map<string, DayStat>
  // 扫到的全部文件绝对路径，供调用方判断某个文件是否存在
  paths: string[]
}

const MAX_FILES = 1200
const MAX_DEPTH = 64
// 与主库扫描保持一致的目录黑名单
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'target', 'dist', 'build',
  '.next', '.vite', 'code cache', 'gpucache', 'service worker', 'ebwebview',
])

type Meta = { title: string; date: string; created: string }

export function splitFrontMatter(src: string): { frontMatter: string | null; body: string } {
  const original = String(src || '')
  if (!original.trim()) return { frontMatter: null, body: '' }
  let text = original
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const lines = text.split(/\r?\n/)
  if (!lines.length || lines[0].trim() !== '---') return { frontMatter: null, body: original }
  let endIndex = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i
      break
    }
  }
  if (endIndex === -1) return { frontMatter: null, body: original }
  return {
    frontMatter: lines.slice(0, endIndex + 1).join('\n'),
    body: lines.slice(endIndex + 1).join('\n'),
  }
}

function stripYamlQuotes(v: string): string {
  let s = String(v || '').trim()
  if (!s) return ''
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1)
  }
  return s.trim()
}

function matchScalar(line: string, key: string): string {
  const m = line.match(new RegExp('^' + key + '\\s*:\\s*(.+)$', 'i'))
  return m ? stripYamlQuotes(m[1]) : ''
}

export function parseMeta(front: string | null): Meta {
  const meta: Meta = { title: '', date: '', created: '' }
  if (!front) return meta
  let inHeader = false
  for (const raw of String(front).split(/\r?\n/)) {
    const line = String(raw || '').trim()
    if (!line) continue
    if (line === '---') {
      if (!inHeader) {
        inHeader = true
        continue
      }
      break
    }
    if (!inHeader || line.startsWith('#')) continue
    const t = matchScalar(line, 'title')
    if (t && !meta.title) {
      meta.title = t
      continue
    }
    const d = matchScalar(line, 'date')
    if (d && !meta.date) {
      meta.date = d
      continue
    }
    const c = matchScalar(line, 'created')
    if (c && !meta.created) meta.created = c
  }
  return meta
}

// 从待办文本中抽取 @YYYY-MM-DD（可带时间），只返回日期部分
export function extractTodoDateFromText(text: string): string {
  const raw = String(text || '').trim()
  const atIdx = raw.lastIndexOf('@')
  if (atIdx < 0) return ''
  let expr = String(raw.slice(atIdx + 1)).trim()
  if (!expr) return ''
  // 去掉后续标记，例如 [pushed] / [reminded]
  const flagIdx = expr.indexOf('[')
  if (flagIdx >= 0) expr = expr.slice(0, flagIdx).trim()
  const m = expr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+\d{1,2}(?::\d{1,2})?)?$/)
  if (!m) return ''
  const y = parseInt(m[1], 10) || 0
  const mo = parseInt(m[2], 10) || 0
  const d = parseInt(m[3], 10) || 0
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return ''
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function metaDate(meta: Meta): string {
  if (meta.date && /^\d{4}-\d{2}-\d{2}/.test(meta.date)) return meta.date.slice(0, 10)
  if (meta.created && /^\d{4}-\d{2}-\d{2}/.test(meta.created)) return meta.created.slice(0, 10)
  return ''
}

export function isTodoFileName(name: string): boolean {
  return /-待办\.md$/i.test(String(name || ''))
}

// 日记文件名：2026-09-24-日记.md（日期在文件名里，所以不需要 front matter）
export function isDiaryFileName(name: string): boolean {
  return /-日记\.md$/i.test(String(name || ''))
}

// 文件名里的 YYYY-MM-DD
export function fileNameDate(name: string): string {
  return /^(\d{4}-\d{2}-\d{2})/.exec(String(name || ''))?.[1] || ''
}

type RawFile = { path: string; relative: string; name: string }

// 递归列出库内 markdown 文件（自带黑名单与深度上限，避免大库卡顿）
async function listMarkdownFiles(root: string): Promise<RawFile[]> {
  const sep = String(root).includes('\\') ? '\\' : '/'
  const base = String(root).replace(/[\\/]+$/, '')
  const out: RawFile[] = []

  const walk = async (dir: string, relPrefix: string, depth: number) => {
    if (depth < 0 || out.length >= MAX_FILES) return
    let entries: any[] = []
    try {
      entries = (await readDir(dir, { recursive: false } as any)) || []
    } catch {
      return
    }
    for (const it of entries as any[]) {
      if (out.length >= MAX_FILES) return
      const name = String(it?.name || '').trim()
      if (!name) continue
      const full = `${dir}${sep}${name}`
      const rel = relPrefix ? `${relPrefix}/${name}` : name
      const isDir =
        typeof it?.isDirectory === 'boolean' ? it.isDirectory : false
      if (isDir) {
        if (SKIP_DIRS.has(name.toLowerCase())) continue
        await walk(full, rel, depth - 1)
        continue
      }
      if (!/\.(md|markdown)$/i.test(name)) continue
      out.push({ path: full, relative: rel, name })
    }
  }

  await walk(base, '', MAX_DEPTH)
  return out
}

// 仅在需要 mtime 兜底时才 stat（新路径规则下多数文件靠文件名即可定位）
async function mtimeOf(path: string): Promise<number | null> {
  try {
    const info: any = await stat(path as any)
    const m = info?.mtime
    if (m instanceof Date) return m.getTime()
    if (typeof m === 'number') return m
    if (typeof m === 'string') {
      const t = Date.parse(m)
      return Number.isFinite(t) ? t : null
    }
  } catch {}
  return null
}

export async function scanLibrary(root: string | null): Promise<ScanResult> {
  const tasks: DiaryTask[] = []
  const notes: DiaryNote[] = []
  const byDate = new Map<string, DayStat>()
  if (!root) return { tasks, notes, byDate, paths: [] }

  const files = await listMarkdownFiles(root)
  const paths = files.map((f) => f.path)
  if (!files.length) return { tasks, notes, byDate, paths }

  const ensureStat = (d: string): DayStat => {
    let s = byDate.get(d)
    if (!s) {
      s = { notes: 0, tasks: 0, done: 0, open: 0 }
      byDate.set(d, s)
    }
    return s
  }
  const noteSeen = new Map<string, Set<string>>()
  // 文件名没写标题时，用正文里第一个标题兜底（模板简化后常常没有 front matter）
  const firstHeading = (bodyText: string): string => {
    const m = /^\s{0,3}#{1,6}\s+(.+?)\s*$/m.exec(String(bodyText || ''))
    return m ? m[1].trim() : ''
  }

  for (const f of files) {
    let text = ''
    try {
      text = await readTextFileAnySafe(f.path)
    } catch {
      continue
    }
    const { frontMatter, body } = splitFrontMatter(text)
    const meta = parseMeta(frontMatter)
    const bodyRaw = body !== undefined ? body : text
    const title =
      meta.title ||
      firstHeading(bodyRaw) ||
      f.name.replace(/\.(md|markdown)$/i, '')
    const explicitDate = metaDate(meta)
    // 文件名里的 YYYY-MM-DD（本功能写出的文件都带，优先使用）
    const nameDate = fileNameDate(f.name)
    const todoFile = isTodoFileName(f.name)
    const diaryFile = isDiaryFileName(f.name)

    // 待办日期回退链：显式日期 → 文件名日期 → mtime
    let todoDate = explicitDate || nameDate
    if (!todoDate) {
      const mt = await mtimeOf(f.path)
      todoDate = mt ? formatYMD(mt) : ''
    }

    // 日记：优先认 -日记.md 文件名日期（模板不必再写 front matter）；
    // 其余笔记仍兼容 front matter 的 date / created。待办文件永不进日记。
    const diaryDate = todoFile ? '' : (diaryFile ? (nameDate || explicitDate) : explicitDate)
    if (diaryDate) {
      let set = noteSeen.get(diaryDate)
      if (!set) {
        set = new Set()
        noteSeen.set(diaryDate, set)
      }
      if (!set.has(f.relative)) {
        set.add(f.relative)
        ensureStat(diaryDate).notes++
        notes.push({ path: f.path, relative: f.relative, title, date: diaryDate })
      }
    }

    const bodyText = body !== undefined ? body : text
    // 行号必须是「整个文件」里的行号：标记完成时按行号直接改原文件，
    // 若用正文内相对行号，带 front matter 的文件会整体错位
    const lineOffset = frontMatter ? frontMatter.split(/\r?\n/).length : 0
    const lines = String(bodyText || '').split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*[-*]\s+\[(\s|x|X)\]\s+(.+)$/)
      if (!m) continue
      const txt = String(m[2] || '').trim()
      if (!txt) continue
      const done = String(m[1] || '').toLowerCase() === 'x'
      const date = extractTodoDateFromText(txt) || todoDate
      tasks.push({
        path: f.path,
        relative: f.relative,
        title,
        text: txt,
        done,
        date,
        line: lineOffset + i + 1,
      })
      if (date) {
        const stat = ensureStat(date)
        stat.tasks++
        if (done) stat.done++
        else stat.open++
      }
    }
  }

  return { tasks, notes, byDate, paths }
}
