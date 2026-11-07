import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Empty, Notice, Spinner } from '../components/ui'
import { fetchMyMemos, friendlyError, revertChange, saveChangeMemo } from '../lib/api'
import { canRevert } from '../lib/history'
import { formatDateKo, formatWhen } from '../lib/date'
import type { ChangeLog } from '../lib/types'

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
  const { me, logs, loading, refresh, showToast } = useApp()
  const isAdmin = me?.role === 'admin'
  // 전체 이력은 관리자만 본다. 해설사는 늘 내 것만.
  const [adminOnlyMine, setAdminOnlyMine] = useState(false)
  const onlyMine = !isAdmin || adminOnlyMine
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 내가 남긴 한 줄 메모 (이력 카드 key → 메모). null 이면 아직 못 불러왔거나
  // 데이터베이스에 메모 기능이 설치되지 않은 것이므로 메모 칸을 숨긴다.
  const [memos, setMemos] = useState<Map<string, string> | null>(null)

  useEffect(() => {
    if (!me?.id) return
    let alive = true
    fetchMyMemos()
      .then((list) => { if (alive) setMemos(new Map(list.map((m) => [m.log_key, m.body]))) })
      .catch(() => { if (alive) setMemos(null) })
    return () => { alive = false }
  }, [me?.id])

  const saveMemo = async (key: string, body: string) => {
    const text = body.trim().slice(0, MEMO_MAX)
    await saveChangeMemo(key, text)
    setMemos((prev) => {
      const next = new Map(prev ?? [])
      if (text) next.set(key, text)
      else next.delete(key)
      return next
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
        {memos && ' 카드마다 누구와 왜 바꿨는지 메모를 남겨 두면 나만 볼 수 있습니다.'}
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

                {memos && (
                  <MemoLine
                    body={memos.get(entry.key) ?? ''}
                    onSave={(body) => saveMemo(entry.key, body)}
                  />
                )}

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

/** 이력 카드 아래 한 줄 메모. 나만 볼 수 있다 */
function MemoLine({ body, onSave }: { body: string; onSave: (body: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(body)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = () => { setDraft(body); setError(null); setEditing(true) }

  const save = async () => {
    setSaving(true); setError(null)
    try {
      await onSave(draft)
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
      </button>
    ) : (
      <button type="button" className="memo-add" onClick={open}>+ 메모 남기기 (나만 보임)</button>
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
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save()
          if (e.key === 'Escape') setEditing(false)
        }}
        aria-label="한 줄 메모"
      />
      {error && <div className="memo-error">{error}</div>}
      <div className="memo-actions">
        <button type="button" className="btn small" onClick={() => void save()} disabled={saving}>
          {saving ? '저장 중...' : '저장'}
        </button>
        <button type="button" className="btn ghost small" onClick={() => setEditing(false)} disabled={saving}>
          취소
        </button>
        {body && (
          <button
            type="button"
            className="btn ghost small"
            onClick={() => { setDraft(''); void onSave('').then(() => setEditing(false), (e) => setError(friendlyError(e))) }}
            disabled={saving}
          >
            지우기
          </button>
        )}
      </div>
      <div className="log-sub" style={{ marginTop: 6 }}>이 메모는 나만 볼 수 있습니다.</div>
    </div>
  )
}
