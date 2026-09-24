// 日记与待办的存储规则：
//   待办 → <库根>/日记与待办/<年-月>/<年-月-日>-待办.md
//   日记 → <库根>/日记与待办/<年-月>/<年-月-日>-日记.md
// 独立顶层目录，避免这些自动生成的文件混进用户的笔记目录树
// 文件名带完整日期并标注类型，便于在文件树里直接辨认

import { invoke } from '@tauri-apps/api/core'
import { stat } from '@tauri-apps/plugin-fs'
import { ensureDir, writeTextFileAnySafe } from '../core/fsSafe'
import type { DiaryTaskKind } from './templates'

// 承载日记与待办的顶层目录名（放在库根下）
export const DIARY_TASKS_DIR = '日记与待办'

export function sepOf(p: string): string {
  return String(p || '').includes('\\') ? '\\' : '/'
}

// 年月目录名：2026-09
export function monthDirName(date: string): string {
  return String(date || '').slice(0, 7)
}

// 文件名：2026-09-24-待办.md
export function fileNameOf(kind: DiaryTaskKind, date: string): string {
  return `${date}-${kind === 'todo' ? '待办' : '日记'}.md`
}

export function buildTaskFilePath(
  root: string,
  kind: DiaryTaskKind,
  date: string,
): string {
  const sep = sepOf(root)
  const base = String(root || '').replace(/[\\/]+$/, '')
  return [base, DIARY_TASKS_DIR, monthDirName(date), fileNameOf(kind, date)].join(sep)
}

// 写入目标文件（自动建目录，fs 失败回退后端命令）
// keepMtimeMs：保留文件原有修改时间。待办/日记在没有显式日期时会用 mtime 定位日期，
// 若改写正文时刷新了 mtime，条目就会从原日期跳到今天，因此标记完成必须传原 mtime。
export async function writeTaskFile(
  path: string,
  content: string,
  opts?: { keepMtimeMs?: number | null },
): Promise<void> {
  const sep = sepOf(path)
  const dir = path.slice(0, path.lastIndexOf(sep))
  if (dir) await ensureDir(dir)

  const keep = opts?.keepMtimeMs
  if (typeof keep === 'number' && Number.isFinite(keep) && keep > 0) {
    try {
      await invoke('write_text_file_any_keep_mtime', {
        path,
        content,
        mtimeMs: keep,
      })
      return
    } catch {
      // 后端命令不可用（老版本 / 非 Tauri 环境）时退化为普通写入
    }
  }
  await writeTextFileAnySafe(path, content)
}

// 读取文件修改时间（毫秒）；取不到返回 null
export async function mtimeMsOf(path: string): Promise<number | null> {
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
