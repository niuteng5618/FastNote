// 农历 / 节气 / 节日 / 干支生肖 与月历网格构造
// 从 note-templates 扩展移植为内置模块（纯计算，无 UI 依赖）
// 算法：寿星万年历简化版，农历数据覆盖 1900-2100

export type LunarInfo = {
  day: string
  month: string
  term: string
  festival: string
  displayText: string
  displayType: 'lunar' | 'term' | 'festival'
  isWeekend: boolean
  yearGanZhi: string
  shengXiao: string
}

export type DayStat = { notes: number; tasks: number; done: number; open: number }

export type CalendarCell = {
  empty: boolean
  day: number
  dateStr: string
  has: boolean
  hasNote: boolean
  tasks: number
  done: number
  open: number
  overdue: boolean
  allDone: boolean
  isToday: boolean
  isSelected: boolean
  lunar: LunarInfo | null
}

// 农历数据：1900-2100 年（每年用 16 进制表示闰月和每月大小）
const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x16a95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520,
]

const LUNAR_MONTH = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']
const LUNAR_DAY = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
]
const TIAN_GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
const DI_ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
const SHENG_XIAO = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪']

// 24 节气名称
const SOLAR_TERMS = [
  '小寒', '大寒', '立春', '雨水', '惊蛰', '春分',
  '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
  '小暑', '大暑', '立秋', '处暑', '白露', '秋分',
  '寒露', '霜降', '立冬', '小雪', '大雪', '冬至',
]

// 公历节日
const SOLAR_FESTIVALS: Record<string, string> = {
  '1-1': '元旦',
  '2-14': '情人节',
  '3-8': '妇女节',
  '3-12': '植树节',
  '4-1': '愚人节',
  '5-1': '劳动节',
  '5-4': '青年节',
  '6-1': '儿童节',
  '7-1': '建党节',
  '8-1': '建军节',
  '9-10': '教师节',
  '10-1': '国庆节',
  '12-13': '公祭日',
  '12-24': '平安夜',
  '12-25': '圣诞节',
}

// 农历节日
const LUNAR_FESTIVALS: Record<string, string> = {
  '1-1': '春节',
  '1-15': '元宵',
  '2-2': '龙抬头',
  '5-5': '端午',
  '7-7': '七夕',
  '7-15': '中元',
  '8-15': '中秋',
  '9-9': '重阳',
  '12-8': '腊八',
  '12-23': '小年',
  '12-30': '除夕',
}

function leapMonth(year: number): number {
  const idx = year - 1900
  if (idx < 0 || idx >= LUNAR_INFO.length) return 0
  return LUNAR_INFO[idx] & 0xf
}

function leapDays(year: number): number {
  if (leapMonth(year)) {
    const idx = year - 1900
    if (idx < 0 || idx >= LUNAR_INFO.length) return 0
    return (LUNAR_INFO[idx] & 0x10000) ? 30 : 29
  }
  return 0
}

function monthDays(year: number, month: number): number {
  const idx = year - 1900
  if (idx < 0 || idx >= LUNAR_INFO.length) return 30
  return (LUNAR_INFO[idx] & (0x10000 >> month)) ? 30 : 29
}

function yearDays(year: number): number {
  const idx = year - 1900
  if (idx < 0 || idx >= LUNAR_INFO.length) return 365
  let sum = 348
  for (let i = 0x8000; i > 0x8; i >>= 1) {
    sum += (LUNAR_INFO[idx] & i) ? 1 : 0
  }
  return sum + leapDays(year)
}

// 公历转农历
export function solarToLunar(year: number, month: number, day: number) {
  // 基准日期：1900 年 1 月 31 日为农历正月初一
  const baseDate = new Date(1900, 0, 31)
  const targetDate = new Date(year, month - 1, day)
  let offset = Math.floor((targetDate.getTime() - baseDate.getTime()) / 86400000)

  let lunarYear = 1900
  while (lunarYear < 2101 && offset > 0) {
    const daysInYear = yearDays(lunarYear)
    if (offset < daysInYear) break
    offset -= daysInYear
    lunarYear++
  }

  let lunarMonth = 1
  let isLeap = false
  const lp = leapMonth(lunarYear)
  for (let i = 1; i <= 12; i++) {
    let daysInMonth: number
    if (lp > 0 && i === lp + 1 && !isLeap) {
      --i
      isLeap = true
      daysInMonth = leapDays(lunarYear)
    } else {
      daysInMonth = monthDays(lunarYear, i)
    }
    if (offset < daysInMonth) {
      lunarMonth = i
      break
    }
    offset -= daysInMonth
    if (isLeap && i === lp + 1) isLeap = false
  }

  const lunarDay = offset + 1
  return {
    year: lunarYear,
    month: lunarMonth,
    day: lunarDay,
    isLeap,
    monthStr: (isLeap ? '闰' : '') + LUNAR_MONTH[lunarMonth - 1] + '月',
    dayStr: LUNAR_DAY[lunarDay - 1] || String(lunarDay),
    yearGanZhi: TIAN_GAN[(lunarYear - 4) % 10] + DI_ZHI[(lunarYear - 4) % 12],
    shengXiao: SHENG_XIAO[(lunarYear - 4) % 12],
  }
}

