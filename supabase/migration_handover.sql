-- ============================================================================
--  마이그레이션: 근무가 없는 사람과도 바꾸기 (근무 넘기기)
--
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--  (여러 번 실행해도 안전합니다)
--
--  무엇이 달라지나
--   1. 근무를 서로 맞바꾸는 것 말고, 그 날 근무가 없는 사람에게
--      내 근무를 넘기는 것이 가능해집니다. (반대로 내가 남의 근무를
--      대신 받아오는 것도 같은 함수로 처리됩니다)
--   2. 되돌리기를 할 수 있는 사람이 넓어집니다.
--      전에는 "그 변경을 한 사람"만 되돌릴 수 있었는데,
--      이제는 그 변경에 이름이 오르내린 사람이면 누구나 되돌릴 수 있습니다.
--      (바꿔준 근무를 되돌리고 싶은 쪽이 대부분 상대방이기 때문)
-- ============================================================================

-- --- 1. 이력에 '근무 넘김' 을 적을 수 있게 한다 -----------------------------

-- 제약 이름이 다를 수 있으므로 action 을 검사하는 제약을 찾아 지운 뒤 다시 건다
do $blk$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.change_logs'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%swap%'
  loop
    execute format('alter table public.change_logs drop constraint %I', c.conname);
  end loop;
end $blk$;

alter table public.change_logs add constraint change_logs_action_check
  check (action in ('swap','handover','assign','clear','closed','import','revert'));

-- --- 2. 근무 넘기기 ---------------------------------------------------------
-- 내 근무를 그 날 비어 있는 사람에게 넘긴다. 되돌아오는 근무는 없다.
-- p_member 가 나 자신이면 "남의 근무를 내가 대신 맡는다"가 된다.

create or replace function public.handover_shift(p_shift uuid, p_member uuid)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  s public.shifts%rowtype;
  s_post text; from_name text; to_name text;
  to_active boolean;
  me_id uuid := public.current_member_id();
  me_name text := public.current_member_name();
  log_id uuid;
begin
  if me_id is null then raise exception '로그인이 필요합니다.'; end if;
  if p_member is null then raise exception '근무를 맡을 사람을 골라주세요.'; end if;

  -- 다른 사람이 같은 칸을 동시에 건드리지 못하게 잠근다
  select * into s from public.shifts where id = p_shift for update;

  if s.id is null then raise exception '근무 정보를 찾을 수 없습니다.'; end if;
  if s.is_closed then raise exception '휴무는 넘길 수 없습니다.'; end if;
  if s.member_id is null then
    raise exception '담당자가 비어 있는 근무입니다. 관리자에게 문의하세요.';
  end if;
  if s.member_id = p_member then raise exception '이미 그 사람의 근무입니다.'; end if;

  select name, active into to_name, to_active from public.members where id = p_member;
  if to_name is null then raise exception '해설사를 찾을 수 없습니다.'; end if;
  if not to_active then
    raise exception '쉬고 있는 해설사에게는 근무를 넘길 수 없습니다.';
  end if;

  -- 내 근무를 남에게 넘기거나, 남의 근무를 내가 받는 것만 허용한다
  if not public.is_admin() and me_id not in (s.member_id, p_member) then
    raise exception '본인이 포함된 근무만 바꿀 수 있습니다.';
  end if;

  -- 받는 사람이 그 날 이미 다른 곳에 서 있으면 거절한다
  if exists (
    select 1 from public.shifts x
     where x.work_date = s.work_date and x.member_id = p_member and x.id <> s.id
  ) then
    raise exception '%님은 %월 %일에 이미 다른 근무가 있습니다.',
      to_name, extract(month from s.work_date)::int, extract(day from s.work_date)::int;
  end if;

  select name into s_post from public.posts where id = s.post_id;
  select name into from_name from public.members where id = s.member_id;

  update public.shifts
     set member_id = p_member, changed = true, updated_at = now()
   where id = s.id;

  insert into public.change_logs
    (schedule_id, action, shift_id, work_date, post_name,
     before_member_id, before_member_name, after_member_id, after_member_name,
     actor_id, actor_name, detail)
  values
    (s.schedule_id, 'handover', s.id, s.work_date, s_post,
     s.member_id, from_name, p_member, to_name, me_id, me_name,
     format('%s 님의 근무를 %s 님이 맡음', from_name, to_name))
  returning id into log_id;

  return log_id;
end $fn$;

-- --- 3. 되돌리기: 그 변경에 관련된 사람이면 누구나 -------------------------

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
  if lg.action = 'import' then
    raise exception '근무표 등록은 되돌릴 수 없습니다. 근무표를 다시 등록하세요.';
  end if;

  -- 되돌릴 수 있는 사람: 관리자, 그 변경을 한 본인,
  -- 또는 그 변경에서 근무를 주거나 받은 사람
  if not public.is_admin()
     and lg.actor_id is distinct from me_id
     and not exists (
       select 1 from public.change_logs c
        where ((lg.swap_group_id is not null and c.swap_group_id = lg.swap_group_id)
            or (lg.swap_group_id is null and c.id = lg.id))
          and me_id in (c.before_member_id, c.after_member_id)
     )
  then
    raise exception '본인이 포함된 변경만 되돌릴 수 있습니다. 관리자에게 문의하세요.';
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
