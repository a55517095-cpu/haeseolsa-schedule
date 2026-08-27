-- ============================================================================
--  해설사 근무편성표 - 데이터베이스 스키마
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--  (여러 번 실행해도 안전하도록 작성되어 있습니다)
-- ============================================================================

-- --- 1. 테이블 --------------------------------------------------------------

-- 조 (1조 / 2조)
create table if not exists public.teams (
  id   int  primary key,
  name text not null
);

-- 근무지 (시공원, 기당미술관, 소암기념관 ...)
create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  team_id    int  not null references public.teams(id) on delete cascade,
  name       text not null,
  sort_order int  not null default 0,
  active     boolean not null default true,
  unique (team_id, name)
);

-- 해설사
create table if not exists public.members (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  login_code   text unique not null,           -- 로그인 계정 식별자 (영문/숫자)
  name         text not null,
  team_id      int  references public.teams(id) on delete set null,
  role         text not null default 'member' check (role in ('member','admin')),
  phone        text,
  group_label  text,                           -- 근무표 상단 명단 구분
  weekend_only boolean not null default false, -- 주말 근무자 (근무표의 밑줄 표시)
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- 월별 근무편성표
create table if not exists public.schedules (
  id         uuid primary key default gen_random_uuid(),
  team_id    int  not null references public.teams(id) on delete cascade,
  year       int  not null,
  month      int  not null check (month between 1 and 12),
  memo       text,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, year, month)
);

-- 개별 근무 배정 (근무표의 칸 하나)
create table if not exists public.shifts (
  id          uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  work_date   date not null,
  post_id     uuid not null references public.posts(id) on delete cascade,
  member_id   uuid references public.members(id) on delete set null,
  is_closed   boolean not null default false,  -- 휴무
  changed     boolean not null default false,  -- 최초 편성에서 변경됨 (종이 근무표의 녹색 표시)
  note        text,
  updated_at  timestamptz not null default now(),
  unique (schedule_id, work_date, post_id)
);

create index if not exists shifts_member_date_idx on public.shifts (member_id, work_date);
create index if not exists shifts_schedule_date_idx on public.shifts (schedule_id, work_date);

-- 날짜별 안내 메모 (특별탐방 등)
create table if not exists public.day_notes (
  id          uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  work_date   date not null,
  body        text not null,
  unique (schedule_id, work_date)
);

-- 변경 이력 (되돌리기의 근거)
create table if not exists public.change_logs (
  id                 uuid primary key default gen_random_uuid(),
  schedule_id        uuid references public.schedules(id) on delete cascade,
  swap_group_id      uuid,        -- 교대 한 건은 두 줄이 같은 값을 가진다
  action             text not null check (action in ('swap','assign','clear','closed','import','revert')),
  shift_id           uuid references public.shifts(id) on delete set null,
  work_date          date,
  post_name          text,
  before_member_id   uuid,
  before_member_name text,
  after_member_id    uuid,
  after_member_name  text,
  actor_id           uuid,
  actor_name         text,
  detail             text,
  reverted           boolean not null default false,
  reverted_by_name   text,
  reverted_at        timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists change_logs_created_idx on public.change_logs (created_at desc);
create index if not exists change_logs_schedule_idx on public.change_logs (schedule_id, created_at desc);

-- --- 2. 로그인 화면용 공개 뷰 ----------------------------------------------
-- 로그인 전에는 아무 데이터도 못 읽으므로, 이름 목록만 볼 수 있는 뷰를 연다.
-- (전화번호, 권한 등 민감한 열은 제외)
create or replace view public.public_members as
  select id, name, team_id, login_code, weekend_only
  from public.members
  where active = true;

grant select on public.public_members to anon, authenticated;

-- 로그인 화면의 조 선택 버튼용 (조 이름은 민감한 정보가 아니다)
drop policy if exists teams_public_read on public.teams;
create policy teams_public_read on public.teams for select to anon using (true);

-- --- 3. 도우미 함수 ---------------------------------------------------------

create or replace function public.current_member_id()
returns uuid language sql stable security definer set search_path = public as $fn$
  select id from public.members where auth_user_id = auth.uid()
$fn$;

create or replace function public.current_member_name()
returns text language sql stable security definer set search_path = public as $fn$
  select name from public.members where auth_user_id = auth.uid()
$fn$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select role = 'admin' from public.members where auth_user_id = auth.uid()), false)
$fn$;

