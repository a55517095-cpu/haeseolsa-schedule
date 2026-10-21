import { useMemo, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Modal, MonthPicker, Notice, Spinner } from '../components/ui'
import { countScheduleChanges, fetchScheduleForMonth, friendlyError, importSchedule } from '../lib/api'
import { downloadTemplate, parseScheduleWorkbook, type ParseResult } from '../lib/excel'
import { matchName } from '../lib/match'
import { WEEKDAY_KO, daysInMonth, weekdayOf } from '../lib/date'
import type { ImportRow } from '../lib/types'

type Flag = 'ok' | 'guess' | 'unknown'
type DraftCell = { post: string; name: string; closed: boolean; flag: Flag; raw?: string }
type DraftRow = { day: number; cells: DraftCell[] }
type Mode = 'excel' | 'manual'

/**
 * 같은 달 근무표가 이미 있을 때 띄우는 덮어쓰기 경고.
 * - stage 'file': 엑셀 파일을 고른 직후 (검토 화면으로 넘어가기 전)
 * - stage 'save': 직접 입력으로 만든 표를 등록하려 할 때
 * (10월을 골라 둔 채 11월 파일을 올려 10월 근무표가 통째로 바뀐 일이 있었다)
 */
type Overwrite = {
  stage: 'file' | 'save'
  updatedAt: string
  changes: number | null
  fileMonth: number | null
  parsed?: ParseResult
}

