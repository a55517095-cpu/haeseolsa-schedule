import { useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { friendlyError, revertChange } from '../lib/api'
import { lastChangeOf } from '../lib/history'
import { formatDateKo } from '../lib/date'
import type { Shift } from '../lib/types'
import { Notice } from './ui'

/**
 * 한 번 바뀐 근무를 변경 전으로 되돌리는 버튼.
 * 되돌릴 것이 없거나 되돌릴 권한이 없으면 아무것도 그리지 않는다.
 * 맞바꾼 근무라면 짝까지 함께 원래대로 돌아간다.
 */
export default function RevertShiftButton({
  shift, onDone,
}: { shift: Shift; onDone: () => void }) {
  const { me, logs, refresh, showToast } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const log = useMemo(() => lastChangeOf(logs, shift.id, me), [logs, shift.id, me])
  if (!log) return null

  const backTo = log.before_member_name ?? '빈 칸'
  const pair = !!log.swap_group_id

  const run = async () => {
    const ask = pair
      ? `${formatDateKo(shift.work_date)} 근무를 ${backTo} 님에게 되돌립니다.\n`
        + '맞바꾼 상대의 근무도 함께 원래대로 돌아갑니다.\n\n계속할까요?'
      : `${formatDateKo(shift.work_date)} 근무를 ${backTo} 님에게 되돌립니다.\n\n계속할까요?`
    if (!confirm(ask)) return

    setBusy(true); setError(null)
    try {
      await revertChange(log.id)
      await refresh()
      showToast('변경 전으로 되돌렸습니다.')
      onDone()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {error && <Notice kind="error">{error}</Notice>}
      <button className="btn danger-outline" onClick={run} disabled={busy}>
        {busy ? '되돌리는 중...' : `변경 전으로 되돌리기 (${backTo} 님)`}
      </button>
    </>
  )
}
