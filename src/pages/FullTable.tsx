import { useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Empty, Modal, MonthPicker, Notice, Spinner } from '../components/ui'
import SwapWizard from '../components/SwapWizard'
import { exportScheduleToExcel } from '../lib/excel'
import { friendlyError, setShiftClosed, setShiftMember } from '../lib/api'
import { daysInMonth, formatDateShort, todayISO, weekdayOf } from '../lib/date'
import type { Shift } from '../lib/types'

export default function FullTable() {
  const {
    me, posts, schedule, shifts, dayNotes,
    year, month, setMonth, loading, error, postById, memberById, refresh, showToast,
  } = useApp()

  const [editing, setEditing] = useState<Shift | null>(null)
  const [swapping, setSwapping] = useState<Shift | null>(null)
  const today = todayISO()
  const isAdmin = me?.role === 'admin'

  const sortedPosts = useMemo(
    () => [...posts].sort((a, b) => a.sort_order - b.sort_order),
    [posts],
  )

  /** (날짜, 근무지) -> 근무 */
  const grid = useMemo(() => {
    const map = new Map<string, Shift>()
    for (const s of shifts) {
      if (s.schedule_id !== schedule?.id) continue
      map.set(`${s.work_date}|${s.post_id}`, s)
    }
    return map
  }, [shifts, schedule?.id])

  const days = daysInMonth(year, month)

  const download = () => {
    void exportScheduleToExcel(year, month, sortedPosts.map((p) => p.name), (iso, postName) => {
      const post = sortedPosts.find((p) => p.name === postName)
      const s = post ? grid.get(`${iso}|${post.id}`) : undefined
      if (!s) return ''
      if (s.is_closed) return '휴무'
      return memberById(s.member_id)?.name ?? ''
    })
  }

  if (loading && shifts.length === 0) return <Spinner />

  return (
    <>
      <MonthPicker year={year} month={month} onChange={setMonth} />

      {error && <Notice kind="error">{error}</Notice>}

      {!schedule ? (
        <Empty
          icon="📄"
          title={`${year}년 ${month}월 근무표가 아직 없습니다`}
          hint={isAdmin ? '[더보기] > [근무표 등록]에서 올릴 수 있습니다.' : '관리자가 올리면 여기에 보입니다.'}
        />
      ) : (
        <>
          {schedule.memo && <Notice kind="warn">{schedule.memo}</Notice>}

          <div className="help" style={{ marginBottom: 10 }}>
            노란색은 내 근무, <span style={{ color: 'var(--ok)', fontWeight: 800 }}>초록 글씨</span>는 변경된 근무입니다.
            표는 옆으로 밀어서 볼 수 있습니다.
          </div>

          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th className="date-cell">일자</th>
                  {sortedPosts.map((p) => <th key={p.id}>{p.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {days.map((iso) => {
                  const w = weekdayOf(iso)
                  const note = dayNotes.find((n) => n.work_date === iso && n.schedule_id === schedule.id)
                  return (
                    <tr key={iso} className={iso === today ? 'is-today' : ''}>
                      <td className={`date-cell ${w === 0 ? 'sun' : w === 6 ? 'sat' : ''}`} title={note?.body}>
                        {formatDateShort(iso)}{note ? ' *' : ''}
                      </td>
                      {sortedPosts.map((p) => {
                        const s = grid.get(`${iso}|${p.id}`)
                        if (!s) return <td key={p.id} />
                        const isMine = s.member_id === me?.id
                        const canTap = isAdmin || (isMine && iso >= today)
                        const classes = [
                          s.is_closed ? 'closed' : '',
                          isMine ? 'mine' : '',
                          s.changed ? 'changed' : '',
                          canTap ? 'clickable' : '',
                        ].filter(Boolean).join(' ')
                        return (
                          <td
                            key={p.id}
                            className={classes}
                            onClick={() => {
                              if (isAdmin) setEditing(s)
                              else if (canTap) setSwapping(s)
                            }}
                          >
                            {s.is_closed ? '휴무' : memberById(s.member_id)?.name ?? '—'}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <button className="btn ghost" style={{ marginTop: 16 }} onClick={download}>
            엑셀로 내려받기
          </button>
        </>
      )}

      {swapping && <SwapWizard myShift={swapping} onClose={() => setSwapping(null)} />}

      {editing && isAdmin && (
        <AdminCellEditor
          shift={editing}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            await refresh()
            showToast(message)
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

/** 관리자가 표의 칸 하나를 직접 고칠 때 쓰는 창 */
function AdminCellEditor({
  shift, onClose, onSaved,
}: { shift: Shift; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const { members, postById, memberById } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const post = postById(shift.post_id)
  const active = members.filter((m) => m.active && m.role !== 'admin')

  const run = async (fn: () => Promise<void>, message: string) => {
    setBusy(true); setError(null)
    try {
      await fn()
      await onSaved(message)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`${formatDateShort(shift.work_date)} ${post?.name ?? ''}`}
      subtitle={`현재: ${shift.is_closed ? '휴무' : memberById(shift.member_id)?.name ?? '비어 있음'}`}
      onClose={onClose}
    >
      {error && <Notice kind="error">{error}</Notice>}
      {busy ? <Spinner /> : (
        <>
          <div className="section-title">담당자 지정</div>
          <div className="choice-grid">
            {active.map((m) => (
              <button
                key={m.id}
                className="choice"
                aria-pressed={m.id === shift.member_id}
                onClick={() => run(() => setShiftMember(shift.id, m.id), `${m.name} 님으로 지정했습니다.`)}
              >
                {m.name}
              </button>
            ))}
          </div>

          <div className="btn-row" style={{ marginTop: 18 }}>
            <button
              className="btn ghost"
              onClick={() => run(() => setShiftMember(shift.id, null), '칸을 비웠습니다.')}
            >
              비우기
            </button>
            <button
              className="btn ghost"
              onClick={() => run(
                () => setShiftClosed(shift.id, !shift.is_closed),
                shift.is_closed ? '휴무를 해제했습니다.' : '휴무로 지정했습니다.',
              )}
            >
              {shift.is_closed ? '휴무 해제' : '휴무로 지정'}
            </button>
          </div>

          <button className="btn secondary" style={{ marginTop: 10 }} onClick={onClose}>닫기</button>
        </>
      )}
    </Modal>
  )
}
