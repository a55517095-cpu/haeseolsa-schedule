/** 변경 이력에서 "이 근무를 변경 전으로 되돌릴 수 있는가"를 찾아내는 도우미 */

import type { ChangeLog, Member } from './types'

/** 되돌릴 수 있는 종류의 이력인가 (등록/되돌림 기록 자체는 제외) */
function revertible(log: ChangeLog): boolean {
  return !log.reverted && log.action !== 'import' && log.action !== 'revert'
}

/** 한 건의 교대는 두 줄로 남는다. 같은 건에 속한 줄을 모두 모은다. */
function groupOf(logs: ChangeLog[], log: ChangeLog): ChangeLog[] {
  if (!log.swap_group_id) return [log]
  return logs.filter((l) => l.swap_group_id === log.swap_group_id)
}

/**
 * 되돌릴 수 있는 사람인가.
 * 관리자, 그 변경을 한 본인, 또는 그 변경에서 근무를 주거나 받은 사람.
 * (데이터베이스의 revert_change 와 같은 기준이다)
 */
export function canRevert(logs: ChangeLog[], log: ChangeLog, me: Member | null): boolean {
  if (!me) return false
  if (me.role === 'admin') return true
  if (log.actor_id === me.id) return true
  return groupOf(logs, log).some(
    (l) => l.before_member_id === me.id || l.after_member_id === me.id,
  )
}

/**
 * 그 근무 칸에 마지막으로 일어난, 아직 되돌리지 않은 변경.
 * 없으면 undefined - 되돌릴 것이 없다는 뜻이다.
 * (logs 는 최신순으로 들어온다)
 */
export function lastChangeOf(
  logs: ChangeLog[], shiftId: string, me: Member | null,
): ChangeLog | undefined {
  const log = logs.find((l) => l.shift_id === shiftId && revertible(l))
  if (!log) return undefined
  return canRevert(logs, log, me) ? log : undefined
}
