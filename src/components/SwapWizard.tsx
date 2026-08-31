import { useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { supabase } from '../lib/supabase'
import { friendlyError, revertChange, swapShifts } from '../lib/api'
import { formatDateKo, formatDateShort, todayISO, weekdayOf } from '../lib/date'
import type { Shift } from '../lib/types'
import { Modal, Notice, Spinner } from './ui'

type Props = {
  /** 내 근무에서 시작할 때 (내 근무 달력) */
  myShift?: Shift
  /** 상대 근무에서 시작할 때 (전체 근무표에서 다른 사람 칸을 누른 경우) */
  targetShift?: Shift
  onClose: () => void
}

type Stage = 'pick-mine' | 'pick-date' | 'pick-shift' | 'confirm' | 'done'

/**
 * 근무 바꾸기 마법사.
 * 한 화면에 한 가지만 묻고, 마지막에 "이렇게 바뀝니다"를 크게 보여준 뒤에야 저장한다.
 * 저장 직후에는 되돌리기 버튼을 같은 화면에 띄워, 잘못 눌렀을 때 즉시 되돌릴 수 있게 한다.
 *
 * 들어오는 길이 두 가지다.
 *   내 근무 달력   → myShift 를 들고 온다 → 날짜 고르기 → 상대 고르기 → 확인
 *   전체 근무표    → targetShift 를 들고 온다 → 내 근무 고르기 → 확인
 */
export default function SwapWizard({ myShift, targetShift, onClose }: Props) {
  const { me, shifts, posts, memberById, postById, showToast, refresh } = useApp()

  const [mine, setMine] = useState<Shift | null>(myShift ?? null)
  const [target, setTarget] = useState<Shift | null>(targetShift ?? null)
  const [stage, setStage] = useState<Stage>(myShift ? 'pick-date' : 'pick-mine')

  const [pickedDate, setPickedDate] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [swapLogId, setSwapLogId] = useState<string | null>(null)

  const myPost = postById(mine?.post_id ?? '')
  const today = todayISO()

  /** 누가 어느 날에 이미 근무가 있는지 (같은 날 두 곳에 서는 것을 막기 위해) */
  const working = useMemo(() => {
    const set = new Set<string>()
    for (const s of shifts) {
      if (s.member_id && !s.is_closed) set.add(`${s.member_id}|${s.work_date}`)
    }
    return set
  }, [shifts])

  /**
   * 바꾸면 어느 한쪽이 같은 날 두 곳에 서게 되는가.
   * 날짜가 같은 교대는 근무지만 맞바꾸는 것이라 겹칠 일이 없다.
   */
  const clashes = (m: Shift, t: Shift): boolean => {
    if (m.work_date === t.work_date) return false
    return working.has(`${t.member_id}|${m.work_date}`)
        || working.has(`${m.member_id}|${t.work_date}`)
  }

  /** 상대 근무부터 고른 경우: 내가 내놓을 수 있는 근무 */
  const myShifts = useMemo(
    () => shifts
      .filter((s) => s.member_id === me?.id && !s.is_closed && s.work_date >= today && s.id !== target?.id)
      .filter((s) => !target || !clashes(s, target))
      .sort((a, b) => a.work_date.localeCompare(b.work_date)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shifts, me?.id, today, target?.id, working],
  )

  /** 바꿀 수 있는 근무: 담당자가 있고, 휴무가 아니고, 내 근무가 아닌 것 */
  const candidates = useMemo(() => {
    return shifts.filter((s) => {
      if (s.id === mine?.id) return false
      if (s.is_closed || !s.member_id) return false
      if (s.member_id === me?.id) return false
      if (s.work_date < today) return false
      if (mine && clashes(mine, s)) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shifts, mine, me?.id, today, working])

  const dates = useMemo(() => {
    const set = new Set(candidates.map((s) => s.work_date))
    return [...set].sort()
  }, [candidates])

  const shiftsOnDate = useMemo(
    () => candidates
      .filter((s) => s.work_date === pickedDate)
      .sort((a, b) => (postById(a.post_id)?.sort_order ?? 0) - (postById(b.post_id)?.sort_order ?? 0)),
    [candidates, pickedDate, postById],
  )

  const doSwap = async () => {
    if (!target || !mine) return
    setBusy(true)
    setError(null)
    try {
      const groupId = await swapShifts(mine.id, target.id)
      const { data } = await supabase
        .from('change_logs').select('id').eq('swap_group_id', groupId).limit(1)
      setSwapLogId(data?.[0]?.id ?? null)
      await refresh()
      setStage('done')
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    if (!swapLogId) return
    setBusy(true)
    try {
      await revertChange(swapLogId)
      await refresh()
      showToast('되돌렸습니다. 원래대로 돌아왔어요.')
      onClose()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  // ─── 완료 화면 ────────────────────────────────────────────────────────────
  if (stage === 'done' && target && mine) {
    const targetName = memberById(target.member_id)?.name ?? '상대방'
    return (
      <Modal title="바뀌었습니다" onClose={onClose}>
        <Notice kind="ok">
          {formatDateKo(mine.work_date)} 근무가 {targetName} 님과 바뀌었습니다.
          <br />
          모든 사람 화면에 바로 반영됩니다.
        </Notice>

        <div className="confirm-box">
          <div className="confirm-row">
            <div className="person"><span className="tag me">나</span>{me?.name}</div>
            <div className="move">
              <span className="to">{formatDateKo(target.work_date)} {postById(target.post_id)?.name}</span>
            </div>
          </div>
          <div className="confirm-row">
            <div className="person"><span className="tag other">상대</span>{targetName}</div>
            <div className="move">
              <span className="to">{formatDateKo(mine.work_date)} {myPost?.name}</span>
            </div>
          </div>
        </div>

        {error && <Notice kind="error">{error}</Notice>}

        <div className="notice warn">
          잘못 바꾸셨나요? 아래 버튼을 누르면 바로 원래대로 돌아갑니다.
        </div>

        <div className="btn-row">
          <button className="btn danger-outline" onClick={undo} disabled={busy || !swapLogId}>
            되돌리기
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>확인</button>
        </div>
      </Modal>
    )
  }

  // ─── 마지막 확인 ──────────────────────────────────────────────────────────
  if (stage === 'confirm' && target && mine) {
    const targetMember = memberById(target.member_id)
    const targetPost = postById(target.post_id)
    return (
      <Modal title="이렇게 바뀝니다" subtitle="맞으면 아래 파란 버튼을 눌러주세요." onClose={onClose}>
        <div className="confirm-box">
          <div className="confirm-row">
            <div className="person"><span className="tag me">나</span>{me?.name} 님</div>
            <div className="move">
              <span className="from">{formatDateKo(mine.work_date)} {myPost?.name}</span>
              <span className="arrow">→</span>
              <span className="to">{formatDateKo(target.work_date)} {targetPost?.name}</span>
            </div>
          </div>
          <div className="confirm-row">
            <div className="person"><span className="tag other">상대</span>{targetMember?.name} 님</div>
            <div className="move">
              <span className="from">{formatDateKo(target.work_date)} {targetPost?.name}</span>
              <span className="arrow">→</span>
              <span className="to">{formatDateKo(mine.work_date)} {myPost?.name}</span>
            </div>
          </div>
        </div>

        <div className="notice info">
          {targetMember?.name} 님에게도 바뀐 근무표가 바로 보입니다.
          바꾼 내용은 [변경 이력]에 남고, 언제든지 되돌릴 수 있습니다.
        </div>

        {error && <Notice kind="error">{error}</Notice>}
        {busy ? <Spinner /> : (
          <div className="btn-row">
            <button
              className="btn ghost"
              onClick={() => setStage(myShift ? 'pick-shift' : 'pick-mine')}
            >
              아니요, 그만두기
            </button>
            <button className="btn" onClick={doSwap}>네, 바꾸겠습니다</button>
          </div>
        )}
      </Modal>
    )
  }

  // ─── 2단계: 그 날짜의 누구와 바꿀지 ──────────────────────────────────────
  if (stage === 'pick-shift' && pickedDate) {
    return (
      <Modal
        title={`${formatDateKo(pickedDate)}`}
        subtitle="누구의 근무와 바꾸시겠습니까?"
        onClose={onClose}
      >
        <div className="step-label">2 / 3 단계</div>
        <ul className="list">
          {shiftsOnDate.map((s) => (
            <li key={s.id}>
              <button
                className="btn secondary"
                style={{ justifyContent: 'space-between' }}
                onClick={() => { setTarget(s); setStage('confirm') }}
              >
                <span style={{ fontSize: '1.15rem' }}>{memberById(s.member_id)?.name}</span>
                <span style={{ color: 'var(--ink-soft)', fontWeight: 600 }}>
                  {postById(s.post_id)?.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button className="btn ghost" onClick={() => setStage('pick-date')}>← 날짜 다시 고르기</button>
      </Modal>
    )
  }

  // ─── 상대부터 고른 경우: 내가 내놓을 근무 고르기 ─────────────────────────
  if (stage === 'pick-mine' && target) {
    const targetName = memberById(target.member_id)?.name ?? '상대방'
    return (
      <Modal
        title={`${targetName} 님과 바꾸기`}
        subtitle={`상대 근무: ${formatDateKo(target.work_date)} ${postById(target.post_id)?.name ?? ''}`}
        onClose={onClose}
      >
        <div className="step-label">1 / 2 단계</div>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>내 어느 근무를 내놓으시겠습니까?</div>

        {myShifts.length === 0 ? (
          <Notice kind="warn">
            내놓을 수 있는 내 근무가 없습니다.
            앞으로 남은 근무만 바꿀 수 있고, 같은 날 두 곳에 서게 되는 조합은 빠집니다.
          </Notice>
        ) : (
          <ul className="list">
            {myShifts.map((s) => (
              <li key={s.id}>
                <button
                  className="btn secondary"
                  style={{ justifyContent: 'space-between' }}
                  onClick={() => { setMine(s); setStage('confirm') }}
                >
                  <span style={{ fontSize: '1.05rem' }}>{formatDateKo(s.work_date)}</span>
                  <span style={{ color: 'var(--ink-soft)', fontWeight: 600 }}>
                    {postById(s.post_id)?.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <button className="btn ghost" style={{ marginTop: 10 }} onClick={onClose}>그만두기</button>
      </Modal>
    )
  }

  // ─── 1단계: 어느 날짜와 바꿀지 ──────────────────────────────────────────
  if (!mine) return null
  return (
    <Modal
      title="근무 바꾸기"
      subtitle={`내 근무: ${formatDateKo(mine.work_date)} ${myPost?.name ?? ''}`}
      onClose={onClose}
    >
      <div className="step-label">1 / 3 단계</div>
      <div style={{ fontWeight: 700, marginBottom: 12 }}>어느 날짜와 바꾸시겠습니까?</div>

      {dates.length === 0 ? (
        <Notice kind="warn">
          바꿀 수 있는 근무가 없습니다.
          같은 날 두 곳에 서게 되는 조합은 고를 수 없습니다.
        </Notice>
      ) : (
        <div className="choice-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }}>
            {dates.map((d) => {
              const w = weekdayOf(d)
              return (
                <button
                  key={d}
                  className="choice"
                  onClick={() => { setPickedDate(d); setStage('pick-shift') }}
                >
                  <span className={w === 0 ? 'sun' : w === 6 ? 'sat' : ''}>{formatDateShort(d)}</span>
                </button>
              )
            })}
        </div>
      )}

      <button className="btn ghost" style={{ marginTop: 16 }} onClick={onClose}>그만두기</button>
    </Modal>
  )
}
