export const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const

/** Date -> 'YYYY-MM-DD' (시간대 때문에 날짜가 하루 밀리는 것을 막기 위해 직접 만든다) */
export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 'YYYY-MM-DD' -> Date (현지 시각 자정) */
export function fromISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const todayISO = () => toISODate(new Date())

export function weekdayOf(iso: string): number {
  return fromISODate(iso).getDay()
}

export function weekdayKo(iso: string): string {
  return WEEKDAY_KO[weekdayOf(iso)]
}

export function isWeekend(iso: string): boolean {
  const w = weekdayOf(iso)
  return w === 0 || w === 6
}

/** '7월 14일 (화)' */
export function formatDateKo(iso: string): string {
  const d = fromISODate(iso)
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_KO[d.getDay()]})`
}

/** '7/14 (화)' - 좁은 화면용 */
export function formatDateShort(iso: string): string {
  const d = fromISODate(iso)
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAY_KO[d.getDay()]})`
}

/** 해당 월의 모든 날짜를 'YYYY-MM-DD' 로 */
export function daysInMonth(year: number, month: number): string[] {
  const last = new Date(year, month, 0).getDate()
  return Array.from({ length: last }, (_, i) => `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)
}

/** '오늘', '내일', '3일 뒤', '지난 근무' 처럼 사람이 읽기 쉬운 표현 */
export function relativeDayKo(iso: string): string {
  const today = fromISODate(todayISO()).getTime()
  const target = fromISODate(iso).getTime()
  const diff = Math.round((target - today) / 86_400_000)
  if (diff === 0) return '오늘'
  if (diff === 1) return '내일'
  if (diff === 2) return '모레'
  if (diff > 0) return `${diff}일 뒤`
  if (diff === -1) return '어제'
  return `${-diff}일 전`
}

/** '방금 전', '10분 전', '3시간 전', '2026-07-14 15:03' */
export function formatWhen(isoTimestamp: string): string {
  const then = new Date(isoTimestamp)
  const mins = Math.round((Date.now() - then.getTime()) / 60_000)
  if (mins < 1) return '방금 전'
  if (mins < 60) return `${mins}분 전`
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}시간 전`
  if (mins < 7 * 24 * 60) return `${Math.floor(mins / (60 * 24))}일 전`
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${then.getFullYear()}.${pad(then.getMonth() + 1)}.${pad(then.getDate())} ${pad(then.getHours())}:${pad(then.getMinutes())}`
}

/** 이번 달 (year, month) */
export function currentYearMonth(): { year: number; month: number } {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}
