import { NotificationManager } from './uiNotifications'
import { openInBrowser } from './updateUtils'

// 在线公告：从官网 JSON 拉取，右下角通知区域弹出；每条默认只弹一次（按 id 去重）
// 设计原则：不阻塞启动、失败静默、数据格式容错、已读记录不无限增长

export type OnlineAnnouncement = {
  id: string
  title?: string
  message?: string
  url?: string
  // 过期时间：支持 YYYY-MM-DD（按本地当天 23:59:59 过期）或 ISO 时间字符串
  expires_at?: string
  // 兼容写法
  expiresAt?: string
  // 可选：通知停留时长（毫秒）
  duration_ms?: number
}

type OnlineAnnouncementPayload =
  | OnlineAnnouncement[]
  | {
      version?: number
      announcements?: OnlineAnnouncement[]
      notices?: OnlineAnnouncement[]
      items?: OnlineAnnouncement[]
    }

// 已停用：原上游公告源（flymd.llingfei.com）会推送上游推广公告。
// 置空后即使被调用也不会拉取任何内容（runOnlineAnnouncements 在 url 为空时直接返回）。
const DEFAULT_URL = ''
const LS_SEEN_KEY = 'flymd:onlineAnnouncements:seen:v1'
const MAX_SEEN_RECORDS = 500
const FETCH_TIMEOUT_MS = 4500

let _started = false

export function initOnlineAnnouncements(opt?: {
  url?: string
}): void {
  if (_started) return
  _started = true

  // 不影响首屏：用 idle 调度
  const ric: any =
    (window as any).requestIdleCallback || ((cb: any) => setTimeout(cb, 150))
  ric(() => {
    void runOnlineAnnouncements(opt).catch(() => {})
  })
}

async function runOnlineAnnouncements(opt?: { url?: string }): Promise<void> {
  const url = String(opt?.url || DEFAULT_URL).trim()
  if (!url) return

  const now = Date.now()

  let payload: OnlineAnnouncementPayload | null = null
  try {
    payload = (await fetchJsonSmart(url)) as any
  } catch {
    return
  }

  const listRaw = extractAnnouncementList(payload)
  if (listRaw.length === 0) return

  const list = listRaw.map(normalizeAnnouncement).filter(Boolean) as OnlineAnnouncement[]
  if (list.length === 0) return

  const seen = readSeenMap()
  const toShow: OnlineAnnouncement[] = []
  for (const a of list) {
    if (seen[a.id]) continue
    if (isExpired(a, now)) continue
    toShow.push(a)
  }

  if (toShow.length === 0) return

  // 默认只弹一次：先标记已读，避免异常导致重复弹
  for (const a of toShow) seen[a.id] = now
  writeSeenMap(seen)

  await playAnnouncements(toShow)
}

function extractAnnouncementList(payload: OnlineAnnouncementPayload | null): OnlineAnnouncement[] {
  if (!payload) return []
  if (Array.isArray(payload)) return payload

  const list =
    (payload as any).announcements ||
    (payload as any).notices ||
    (payload as any).items
  return Array.isArray(list) ? list : []
}

function normalizeAnnouncement(raw: any): OnlineAnnouncement | null {
  const id = String(raw?.id || '').trim()
  if (!id) return null

  const title = String(raw?.title || '').trim()
  const message = String(raw?.message || '').trim()
  if (!title && !message) return null

  const url = String(raw?.url || '').trim()

  const expires_at = String(raw?.expires_at || raw?.expiresAt || '').trim()

  const durationMsRaw = raw?.duration_ms
  const duration_ms =
    typeof durationMsRaw === 'number' && Number.isFinite(durationMsRaw) && durationMsRaw > 0
      ? Math.floor(durationMsRaw)
      : undefined

  return {
    id,
    title: title || undefined,
    message: message || undefined,
    url: url || undefined,
    expires_at: expires_at || undefined,
    duration_ms,
  }
}

