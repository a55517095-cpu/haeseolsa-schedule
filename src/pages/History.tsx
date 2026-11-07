import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Empty, Notice, Spinner } from '../components/ui'
import { fetchVisibleMemos, friendlyError, revertChange, saveChangeMemo } from '../lib/api'
import { canRevert } from '../lib/history'
import { formatDateKo, formatWhen } from '../lib/date'
import type { ChangeLog, ChangeMemo, MemoVisibility } from '../lib/types'

/** 교대 한 건은 이력 두 줄로 남으므로 한 장의 카드로 묶어 보여준다 */
type Entry = { key: string; logs: ChangeLog[]; at: string }

const ACTION_LABEL: Record<ChangeLog['action'], string> = {
  swap: '근무 맞교대',
  handover: '근무 넘김',
  assign: '담당자 지정',
  clear: '담당자 비움',
  closed: '휴무 변경',
  import: '근무표 등록',
  revert: '되돌림',
}

export default function History() {
  const { me, logs, loading, refresh, showToast, memberById } = useApp()
  const isAdmin = me?.role === 'admin'
  // 전체 이력은 관리자만 본다. 해설사는 늘 내 것만.
  const [adminOnlyMine, setAdminOnlyMine] = useState(false)
  const onlyMine = !isAdmin || adminOnlyMine
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 내가 볼 수 있는 한 줄 메모 (내 것 + 남이 공개한 것). null 이면 아직 못 불러왔거나
  // 데이터베이스에 메모 기능이 설치되지 않은 것이므로 메모 칸을 숨긴다.
  const [memos, setMemos] = useState<ChangeMemo[] | null>(null)

  useEffect(() => {
    if (!me?.id) return
    let alive = true
    fetchVisibleMemos()
      .then((list) => { if (alive) setMemos(list) })
      .catch(() => { if (alive) setMemos(null) })
    return () => { alive = false }
  }, [me?.id])

  const saveMemo = async (key: string, body: string, visibility: MemoVisibility) => {
    if (!me) return
    const text = body.trim().slice(0, MEMO_MAX)
    await saveChangeMemo(key, text, visibility)
    setMemos((prev) => {
      const rest = (prev ?? []).filter((m) => !(m.log_key === key && m.member_id === me.id))
      return text ? [...rest, { member_id: me.id, log_key: key, body: text, visibility }] : rest
    })
  }

  const entries = useMemo<Entry[]>(() => {
    const groups = new Map<string, ChangeLog[]>()
    for (const l of logs) {
      if (l.action === 'revert') continue // 되돌린 결과는 원본 카드에 '되돌림'으로 표시된다
      const key = l.swap_group_id ?? l.id
      const bucket = groups.get(key)
      if (bucket) bucket.push(l)
      else groups.set(key, [l])
    }
    return [...groups.entries()]
      .map(([key, list]) => ({ key, logs: list, at: list[0].created_at }))
      .filter((e) => {
        if (!onlyMine) return true
        return e.logs.some(
          (l) => l.actor_id === me?.id || l.before_member_id === me?.id || l.after_member_id === me?.id,
        )
      })
      .sort((a, b) => b.at.localeCompare(a.at))
  }, [logs, onlyMine, me?.id])

  const undo = async (logId: string) => {
    setBusyId(logId); setError(null)
    try {
      await revertChange(logId)
      await refresh()
      showToast('되돌렸습니다. 원래대로 돌아왔어요.')
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusyId(null)
    }
  }

  if (loading && logs.length === 0) return <Spinner />

  return (
    <>
      {isAdmin && (
        <div className="tabs">
          <button aria-selected={!onlyMine} onClick={() => setAdminOnlyMine(false)}>전체</button>
          <button aria-selected={onlyMine} onClick={() => setAdminOnlyMine(true)}>내 것만</button>
        </div>
      )}

      <div className="help" style={{ marginBottom: 14 }}>
        {isAdmin
          ? '누가 언제 무엇을 바꿨는지 모두 남습니다. 잘못된 변경은 [되돌리기]로 원래대로 돌릴 수 있습니다.'
          : '내 근무가 바뀐 내용만 보입니다. 잘못된 변경은 [되돌리기]로 원래대로 돌릴 수 있습니다.'}
        {memos && ' 카드마다 누구와 왜 바꿨는지 메모를 남길 수 있고, 나만 볼지 함께 볼지 고를 수 있습니다.'}
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      {entries.length === 0 ? (
        <Empty icon="🗒️" title="아직 변경된 내용이 없습니다" />
      ) : (
        <ul className="list">
          {entries.map((entry) => {
            const first = entry.logs[0]
            const reverted = entry.logs.every((l) => l.reverted)
            const involvesMe = entry.logs.some(
              (l) => l.before_member_id === me?.id || l.after_member_id === me?.id,
            )
            const canUndo = !reverted && first.action !== 'import' && canRevert(logs, first, me)

            return (
              <li key={entry.key} className={`${reverted ? 'reverted' : ''} ${involvesMe ? 'mine' : ''}`}>
                <div className="log-sub" style={{ marginBottom: 6 }}>
                  {ACTION_LABEL[first.action]}
                  {involvesMe && <span className="badge today" style={{ marginLeft: 8 }}>내 근무</span>}
                  {reverted && <span className="badge closed" style={{ marginLeft: 8 }}>되돌림</span>}
                </div>

                {first.action === 'import' ? (
                  <div className="log-line">{first.detail}</div>
                ) : (
                  entry.logs.map((l) => (
                    <div className="log-line" key={l.id}>
                      {l.work_date && `${formatDateKo(l.work_date)} `}
                      <span style={{ color: 'var(--ink-soft)' }}>{l.post_name}</span>
                      {'  '}
                      {l.before_member_name ?? '빈 칸'}
                      <span className="log-arrow"> → </span>
                      {l.action === 'closed' ? (l.detail ?? '휴무') : l.after_member_name ?? '빈 칸'}
                    </div>
                  ))
                )}

                <div className="log-sub" style={{ marginTop: 6 }}>
                  {first.actor_name ?? '알 수 없음'} · {formatWhen(first.created_at)}
                  {reverted && first.reverted_by_name && ` · ${first.reverted_by_name} 님이 되돌림`}
                </div>

                {memos && (() => {
                  const here = memos.filter((m) => m.log_key === entry.key)
                  const mine = here.find((m) => m.member_id === me?.id)
                  const others = here.filter((m) => m.member_id !== me?.id)
                  return (
                    <>
                      {others.map((m) => (
                        <div className="memo-other" key={m.member_id}>
                          <span aria-hidden>📝</span>{' '}
                          <b>{memberById(m.member_id)?.name ?? '알 수 없음'}</b> {m.body}
                        </div>
                      ))}
                      <MemoLine
                        body={mine?.body ?? ''}
                        visibility={mine?.visibility ?? 'private'}
                        onSave={(body, vis) => saveMemo(entry.key, body, vis)}
                      />
                    </>
                  )
                })()}

                {canUndo && (
                  <button
                    className="btn danger-outline small"
                    style={{ marginTop: 10 }}
                    onClick={() => undo(first.id)}
                    disabled={busyId === first.id}
                  >
                    {busyId === first.id ? '되돌리는 중...' : '되돌리기'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

const MEMO_MAX = 100

const VIS_LABEL: Record<MemoVisibility, string> = {
  private: '나만',
  involved: '관련된 사람',
  all: '모두',
}

const VIS_HELP: Record<MemoVisibility, string> = {
  private: '이 메모는 나만 볼 수 있습니다.',
  involved: '이 변경으로 근무를 주고받은 사람과 변경한 사람이 볼 수 있습니다.',
  all: '이 이력을 보는 모든 사람(관리자 포함)이 볼 수 있습니다.',
}

/** 이력 카드 아래 내 한 줄 메모. 공개 범위를 고를 수 있다 */
function MemoLine({ body, visibility, onSave }: {
  body: string
  visibility: MemoVisibility
  onSave: (body: string, visibility: MemoVisibility) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(body)
  const [vis, setVis] = useState<MemoVisibility>(visibility)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = () => { setDraft(body); setVis(visibility); setError(null); setEditing(true) }

  const save = async (text: string) => {
    setSaving(true); setError(null)
    try {
      await onSave(text, vis)
      setEditing(false)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return body ? (
      <button type="button" className="memo-view" onClick={open} title="메모 고치기">
        <span aria-hidden>📝</span> {body}
        <span className="memo-vis-badge">{VIS_LABEL[visibility]}</span>
      </button>
    ) : (
      <button type="button" className="memo-add" onClick={open}>+ 메모 남기기</button>
    )
  }

  return (
    <div className="memo-edit">
      <input
        type="text"
        value={draft}
        maxLength={MEMO_MAX}
        autoFocus
        placeholder="예) 김OO 님 병원 일정으로 바꿔 줌"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save(draft)
          if (e.key === 'Escape') setEditing(false)
        }}
        aria-label="한 줄 메모"
      />

      <div className="memo-vis" role="radiogroup" aria-label="누구에게 보일까요">
        {(Object.keys(VIS_LABEL) as MemoVisibility[]).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={vis === v}
            onClick={() => setVis(v)}
            disabled={saving}
          >
            {VIS_LABEL[v]}
          </button>
        ))}
      </div>
      <div className="log-sub" style={{ marginTop: 6 }}>{VIS_HELP[vis]}</div>

      {error && <div className="memo-error">{error}</div>}
      <div className="memo-actions">
        <button type="button" className="btn small" onClick={() => void save(draft)} disabled={saving}>
          {saving ? '저장 중...' : '저장'}
        </button>
        <button type="button" className="btn ghost small" onClick={() => setEditing(false)} disabled={saving}>
          취소
        </button>
        {body && (
          <button type="button" className="btn ghost small" onClick={() => void save('')} disabled={saving}>
            지우기
          </button>
        )}
      </div>
    </div>
  )
}
