-- ============================================================================
--  마이그레이션: 최초 근무표 보관 · 근무 변경 알림
--
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--  (여러 번 실행해도 안전합니다)
--  migration_handover.sql 을 아직 실행하지 않았다면 그것부터 실행하세요.
--
--  무엇이 달라지나
--   1. 근무표를 등록한 순간의 담당자(최초 근무표)를 칸마다 따로 보관합니다.
--      이미 등록된 근무표는 변경 이력을 거슬러 올라가 처음 모습을 복원합니다.
--   2. 해설사마다 "변경 알림을 어디까지 확인했는지"를 기록합니다.
--      다른 사람이 내 근무를 바꾸면, 다음에 앱을 열 때 알림창이 뜹니다.
-- ============================================================================

-- --- 1. 최초 근무표 ---------------------------------------------------------

alter table public.shifts add column if not exists orig_member_id uuid
  references public.members(id) on delete set null;
alter table public.shifts add column if not exists orig_closed boolean;

-- 이미 있는 칸: 마지막 등록 이후 그 칸에 처음 일어난 변경의 "변경 전" 이 최초 모습이다.
-- 변경이 없던 칸은 지금 모습이 곧 최초 모습이다.
with last_import as (
  select schedule_id, max(created_at) as at
    from public.change_logs
   where action = 'import'
   group by schedule_id
), first_change as (
  select distinct on (c.shift_id)
         c.shift_id, c.action, c.before_member_id, c.detail
    from public.change_logs c
    left join last_import li on li.schedule_id = c.schedule_id
   where c.shift_id is not null
     and c.action not in ('import', 'revert')
     and (li.at is null or c.created_at > li.at)
   order by c.shift_id, c.created_at, c.id
)
update public.shifts s
   set orig_member_id = case when fc.shift_id is null then s.member_id else fc.before_member_id end,
       orig_closed    = case
                          when fc.shift_id is null then s.is_closed
                          when fc.action = 'closed' then coalesce(fc.detail = '휴무 해제', false)
                          else false
                        end
  from public.shifts s2
  left join first_change fc on fc.shift_id = s2.id
 where s.id = s2.id
   and s.orig_closed is null;

-- 근무표 등록 함수: 등록할 때 최초 모습도 함께 적는다
create or replace function public.import_schedule(
  p_year int, p_month int, p_rows jsonb, p_memo text default null
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

  insert into public.schedules (year, month, memo, created_by)
  values (p_year, p_month, p_memo, me_id)
  on conflict (year, month)
    do update set memo = coalesce(excluded.memo, public.schedules.memo), updated_at = now()
  returning id into sched_id;

  for row_json in select * from jsonb_array_elements(p_rows) loop
    d := (row_json->>'date')::date;
    for cell in select * from jsonb_array_elements(row_json->'cells') loop
      select id into v_post_id from public.posts where name = (cell->>'post');
      if v_post_id is null then
        raise exception '근무지 "%" 를 찾을 수 없습니다. 근무지 이름을 확인하세요.', (cell->>'post');
      end if;

      v_closed := coalesce((cell->>'closed')::boolean, false);
      v_member_id := null;
      if not v_closed and coalesce(cell->>'name','') <> '' then
        select id into v_member_id from public.members
          where name = (cell->>'name') and active = true
          order by created_at limit 1;
        if v_member_id is null then
          raise exception '해설사 "%" 를 명단에서 찾을 수 없습니다. 직원 관리에서 먼저 등록하세요.', (cell->>'name');
        end if;
      end if;

      insert into public.shifts
        (schedule_id, work_date, post_id, member_id, is_closed, changed, orig_member_id, orig_closed)
      values (sched_id, d, v_post_id, v_member_id, v_closed, false, v_member_id, v_closed)
      on conflict (schedule_id, work_date, post_id)
        do update set member_id      = excluded.member_id,
                      is_closed      = excluded.is_closed,
                      changed        = false,
                      orig_member_id = excluded.orig_member_id,
                      orig_closed    = excluded.orig_closed,
                      updated_at     = now();
      cnt := cnt + 1;
    end loop;
  end loop;

  insert into public.change_logs (schedule_id, action, actor_id, actor_name, detail)
  values (sched_id, 'import', me_id, me_name,
          format('%s년 %s월 근무표 등록 (%s칸)', p_year, p_month, cnt));

  return sched_id;
end $fn$;

-- --- 2. 근무 변경 알림 ------------------------------------------------------

alter table public.members add column if not exists notice_seen_at timestamptz;

-- 알림창에서 [확인] 을 누르면 그 시각까지의 알림은 다시 띄우지 않는다
create or replace function public.mark_changes_seen(p_until timestamptz)
returns void
language sql security definer set search_path = public as $fn$
  update public.members
     set notice_seen_at = greatest(coalesce(notice_seen_at, '-infinity'::timestamptz),
                                   least(p_until, now()))
   where auth_user_id = auth.uid()
$fn$;
