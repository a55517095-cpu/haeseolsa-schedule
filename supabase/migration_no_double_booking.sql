-- ============================================================================
--  마이그레이션: 같은 날 두 곳에 배정되는 교대 막기
--
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--  (여러 번 실행해도 안전합니다)
--
--  무엇이 달라지나
--   - 교대한 결과 어느 한 쪽이 같은 날 두 곳에 서게 되면 거절합니다.
--   - 같은 날짜끼리의 교대(근무지만 맞바꾸기)는 그대로 됩니다.
--   - 관리자가 칸을 직접 지정하는 것은 막지 않습니다. (고치는 도중에는
--     잠시 겹칠 수 있어야 하므로)
-- ============================================================================

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

  -- --- 같은 날 두 곳에 서게 되는 교대는 거절한다 ---------------------------
  -- 날짜가 같은 교대(근무지만 맞바꾸기)는 겹칠 일이 없다.
  if a.work_date <> b.work_date then
    if exists (
      select 1 from public.shifts s
       where s.work_date = a.work_date
         and s.member_id = b.member_id
         and s.id <> a.id and s.id <> b.id
    ) then
      raise exception '%님은 %월 %일에 이미 다른 근무가 있어 바꿀 수 없습니다.',
        b_name,
        extract(month from a.work_date)::int,
        extract(day   from a.work_date)::int;
    end if;

    if exists (
      select 1 from public.shifts s
       where s.work_date = b.work_date
         and s.member_id = a.member_id
         and s.id <> a.id and s.id <> b.id
    ) then
      raise exception '%님은 %월 %일에 이미 다른 근무가 있어 바꿀 수 없습니다.',
        a_name,
        extract(month from b.work_date)::int,
        extract(day   from b.work_date)::int;
    end if;
  end if;

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
