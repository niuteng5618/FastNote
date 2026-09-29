// 文档库排序偏好（纯 Store 读写，不依赖 UI）

import type { Store } from '@tauri-apps/plugin-store'

export type LibSortMode = 'name_asc' | 'name_desc' | 'mtime_asc' | 'mtime_desc'

// 从 Store 中读取库排序偏好，非法值回退到 name_asc（默认按名称升序，位置稳定不随编辑跳动）
export async function getLibrarySort(store: Store | null): Promise<LibSortMode> {
  try {
    if (!store) return 'name_asc'
    const val = await store.get('librarySort')
    const s = typeof val === 'string' ? val : ''
    const allowed: LibSortMode[] = [
      'name_asc',
      'name_desc',
      'mtime_asc',
      'mtime_desc',
    ]
    return allowed.includes(s as any) ? (s as LibSortMode) : 'name_asc'
  } catch {
    return 'name_asc'
  }
}

// 将库排序偏好写入 Store
export async function setLibrarySort(
  store: Store | null,
  mode: LibSortMode,
): Promise<void> {
  try {
    if (!store) return
    await store.set('librarySort', mode)
    await store.save()
  } catch {}
}

