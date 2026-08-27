export type Team = { id: number; name: string }

export type Post = {
  id: string
  team_id: number
  name: string
  sort_order: number
  active: boolean
}

export type Member = {
  id: string
  auth_user_id: string | null
  login_code: string
  name: string
  team_id: number | null
  role: 'member' | 'admin'
  phone: string | null
  group_label: string | null
  weekend_only: boolean
  active: boolean
}

/** 로그인 전에 볼 수 있는 최소한의 정보 */
export type PublicMember = {
  id: string
  name: string
  team_id: number | null
  login_code: string
  weekend_only: boolean
}

export type Schedule = {
  id: string
  team_id: number
  year: number
  month: number
  memo: string | null
  created_at: string
  updated_at: string
}

export type Shift = {
  id: string
  schedule_id: string
  work_date: string // 'YYYY-MM-DD'
  post_id: string
  member_id: string | null
  is_closed: boolean
  changed: boolean
  note: string | null
  updated_at: string
}

export type ChangeAction = 'swap' | 'assign' | 'clear' | 'closed' | 'import' | 'revert'

export type ChangeLog = {
  id: string
  schedule_id: string | null
  swap_group_id: string | null
  action: ChangeAction
  shift_id: string | null
  work_date: string | null
  post_name: string | null
  before_member_id: string | null
  before_member_name: string | null
  after_member_id: string | null
  after_member_name: string | null
  actor_id: string | null
  actor_name: string | null
  detail: string | null
  reverted: boolean
  reverted_by_name: string | null
  reverted_at: string | null
  created_at: string
}

export type DayNote = {
  id: string
  schedule_id: string
  work_date: string
  body: string
}

/** 근무표를 등록할 때 주고받는 모양 (엑셀 / 직접입력 공통) */
export type ImportCell = { post: string; name: string; closed: boolean; uncertain?: boolean }
export type ImportRow = { date: string; cells: ImportCell[] }
