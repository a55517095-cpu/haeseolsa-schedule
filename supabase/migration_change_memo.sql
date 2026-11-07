-- ============================================================================
--  마이그레이션: 변경 이력 한 줄 메모
--
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--  (여러 번 실행해도 안전합니다)
--
--  무엇이 달라지나
--   변경 이력 카드마다 "누구와 왜 바꿨는지" 한 줄 메모를 남길 수 있습니다.
--   메모는 쓴 사람만 볼 수 있습니다. 교대 상대도, 관리자도 볼 수 없습니다.
-- ============================================================================

create table if not exists public.change_memos (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members(id) on delete cascade,
  -- 이력 카드 하나를 가리킨다: 교대는 swap_group_id, 나머지는 change_logs.id
  log_key    uuid not null,
  body       text not null check (char_length(body) between 1 and 100),
  updated_at timestamptz not null default now(),
  unique (member_id, log_key)
);

alter table public.change_memos enable row level security;

-- 내 메모만 읽는다 (관리자도 예외 없음)
drop policy if exists change_memos_read_own on public.change_memos;
create policy change_memos_read_own on public.change_memos
  for select to authenticated
  using (member_id = public.current_member_id());

-- 메모 쓰기·고치기·지우기: 빈 글이면 지운다
create or replace function public.set_change_memo(p_log_key uuid, p_body text)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  me_id uuid := public.current_member_id();
  v_body text := left(btrim(coalesce(p_body, '')), 100);
begin
  if me_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if v_body = '' then
    delete from public.change_memos where member_id = me_id and log_key = p_log_key;
    return;
  end if;

  insert into public.change_memos (member_id, log_key, body)
  values (me_id, p_log_key, v_body)
  on conflict (member_id, log_key)
    do update set body = excluded.body, updated_at = now();
end $fn$;