-- --- 4. RLS (행 수준 보안) --------------------------------------------------
-- 원칙: 로그인한 사람은 모두 읽기는 자유, 쓰기는 아래 함수를 통해서만.
--       관리자만 직접 쓰기가 가능하다.

alter table public.teams       enable row level security;
alter table public.posts       enable row level security;
alter table public.members     enable row level security;
alter table public.schedules   enable row level security;
alter table public.shifts      enable row level security;
alter table public.day_notes   enable row level security;
alter table public.change_logs enable row level security;

do $blk$
declare t text;
begin
  foreach t in array array['teams','posts','members','schedules','shifts','day_notes','change_logs'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin_write', t);
  end loop;
end $blk$;

-- 본인 전화번호는 스스로 고칠 수 있게 (권한 열은 못 건드림)
drop policy if exists members_update_self on public.members;
create policy members_update_self on public.members
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid() and role = 'member');

-- --- 5. 근무 교대 (핵심 기능) ----------------------------------------------
-- 두 칸의 담당자를 서로 맞바꾸고, 이력 두 줄을 같은 swap_group_id 로 남긴다.
-- 한 번의 트랜잭션이므로 한쪽만 바뀌는 사고가 생기지 않는다.

create or replace function public.swap_shifts(p_shift_a uuid, p_shift_b uuid)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  a public.shifts%rowtype;
  b public.shifts%rowtype;
  a_post text; b_post text;
  a_name text; b_name text;
  me_id uuid := public.current_member_id();
  me_name text := public.current_member_name();
  grp uuid := gen_random_uuid();
begin
  if me_id is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if p_shift_a = p_shift_b then
    raise exception '같은 근무끼리는 바꿀 수 없습니다.';
  end if;

  -- 두 행을 잠가서 동시에 다른 사람이 손대는 것을 막는다
  select * into a from public.shifts where id = p_shift_a for update;
  select * into b from public.shifts where id = p_shift_b for update;

  if a.id is null or b.id is null then
    raise exception '근무 정보를 찾을 수 없습니다.';
  end if;
  if a.is_closed or b.is_closed then
    raise exception '휴무는 교대할 수 없습니다.';
  end if;
  if a.member_id is null or b.member_id is null then
    raise exception '담당자가 비어 있는 근무는 교대할 수 없습니다. 관리자에게 문의하세요.';
  end if;
  if a.member_id = b.member_id then
    raise exception '같은 사람의 근무끼리는 바꿀 수 없습니다.';
  end if;

  -- 자유 변경: 본인이 관련된 교대이거나, 관리자이면 허용
  if not public.is_admin() and me_id not in (a.member_id, b.member_id) then
    raise exception '본인이 포함된 근무만 바꿀 수 있습니다.';
  end if;

  select name into a_post from public.posts where id = a.post_id;
  select name into b_post from public.posts where id = b.post_id;
  select name into a_name from public.members where id = a.member_id;
  select name into b_name from public.members where id = b.member_id;

  update public.shifts set member_id = b.member_id, changed = true, updated_at = now() where id = a.id;
  update public.shifts set member_id = a.member_id, changed = true, updated_at = now() where id = b.id;

  insert into public.change_logs
    (schedule_id, swap_group_id, action, shift_id, work_date, post_name,
     before_member_id, before_member_name, after_member_id, after_member_name, actor_id, actor_name)
  values
    (a.schedule_id, grp, 'swap', a.id, a.work_date, a_post, a.member_id, a_name, b.member_id, b_name, me_id, me_name),
    (b.schedule_id, grp, 'swap', b.id, b.work_date, b_post, b.member_id, b_name, a.member_id, a_name, me_id, me_name);

  return grp;
