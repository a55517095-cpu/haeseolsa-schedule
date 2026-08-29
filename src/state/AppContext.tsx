import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import {
  fetchChangeLogs, fetchDayNotes, fetchMembers, fetchPosts, fetchScheduleForMonth,
  fetchShifts, friendlyError,
} from '../lib/api'
import { currentYearMonth } from '../lib/date'
import type { ChangeLog, DayNote, Member, Post, Schedule, Shift } from '../lib/types'

type Ctx = {
  session: Session | null
  me: Member | null
  ready: boolean

  posts: Post[]
  members: Member[]

  year: number
  month: number
  setMonth: (year: number, month: number) => void

  schedule: Schedule | null
  shifts: Shift[]
  dayNotes: DayNote[]
  logs: ChangeLog[]

  loading: boolean
  error: string | null
  refresh: () => Promise<void>

  memberById: (id: string | null) => Member | undefined
  postById: (id: string) => Post | undefined

  fontScale: number
  setFontScale: (v: number) => void

  toast: string | null
  showToast: (message: string) => void

  signOut: () => Promise<void>
}

const AppContext = createContext<Ctx | null>(null)

export function useApp(): Ctx {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('AppProvider 안에서만 사용할 수 있습니다.')
  return ctx
}

const FONT_KEY = 'guide-shift-font-scale'

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [me, setMe] = useState<Member | null>(null)
  const [ready, setReady] = useState(false)

  const [posts, setPosts] = useState<Post[]>([])
  const [members, setMembers] = useState<Member[]>([])

  const initial = currentYearMonth()
  const [year, setYear] = useState(initial.year)
  const [month, setMonthState] = useState(initial.month)

  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [dayNotes, setDayNotes] = useState<DayNote[]>([])
  const [logs, setLogs] = useState<ChangeLog[]>([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const [fontScale, setFontScaleState] = useState(() => {
    const saved = Number(localStorage.getItem(FONT_KEY))
    return saved >= 0.9 && saved <= 1.6 ? saved : 1
  })

  useEffect(() => {
    document.documentElement.style.setProperty('--fs', String(fontScale))
    localStorage.setItem(FONT_KEY, String(fontScale))
  }, [fontScale])

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3200)
  }, [])

  // ─── 로그인 상태 ──────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) {
        setMe(null)
        setSchedule(null); setShifts([]); setDayNotes([]); setLogs([])
        setReady(true)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // ─── 로그인 후 기준 데이터 ────────────────────────────────────────────────

  const loadBase = useCallback(async () => {
    if (!session) return
    try {
      const [p, m] = await Promise.all([fetchPosts(), fetchMembers()])
      setPosts(p); setMembers(m)
      setMe(m.find((x) => x.auth_user_id === session.user.id) ?? null)
      setError(null)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setReady(true)
    }
  }, [session])

  useEffect(() => { void loadBase() }, [loadBase])

  // ─── 그 달의 근무표 ───────────────────────────────────────────────────────

  const loadMonth = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const sched = await fetchScheduleForMonth(year, month)
      const [sh, notes, lg] = await Promise.all([
        fetchShifts(sched?.id ?? null), fetchDayNotes(sched?.id ?? null), fetchChangeLogs(150),
      ])
      setSchedule(sched); setShifts(sh); setDayNotes(notes); setLogs(lg)
      setError(null)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setLoading(false)
    }
  }, [session, year, month])

  useEffect(() => { void loadMonth() }, [loadMonth])

  // ─── 실시간 반영 ──────────────────────────────────────────────────────────
  // 누가 근무를 바꾸면 다른 사람 화면에서도 바로 최신으로 바뀐다.

  useEffect(() => {
    if (!session) return
    let timer: number | undefined
    const nudge = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { void loadMonth() }, 400)
    }
    const channel = supabase
      .channel('schedule-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, nudge)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'change_logs' }, nudge)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, nudge)
      .subscribe()
    return () => {
      window.clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [session, loadMonth])

  // 화면을 다시 켰을 때 최신으로 (휴대폰은 앱을 오래 백그라운드에 둔다)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void loadMonth() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadMonth])

  const memberIndex = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const postIndex = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts])

  const value: Ctx = {
    session, me, ready,
    posts, members,
    year, month,
    setMonth: (y, m) => { setYear(y); setMonthState(m) },
    schedule, shifts, dayNotes, logs,
    loading, error,
    refresh: async () => { await loadBase(); await loadMonth() },
    memberById: (id) => (id ? memberIndex.get(id) : undefined),
    postById: (id) => postIndex.get(id),
    fontScale, setFontScale: setFontScaleState,
    toast, showToast,
    signOut: async () => { await supabase.auth.signOut() },
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
