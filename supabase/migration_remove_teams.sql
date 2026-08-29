-- ============================================================================
--  마이그레이션: 조(1조/2조) 구분 없애기
--
--  이미 schema.sql / seed.sql 을 실행한 데이터베이스에 한 번만 적용하세요.
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하면 됩니다.
--  (여러 번 실행해도 안전합니다)
--
--  바뀌는 점
--   - teams 테이블이 사라집니다
--   - 근무지 10곳이 조 구분 없이 한 표에 모입니다
--   - 근무표는 한 달에 하나가 됩니다 (조별로 두 개가 아니라)
-- ============================================================================

-- --- 1. 같은 달에 조별로 나뉘어 있던 근무표를 하나로 합친다 -----------------
-- (아직 근무표를 등록하지 않았다면 아무 일도 일어나지 않습니다)

do $blk$
declare r record;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'schedules' and column_name = 'team_id'
  ) then
    return; -- 이미 적용된 상태
  end if;

  for r in
    select year, month,
           (array_agg(id order by created_at))[1] as keep_id,
           array_agg(id) as all_ids
      from public.schedules
     group by year, month
    having count(*) > 1
  loop
    update public.shifts      set schedule_id = r.keep_id
     where schedule_id = any(r.all_ids) and schedule_id <> r.keep_id;

    -- 날짜 메모는 한 날짜에 하나뿐이라, 합칠 때 겹치면 나중 것을 버린다
    delete from public.day_notes d
     where d.schedule_id = any(r.all_ids) and d.schedule_id <> r.keep_id
       and exists (select 1 from public.day_notes k
                    where k.schedule_id = r.keep_id and k.work_date = d.work_date);
    update public.day_notes   set schedule_id = r.keep_id
     where schedule_id = any(r.all_ids) and schedule_id <> r.keep_id;

    update public.change_logs set schedule_id = r.keep_id
     where schedule_id = any(r.all_ids) and schedule_id <> r.keep_id;

    delete from public.schedules where id = any(r.all_ids) and id <> r.keep_id;
  end loop;
end $blk$;

-- --- 2. 조 열 없애기 --------------------------------------------------------
-- 로그인 화면용 뷰가 members.team_id 를 쓰고 있으므로 먼저 내린다.

drop view if exists public.public_members;

alter table public.posts     drop column if exists team_id cascade;
alter table public.schedules drop column if exists team_id cascade;
alter table public.members   drop column if exists team_id cascade;

drop table if exists public.teams cascade;

-- 조가 없어졌으니 근무지 이름과 (연,월) 이 그 자체로 유일해야 한다
alter table public.posts     drop constraint if exists posts_name_key;
alter table public.posts     add  constraint posts_name_key unique (name);
alter table public.schedules drop constraint if exists schedules_year_month_key;
alter table public.schedules add  constraint schedules_year_month_key unique (year, month);

-- --- 3. 근무지 10곳을 한 표의 순서대로 정렬 ---------------------------------
insert into public.posts (name, sort_order) values
  ('시공원',       1),
  ('기당미술관',   2),
  ('서복전시관2',  3),
  ('탐방1',        4),
  ('탐방2',        5),
  ('소암기념관',   6),
  ('종합안내소',   7),
  ('서복전시관1',  8),
  ('거주지1',      9),
  ('거주지2',     10)
on conflict (name) do update set sort_order = excluded.sort_order, active = true;

-- --- 4. 로그인 화면용 공개 뷰 다시 만들기 -----------------------------------
create or replace view public.public_members as
  select id, name, login_code, weekend_only
  from public.members
  where active = true;

grant select on public.public_members to anon, authenticated;

-- --- 5. 근무표 일괄 등록 함수에서 조 인자 빼기 -------------------------------
drop function if exists public.import_schedule(int, int, int, jsonb, text);

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

-- --- 6. 주말 근무자 표시 바로잡기 -------------------------------------------
-- 종이 근무표의 파란 밑줄(주말 근무) 기준입니다.
update public.members set weekend_only = true
 where name in ('공윤경', '김은희', '김영선', '부경자', '오재영', '김희경');