end $fn$;

-- --- 6. 관리자용 단일 칸 지정 ----------------------------------------------

create or replace function public.set_shift_member(p_shift uuid, p_member uuid)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  s public.shifts%rowtype;
  post text; before_name text; after_name text;
  me_id uuid := public.current_member_id();
  me_name text := public.current_member_name();
begin
  if not public.is_admin() then
    raise exception '관리자만 근무를 지정할 수 있습니다.';
  end if;

  select * into s from public.shifts where id = p_shift for update;
  if s.id is null then raise exception '근무 정보를 찾을 수 없습니다.'; end if;

  select name into post from public.posts where id = s.post_id;
  select name into before_name from public.members where id = s.member_id;
  select name into after_name from public.members where id = p_member;

  update public.shifts
     set member_id = p_member, is_closed = false, changed = true, updated_at = now()
   where id = s.id;

  insert into public.change_logs
    (schedule_id, action, shift_id, work_date, post_name,
     before_member_id, before_member_name, after_member_id, after_member_name, actor_id, actor_name)
  values
    (s.schedule_id, case when p_member is null then 'clear' else 'assign' end,
     s.id, s.work_date, post, s.member_id, before_name, p_member, after_name, me_id, me_name);
end $fn$;

create or replace function public.set_shift_closed(p_shift uuid, p_closed boolean)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  s public.shifts%rowtype;
  post text; before_name text;
  me_id uuid := public.current_member_id();
  me_name text := public.current_member_name();
begin
  if not public.is_admin() then
    raise exception '관리자만 휴무를 지정할 수 있습니다.';
  end if;

  select * into s from public.shifts where id = p_shift for update;
  if s.id is null then raise exception '근무 정보를 찾을 수 없습니다.'; end if;

  select name into post from public.posts where id = s.post_id;
  select name into before_name from public.members where id = s.member_id;

  update public.shifts
     set is_closed = p_closed,
         member_id = case when p_closed then null else s.member_id end,
         changed = true, updated_at = now()
   where id = s.id;

  insert into public.change_logs
    (schedule_id, action, shift_id, work_date, post_name,
     before_member_id, before_member_name, actor_id, actor_name, detail)
  values
    (s.schedule_id, 'closed', s.id, s.work_date, post, s.member_id, before_name, me_id, me_name,
     case when p_closed then '휴무로 지정' else '휴무 해제' end);
end $fn$;

-- --- 7. 되돌리기 ------------------------------------------------------------
-- 교대(swap)는 두 줄이 한 쌍이므로 짝까지 함께 되돌린다.

create or replace function public.revert_change(p_log uuid)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  lg public.change_logs%rowtype;
  row_log public.change_logs%rowtype;
  me_id uuid := public.current_member_id();
  me_name text := public.current_member_name();
begin
  if me_id is null then raise exception '로그인이 필요합니다.'; end if;

  select * into lg from public.change_logs where id = p_log;
  if lg.id is null then raise exception '변경 이력을 찾을 수 없습니다.'; end if;
  if lg.reverted then raise exception '이미 되돌린 변경입니다.'; end if;
  if lg.action = 'revert' then raise exception '되돌리기 기록은 다시 되돌릴 수 없습니다.'; end if;
  if lg.action = 'import' then raise exception '근무표 등록은 되돌릴 수 없습니다. 근무표를 다시 등록하세요.'; end if;

  -- 되돌릴 수 있는 사람: 관리자, 또는 그 변경을 한 본인
  if not public.is_admin() and lg.actor_id is distinct from me_id then
    raise exception '본인이 한 변경만 되돌릴 수 있습니다. 관리자에게 문의하세요.';
  end if;

  -- 한 쌍(또는 단독)의 모든 줄을 되돌린다
  for row_log in
    select * from public.change_logs
    where (lg.swap_group_id is not null and swap_group_id = lg.swap_group_id)
       or (lg.swap_group_id is null and id = lg.id)
  loop
    if row_log.reverted then continue; end if;

    update public.shifts
       set member_id  = row_log.before_member_id,
           is_closed  = case when row_log.action = 'closed'
                             then not coalesce(is_closed, false) else is_closed end,
           updated_at = now()
     where id = row_log.shift_id;

    update public.change_logs
       set reverted = true, reverted_by_name = me_name, reverted_at = now()
     where id = row_log.id;

    insert into public.change_logs
      (schedule_id, action, shift_id, work_date, post_name,
       before_member_id, before_member_name, after_member_id, after_member_name,
       actor_id, actor_name, detail)
    values
      (row_log.schedule_id, 'revert', row_log.shift_id, row_log.work_date, row_log.post_name,
       row_log.after_member_id, row_log.after_member_name,
       row_log.before_member_id, row_log.before_member_name,
       me_id, me_name, '변경을 되돌림');
  end loop;
