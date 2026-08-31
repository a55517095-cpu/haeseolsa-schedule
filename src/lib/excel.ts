import type * as XLSXType from 'xlsx'
import { daysInMonth, weekdayKo } from './date'
import { isClosedText, normalize } from './match'

/**
 * 엑셀 라이브러리는 700KB가 넘는다. 근무자 대부분은 엑셀 기능을 쓰지 않으므로
 * 앱을 처음 열 때 받지 않고, 실제로 엑셀을 만지는 순간에만 내려받는다.
 */
const loadXLSX = (): Promise<typeof XLSXType> => import('xlsx')

/**
 * 업로드용 엑셀 양식 (근무지 10곳이 조 구분 없이 한 표에 들어간다)
 *
 *   일자 | 요일 | 시공원 | 기당미술관 | ... | 거주지1 | 거주지2
 *    1   |  화  | 휴무   |  김태순    | ... | 현경조  | 김숙향
 *    2   |  수  | 문상금 |  문춘희    | ... | 이화영  | 김명준
 *
 * - 휴무는 "휴무" 라고 적으면 됩니다.
 * - 빈 칸은 그냥 비워두면 됩니다.
 */
async function buildTemplateWorkbook(
  postNames: string[], year: number, month: number,
): Promise<{ XLSX: typeof XLSXType; wb: XLSXType.WorkBook }> {
  const XLSX = await loadXLSX()
  const header = ['일자', '요일', ...postNames]
  const rows = daysInMonth(year, month).map((iso) => {
    const day = Number(iso.slice(8, 10))
    return [day, weekdayKo(iso), ...postNames.map(() => '')]
  })

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
  ws['!cols'] = [{ wch: 6 }, { wch: 6 }, ...postNames.map(() => ({ wch: 14 }))]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `${year}년 ${month}월`)
  return { XLSX, wb }
}

export async function downloadTemplate(
  postNames: string[], year: number, month: number,
): Promise<void> {
  const { XLSX, wb } = await buildTemplateWorkbook(postNames, year, month)
  XLSX.writeFile(wb, `${year}년 ${month}월 해설사 근무표 양식.xlsx`)
}

export type ParsedCell = { post: string; raw: string; closed: boolean }
export type ParsedRow = { day: number; cells: ParsedCell[] }
export type ParseResult = { rows: ParsedRow[]; postColumns: string[]; warnings: string[] }

/** 시트 이름·파일 이름에서 "9월" 같은 표기를 찾아 달을 알아낸다 */
function monthFromText(text: string): number | null {
  const m = text.match(/(\d{1,2})\s*월/)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= 12 ? n : null
}

/** 엑셀 셀 하나에서 일자 숫자를 뽑는다. '1', '7/01', '7월 1일', 엑셀 날짜값 모두 지원 */
function parseDay(value: unknown, month: number): number | null {
  if (value == null || value === '') return null
  if (value instanceof Date) return value.getDate()
  const s = String(value).trim()
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s)
    return n >= 1 && n <= 31 ? n : null
  }
  const slash = s.match(/^(\d{1,2})\s*[/.\-]\s*(\d{1,2})$/)
  if (slash) return Number(slash[2])
  const korean = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/)
  if (korean) return Number(korean[2])
  const dayOnly = s.match(/^(\d{1,2})\s*일$/)
  if (dayOnly) return Number(dayOnly[1])
  return null
}

/**
 * 업로드한 엑셀/CSV 을 읽어 표로 바꾼다.
 * 근무지 열은 이름이 정확히 일치하는 열만 인식하므로, 오타가 있으면 경고로 알려준다.
 */
