import { useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Empty, Modal, MonthPicker, Notice, Spinner } from '../components/ui'
import SwapWizard from '../components/SwapWizard'
import { WEEKDAY_KO, daysInMonth, formatDateKo, formatWhen, todayISO, weekdayOf } from '../lib/date'
import type { Shift } from '../lib/types'

/**
 * 달력 칸은 좁아서 긴 근무지 이름이 안 들어간다.
 * 기당미술관 → 기당, 서복전시관2 → 서복2, 거주지1 → 거주1 처럼 줄인다.
 */
function shortPost(name: string): string {
  if (name.length <= 3) return name
  const tail = name.match(/(\d+)$/)?.[1] ?? ''
  return name.slice(0, 2) + tail
}

export default function MyShifts() {
  const {
    me, shifts, dayNotes, logs, year, month, setMonth,
    loading, error, postById,
  } = useApp()

  const [swapping, setSwapping] = useState<Shift | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const today = todayISO()

  /** 날짜 -> 내 근무 */
  const mineByDate = useMemo(() => {
    const map = new Map<string, Shift>()
    for (const s of shifts) {
      if (s.member_id === me?.id) map.set(s.work_date, s)
    }
    return map
  }, [shifts, me?.id])

  const days = daysInMonth(year, month)
  const leading = weekdayOf(days[0])
  const upcomingCount = [...mineByDate.keys()].filter((d) => d >= today).length

  /** 내 근무에 생긴 최근 변경 (하루 안에 일어난 것만 알린다) */
  const recentForMe = useMemo(() => {
    const dayAgo = Date.now() - 24 * 3600 * 1000
    return logs.filter(
      (l) =>
        !l.reverted &&
        l.action !== 'import' &&
        new Date(l.created_at).getTime() > dayAgo &&
        (l.before_member_id === me?.id || l.after_member_id === me?.id),
    ).slice(0, 4)
  }, [logs, me?.id])

  const noteFor = (iso: string) => dayNotes.find((n) => n.work_date === iso)?.body

  if (loading && shifts.length === 0) return <Spinner />

  const pickedShift = picked ? mineByDate.get(picked) : undefined

  return (
    <>
      <MonthPicker year={year} month={month} onChange={setMonth} />

      {error && <Notice kind="error">{error}</Notice>}

      {recentForMe.length > 0 && (
        <div className="notice warn">
          <div style={{ marginBottom: 6 }}>최근에 내 근무가 바뀌었습니다</div>
          {recentForMe.map((l) => (
            <div key={l.id} style={{ fontSize: '.9rem', fontWeight: 600 }}>
              · {l.work_date ? formatDateKo(l.work_date) : ''} {l.post_name} —{' '}
              {l.before_member_name} → {l.after_member_name}
              <span style={{ color: 'var(--ink-soft)' }}>
                {' '}({l.actor_name}, {formatWhen(l.created_at)})
              </span>
            </div>
          ))}
        </div>
      )}

      {mineByDate.size === 0 ? (
        <Empty
          icon="📅"
          title={`${month}월에 등록된 내 근무가 없습니다`}
          hint="근무표가 아직 올라오지 않았거나, 다른 달일 수 있습니다. 위 화살표로 달을 바꿔보세요."
        />
      ) : (
        <>
          <div className="help" style={{ marginBottom: 10 }}>
            노란 칸이 내 근무입니다. 앞으로 남은 근무 <b>{upcomingCount}일</b>.
            칸을 누르면 근무를 바꿀 수 있습니다.
          </div>

          <div className="cal-head">
            {WEEKDAY_KO.map((w, i) => (
              <div key={w} className={i === 0 ? 'sun' : i === 6 ? 'sat' : ''}>{w}</div>
            ))}
          </div>

          <div className="cal-grid">
            {Array.from({ length: leading }).map((_, i) => (
              <div key={`blank-${i}`} className="cal-cell blank" />
            ))}

            {days.map((iso) => {
              const s = mineByDate.get(iso)
              const w = weekdayOf(iso)
              const classes = [
                'cal-cell',
                s ? 'has' : '',
                iso === today ? 'today' : '',
                iso < today ? 'past' : '',
                s?.changed ? 'changed' : '',
              ].filter(Boolean).join(' ')

              return (
                <button
                  key={iso}
                  className={classes}
                  disabled={!s}
                  onClick={() => setPicked(iso)}
                >
                  <span className={`d ${w === 0 ? 'sun' : w === 6 ? 'sat' : ''}`}>
                    {Number(iso.slice(8, 10))}
                  </span>
                  {s && (
                    <span className="p">
                      {s.is_closed ? '휴무' : shortPost(postById(s.post_id)?.name ?? '')}
                    </span>
                  )}
                  {noteFor(iso) && <span className="dot" aria-label="알림 있음" />}
                </button>
              )
            })}
          </div>
        </>
      )}

      {picked && pickedShift && (
        <Modal
          title={formatDateKo(picked)}
          subtitle={pickedShift.is_closed ? '휴무' : postById(pickedShift.post_id)?.name}
          onClose={() => setPicked(null)}
        >
          {noteFor(picked) && <Notice kind="warn">알림 · {noteFor(picked)}</Notice>}
          {pickedShift.changed && <Notice kind="info">이 근무는 한 번 바뀐 근무입니다.</Notice>}

          {picked < today ? (
            <Notice kind="info">지난 근무는 바꿀 수 없습니다.</Notice>
          ) : (
            <button
              className="btn"
              onClick={() => { setSwapping(pickedShift); setPicked(null) }}
            >
              근무 바꾸기
            </button>
          )}

          <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setPicked(null)}>
            닫기
          </button>
        </Modal>
      )}

      {swapping && <SwapWizard myShift={swapping} onClose={() => setSwapping(null)} />}
    </>
  )
}
