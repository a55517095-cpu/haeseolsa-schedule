import { useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Empty, MonthPicker, Notice, Spinner } from '../components/ui'
import SwapWizard from '../components/SwapWizard'
import { formatDateKo, formatWhen, relativeDayKo, todayISO, weekdayOf } from '../lib/date'
import type { Shift } from '../lib/types'

export default function MyShifts() {
  const {
    me, shifts, dayNotes, logs, year, month, setMonth,
    loading, error, postById,
  } = useApp()

  const [swapping, setSwapping] = useState<Shift | null>(null)
  const [showPast, setShowPast] = useState(false)
  const today = todayISO()

  const mine = useMemo(
    () => shifts.filter((s) => s.member_id === me?.id).sort((a, b) => a.work_date.localeCompare(b.work_date)),
    [shifts, me?.id],
  )
  const upcoming = mine.filter((s) => s.work_date >= today)
  const past = mine.filter((s) => s.work_date < today)

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

  const renderCard = (s: Shift, isPast: boolean) => {
    const w = weekdayOf(s.work_date)
    const isToday = s.work_date === today
    const note = noteFor(s.work_date)
    return (
      <div key={s.id} className={`card shift-card ${isToday ? 'today' : ''} ${isPast ? 'past' : ''}`}>
        <div className="when">
          <span className={w === 0 ? 'sun' : w === 6 ? 'sat' : ''}>{formatDateKo(s.work_date)}</span>
          {isToday && <span className="badge today">오늘</span>}
          {!isToday && !isPast && <span className="rel">{relativeDayKo(s.work_date)}</span>}
          {s.changed && <span className="badge changed">변경됨</span>}
        </div>
        <div className="where">{postById(s.post_id)?.name ?? '근무지 미정'}</div>
        {note && <div className="note">알림 · {note}</div>}
        {!isPast && (
          <button className="btn secondary" onClick={() => setSwapping(s)}>
            근무 바꾸기
          </button>
        )}
      </div>
    )
  }

  if (loading && shifts.length === 0) return <Spinner />

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

      {mine.length === 0 ? (
        <Empty
          icon="📅"
          title={`${month}월에 등록된 내 근무가 없습니다`}
          hint="근무표가 아직 올라오지 않았거나, 다른 달일 수 있습니다. 위 화살표로 달을 바꿔보세요."
        />
      ) : (
        <>
          <div className="section-title">
            앞으로의 내 근무 {upcoming.length > 0 && `(${upcoming.length}일)`}
          </div>

          {upcoming.length === 0
            ? <Notice kind="info">{month}월에 남은 근무가 없습니다.</Notice>
            : upcoming.map((s) => renderCard(s, false))}

          {past.length > 0 && (
            <>
              <button
                className="btn ghost"
                style={{ marginTop: 10 }}
                onClick={() => setShowPast((v) => !v)}
              >
                {showPast ? '지난 근무 접기' : `지난 근무 보기 (${past.length}일)`}
              </button>
              {showPast && <div style={{ marginTop: 14 }}>{past.map((s) => renderCard(s, true))}</div>}
            </>
          )}
        </>
      )}

      {swapping && <SwapWizard myShift={swapping} onClose={() => setSwapping(null)} />}
    </>
  )
}