end $fn$;

-- --- 8. 근무표 일괄 등록 (엑셀 / 직접입력 공통) ----------------------
-- p_rows 예시:
-- [{"date":"2026-07-01","cells":[{"post":"시공원","name":"박향란"},
--                                {"post":"기당미술관","closed":true}]}, ...]

create or replace function public.import_schedule(
  p_team int, p_year int, p_month int, p_rows jsonb, p_memo text default null
)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  sched_id uuid;
  row_json jsonb;
  cell jsonb;
  d date;
  v_post_id uuid;
  v_member_id uuid;
  v_closed boolean;
  me_id uuid := public.current_member_id();
  me_name text := public.current_member_name();
  cnt int := 0;
begin
  if not public.is_admin() then
    raise exception '관리자만 근무표를 등록할 수 있습니다.';
  end if;

  insert into public.schedules (team_id, year, month, memo, created_by)
  values (p_team, p_year, p_month, p_memo, me_id)
  on conflict (team_id, year, month)
    do update set memo = coalesce(excluded.memo, public.schedules.memo), updated_at = now()
  returning id into sched_id;

  for row_json in select * from jsonb_array_elements(p_rows) loop
    d := (row_json->>'date')::date;
    for cell in select * from jsonb_array_elements(row_json->'cells') loop
      select id into v_post_id from public.posts
        where team_id = p_team and name = (cell->>'post');
      if v_post_id is null then
        raise exception '근무지 "%" 를 찾을 수 없습니다. 근무지 이름을 확인하세요.', (cell->>'post');
      end if;

      v_closed := coalesce((cell->>'closed')::boolean, false);
      v_member_id := null;
      if not v_closed and coalesce(cell->>'name','') <> '' then
        select id into v_member_id from public.members
          where name = (cell->>'name') and active = true
          order by (team_id = p_team) desc limit 1;
        if v_member_id is null then
          raise exception '해설사 "%" 를 명단에서 찾을 수 없습니다. 직원 관리에서 먼저 등록하세요.', (cell->>'name');
        end if;
      end if;

      insert into public.shifts (schedule_id, work_date, post_id, member_id, is_closed, changed)
      values (sched_id, d, v_post_id, v_member_id, v_closed, false)
      on conflict (schedule_id, work_date, post_id)
        do update set member_id  = excluded.member_id,
                      is_closed  = excluded.is_closed,
                      changed    = false,
                      updated_at = now();
      cnt := cnt + 1;
    end loop;
  end loop;

  insert into public.change_logs (schedule_id, action, actor_id, actor_name, detail)
  values (sched_id, 'import', me_id, me_name,
          format('%s년 %s월 근무표 등록 (%s칸)', p_year, p_month, cnt));

  return sched_id;
end $fn$;

-- --- 9. 실시간 반영 ---------------------------------------------------------
do $blk$
begin
  begin execute 'alter publication supabase_realtime add table public.shifts';      exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.change_logs'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.schedules';   exception when others then null; end;
end $blk$;
