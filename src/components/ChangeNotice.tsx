import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { fetchChangesForMe, markChangesSeen } from '../lib/api'
import { formatDateKo, formatWhen } from '../lib/date'
import type { ChangeLog, Member } from '../lib/types'
import { Modal } from './ui'

const SEEN_KEY = 'guide-shift-notice-seen'
/** 알림을 한 번도 확인한 적이 없으면 최근 일주일치만 보여준다 */
const FIRST_LOOKBACK_MS = 7 * 24 * 3600 * 1000

type Line = { key: string; kind: 'got' | 'lost'; where: string; note: string }
type Entry = { key: string; title: string; lines: Line[]; actor: string; at: string }

const laterOf = (a?: string | null, b?: string | null): string | null => {
  if (!a) return b ?? null
  if (!b) return a
  return Date.parse(a) >= Date.parse(b) ? a : b
}

function readLocalSeen(memberId: string): string | null {
  try { return localStorage.getItem(`${SEEN_KEY}:${memberId}`) } catch { return null }
}

/**
 * 바꿨다가 곧바로 되돌린 것처럼 결과적으로 아무 일도 없던 변경은 알리지 않는다.
 * 되돌리기는 한 트랜잭션이라, 원래 이력의 reverted_at 과 되돌림 이력의 created_at 이 같다.
 */
function withoutCancelled(list: ChangeLog[]): ChangeLog[] {
  const undone = new Set(
    list.filter((l) => l.reverted && l.reverted_at)
      .map((l) => `${l.shift_id}|${Date.parse(l.reverted_at!)}`),
  )
  return list.filter((l) => {
    if (l.reverted) return false
    if (l.action === 'revert' && undone.has(`${l.shift_id}|${Date.parse(l.created_at)}`)) return false
    return true
  })
}

function toEntries(list: ChangeLog[], meId: string): Entry[] {
  const groups = new Map<string, ChangeLog[]>()
  for (const l of list) {
    // 교대 한 건, 되돌리기 한 번은 이력이 두 줄이라 한 장으로 묶는다
    const key = l.swap_group_id ?? (l.action === 'revert' ? `r|${l.created_at}|${l.actor_id}` : l.id)
    const bucket = groups.get(key)
    if (bucket) bucket.push(l)
    else groups.set(key, [l])
  }

  return [...groups.entries()].map(([key, logs]) => {
    const first = logs[0]
    const lines: Line[] = []
    for (const l of logs) {
      const where = `${l.work_date ? formatDateKo(l.work_date) : ''} ${l.post_name ?? ''}`.trim()
      if (l.before_member_id === meId) {
        lines.push({
          key: `${l.id}-lost`, kind: 'lost', where,
          note: l.after_member_name
            ? `${l.after_member_name} 님이 맡음`
            : l.action === 'closed' ? '휴무로 바뀜' : '빈 칸이 됨',
        })
      }
      if (l.after_member_id === meId) {
        lines.push({
          key: `${l.id}-got`, kind: 'got', where,
          note: l.before_member_name ? `${l.before_member_name} 님 대신` : '빈 칸이었던 근무',
        })
      }
    }

    const actor = first.actor_name ?? '누군가'
    const lost = lines.find((x) => x.kind === 'lost')
    const got = lines.find((x) => x.kind === 'got')
    const counterpart =
      first.action === 'swap' || first.action === 'handover'
        ? (lost ? logs.find((l) => l.before_member_id === meId)?.after_member_name
                : logs.find((l) => l.after_member_id === meId)?.before_member_name)
        : null

    let title: string
    if (first.action === 'swap') title = `${counterpart ?? '다른 분'} 님과 근무가 맞바뀌었습니다`
    else if (first.action === 'handover' && lost) title = `${counterpart ?? '다른 분'} 님이 내 근무를 대신 맡았습니다`
    else if (first.action === 'handover' && got) title = `${counterpart ?? '다른 분'} 님의 근무를 내가 맡게 되었습니다`
    else if (first.action === 'revert') title = `${actor} 님이 근무 변경을 되돌렸습니다`
    else if (first.action === 'closed') title = '내 근무가 휴무로 바뀌었습니다'
    else title = '관리자가 내 근무를 바꿨습니다'

    return { key, title, lines, actor, at: first.created_at }
  }).sort((a, b) => b.at.localeCompare(a.at))
}

/**
 * 다른 사람이 내 근무를 바꿨으면, 앱을 열었을 때 알림창을 띄운다.
 * [확인했습니다] 를 누르면 그 시각까지의 변경은 다시 띄우지 않는다.
 * 앱을 켜둔 사이에 바뀌어도 실시간으로 뜬다.
 */
export default function ChangeNotice({ me }: { me: Member }) {
  const { logs } = useApp()
  const [seenAt, setSeenAt] = useState<string>(
    () => laterOf(me.notice_seen_at, readLocalSeen(me.id))
      ?? new Date(Date.now() - FIRST_LOOKBACK_MS).toISOString(),
  )
  const [raw, setRaw] = useState<ChangeLog[]>([])

  // logs 는 누가 근무를 바꿀 때마다 새로 받아오므로, 그때마다 다시 확인한다
  useEffect(() => {
    let alive = true
    fetchChangesForMe(me.id, seenAt)
      .then((list) => { if (alive) setRaw(list) })
      .catch(() => { /* 알림은 부가 기능이라 실패해도 조용히 넘어간다 */ })
    return () => { alive = false }
  }, [me.id, seenAt, logs])

  const entries = useMemo(() => toEntries(withoutCancelled(raw), me.id), [raw, me.id])

  const acknowledge = () => {
    const until = raw[raw.length - 1]?.created_at
    setRaw([])
    if (!until) return
    setSeenAt(until)
    try { localStorage.setItem(`${SEEN_KEY}:${me.id}`, until) } catch { /* 저장 못 해도 서버에 남는다 */ }
    void markChangesSeen(until).catch(() => {})
  }

  if (entries.length === 0) return null

  return (
    <Modal
      title="내 근무가 바뀌었습니다"
      subtitle={`${me.name} 님, 다른 분이 바꾼 내용입니다. 확인해 주세요.`}
      onClose={acknowledge}
    >
      <ul className="list">
        {entries.map((e) => (
          <li key={e.key}>
            <div className="log-line">{e.title}</div>
            {e.lines.map((l) => (
              <div key={l.key} className={`change-line ${l.kind}`}>
                <span className="tag">{l.kind === 'got' ? '새 근무' : '빠진 근무'}</span>
                <span>{l.where}</span>
                <span className="who">{l.note}</span>
              </div>
            ))}
            <div className="log-sub" style={{ marginTop: 6 }}>
              {e.actor} 님이 바꿈 · {formatWhen(e.at)}
            </div>
          </li>
        ))}
      </ul>
      <button className="btn" onClick={acknowledge}>확인했습니다</button>
    </Modal>
  )
}
