import {
  mkdir,
  readDir,
  readFile,
  writeFile,
  readTextFile,
  writeTextFile,
  BaseDirectory,
} from '@tauri-apps/plugin-fs'
import type { Store } from '@tauri-apps/plugin-store'
import type { InstallableItem } from './market'
import { PLUGINS_DIR } from '../core/configBackup'

// 插件运行时基础：类型 + 目录保证 + 仓库输入解析 + 版本比较 + HTTP 工具 + 更新检测
// 尽量保持无副作用，方便 main.ts 以及其他扩展模块复用

// 插件相关类型
export type PluginManifest = {
  id: string
  name?: string
  version?: string
  author?: string
  description?: string
  main?: string
  minHostVersion?: string
  assets?: string[]
}

export type InstalledPlugin = {
  id: string
  name?: string
  version?: string
  author?: string
  enabled?: boolean
  showInMenuBar?: boolean
  dir: string
  main: string
  builtin?: boolean
  description?: string
  manifestUrl?: string
}

export type InstallPluginOptions = {
  enabled?: boolean
  showInMenuBar?: boolean
}

export type PluginUpdateState = {
  manifestUrl: string
  remoteVersion: string
}

// 确保插件根目录存在
export async function ensurePluginsDir(): Promise<void> {
  try {
    await mkdir(PLUGINS_DIR as any, {
      baseDir: BaseDirectory.AppLocalData,
      recursive: true,
    } as any)
  } catch {
    // 目录创建失败时静默忽略，由后续文件操作自行报错
  }
}

// ===== 已安装插件状态管理（仅处理数据结构与持久化，不关心 UI） =====

// 已退役扩展：功能已内置进应用，不再出现在扩展列表、也不会被激活。
// 库里残留的旧安装记录在读取时被过滤掉，下次写入即自然清除。
const RETIRED_PLUGIN_IDS = new Set(['note-templates'])

// 从 Store 中读取已安装插件映射
export async function loadInstalledPlugins(
  store: Store | null,
): Promise<Record<string, InstalledPlugin>> {
  try {
    if (!store) return {}
    const p = await store.get('plugins')
    const obj = p && typeof p === 'object' ? (p as any) : {}
    const map =
      obj?.installed && typeof obj.installed === 'object'
        ? obj.installed
        : {}
    const out: Record<string, InstalledPlugin> = {}
    for (const [id, rec] of Object.entries(map as Record<string, InstalledPlugin>)) {
      if (RETIRED_PLUGIN_IDS.has(id)) continue
      out[id] = rec
    }
    return out
  } catch {
    return {}
  }
}

// 将已安装插件映射写回 Store
export async function saveInstalledPlugins(
  store: Store | null,
  map: Record<string, InstalledPlugin>,
): Promise<void> {
  try {
    if (!store) return
    const old = ((await store.get('plugins')) as any) || {}
    old.installed = map
    await store.set('plugins', old)
    await store.save()
  } catch {
    // 持久化失败时静默忽略，由上层决定是否提示
  }
}

// 支持两种输入：
// 1) 直接 HTTP(S) URL（自动补全 manifest.json）
// 2) GitHub 简写：user/repo[@branch]
export function parseRepoInput(inputRaw: string): {
  type: 'github' | 'http'
  manifestUrl: string
  mainUrl?: string
} | null {
  const input = (inputRaw || '').trim()
  if (!input) return null

  // 直接 HTTP(S) URL
  if (/^https?:\/\//i.test(input)) {
    let u = input
    if (!/manifest\.json$/i.test(u)) {
      if (!u.endsWith('/')) u += '/'
      u += 'manifest.json'
    }
    return { type: 'http', manifestUrl: u }
  }

  // GitHub 仓库简写：user/repo[@branch]
  const m = input.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:@([A-Za-z0-9_.\/-]+))?$/)
  if (m) {
    const user = m[1]
    const repo = m[2]
    const branch = m[3] || 'main'
    const base = `https://raw.githubusercontent.com/${user}/${repo}/${branch}/`
    return { type: 'github', manifestUrl: base + 'manifest.json' }
  }
  return null
}

