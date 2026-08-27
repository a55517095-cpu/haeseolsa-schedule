-- ============================================================================
--  해설사 근무편성표 - 기초 데이터 (조 / 근무지 / 해설사 명단)
--  schema.sql 을 먼저 실행한 뒤에 이 파일을 실행하세요.
--  명단은 2026년 7월 근무편성표 기준입니다. 나중에 앱의 [직원 관리]에서 고칠 수 있습니다.
-- ============================================================================

-- --- 조 ---------------------------------------------------------------------
insert into public.teams (id, name) values (1, '1조'), (2, '2조')
on conflict (id) do update set name = excluded.name;

-- --- 근무지 -----------------------------------------------------------------
insert into public.posts (team_id, name, sort_order) values
  (1, '시공원',       1),
  (1, '기당미술관',   2),
  (1, '서복전시관2',  3),
  (1, '탐방1',        4),
  (1, '탐방2',        5),
  (2, '소암기념관',   1),
  (2, '종합안내소',   2),
  (2, '서복전시관1',  3),
  (2, '거주지1',      4),
  (2, '거주지2',      5)
on conflict (team_id, name) do update set sort_order = excluded.sort_order;

-- --- 해설사 명단 -------------------------------------------------------------
-- login_code 는 시스템 내부용 식별자입니다. 사용자는 절대 입력하지 않고,
-- 로그인 화면에서 자기 이름 버튼을 누르기만 하면 됩니다.
insert into public.members (login_code, name, team_id, group_label, weekend_only, role) values
  -- 1조
  ('a01', '고혜자', 1, '시공원',     false, 'member'),
  ('a02', '김태순', 1, '시공원',     false, 'member'),
  ('a03', '문선미', 1, '시공원',     false, 'member'),
  ('a04', '박향란', 1, '시공원',     false, 'member'),
  ('a05', '김봉하', 1, '시공원',     false, 'member'),
  ('a06', '문상금', 1, '기당미술관', false, 'member'),
  ('a07', '문춘희', 1, '기당미술관', false, 'member'),
  ('a08', '정영자', 1, '기당미술관', false, 'member'),
  ('a09', '허은주', 1, '기당미술관', false, 'member'),
  ('a10', '공윤경', 1, '탐방',       true,  'member'),
  ('a11', '김은희', 1, '탐방',       true,  'member'),
  -- 2조
  ('b01', '강연희', 2, '소암기념관', false, 'member'),
  ('b02', '고보옥', 2, '소암기념관', false, 'member'),
  ('b03', '부의화', 2, '소암기념관', false, 'member'),
  ('b04', '이화영', 2, '소암기념관', false, 'member'),
  ('b05', '김명준', 2, '소암기념관', false, 'member'),
  ('b06', '민영경', 2, '종합안내소', false, 'member'),
  ('b07', '유점숙', 2, '종합안내소', false, 'member'),
  ('b08', '장인옥', 2, '종합안내소', false, 'member'),
  ('b09', '현경조', 2, '종합안내소', false, 'member'),
  ('b10', '김숙향', 2, '종합안내소', false, 'member'),
  ('b11', '김영선', 2, '거주지',     true,  'member'),
  ('b12', '부경자', 2, '거주지',     false, 'member'),
  ('b13', '오재영', 2, '거주지',     false, 'member'),
  ('b14', '김희경', 2, '거주지',     true,  'member'),
  -- 관리자 계정
  ('admin', '관리자', null, null, false, 'admin')
on conflict (login_code) do update
  set name         = excluded.name,
      team_id      = excluded.team_id,
      group_label  = excluded.group_label,
      weekend_only = excluded.weekend_only;

-- ============================================================================
--  마지막 단계: 첫 관리자 로그인 연결
--
--  1) Supabase 대시보드 > Authentication > Users > "Add user" > "Create new user"
--     - Email    : admin@guide.local          (.env 의 VITE_LOGIN_EMAIL_DOMAIN 과 맞출 것)
--     - Password : 0000jeju-guide-2026        (PIN 4자리 + VITE_PIN_PEPPER 를 붙여쓴 값)
--     - "Auto Confirm User" 체크
--  2) 그런 다음 아래 한 줄을 실행하세요.
-- ============================================================================

update public.members
   set auth_user_id = (select id from auth.users where email = 'admin@guide.local')
 where login_code = 'admin';
