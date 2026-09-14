import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useApp } from '../state/AppContext'
import { supabase } from '../lib/supabase'
import { friendlyError, handoverShift, revertChange, swapShifts } from '../lib/api'
import { formatDateKo, formatDateShort, todayISO, weekdayOf } from '../lib/date'
import type { Member, Shift } from '../lib/types'
import { Modal, Notice, Spinner } from './ui'
import RevertShiftButton from './RevertShiftButton'

type Props = {
  /** 내 근무에서 시작할 때 (내 근무 달력) */
  myShift?: Shift
  /** 상대 근무에서 시작할 때 (전체 근무표에서 다른 사람 칸을 누른 경우) */
  targetShift?: Shift
  onClose: () => void
}

type Stage =
  | 'pick-mode'   // 내 근무로 무엇을 할지
  | 'pick-date'   // 맞바꾸기 - 어느 날짜와
  | 'pick-shift'  // 맞바꾸기 - 그 날 누구와
  | 'pick-free'   // 넘기기 - 그 날 근무 없는 누구에게
  | 'pick-mine'   // 상대 근무에서 시작 - 내가 내놓을 근무 (또는 그냥 내가 맡기)
  | 'confirm'
  | 'done'

/** 맞바꾸기 / 내 근무 넘겨주기 / 남의 근무 넘겨받기 */
type Mode = 'swap' | 'give' | 'take'

/**
 * 근무 바꾸기 마법사.
 * 한 화면에 한 가지만 묻고, 마지막에 "이렇게 바뀝니다"를 크게 보여준 뒤에야 저장한다.
 * 저장 직후에는 되돌리기 버튼을 같은 화면에 띄워, 잘못 눌렀을 때 즉시 되돌릴 수 있게 한다.
 *
 * 들어오는 길이 두 가지다.
 *   내 근무 달력   → myShift 를 들고 온다 → 무엇을 할지 → ... → 확인
 *   전체 근무표    → targetShift 를 들고 온다 → 내 근무 고르기(또는 내가 맡기) → 확인
 *
 * 바꾸는 방법도 두 가지다.
 *   맞바꾸기   서로 근무가 있을 때. 두 칸의 담당자를 통째로 맞바꾼다.
 *   넘기기     한쪽이 그 날 근무가 없을 때. 한 칸의 담당자만 바뀐다.
 */
