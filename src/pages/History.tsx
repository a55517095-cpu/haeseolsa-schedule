import { useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Empty, Notice, Spinner } from '../components/ui'
import { friendlyError, revertChange } from '../lib/api'
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
  const [onlyMine, setOnlyMine] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      <div className="tabs">
        <button aria-selected={!onlyMine} onClick={() => setOnlyMine(false)}>전체</button>
        <button aria-selected={onlyMine} onClick={() => setOnlyMine(true)}>내 것만</button>
      </div>

      <div className="help" style={{ marginBottom: 14 }}>
        누가 언제 무엇을 바꿨는지 모두 남습니다. 잘못된 변경은 [되돌리기]로 원래대로 돌릴 수 있습니다.
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