// 安装版本比较：只认数字和点，不做乱七八糟的 semver 扩展
export function compareVersions(a?: string, b?: string): number {
  if (!a || !b) return 0
  const as = String(a).split('.')
  const bs = String(b).split('.')
  const len = Math.max(as.length, bs.length)

  for (let i = 0; i < len; i++) {
    const av = parseInt(as[i] || '0', 10)
    const bv = parseInt(bs[i] || '0', 10)

    if (!Number.isFinite(av) || !Number.isFinite(bv)) {
      const sa = as[i] || ''
      const sb = bs[i] || ''
      if (sa === sb) continue
      return sa > sb ? 1 : -1
    }

    if (av === bv) continue
    return av > bv ? 1 : -1
  }
  return 0
}

// HTTP 客户端封装：统一走 tauri http 插件，可选回退到 fetch 由上层处理
export async function getHttpClient(): Promise<{
  fetch?: any
  Body?: any
  ResponseType?: any
  available?: () => Promise<boolean>
} | null> {
  try {
    const mod: any = await import('@tauri-apps/plugin-http')
    const http = {
      fetch: mod?.fetch,
      Body: mod?.Body,
      ResponseType: mod?.ResponseType,
      // 标记可用：存在 fetch 即视为可用，避免因网络失败误报不可用
      available: async () => true,
    }
    if (typeof http.fetch === 'function') return http
    return null
  } catch {
    return null
  }
}

const HTTP_TEXT_TIMEOUT_MS = 8000
const HTTP_BINARY_TIMEOUT_MS = 30000

