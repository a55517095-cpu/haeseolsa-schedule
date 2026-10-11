import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../state/AppContext'
import { Empty, Modal, MonthPicker, Notice, Spinner } from '../components/ui'
import SwapWizard from '../components/SwapWizard'
import { exportScheduleToExcel } from '../lib/excel'
import { renderScheduleImage, saveImage, type ImageCell } from '../lib/tableImage'
import { friendlyError, setShiftClosed, setShiftMember } from '../lib/api'
import { daysInMonth, formatDateShort, todayISO, weekdayOf } from '../lib/date'
import type { Shift } from '../lib/types'

/** 지금 근무표 / 처음 등록한 근무표 */
type View = 'now' | 'orig'

/** 칸 폭 (em). 머리줄 표와 본문 표가 같은 폭을 써야 줄이 맞는다 */
const DATE_COL_EM = 5.6
const POST_COL_EM = 4.8

/** 표 한 칸에 보여줄 내용 */
type CellView = { memberId: string | null; closed: boolean; changed: boolean; later: boolean }

/** 최초 근무표의 담당자·휴무. 최초 기록이 없는 칸(마이그레이션 전)은 지금 모습을 쓴다 */
function originalOf(s: Shift): { memberId: string | null; closed: boolean } {
  if (s.orig_closed == null) return { memberId: s.member_id, closed: s.is_closed }
  return { memberId: s.orig_member_id ?? null, closed: s.orig_closed }
}