function isExpired(a: OnlineAnnouncement, nowMs: number): boolean {
  const expires = String(a.expires_at || a.expiresAt || '').trim()
  if (!expires) return false

  const ms = parseExpiryMs(expires)
  if (!Number.isFinite(ms)) return false
  return nowMs > ms
}

function parseExpiryMs(s: string): number {
  const v = String(s || '').trim()
  if (!v) return NaN

  // YYYY-MM-DD：按本地当天结束过期，更符合直觉（不用纠结时区）
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) {
    const y = parseInt(m[1], 10)
    const mo = parseInt(m[2], 10)
    const d = parseInt(m[3], 10)
    const dt = new Date(y, mo - 1, d, 23, 59, 59, 999)
    return dt.getTime()
  }

  return Date.parse(v)
}

async function playAnnouncements(list: OnlineAnnouncement[]): Promise<void> {
  for (const a of list) {
    const msg = formatAnnouncement(a)
    const duration = a.duration_ms || 12000
    if (a.url) {
      NotificationManager.showWithActions('announcement', msg, {
        duration,
        actions: [
          {
            label: '查看',
            title: a.url,
            onClick: () => openInBrowser(a.url!),
          },
        ],
      })
    } else {
      NotificationManager.show('announcement', msg, duration)
    }
    await sleep(650)
  }
}

function formatAnnouncement(a: OnlineAnnouncement): string {
  const title = String(a.title || '').trim()
  const message = String(a.message || '').trim()
  const body = title && message ? `${title}：${message}` : title || message
  return `【公告】${body}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type SeenMap = Record<string, number>

function readSeenMap(): SeenMap {
  try {
    const raw = localStorage.getItem(LS_SEEN_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return {}

    const out: SeenMap = {}
    for (const [k, v] of Object.entries(obj)) {
      const id = String(k || '').trim()
      const ms =
        typeof v === 'number'
          ? v
          : typeof v === 'string'
            ? parseInt(v, 10)
            : NaN
      if (!id || !Number.isFinite(ms) || ms <= 0) continue
      out[id] = ms
    }
    return out
  } catch {
    return {}
  }
}

function writeSeenMap(map: SeenMap): void {
  try {
    const entries = Object.entries(map).filter(([id, ms]) => id && Number.isFinite(ms) && ms > 0)
    entries.sort((a, b) => b[1] - a[1])
    const trimmed = entries.slice(0, MAX_SEEN_RECORDS)
    const out: SeenMap = {}
    for (const [id, ms] of trimmed) out[id] = ms
    localStorage.setItem(LS_SEEN_KEY, JSON.stringify(out))
  } catch {}
}

async function fetchJsonSmart(url: string): Promise<any> {
  const text = await fetchTextSmart(url)
  return JSON.parse(text)
}

async function fetchTextSmart(url: string): Promise<string> {
  // 优先使用 tauri plugin-http（绕过 CORS）；失败再回退到 window.fetch
  try {
    const mod: any = await import('@tauri-apps/plugin-http')
    if (typeof mod?.fetch === 'function') {
      const resp = await pluginHttpFetchWithTimeout(mod.fetch, url, {
        method: 'GET',
        responseType: mod.ResponseType?.Text,
        headers: {
          'cache-control': 'no-cache',
        },
      }, FETCH_TIMEOUT_MS)
      const ok =
        resp &&
        (resp.ok === true ||
          (typeof resp.status === 'number' &&
            resp.status >= 200 &&
            resp.status < 300))
      if (ok) {
        const t = typeof resp.text === 'function' ? await resp.text() : resp.data
        return String(t || '')
      }
    }
  } catch {}

  const ctl = new AbortController()
  const timer = window.setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.text()
  } finally {
    window.clearTimeout(timer)
  }
}

async function pluginHttpFetchWithTimeout(fetcher: any, url: string, init: any, timeoutMs: number): Promise<any> {
  let timer: number | undefined
  const timeout = new Promise((_resolve, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error('announcement fetch timeout'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([fetcher(url, init), timeout])
  } finally {
    if (timer != null) window.clearTimeout(timer)
  }
}