async function httpFetchWithTimeout(fetcher: any, url: string, init: any, timeoutMs: number): Promise<any> {
  let timer: number | undefined
  const timeout = new Promise((_resolve, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error('http timeout'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([fetcher(url, init), timeout])
  } finally {
    if (timer != null) window.clearTimeout(timer)
  }
}

// 文本抓取：优先 tauri http，失败回退到浏览器 fetch
export async function fetchTextSmart(url: string): Promise<string> {
  try {
    const http = await getHttpClient()
    if (http && http.fetch) {
      const resp = await httpFetchWithTimeout(http.fetch, url, {
        method: 'GET',
        responseType: http.ResponseType?.Text,
      }, HTTP_TEXT_TIMEOUT_MS)
      if (
        resp &&
        (resp.ok === true ||
          (typeof resp.status === 'number' &&
            resp.status >= 200 &&
            resp.status < 300))
      ) {
        const text =
          typeof resp.text === 'function'
            ? await resp.text()
            : (resp.data || '')
        return String(text || '')
      }
    }
  } catch {
    // 回退到原始 fetch
  }
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? window.setTimeout(() => ctl.abort(), HTTP_TEXT_TIMEOUT_MS) : undefined
  try {
    const r2 = await fetch(url, { signal: ctl?.signal } as any)
    if (!r2.ok) throw new Error(`HTTP ${r2.status}`)
    return await r2.text()
  } finally {
    if (timer != null) window.clearTimeout(timer)
  }
}

// 二进制抓取：同样优先 tauri http，再回退到 fetch
export async function fetchBinarySmart(url: string): Promise<Uint8Array> {
  try {
    const http = await getHttpClient()
    if (http && http.fetch) {
      const resp = await httpFetchWithTimeout(http.fetch, url, {
        method: 'GET',
        responseType: http.ResponseType?.Binary,
      }, HTTP_BINARY_TIMEOUT_MS)
      if (
        resp &&
        (resp.ok === true ||
          (typeof resp.status === 'number' &&
            resp.status >= 200 &&
            resp.status < 300))
      ) {
        if (resp.data instanceof Uint8Array) return resp.data
        if (Array.isArray(resp.data)) return new Uint8Array(resp.data)
        if (resp.arrayBuffer) {
          const buf = await resp.arrayBuffer()
          if (buf) return new Uint8Array(buf)
        }
        if (resp.data && typeof resp.data === 'string') {
          const binaryString = resp.data as string
          const arr = new Uint8Array(binaryString.length)
          for (let i = 0; i < binaryString.length; i++) {
            arr[i] = binaryString.charCodeAt(i) & 0xff
          }
          return arr
        }
      }
    }
  } catch {
    // 回退到原始 fetch
  }
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? window.setTimeout(() => ctl.abort(), HTTP_BINARY_TIMEOUT_MS) : undefined
  try {
    const r2 = await fetch(url, { signal: ctl?.signal } as any)
    if (!r2.ok) throw new Error(`HTTP ${r2.status}`)
    const buf = await r2.arrayBuffer()
    return new Uint8Array(buf)
  } finally {
    if (timer != null) window.clearTimeout(timer)
  }
}

// 解析已安装扩展对应的 manifest URL：
// 1) 优先使用存储在插件记录中的 manifestUrl
// 2) 否则尝试在市场列表中找到对应条目并还原出 manifest.json 地址
export function resolvePluginManifestUrl(
  p: InstalledPlugin,
  market: InstallableItem[],
): string | null {
  if (p.manifestUrl && /^https?:\/\//i.test(p.manifestUrl)) return p.manifestUrl
  if (!market.length) return null
  for (const it of market) {
    if (!it || it.id !== p.id) continue
    const ref =
      it.install && typeof it.install.ref === 'string'
        ? it.install.ref
        : ''
    if (!ref) return null
    const parsed = parseRepoInput(ref)
    return parsed?.manifestUrl || null
  }
  return null
}

// 拉取远端 manifest 并读出 version 字段
export async function fetchRemoteManifestVersion(
  url: string,
): Promise<string | null> {
  try {
    const text = await fetchTextSmart(url)
    const json = JSON.parse(text) as PluginManifest
    const v =
      json && typeof json.version === 'string' ? json.version : null
    return v || null
  } catch {
    return null
  }
}

// 读取已安装扩展的“可更新”状态（只返回有新版本的）
export async function getPluginUpdateStates(
  list: InstalledPlugin[],
  market: InstallableItem[],
): Promise<Record<string, PluginUpdateState>> {
  const res: Record<string, PluginUpdateState> = {}
  if (!list.length) return res
  const tasks: Promise<void>[] = []
  for (const p of list) {
    if (!p.version) continue
    tasks.push(
      (async () => {
        const url = resolvePluginManifestUrl(p, market)
        if (!url) return
        const remote = await fetchRemoteManifestVersion(url)
        if (!remote) return
        if (compareVersions(remote, p.version) <= 0) return
        res[p.id] = { manifestUrl: url, remoteVersion: remote }
      })(),
    )
  }
  await Promise.all(tasks)
  return res
}

// ===== 插件安装核心逻辑（下载 / 复制文件 + 更新安装映射） =====

// 从远程 Git 仓库 / URL 安装扩展（不处理 UI，仅做 IO 与状态更新）
export async function installPluginFromGitCore(
  inputRaw: string,
  opt: InstallPluginOptions | undefined,
  ctx: {
    appVersion: string
    store: Store | null
  },
): Promise<InstalledPlugin> {
  await ensurePluginsDir()
  const parsed = parseRepoInput(inputRaw)
  if (!parsed) {
    throw new Error('无法识别的输入，请输入 URL 或 username/repo[@branch]')
  }
  const manifestText = await fetchTextSmart(parsed.manifestUrl)
  let manifest: PluginManifest
  try {
    manifest = JSON.parse(manifestText) as PluginManifest
  } catch {
    throw new Error('manifest.json 解析失败')
  }
  if (!manifest?.id) throw new Error('manifest.json 缺少 id')

  // 宿主版本兼容性检查
  if (manifest.minHostVersion) {
    const currentVersion = ctx.appVersion
    const requiredVersion = manifest.minHostVersion
    if (compareVersions(currentVersion, requiredVersion) < 0) {
      throw new Error(
        `此扩展需要 FastNote ${requiredVersion} 或更高版本，当前版本为 ${currentVersion}。\n` +
          `请先升级 FastNote 再安装此扩展。`,
      )
    }
  }

  async function ensurePluginPath(
    dirPath: string,
    relPath: string,
  ): Promise<void> {
    const parts = relPath.split('/').filter((p) => !!p)
    if (parts.length <= 1) return
    let cur = dirPath
    for (let i = 0; i < parts.length - 1; i++) {
      cur += '/' + parts[i]
      try {
        await mkdir(cur as any, {
          baseDir: BaseDirectory.AppLocalData,
          recursive: true,
        } as any)
      } catch {}
    }
  }

  const mainRel = (manifest.main || 'main.js').replace(/^\/+/, '')
  const mainUrl = parsed.manifestUrl.replace(/manifest\.json$/i, '') + mainRel
  const mainCode = await fetchTextSmart(mainUrl)

  // 保存主文件与 manifest
  const dir = `${PLUGINS_DIR}/${manifest.id}`
  await mkdir(dir as any, {
    baseDir: BaseDirectory.AppLocalData,
    recursive: true,
  } as any)
  await writeTextFile(
    `${dir}/manifest.json` as any,
    JSON.stringify(manifest, null, 2),
    { baseDir: BaseDirectory.AppLocalData } as any,
  )
  await writeTextFile(`${dir}/${mainRel}` as any, mainCode, {
    baseDir: BaseDirectory.AppLocalData,
  } as any)

  // 下载资源文件
  const assetList = Array.isArray(manifest.assets) ? manifest.assets : []
  const assetBase = parsed.manifestUrl.replace(/manifest\.json$/i, '')
  for (const raw of assetList) {
    let rel = String(raw || '').trim()
    if (!rel) continue
    rel = rel.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!rel || rel.includes('..')) continue
    try {
      await ensurePluginPath(dir, rel)
      const data = await fetchBinarySmart(assetBase + rel)
      await writeFile(`${dir}/${rel}` as any, data, {
        baseDir: BaseDirectory.AppLocalData,
      } as any)
    } catch (e) {
      console.warn(`[Extensions] 资源下载失败: ${rel}`, e)
    }
  }

  const enabled =
    opt && typeof opt.enabled === 'boolean' ? opt.enabled : true
  const showInMenuBar =
    opt && typeof opt.showInMenuBar === 'boolean' ? opt.showInMenuBar : false

  const record: InstalledPlugin = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    enabled,
    showInMenuBar, // 新安装默认收纳到"插件"菜单，更新时由上层传入保持用户配置
    dir,
    main: mainRel,
    description: manifest.description,
    manifestUrl: parsed.manifestUrl,
  }

  const map = await loadInstalledPlugins(ctx.store)
  map[manifest.id] = record
  await saveInstalledPlugins(ctx.store, map)
  return record
}

// 从本地文件夹安装扩展（源目录在外部文件系统，目标写入 AppLocalData）
export async function installPluginFromLocalCore(
  sourcePath: string,
  opt: InstallPluginOptions | undefined,
  ctx: {
    appVersion: string
    store: Store | null
  },
): Promise<InstalledPlugin> {
  await ensurePluginsDir()

  // 读取 manifest.json
  const manifestPath = `${sourcePath}/manifest.json`
  let manifestText: string
  try {
    manifestText = await readTextFile(manifestPath)
  } catch {
    throw new Error('未找到 manifest.json 文件')
  }

  let manifest: PluginManifest
  try {
    manifest = JSON.parse(manifestText) as PluginManifest
  } catch {
    throw new Error('manifest.json 解析失败')
  }

  if (!manifest?.id) throw new Error('manifest.json 缺少 id')

  // 宿主版本兼容性检查
  if (manifest.minHostVersion) {
    const currentVersion = ctx.appVersion
    const requiredVersion = manifest.minHostVersion
    if (compareVersions(currentVersion, requiredVersion) < 0) {
      throw new Error(
        `此扩展需要 FastNote ${requiredVersion} 或更高版本，当前版本为 ${currentVersion}。\n` +
          `请先升级 FastNote 再安装此扩展。`,
      )
    }
  }

  // 递归复制源目录到 AppLocalData 下的插件目录
  async function copyDirRecursive(
    src: string,
    dest: string,
  ): Promise<void> {
    try {
      await mkdir(dest as any, {
        baseDir: BaseDirectory.AppLocalData,
        recursive: true,
      } as any)
    } catch {}

    const entries = await readDir(src)
    for (const entry of entries as any[]) {
      const srcPath = `${src}/${entry.name}`
      const destPath = `${dest}/${entry.name}`

      if (entry.isDirectory) {
        await copyDirRecursive(srcPath, destPath)
      } else {
        try {
          const content = await readFile(srcPath)
          await writeFile(destPath as any, content, {
            baseDir: BaseDirectory.AppLocalData,
          } as any)
        } catch (e) {
          console.warn(`复制文件失败: ${srcPath}`, e)
        }
      }
    }
  }

  const dir = `${PLUGINS_DIR}/${manifest.id}`
  await copyDirRecursive(sourcePath, dir)

  const mainRel = (manifest.main || 'main.js').replace(/^\/+/, '')
  const enabled =
    opt && typeof opt.enabled === 'boolean' ? opt.enabled : true
  const showInMenuBar =
    opt && typeof opt.showInMenuBar === 'boolean' ? opt.showInMenuBar : false

  const record: InstalledPlugin = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    enabled,
    showInMenuBar,
    dir,
    main: mainRel,
    description: manifest.description,
    manifestUrl: '', // 本地安装没有 URL
  }

  const map = await loadInstalledPlugins(ctx.store)
  map[manifest.id] = record
  await saveInstalledPlugins(ctx.store, map)
  return record
}