export default function AdminImport({ onBack }: { onBack: () => void }) {
  const { posts, members, year, month, setMonth, refresh, showToast } = useApp()

  const [mode, setMode] = useState<Mode>('excel')
  const [draft, setDraft] = useState<DraftRow[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [overwrite, setOverwrite] = useState<Overwrite | null>(null)
  /** 덮어쓰기 경고를 이미 보고 계속하기로 했는지 */
  const [overwriteOk, setOverwriteOk] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const postNames = useMemo(
    () => [...posts].sort((a, b) => a.sort_order - b.sort_order).map((p) => p.name),
    [posts],
  )
  const roster = useMemo(
    () => members.filter((m) => m.active && m.role !== 'admin').map((m) => m.name),
    [members],
  )

  const reset = () => {
    setDraft(null); setWarnings([]); setError(null); setOverwrite(null); setOverwriteOk(false)
  }

  const cellFrom = (post: string, raw: string): DraftCell => {
    const m = matchName(raw, roster)
    switch (m.kind) {
      case 'closed': return { post, name: '', closed: true, flag: 'ok' }
      case 'empty': return { post, name: '', closed: false, flag: 'ok' }
      case 'exact': return { post, name: m.name, closed: false, flag: 'ok' }
      case 'guess': return { post, name: m.name, closed: false, flag: 'guess', raw: m.input }
      case 'unknown': return { post, name: '', closed: false, flag: 'unknown', raw: m.input }
    }
  }

  /** 서버에서 그 달 근무표가 이미 있는지 확인한다. 없으면 null */
  const findExisting = async (): Promise<{ updatedAt: string; changes: number | null } | null> => {
    const existing = await fetchScheduleForMonth(year, month)
    if (!existing) return null
    const changes = await countScheduleChanges(existing.id).catch(() => null)
    return { updatedAt: existing.updated_at, changes }
  }

  const applyParsed = (parsed: ParseResult) => {
    setDraft(parsed.rows.map((r) => ({
      day: r.day,
      cells: postNames.map((p) => {
        const found = r.cells.find((c) => c.post === p)
        return cellFrom(p, found?.raw ?? '')
      }),
    })))
    setWarnings(parsed.warnings)
  }

  // ─── 엑셀 업로드 ──────────────────────────────────────────────────────────
  const onExcel = async (file: File) => {
    setBusy('엑셀을 읽는 중입니다...'); setError(null)
    try {
      const parsed = await parseScheduleWorkbook(file, postNames, year, month)
      const existing = await findExisting()
      if (existing) {
        setOverwrite({ stage: 'file', ...existing, fileMonth: parsed.fileMonth, parsed })
      } else {
        applyParsed(parsed)
      }
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // ─── 직접 입력 ────────────────────────────────────────────────────────────
  const startManual = () => {
    setDraft(daysInMonth(year, month).map((iso) => ({
      day: Number(iso.slice(8, 10)),
      cells: postNames.map((p) => ({ post: p, name: '', closed: false, flag: 'ok' as Flag })),
    })))
    setWarnings([])
    setOverwriteOk(false)
    setError(null)
  }

  // ─── 덮어쓰기 경고에서 [계속] ─────────────────────────────────────────────
  const confirmOverwrite = () => {
    if (!overwrite) return
    if (overwrite.stage === 'file' && overwrite.parsed) {
      applyParsed(overwrite.parsed)
      setOverwriteOk(true)
      setOverwrite(null)
    } else {
      void doSave()
    }
  }

  // ─── 저장 ────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!draft) return
    const unresolved = draft.reduce(
      (n, r) => n + r.cells.filter((c) => c.flag === 'unknown').length, 0,
    )
    if (unresolved > 0) {
      setError(`이름을 알 수 없는 칸이 ${unresolved}개 있습니다. 빨간 칸을 눌러 사람을 골라주시거나 [비움]으로 두세요.`)
      return
    }

    // 파일을 고를 때 이미 덮어쓰기 경고를 보고 계속하기로 했다
    if (overwriteOk) {
      if (!confirm(`이미 등록된 ${year}년 ${month}월 근무표를 지금 내용으로 덮어씁니다.\n계속할까요?`)) return
      await doSave()
      return
    }

    setBusy('이미 등록된 근무표가 있는지 확인하는 중입니다...'); setError(null)
    let existing: Awaited<ReturnType<typeof findExisting>>
    try {
      existing = await findExisting()
    } catch (e) {
      setError(friendlyError(e))
      setBusy(null)
      return
    }
    setBusy(null)

    if (existing) {
      setOverwrite({ stage: 'save', ...existing, fileMonth: null })
      return
    }
    if (!confirm(`${year}년 ${month}월 근무표를 새로 등록합니다.\n계속할까요?`)) return
    await doSave()
  }

  const doSave = async () => {
    if (!draft) return
    setOverwrite(null)
    setBusy('등록하는 중입니다...'); setError(null)
    try {
      const rows: ImportRow[] = draft.map((r) => ({
        date: `${year}-${String(month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`,
        cells: r.cells.map((c) => ({ post: c.post, name: c.name, closed: c.closed })),
      }))
      await importSchedule(year, month, rows, memo.trim() || undefined)
      await refresh()
      showToast(`${year}년 ${month}월 근무표를 등록했습니다.`)
      reset()
      onBack()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  const updateCell = (day: number, post: string, value: string) => {
    setDraft((prev) => prev?.map((r) => r.day !== day ? r : {
      ...r,
      cells: r.cells.map((c) => {
        if (c.post !== post) return c
        if (value === '__closed') return { post, name: '', closed: true, flag: 'ok' }
        if (value === '') return { post, name: '', closed: false, flag: 'ok' }
        return { post, name: value, closed: false, flag: 'ok' }
      }),
    }) ?? null)
  }

  // ─── 화면 ────────────────────────────────────────────────────────────────

  // ─── 덮어쓰기 경고 팝업 (첫 화면·검토 화면 공용) ─────────────────────────
  const overwriteModal = overwrite && (
    <Modal
      title={`${month}월 근무표를 덮어쓸까요?`}
      subtitle={`${year}년 ${month}월 근무표가 이미 등록되어 있습니다.`}
      onClose={() => setOverwrite(null)}
    >
      {overwrite.fileMonth !== null && overwrite.fileMonth !== month && (
        <Notice kind="error">
          올리신 파일은 <b>{overwrite.fileMonth}월</b> 근무표로 보입니다.
          지금 고른 달은 <b>{month}월</b>입니다. 달을 잘못 고르지 않았는지 꼭 확인하세요.
        </Notice>
      )}
      <Notice kind="warn">
        덮어쓰면 지금 {month}월 근무표의 모든 칸이 새 내용으로 바뀝니다.
        {overwrite.changes !== null && overwrite.changes > 0 && (
          <> 그동안 있었던 <b>교대·넘기기 {overwrite.changes}건</b>도 사라집니다.</>
        )}
        {' '}앱에서 되돌릴 수 없습니다.
      </Notice>
      <div className="help" style={{ marginBottom: 14 }}>
        지금 근무표 마지막 수정: {new Date(overwrite.updatedAt).toLocaleString('ko-KR', {
          month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })}
        {overwrite.stage === 'file' && (
          <><br />계속하면 검토 화면으로 넘어갑니다. 실제로 바뀌는 것은 [이대로 등록하기]를 누를 때입니다.</>
        )}
      </div>
      <div className="btn-row">
        <button className="btn ghost" onClick={() => setOverwrite(null)}>취소</button>
        <button className="btn danger" onClick={confirmOverwrite}>
          {overwrite.stage === 'file' ? '덮어쓰기로 하고 계속' : `${month}월 근무표 덮어쓰기`}
        </button>
      </div>
    </Modal>
  )

  if (busy) return (
    <>
      <Spinner />
      <div style={{ textAlign: 'center', fontWeight: 700 }}>{busy}</div>
    </>
  )

  if (draft) {
    const guessCount = draft.reduce((n, r) => n + r.cells.filter((c) => c.flag === 'guess').length, 0)
    const unknownCount = draft.reduce((n, r) => n + r.cells.filter((c) => c.flag === 'unknown').length, 0)

    return (
      <>
        <div className="section-title">{year}년 {month}월 — 검토</div>

        {warnings.map((w, i) => <Notice key={i} kind="warn">{w}</Notice>)}
        {unknownCount > 0 && (
          <Notice kind="error">
            빨간 칸 {unknownCount}개는 명단에 없는 이름입니다. 눌러서 골라주세요.
          </Notice>
        )}
        {guessCount > 0 && (
          <Notice kind="warn">
            노란 칸 {guessCount}개는 비슷한 이름으로 짐작한 것입니다. 맞는지 확인해 주세요.
          </Notice>
        )}
        {error && <Notice kind="error">{error}</Notice>}

        <div className="table-scroll wide">
          <table className="grid review">
            <thead>
              <tr>
                <th className="date-cell">일자</th>
                {postNames.map((p) => <th key={p}>{p}</th>)}
              </tr>
            </thead>
            <tbody>
              {draft.map((r) => {
                const iso = `${year}-${String(month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`
                const w = weekdayOf(iso)
                return (
                  <tr key={r.day}>
                    <td className={`date-cell ${w === 0 ? 'sun' : w === 6 ? 'sat' : ''}`}>
                      {r.day} ({WEEKDAY_KO[w]})
                    </td>
                    {r.cells.map((c) => (
                      <td key={c.post} className={c.flag === 'unknown' ? 'unknown' : c.flag === 'guess' ? 'uncertain' : ''}>
                        <select
                          value={c.closed ? '__closed' : c.name}
                          onChange={(e) => updateCell(r.day, c.post, e.target.value)}
                          title={c.raw ? `엑셀에서 읽은 글자: ${c.raw}` : undefined}
                        >
                          <option value="">{c.flag === 'unknown' ? `? ${c.raw ?? ''}` : '(비움)'}</option>
                          <option value="__closed">휴무</option>
                          {roster.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="field" style={{ marginTop: 18 }}>
          <label htmlFor="memo">근무표 안내 문구 (없으면 비워두세요)</label>
          <input
            id="memo" type="text" value={memo} onChange={(e) => setMemo(e.target.value)}
            placeholder="예) 7월 8일(수)은 특별탐방(사전예약)입니다"
          />
        </div>

        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn ghost" onClick={reset}>처음으로</button>
          <button className="btn" onClick={save}>이대로 등록하기</button>
        </div>

        {overwriteModal}
      </>
    )
  }

  return (
    <>
      <button className="btn ghost small" style={{ marginBottom: 14 }} onClick={onBack}>← 더보기</button>

      <div className="section-title">어느 달 근무표인가요?</div>
      <MonthPicker year={year} month={month} onChange={setMonth} />

      <div className="section-title">어떻게 넣으시겠습니까?</div>
      <div className="tabs">
        <button aria-selected={mode === 'excel'} onClick={() => setMode('excel')}>엑셀</button>
        <button aria-selected={mode === 'manual'} onClick={() => setMode('manual')}>직접 입력</button>
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      {mode === 'excel' && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>엑셀 파일로 올리기</div>
          <div className="help" style={{ marginBottom: 14 }}>
            먼저 양식을 내려받아 이름을 채운 뒤 그대로 올리시면 됩니다.
            첫 줄에 <b>일자</b>와 근무지 이름({postNames.join(', ')})이 있어야 합니다.
            쉬는 날은 <b>휴무</b> 라고 적으세요.
          </div>
          <button
            className="btn secondary"
            style={{ marginBottom: 10 }}
            onClick={() => void downloadTemplate(postNames, year, month)}
          >
            빈 양식 내려받기
          </button>
          <input
            ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onExcel(f) }}
          />
          <button className="btn" onClick={() => fileRef.current?.click()}>엑셀 파일 고르기</button>
        </div>
      )}

      {mode === 'manual' && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>화면에서 직접 채우기</div>
          <div className="help" style={{ marginBottom: 14 }}>
            {year}년 {month}월 빈 표를 만들어 드립니다. 칸을 눌러 사람을 고르면 됩니다.
          </div>
          <button className="btn" onClick={startManual}>빈 표 만들기</button>
        </div>
      )}
      {overwriteModal}
    </>
  )
}