export default function SwapWizard({ myShift, targetShift, onClose }: Props) {
  const { me, members, shifts, memberById, postById, showToast, refresh } = useApp()

  const [mine, setMine] = useState<Shift | null>(myShift ?? null)
  const [target, setTarget] = useState<Shift | null>(targetShift ?? null)
  /** 넘기기에서 그 근무를 맡게 될 사람 */
  const [taker, setTaker] = useState<Member | null>(null)
  const [mode, setMode] = useState<Mode>('swap')
  const [stage, setStage] = useState<Stage>(myShift ? 'pick-mode' : 'pick-mine')

  const [pickedDate, setPickedDate] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [undoLogId, setUndoLogId] = useState<string | null>(null)

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

  const isFreeOn = useCallback(
    (memberId: string, date: string) => !working.has(`${memberId}|${date}`),
    [working],
  )

  /** 그 날 근무가 없어서 근무를 대신 맡을 수 있는 사람들 */
  const freeMembersOn = useCallback(
    (date: string) => members.filter(
      (m) => m.active && m.role !== 'admin' && m.id !== me?.id && isFreeOn(m.id, date),
    ),
    [members, me?.id, isFreeOn],
  )

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

  /** 맞바꿀 수 있는 근무: 담당자가 있고, 휴무가 아니고, 내 근무가 아닌 것 */
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

  /** 넘기기에서 실제로 담당자가 바뀌는 칸 */
  const handoverRow = mode === 'give' ? mine : target

  /** 내 근무를 대신 맡아줄 수 있는 사람 목록 */
  const freeList = useMemo(
    () => (mine ? freeMembersOn(mine.work_date) : []),
    [mine, freeMembersOn],
  )

  /** 상대 근무 날짜에 내가 비어 있으면, 내 근무를 내놓지 않고 그냥 맡을 수 있다 */
  const canTakeOver = !!(target && me && isFreeOn(me.id, target.work_date))

  // ─── 저장 ────────────────────────────────────────────────────────────────

  const commit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'swap') {
        if (!mine || !target) return
        const groupId = await swapShifts(mine.id, target.id)
        const { data } = await supabase
          .from('change_logs').select('id').eq('swap_group_id', groupId).limit(1)
        setUndoLogId(data?.[0]?.id ?? null)
      } else {
        if (!handoverRow || !taker) return
        setUndoLogId(await handoverShift(handoverRow.id, taker.id))
      }
      await refresh()
      setStage('done')
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    if (!undoLogId) return
    setBusy(true)
    try {
      await revertChange(undoLogId)
      await refresh()
      showToast('되돌렸습니다. 원래대로 돌아왔어요.')
      onClose()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const backFromConfirm = () => {
    if (mode === 'give') setStage('pick-free')
    else if (mode === 'take') setStage('pick-mine')
    else setStage(myShift ? 'pick-shift' : 'pick-mine')
  }

  /** 넘기기 화면의 두 줄 (근무를 내놓는 사람 / 대신 맡는 사람) */
  const handoverLines = (): ReactNode => {
    if (!handoverRow || !taker) return null
    const giver = memberById(handoverRow.member_id)
    const where = `${formatDateKo(handoverRow.work_date)} ${postById(handoverRow.post_id)?.name ?? ''}`
    const giverIsMe = giver?.id === me?.id
    return (
      <>
        <ConfirmRow mine={giverIsMe} name={giver?.name ?? '담당자'} from={where} to="이 날 근무 없음" />
        <ConfirmRow mine={!giverIsMe} name={taker.name} from="이 날 근무 없음" to={where} />
      </>
    )
  }

  // ─── 완료 화면 ────────────────────────────────────────────────────────────
  if (stage === 'done') {
    const message =
      mode === 'swap' && mine && target
        ? `${formatDateKo(mine.work_date)} 근무가 ${memberById(target.member_id)?.name ?? '상대방'} 님과 바뀌었습니다.`
        : handoverRow && taker
          ? `${formatDateKo(handoverRow.work_date)} 근무를 ${taker.name} 님이 맡습니다.`
          : '근무가 바뀌었습니다.'

    return (
      <Modal title="바뀌었습니다" onClose={onClose}>
        <Notice kind="ok">
          {message}
          <br />
          모든 사람 화면에 바로 반영됩니다.
        </Notice>

        <div className="confirm-box">
          {mode === 'swap' && mine && target ? (
            <>
              <ConfirmRow
                mine
                name={me?.name ?? '나'}
                to={`${formatDateKo(target.work_date)} ${postById(target.post_id)?.name ?? ''}`}
              />
              <ConfirmRow
                name={memberById(target.member_id)?.name ?? '상대방'}
                to={`${formatDateKo(mine.work_date)} ${myPost?.name ?? ''}`}
              />
            </>
          ) : handoverLines()}
        </div>

        {error && <Notice kind="error">{error}</Notice>}

        <div className="notice warn">
          잘못 바꾸셨나요? 아래 버튼을 누르면 바로 원래대로 돌아갑니다.
        </div>

        <div className="btn-row">
          <button className="btn danger-outline" onClick={undo} disabled={busy || !undoLogId}>
            되돌리기
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>확인</button>
        </div>
      </Modal>
    )
  }

  // ─── 마지막 확인 ──────────────────────────────────────────────────────────
  if (stage === 'confirm') {
    const swapReady = mode === 'swap' && !!mine && !!target
    const handoverReady = mode !== 'swap' && !!handoverRow && !!taker
    if (!swapReady && !handoverReady) return null

    const targetMember = target ? memberById(target.member_id) : undefined
    const giverName = memberById(handoverRow?.member_id ?? null)?.name ?? '상대'

    return (
      <Modal title="이렇게 바뀝니다" subtitle="맞으면 아래 파란 버튼을 눌러주세요." onClose={onClose}>
        <div className="confirm-box">
          {mode === 'swap' && mine && target ? (
            <>
              <ConfirmRow
                mine
                name={`${me?.name ?? '나'} 님`}
                from={`${formatDateKo(mine.work_date)} ${myPost?.name ?? ''}`}
                to={`${formatDateKo(target.work_date)} ${postById(target.post_id)?.name ?? ''}`}
              />
              <ConfirmRow
                name={`${targetMember?.name ?? '상대방'} 님`}
                from={`${formatDateKo(target.work_date)} ${postById(target.post_id)?.name ?? ''}`}
                to={`${formatDateKo(mine.work_date)} ${myPost?.name ?? ''}`}
              />
            </>
          ) : handoverLines()}
        </div>

        <div className="notice info">
          {mode === 'swap'
            ? `${targetMember?.name ?? '상대'} 님에게도 바뀐 근무표가 바로 보입니다.`
            : mode === 'give'
              ? `${taker?.name ?? '상대'} 님에게도 바뀐 근무표가 바로 보입니다. 이 날 나는 근무가 없어집니다.`
              : `${giverName} 님은 이 날 근무가 없어집니다.`}
          {' '}바꾼 내용은 [변경 이력]에 남고, 언제든지 되돌릴 수 있습니다.
        </div>

        {error && <Notice kind="error">{error}</Notice>}
        {busy ? <Spinner /> : (
          <div className="btn-row">
            <button className="btn ghost" onClick={backFromConfirm}>아니요, 그만두기</button>
            <button className="btn" onClick={commit}>네, 바꾸겠습니다</button>
          </div>
        )}
      </Modal>
    )
  }

  // ─── 내 근무로 무엇을 할지 ───────────────────────────────────────────────
  if (stage === 'pick-mode' && mine) {
    return (
      <Modal
        title="근무 바꾸기"
        subtitle={`내 근무: ${formatDateKo(mine.work_date)} ${myPost?.name ?? ''}`}
        onClose={onClose}
      >
        <button
          className="btn secondary big-choice"
          onClick={() => { setMode('swap'); setStage('pick-date') }}
        >
          <span className="t">다른 사람 근무와 맞바꾸기</span>
          <span className="s">내 근무를 주고, 그 사람 근무를 대신 받습니다</span>
        </button>

        <button
          className="btn secondary big-choice"
          style={{ marginTop: 10 }}
          onClick={() => { setMode('give'); setStage('pick-free') }}
        >
          <span className="t">근무가 없는 사람에게 넘기기</span>
          <span className="s">이 날 근무가 없는 분이 대신 맡습니다. 나는 쉽니다</span>
        </button>

        {mine.changed && (
          <div style={{ marginTop: 18 }}>
            <RevertShiftButton shift={mine} onDone={onClose} />
          </div>
        )}

        <button className="btn ghost" style={{ marginTop: 10 }} onClick={onClose}>그만두기</button>
      </Modal>
    )
  }

  // ─── 넘기기: 그 날 근무가 없는 사람 고르기 ───────────────────────────────
  if (stage === 'pick-free' && mine) {
    return (
      <Modal
        title="누가 대신 맡을까요?"
        subtitle={`내 근무: ${formatDateKo(mine.work_date)} ${myPost?.name ?? ''}`}
        onClose={onClose}
      >
        {freeList.length === 0 ? (
          <Notice kind="warn">
            이 날 근무가 없는 분이 없습니다.
            [다른 사람 근무와 맞바꾸기]를 이용해 주세요.
          </Notice>
        ) : (
          <>
            <div className="help" style={{ marginBottom: 10 }}>
              {formatDateKo(mine.work_date)}에 근무가 없는 분들입니다.
            </div>
            <div className="choice-grid">
              {freeList.map((m) => (
                <button
                  key={m.id}
                  className="choice"
                  onClick={() => { setTaker(m); setStage('confirm') }}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </>
        )}

        <button className="btn ghost" style={{ marginTop: 16 }} onClick={() => setStage('pick-mode')}>
          ← 뒤로
        </button>
      </Modal>
    )
  }

  // ─── 맞바꾸기 2단계: 그 날짜의 누구와 ────────────────────────────────────
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
                onClick={() => { setTarget(s); setMode('swap'); setStage('confirm') }}
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
        {canTakeOver && me && (
          <>
            <button
              className="btn secondary big-choice"
              onClick={() => { setMode('take'); setTaker(me); setStage('confirm') }}
            >
              <span className="t">내가 대신 근무하기</span>
              <span className="s">
                내 근무를 내놓지 않고 이 근무만 맡습니다
                ({formatDateKo(target.work_date)}에는 내 근무가 없습니다)
              </span>
            </button>
            {myShifts.length > 0 && <div className="section-title">또는, 내 근무와 맞바꾸기</div>}
          </>
        )}

        {!canTakeOver && (
          <div style={{ fontWeight: 700, marginBottom: 12 }}>내 어느 근무를 내놓으시겠습니까?</div>
        )}

        {myShifts.length === 0 ? (
          !canTakeOver && (
            <Notice kind="warn">
              내놓을 수 있는 내 근무가 없습니다.
              앞으로 남은 근무만 바꿀 수 있고, 같은 날 두 곳에 서게 되는 조합은 빠집니다.
            </Notice>
          )
        ) : (
          <ul className="list">
            {myShifts.map((s) => (
              <li key={s.id}>
                <button
                  className="btn secondary"
                  style={{ justifyContent: 'space-between' }}
                  onClick={() => { setMine(s); setMode('swap'); setStage('confirm') }}
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

        {target.changed && (
          <div style={{ marginTop: 18 }}>
            <RevertShiftButton shift={target} onDone={onClose} />
          </div>
        )}

        <button className="btn ghost" style={{ marginTop: 10 }} onClick={onClose}>그만두기</button>
      </Modal>
    )
  }

  // ─── 맞바꾸기 1단계: 어느 날짜와 ────────────────────────────────────────
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

      <button
        className="btn ghost"
        style={{ marginTop: 16 }}
        onClick={() => (myShift ? setStage('pick-mode') : onClose())}
      >
        {myShift ? '← 뒤로' : '그만두기'}
      </button>
    </Modal>
  )
}

/** "누가 · 어디에서 어디로" 한 줄 */
function ConfirmRow({
  mine = false, name, from, to,
}: { mine?: boolean; name: string; from?: string; to: string }) {
  return (
    <div className="confirm-row">
      <div className="person">
        <span className={`tag ${mine ? 'me' : 'other'}`}>{mine ? '나' : '상대'}</span>
        {name}
      </div>
      <div className="move">
        {from && (
          <>
            <span className="from">{from}</span>
            <span className="arrow">→</span>
          </>
        )}
        <span className="to">{to}</span>
      </div>
    </div>
  )
}
