import { supabase } from './supabase'
import type {
  ChangeLog, DayNote, ImportRow, Member, Post, PublicMember, Schedule, Shift,
} from './types'

/** Supabase 에서 온 오류를 사람이 읽을 수 있는 한국어 한 줄로 */
export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  if (!raw) return '알 수 없는 오류가 생겼습니다.'
  if (raw.includes('Invalid login credentials')) return 'PIN이 맞지 않습니다. 다시 확인해 주세요.'
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError'))
    return '인터넷 연결을 확인해 주세요.'
  if (raw.includes('JWT') || raw.includes('session'))
    return '로그인이 만료되었습니다. 다시 로그인해 주세요.'
  return raw
}

// ─── 읽기 ────────────────────────────────────────────────────────────────────

export async function fetchPosts(): Promise<Post[]> {
  const { data, error } = await supabase
    .from('posts').select('*').eq('active', true).order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function fetchMembers(): Promise<Member[]> {
  const { data, error } = await supabase
    .from('members').select('*').order('name')
  if (error) throw error
  return data ?? []
}

/** 로그인 화면용 - 아직 로그인하지 않아도 읽을 수 있다 */
export async function fetchPublicMembers(): Promise<PublicMember[]> {
  const { data, error } = await supabase
    .from('public_members').select('*').order('name')
  if (error) throw error
  return data ?? []
}

/** 그 달의 근무표 (한 달에 하나) */
export async function fetchScheduleForMonth(year: number, month: number): Promise<Schedule | null> {
  const { data, error } = await supabase
    .from('schedules').select('*').eq('year', year).eq('month', month).maybeSingle()
  if (error) throw error
  return data
}

export async function fetchShifts(scheduleId: string | null): Promise<Shift[]> {
  if (!scheduleId) return []
  const { data, error } = await supabase
    .from('shifts').select('*').eq('schedule_id', scheduleId).order('work_date')
  if (error) throw error
  return data ?? []
}

export async function fetchDayNotes(scheduleId: string | null): Promise<DayNote[]> {
  if (!scheduleId) return []
  const { data, error } = await supabase
    .from('day_notes').select('*').eq('schedule_id', scheduleId)
  if (error) throw error
  return data ?? []
}

export async function fetchChangeLogs(limit = 100): Promise<ChangeLog[]> {
  const { data, error } = await supabase
    .from('change_logs').select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

/**
 * 다른 사람이 내 근무를 바꾼 이력 중 since 이후의 것 (오래된 순).
 * 내가 직접 한 변경과 근무표 등록은 뺀다.
 */
export async function fetchChangesForMe(memberId: string, since: string): Promise<ChangeLog[]> {
  const { data, error } = await supabase
    .from('change_logs').select('*')
    .or(`before_member_id.eq.${memberId},after_member_id.eq.${memberId}`)
    .neq('actor_id', memberId)
    .neq('action', 'import')
    .gt('created_at', since)
    .order('created_at', { ascending: true })
    .limit(60)
  if (error) throw error
  return data ?? []
}

// ─── 쓰기 (모두 데이터베이스 함수를 통한다) ──────────────────────────────────

/** 근무 변경 알림을 until 시각까지 확인했다고 적는다 */
export async function markChangesSeen(until: string): Promise<void> {
  const { error } = await supabase.rpc('mark_changes_seen', { p_until: until })
  if (error) throw error
}

/** 근무 교대 - 두 칸을 한 번에 맞바꾼다 */
export async function swapShifts(shiftA: string, shiftB: string): Promise<string> {
  const { data, error } = await supabase.rpc('swap_shifts', { p_shift_a: shiftA, p_shift_b: shiftB })
  if (error) throw error
  return data as string
}

/**
 * 근무 넘기기 - 그 날 근무가 없는 사람에게 근무를 넘긴다.
 * memberId 가 나 자신이면 남의 근무를 내가 대신 맡는 것이 된다.
 * 되돌리기에 쓸 이력 id 를 돌려준다.
 */
export async function handoverShift(shiftId: string, memberId: string): Promise<string> {
  const { data, error } = await supabase.rpc('handover_shift', {
    p_shift: shiftId, p_member: memberId,
  })
  if (error) throw error
  return data as string
}

/** 변경 되돌리기 (교대는 짝까지 함께 되돌아간다) */
export async function revertChange(logId: string): Promise<void> {
  const { error } = await supabase.rpc('revert_change', { p_log: logId })
  if (error) throw error
}

/** 관리자: 한 칸의 담당자 지정 */
export async function setShiftMember(shiftId: string, memberId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_shift_member', { p_shift: shiftId, p_member: memberId })
  if (error) throw error
}

/** 관리자: 휴무 지정/해제 */
export async function setShiftClosed(shiftId: string, closed: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_shift_closed', { p_shift: shiftId, p_closed: closed })
  if (error) throw error
}

/** 관리자: 근무표 일괄 등록 */
export async function importSchedule(
  year: number, month: number, rows: ImportRow[], memo?: string,
): Promise<string> {
  const payload = rows.map((r) => ({
    date: r.date,
    cells: r.cells.map((c) => ({ post: c.post, name: c.name, closed: c.closed })),
  }))
  const { data, error } = await supabase.rpc('import_schedule', {
    p_year: year, p_month: month, p_rows: payload, p_memo: memo ?? null,
  })
  if (error) throw error
  return data as string
}

// ─── Edge Function 호출 ──────────────────────────────────────────────────────

async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    // Edge Function 이 4xx/5xx 를 주면 본문에 담긴 한국어 메시지를 꺼내 쓴다
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const parsed = await ctx.json()
        if (parsed?.error) throw new Error(parsed.error)
      } catch (inner) {
        if (inner instanceof Error && inner.message) throw inner
      }
    }
    throw error
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error)
  return data as T
}

export const changeMyPin = (pin: string) =>
  callFunction<{ ok: true }>('manage-user', { action: 'change_my_pin', pin })

export const adminCreateMember = (payload: {
  name: string; login_code: string; pin: string
  role?: 'member' | 'admin'; group_label?: string | null; weekend_only?: boolean; phone?: string | null
}) => callFunction<{ ok: true }>('manage-user', { action: 'create_member', ...payload })

export const adminLinkMember = (memberId: string, pin: string) =>
  callFunction<{ ok: true }>('manage-user', { action: 'link_member', member_id: memberId, pin })

export const adminResetPin = (memberId: string, pin: string) =>
  callFunction<{ ok: true }>('manage-user', { action: 'reset_pin', member_id: memberId, pin })

export const adminSetActive = (memberId: string, active: boolean) =>
  callFunction<{ ok: true }>('manage-user', { action: 'set_active', member_id: memberId, active })