export default function FullTable() {
  const {
    me, posts, schedule, shifts, dayNotes,
    year, month, setMonth, loading, error, postById, memberById, refresh, showToast,
  } = useApp()

  const [view, setView] = useState<View>('now')
  const [editing, setEditing] = useState<Shift | null>(null)
  /** 근무 바꾸기 — 내 칸에서 시작했는지, 남의 칸에서 시작했는지 */
  const [swapping, setSwapping] = useState<{ mine?: Shift; target?: Shift } | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  /** 휴대폰에서 표만 가로로 펼쳐 보기 */
  const [wideOpen, setWideOpen] = useState(false)
  const headRef = useRef<HTMLDivElement>(null)
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

  /** 최초 근무표가 기록되어 있는가 (데이터베이스 업데이트 전이면 없다) */
  const hasOriginal = useMemo(() => shifts.some((s) => s.orig_closed != null), [shifts])

  /** 남의 칸과 맞바꾸려면 내가 내놓을 근무가 하나라도 있어야 한다 */
  const hasMyShiftToOffer = useMemo(
    () => shifts.some((s) => s.member_id === me?.id && !s.is_closed && s.work_date >= today),
    [shifts, me?.id, today],
  )

  /** 내가 근무하는 날. 비어 있는 날이면 남의 근무를 그냥 대신 맡을 수 있다 */
  const myDates = useMemo(
    () => new Set(
      shifts.filter((s) => s.member_id === me?.id && !s.is_closed).map((s) => s.work_date),
    ),
    [shifts, me?.id],
  )

  const cellView = (s: Shift): CellView => {
    if (view === 'now') {
      return { memberId: s.member_id, closed: s.is_closed, changed: s.changed, later: false }
    }
    const o = originalOf(s)
    return {
      memberId: o.memberId,
      closed: o.closed,
      changed: false,
      later: o.memberId !== s.member_id || o.closed !== s.is_closed,
    }
  }

  const cellText = (c: CellView) => (c.closed ? '휴무' : memberById(c.memberId)?.name ?? '—')
  const noteOn = (iso: string) =>
    dayNotes.find((n) => n.work_date === iso && n.schedule_id === schedule?.id)

  const downloadExcel = () => {
    void exportScheduleToExcel(year, month, sortedPosts.map((p) => p.name), (iso, postName) => {
      const post = sortedPosts.find((p) => p.name === postName)
      const s = post ? grid.get(`${iso}|${post.id}`) : undefined
      if (!s) return ''
      const c = cellView(s)
      return c.closed ? '휴무' : memberById(c.memberId)?.name ?? ''
    })
  }

  const downloadImage = async () => {
    setImageBusy(true)
    try {
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const blob = renderScheduleImage({
        title: `${year}년 ${month}월 해설사 근무편성표${view === 'orig' ? ' (최초)' : ''}`,
        stamp: `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())} `
          + `${pad(now.getHours())}:${pad(now.getMinutes())} 기준`,
        legend: view === 'now'
          ? '초록 글씨: 바뀐 근무   ·   회색: 휴무'
          : '밑줄: 이후에 바뀐 칸   ·   회색: 휴무',
        posts: sortedPosts.map((p) => p.name),
        rows: days.map((iso) => ({
          label: `${formatDateShort(iso)}${noteOn(iso) ? ' *' : ''}`,
          weekday: weekdayOf(iso),
          cells: sortedPosts.map((p): ImageCell | null => {
            const s = grid.get(`${iso}|${p.id}`)
            if (!s) return null
            const c = cellView(s)
            return { text: cellText(c), closed: c.closed, changed: c.changed, later: c.later }
          }),
        })),
      })
      await saveImage(blob, `${year}년 ${month}월 ${view === 'orig' ? '최초 ' : ''}근무표.png`)
    } catch (e) {
      showToast(friendlyError(e))
    } finally {
      setImageBusy(false)
    }
  }

  if (loading && shifts.length === 0) return <Spinner />

  const tableMinWidth = `${DATE_COL_EM + POST_COL_EM * sortedPosts.length}em`
  const colgroup = (
    <colgroup>
      <col style={{ width: `${DATE_COL_EM}em` }} />
      {sortedPosts.map((p) => <col key={p.id} style={{ width: `${POST_COL_EM}em` }} />)}
    </colgroup>
  )

  const tbody = (
    <tbody>
      {days.map((iso) => {
        const w = weekdayOf(iso)
        const note = noteOn(iso)
        return (
          <tr key={iso} className={iso === today ? 'is-today' : ''}>
            <td className={`date-cell ${w === 0 ? 'sun' : w === 6 ? 'sat' : ''}`} title={note?.body}>
              {formatDateShort(iso)}{note ? ' *' : ''}
            </td>
            {sortedPosts.map((p) => {
              const s = grid.get(`${iso}|${p.id}`)
              if (!s) return <td key={p.id} />
              const c = cellView(s)
              const isMine = c.memberId === me?.id
              // 관리자는 아무 칸이나, 근무자는 앞으로의 근무 중
              // 내 칸(누구와 바꿀지 고르기), 또는 남의 칸
              // (내 근무를 내놓거나, 그 날 내가 비어 있으면 대신 맡기)
              // 최초 근무표는 보기만 한다
              const swappable = iso >= today && !s.is_closed && !!s.member_id
              const canTap = view === 'now' && (isAdmin
                || (swappable && (isMine || hasMyShiftToOffer || !myDates.has(iso))))
              const classes = [
                c.closed ? 'closed' : '',
                isMine ? 'mine' : '',
                c.changed ? 'changed' : '',
                c.later ? 'later' : '',
                canTap ? 'clickable' : '',
              ].filter(Boolean).join(' ')
              return (
                <td
                  key={p.id}
                  className={classes}
                  onClick={() => {
                    if (!canTap) return
                    if (isAdmin) setEditing(s)
                    else if (isMine) setSwapping({ mine: s })
                    else setSwapping({ target: s })
                  }}
                >
                  {cellText(c)}
                </td>
              )
            })}
          </tr>
        )
      })}
    </tbody>
  )

  // 가로 보기가 열려 있으면 그 안에 띄운다. (아이폰에서는 가로 보기를 눕혀 그리므로 창도 같이 눕는다)
  const dialogs = (
    <>
      {swapping && (
        <SwapWizard
          myShift={swapping.mine}
          targetShift={swapping.target}
          onClose={() => setSwapping(null)}
        />
      )}

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

          <div className="tabs">
            <button aria-selected={view === 'now'} onClick={() => setView('now')}>지금 근무표</button>
            <button aria-selected={view === 'orig'} onClick={() => setView('orig')}>최초 근무표</button>
          </div>

          {view === 'orig' && !hasOriginal && (
            <Notice kind="warn">
              최초 근무표 기록이 아직 없어 지금 근무표를 그대로 보여드립니다.
              {isAdmin
                ? ' 데이터베이스 업데이트(migration_original_notice.sql)를 실행하면 보입니다.'
                : ' 관리자에게 알려주세요.'}
            </Notice>
          )}

          <div className="help" style={{ marginBottom: 10 }}>
            {view === 'now' ? (
              <>
                노란색은 내 근무, <span style={{ color: 'var(--ok)', fontWeight: 800 }}>초록 글씨</span>는 변경된 근무입니다.
                {!isAdmin && ' 내 칸을 누르거나, 바꾸고 싶은 사람의 칸을 눌러 근무를 바꿀 수 있습니다.'}
              </>
            ) : (
              <>
                처음 등록된 근무표입니다. <span className="later-sample">밑줄</span> 친 칸은 이후에 바뀐 칸입니다.
                근무를 바꾸려면 [지금 근무표]로 가세요.
              </>
            )}
            <span className="only-narrow"> 표는 옆으로 밀어서 볼 수 있습니다.</span>
          </div>

          <button className="rotate-btn" onClick={() => setWideOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="7" width="18" height="11" rx="2" />
              <path d="M8 3.5a7 7 0 0 1 8 0" />
              <path d="M16 1.8v1.8h-1.8" />
            </svg>
            가로로 보기 (한눈에 전체)
          </button>

          <div className="grid-wrap wide">
            {/* 근무지 이름 줄 - 페이지를 내려도 상단바 아래에 붙어 있는다 */}
            <div className="grid-head-shell">
              <div className="grid-head" ref={headRef}>
                <table className="grid" style={{ minWidth: tableMinWidth }}>
                  {colgroup}
                  <thead>
                    <tr>
                      <th className="date-cell">일자</th>
                      {sortedPosts.map((p) => <th key={p.id}>{p.name}</th>)}
                    </tr>
                  </thead>
                </table>
              </div>
            </div>

            <div
              className="grid-body"
              onScroll={(e) => {
                if (headRef.current) headRef.current.scrollLeft = e.currentTarget.scrollLeft
              }}
            >
              <table className="grid" style={{ minWidth: tableMinWidth }}>
                {colgroup}
                {tbody}
              </table>
            </div>
          </div>

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn secondary" onClick={() => void downloadImage()} disabled={imageBusy}>
              {imageBusy ? '만드는 중...' : '이미지로 저장'}
            </button>
            <button className="btn ghost" onClick={downloadExcel}>엑셀로 내려받기</button>
          </div>
          <div className="help">
            {view === 'now' ? '지금' : '최초'} 근무표를 그대로 저장합니다.
            휴대폰에서는 [이미지 저장]이나 카카오톡으로 보낼 수 있습니다.
          </div>
        </>
      )}

      {wideOpen ? (
        <WideView
          title={`${year}년 ${month}월 근무표`}
          view={view}
          onView={setView}
          posts={sortedPosts.map((p) => ({ id: p.id, name: p.name }))}
          onClose={() => setWideOpen(false)}
          tbody={tbody}
        >
          {dialogs}
        </WideView>
      ) : dialogs}
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

/**
 * 휴대폰에서 표만 화면 가득 가로로 펼쳐 보는 창.
 * 근무지가 모두 한 줄에 들어가도록 칸 폭을 화면 폭에 나눠 맞추고, 날짜는 위아래로 넘긴다.
 * 안드로이드는 화면을 가로로 돌려 고정하고, 그게 안 되는 아이폰은
 * 화면이 세로인 동안 CSS로 창을 눕혀 그린다. (휴대폰을 옆으로 들면 똑바로 보인다)
 */
function WideView({
  title, view, onView, posts, onClose, tbody, children,
}: {
  title: string
  view: View
  onView: (v: View) => void
  posts: { id: string; name: string }[]
  onClose: () => void
  tbody: ReactNode
  children: ReactNode
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  // 부모가 다시 그려질 때마다 전체 화면을 풀었다 걸지 않도록, 닫기는 ref 로 들고 있는다
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    let entered = false
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>
    }
    const enter = async () => {
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
          entered = true
        }
        await orientation.lock?.('landscape')
      } catch {
        // 아이폰 등 화면을 돌릴 수 없는 기기 - CSS 로 눕혀 그린다
      }
    }
    void enter()

    // 뒤로 가기 등으로 전체 화면이 풀리면 가로 보기도 닫는다
    const onFullscreen = () => { if (entered && !document.fullscreenElement) closeRef.current() }
    document.addEventListener('fullscreenchange', onFullscreen)
    // 창(근무 바꾸기 등)이 떠 있을 때는 그 창이 먼저 닫힌다
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.wide-view .modal-backdrop')) closeRef.current()
    }
    document.addEventListener('keydown', onKey)

    // 오늘 줄이 보이게 내려둔다
    const todayRow = bodyRef.current?.querySelector<HTMLElement>('tr.is-today')
    if (todayRow && bodyRef.current) bodyRef.current.scrollTop = Math.max(0, todayRow.offsetTop - 80)

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen)
      document.removeEventListener('keydown', onKey)
      try { orientation.unlock?.() } catch { /* 지원 안 함 */ }
      if (entered && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])

  return (
    <div className="wide-view" role="dialog" aria-modal="true" aria-label={title}>
      <div className="wide-bar">
        <b>{title}</b>
        <div className="wide-seg">
          <button aria-pressed={view === 'now'} onClick={() => onView('now')}>지금</button>
          <button aria-pressed={view === 'orig'} onClick={() => onView('orig')}>최초</button>
        </div>
        <button className="wide-close" onClick={onClose}>✕ 닫기</button>
      </div>
      <div className="wide-body" ref={bodyRef}>
        <table className="grid">
          <colgroup>
            <col className="wide-date-col" />
            {posts.map((p) => <col key={p.id} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="date-cell">일자</th>
              {posts.map((p) => <th key={p.id}>{p.name}</th>)}
            </tr>
          </thead>
          {tbody}
        </table>
      </div>
      {children}
    </div>
  )
}