export async function parseScheduleWorkbook(
  file: File, postNames: string[], year: number, month: number,
): Promise<ParseResult> {
  const XLSX = await loadXLSX()
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) throw new Error('엑셀 파일에서 시트를 찾지 못했습니다.')

  const grid: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true })
  const warnings: string[] = []

  // 화면에서 고른 달과 파일의 달이 다른 실수가 잦다.
  // (오늘이 8월 31일이면 화면은 8월로 열리는데 올리는 건 9월 근무표인 경우)
  const fileMonth = monthFromText(`${wb.SheetNames[0]} ${file.name}`)
  if (fileMonth !== null && fileMonth !== month) {
    warnings.push(
      `⚠ 지금 고르신 달은 ${year}년 ${month}월인데, 올리신 파일은 ${fileMonth}월 근무표로 보입니다. ` +
      `이대로 등록하면 ${month}월 근무표가 됩니다. ` +
      `[처음으로]를 눌러 위쪽 달을 ${fileMonth}월로 바꾼 뒤 다시 올려주세요.`,
    )
  }
  const normalizedPosts = new Map(postNames.map((p) => [normalize(p), p]))

  // 근무지 이름이 2개 이상 들어있는 첫 줄을 머리글로 본다
  let headerIndex = -1
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const hits = grid[i].filter((c) => normalizedPosts.has(normalize(String(c ?? '')))).length
    if (hits >= 2) { headerIndex = i; break }
  }
  if (headerIndex === -1) {
    throw new Error(
      `엑셀에서 근무지 머리글 줄을 찾지 못했습니다. 첫 줄에 "일자"와 근무지 이름(${postNames.join(', ')})이 있어야 합니다.`,
    )
  }

  const headerRow = grid[headerIndex]
  const postColumnMap = new Map<number, string>()
  headerRow.forEach((cell, index) => {
    const matched = normalizedPosts.get(normalize(String(cell ?? '')))
    if (matched) postColumnMap.set(index, matched)
  })

  const missing = postNames.filter((p) => ![...postColumnMap.values()].includes(p))
  if (missing.length > 0) {
    warnings.push(`엑셀에 "${missing.join(', ')}" 열이 없습니다. 그 근무지는 빈 칸으로 등록됩니다.`)
  }

  // 일자 열 찾기 (머리글이 '일자'/'날짜' 인 열, 없으면 맨 왼쪽)
  let dayColumn = headerRow.findIndex((c) => ['일자', '날짜', '일'].includes(normalize(String(c ?? ''))))
  if (dayColumn === -1) dayColumn = 0

  const rows: ParsedRow[] = []
  const seenDays = new Set<number>()

  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i]
    const day = parseDay(row[dayColumn], month)
    if (day == null) continue
    if (seenDays.has(day)) {
      warnings.push(`${month}월 ${day}일이 두 번 나옵니다. 나중 줄은 무시했습니다.`)
      continue
    }
    seenDays.add(day)

    const cells: ParsedCell[] = []
    for (const [index, post] of postColumnMap) {
      const raw = String(row[index] ?? '').trim()
      cells.push({ post, raw, closed: isClosedText(raw) })
    }
    // 엑셀에 없는 근무지 열은 빈 칸으로 채운다
    for (const post of missing) cells.push({ post, raw: '', closed: false })

    rows.push({ day, cells })
  }

  if (rows.length === 0) {
    throw new Error('엑셀에서 날짜 줄을 하나도 찾지 못했습니다. 첫 번째 열에 일자(1, 2, 3 ...)를 넣어주세요.')
  }

  const lastDay = new Date(year, month, 0).getDate()
  const outOfRange = [...seenDays].filter((d) => d > lastDay)
  if (outOfRange.length > 0) {
    warnings.push(`${month}월에 없는 날짜(${outOfRange.join(', ')}일)가 있어 제외했습니다.`)
  }

  return {
    rows: rows.filter((r) => r.day <= lastDay).sort((a, b) => a.day - b.day),
    postColumns: [...postColumnMap.values(), ...missing],
    warnings,
  }
}

/** 등록된 근무표를 엑셀로 내려받기 (백업/인쇄용) */
export async function exportScheduleToExcel(
  year: number, month: number,
  postNames: string[],
  lookup: (iso: string, post: string) => string,
): Promise<void> {
  const XLSX = await loadXLSX()
  const header = ['일자', '요일', ...postNames]
  const rows = daysInMonth(year, month).map((iso) => [
    Number(iso.slice(8, 10)),
    weekdayKo(iso),
    ...postNames.map((p) => lookup(iso, p)),
  ])
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
  ws['!cols'] = [{ wch: 6 }, { wch: 6 }, ...postNames.map(() => ({ wch: 14 }))]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `${month}월`)
  XLSX.writeFile(wb, `${year}년 ${month}월 해설사 근무표.xlsx`)
}