// 精确计算某年第 n 个节气的日期（寿星公式）
function termDay(year: number, n: number): number {
  const y = year % 100
  const termCoef = [
    [6.11, 20.84], [4.15, 18.73], [5.63, 20.64], [5.43, 20.12],
    [5.09, 20.51], [6.06, 21.31], [7.26, 22.81], [8.08, 23.65],
    [8.29, 23.95], [8.18, 23.89], [8.15, 23.99], [7.90, 22.60],
  ]
  const monthIdx = Math.floor(n / 2)
  const isSecond = n % 2
  if (monthIdx >= 12) return 1
  const coef = termCoef[monthIdx][isSecond]
  return Math.floor(y * 0.2422 + coef) - Math.floor((y - 1) / 4)
}

function getSolarTerm(year: number, month: number, day: number): string {
  const termIndex = (month - 1) * 2
  for (let i = 0; i < 2; i++) {
    const idx = termIndex + i
    if (idx >= 24) continue
    if (day === termDay(year, idx)) return SOLAR_TERMS[idx]
  }
  return ''
}

function getFestival(
  solarMonth: number,
  solarDay: number,
  lunarMonth: number,
  lunarDay: number,
  isLeap: boolean,
): { name: string; type: string } | null {
  const solarKey = `${solarMonth}-${solarDay}`
  if (SOLAR_FESTIVALS[solarKey]) return { name: SOLAR_FESTIVALS[solarKey], type: 'solar' }
  if (!isLeap) {
    const lunarKey = `${lunarMonth}-${lunarDay}`
    if (LUNAR_FESTIVALS[lunarKey]) return { name: LUNAR_FESTIVALS[lunarKey], type: 'lunar' }
    // 除夕：腊月最后一天（29 或 30 都按除夕处理）
    if (lunarMonth === 12 && lunarDay >= 29) return { name: '除夕', type: 'lunar' }
  }
  return null
}

// 单元格的农历信息（显示优先级：节日 > 节气 > 农历日）
export function getLunarInfo(year: number, month: number, day: number): LunarInfo {
  const weekday = new Date(year, month - 1, day).getDay()
  const lunar = solarToLunar(year, month, day)
  const term = getSolarTerm(year, month, day)
  const festival = getFestival(month, day, lunar.month, lunar.day, lunar.isLeap)

  let displayText = lunar.dayStr
  let displayType: LunarInfo['displayType'] = 'lunar'
  if (term) {
    displayText = term
    displayType = 'term'
  }
  if (festival) {
    displayText = festival.name
    displayType = 'festival'
  }

  return {
    day: lunar.dayStr,
    month: lunar.monthStr,
    term,
    festival: festival ? festival.name : '',
    displayText,
    displayType,
    isWeekend: weekday === 0 || weekday === 6,
    yearGanZhi: lunar.yearGanZhi,
    shengXiao: lunar.shengXiao,
  }
}

// 按本地时区格式化为 YYYY-MM-DD
export function formatYMD(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 构造月历网格：周一为一周起始，前导空单元格补齐
export function buildCalendarGrid(
  baseDate: Date,
  dateStats: Map<string, DayStat>,
  selectedDate: string,
): CalendarCell[] {
  const first = new Date(baseDate.getTime())
  first.setDate(1)
  first.setHours(0, 0, 0, 0)
  const year = first.getFullYear()
  const month = first.getMonth() + 1
  const days = new Date(year, month, 0).getDate()
  const firstWeekday = first.getDay() // 0-6，周日为 0
  // 周日=0 需要转换为 6，其余减 1
  const mondayOffset = firstWeekday === 0 ? 6 : firstWeekday - 1

  const cells: CalendarCell[] = []
  for (let i = 0; i < mondayOffset; i++) cells.push({ empty: true } as CalendarCell)

  const todayStr = formatYMD(Date.now())
  for (let d = 1; d <= days; d++) {
    const ds = formatYMD(new Date(year, month - 1, d).getTime())
    const stat = dateStats.get(ds)
    const tasks = stat ? stat.tasks : 0
    const doneCnt = stat ? stat.done : 0
    const openCnt = stat ? stat.open : 0
    const noteCnt = stat ? stat.notes : 0
    cells.push({
      empty: false,
      day: d,
      dateStr: ds,
      has: tasks > 0 || noteCnt > 0,
      hasNote: noteCnt > 0,
      tasks,
      done: doneCnt,
      open: openCnt,
      // 逾期：该日期在今天之前且仍有未完成待办
      overdue: openCnt > 0 && ds < todayStr,
      allDone: tasks > 0 && openCnt === 0,
      isToday: ds === todayStr,
      isSelected: ds === selectedDate,
      lunar: getLunarInfo(year, month, d),
    })
  }
  return cells
}
