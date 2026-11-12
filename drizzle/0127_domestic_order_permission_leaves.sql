--
-- ============================================================================
-- 내자 정리 권한을 잎 넷으로 쪼갠다 — **저장된 행 이사** (2026-11-12)
-- ============================================================================
-- 🔴 **표를 바꾸지 않는다.** drizzle-kit 은 이 판에서 "No schema changes" 라고 답했다
-- (실측 2026-11-12). 여기 있는 것은 전부 **손으로 적은 자료 이사**이고, 옮기는 것은
-- `role_permissions` 의 `area_key` 하나다.
--
-- ── 왜 필요한가 ─────────────────────────────────────────────────────────
-- 그 전까지 `domesticOrders` 는 하위 기능이 없어서 **메뉴 키 자체가 저장되는 잎**
-- 이었다. 2026-11-12 에 그 메뉴가 잎 넷(view · edit · lifecycle · approval)으로
-- 쪼개지면서 메뉴 키는 더 이상 잎이 아니다. 그냥 두면 옛 행은
-- `isPermissionLeafKey` 에 걸려 **읽는 쪽에서 통째로 버려지고**(queries/role-
-- permissions.ts), 그 역할은 **오류 한 줄 없이 조용히** 코드 기본값으로 되돌아간다.
-- 같은 표의 `inventory.stock` 행이 그렇게 죽어 있는 실물이다.
--
-- ── 🔴 0건이어도 정상이다 ───────────────────────────────────────────────
-- 운영 실측(2026-11-12): `area_key IN ('domesticOrders','miscCases','quotes')` 가
-- **0행**이다 — 운영은 전부 코드 기본값으로 돈다. 개발 DB 에는 1행이 있다.
-- 아래 문장들은 전부 `INSERT ... SELECT` 라 **원본이 0행이면 0행을 넣고 조용히
-- 끝난다.** 그래도 이 판을 빼지 않는 까닭: ① 개발 DB 의 그 1행이 안 옮겨지면 죽는다
-- ② 배포일까지 누가 저장하면 행이 생긴다 ③ 배포 시점의 운영을 미리 알 수 없다.
--
-- ── 🔴 무엇으로 바꿔 넣는가 — 「사다리를 그대로 펼친다」 ──────────────────
-- 옛 저장값 X 는 「이 역할의 내자 권한이 X 다」였고, 모든 관문이 `X >= 필요수준` 을
-- 물었다. 쪼갠 뒤 관문은 잎마다 **묻는 수준이 고정**돼 있다 — view 는 READ 만,
-- edit 는 WRITE 만, lifecycle 은 MANAGE 만, approval 은 READ 만 묻는다. 그래서
-- 아래 표가 **동작을 한 칸도 바꾸지 않는** 유일한 펼침이다:
--
--     X         view    edit    lifecycle   approval
--     NONE      NONE    NONE    NONE        NONE
--     READ      READ    NONE    NONE        READ
--     WRITE     READ    WRITE   NONE        READ
--     MANAGE    READ    WRITE   MANAGE      READ
--
--  · 🔴 **X 를 네 칸에 그대로 복사하지 않는다.** 복사해도 판정 결과는 같지만(관문이
--    묻는 수준이 고정이라), 권한 설정 화면의 드롭다운은 잎마다 **고를 수 있는 수준**이
--    정해져 있다(selectableLevelsOfLeaf — view 는 [접근 불가/읽기]뿐이다). 거기에
--    MANAGE 가 저장돼 있으면 화면이 고를 수 없는 값을 들고 있게 된다. 깎아 넣으면
--    사람이 보는 값과 저장된 값이 언제나 같다.
--  · 🔴 **NONE 행도 반드시 넣는다.** 안 넣으면 그 잎은 「저장값 없음」이 되어 **코드
--    기본값으로 떨어진다.** 예를 들어 X=READ 로 좁혀 둔 역할의 edit 행을 빠뜨리면
--    영업·엔지니어의 기본값 WRITE 가 되살아나 **권한이 넓어진다.** 좁히려고 저장해 둔
--    설정이 이사하면서 풀리는 셈이고, 그것은 아무도 신고하지 않는 종류의 사고다.
--  · 🔵 `updated_by` · `updated_at` 은 **옛 행의 것을 그대로** 물려준다. 이사는 사람이
--    한 결정이 아니므로 「누가 언제 정했나」는 원래 사람의 것이어야 한다.
--
-- ── 🔴 옛 행은 **지우지 않는다** ────────────────────────────────────────
-- 두 까닭이다. ① 되돌리기가 한 문장이 된다(아래). 지워 버리면 되돌릴 때 옛 값을
-- 어딘가에서 다시 만들어 내야 한다. ② 남아도 해롭지 않다 — 읽는 쪽이 잎이 아닌 키를
-- 거르므로 아무 판정에도 끼지 않는다(`inventory.stock` 과 같은 자리).
-- 🔵 권한 화면에서 그 역할을 한 번 저장하면 그 행은 저절로 정리된다
-- (mutations/role-permissions.ts 가 잎 목록 기준으로 다시 적는다).
--
-- ── 🔴 되돌리는 법 (이 판을 물릴 때 손으로 돌린다) ───────────────────────
--     DELETE FROM "role_permissions"
--      WHERE "area_key" IN ('domesticOrders.view', 'domesticOrders.edit',
--                           'domesticOrders.lifecycle', 'domesticOrders.approval');
--   옛 `domesticOrders` 행이 그대로 남아 있으므로 그 한 문장이면 이사 전 상태다.
--   🔴 **코드도 함께 되돌려야 한다** — 잎이 코드에 남아 있는 채로 행만 지우면 그
--   역할은 기본값으로 돈다(좁혀 둔 설정이 풀린다).
--
-- 🔵 `ON CONFLICT DO NOTHING` 은 **다시 돌려도 안전하게** 하려는 것이다(role,
-- area_key 에 유일 인덱스가 있다 — 0042). 새 잎에 이미 값이 저장돼 있으면 그쪽이
-- 이긴다: 사람이 나중에 정한 값을 이사가 덮어쓰면 안 된다.
-- ============================================================================
--
INSERT INTO "role_permissions" ("role", "area_key", "level", "updated_by", "updated_at")
SELECT "role",
       'domesticOrders.view',
       (CASE WHEN "level" = 'NONE' THEN 'NONE' ELSE 'READ' END)::"permission_level",
       "updated_by",
       "updated_at"
  FROM "role_permissions"
 WHERE "area_key" = 'domesticOrders'
ON CONFLICT ("role", "area_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "area_key", "level", "updated_by", "updated_at")
SELECT "role",
       'domesticOrders.edit',
       (CASE WHEN "level" IN ('WRITE', 'MANAGE') THEN 'WRITE' ELSE 'NONE' END)::"permission_level",
       "updated_by",
       "updated_at"
  FROM "role_permissions"
 WHERE "area_key" = 'domesticOrders'
ON CONFLICT ("role", "area_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "area_key", "level", "updated_by", "updated_at")
SELECT "role",
       'domesticOrders.lifecycle',
       (CASE WHEN "level" = 'MANAGE' THEN 'MANAGE' ELSE 'NONE' END)::"permission_level",
       "updated_by",
       "updated_at"
  FROM "role_permissions"
 WHERE "area_key" = 'domesticOrders'
ON CONFLICT ("role", "area_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "area_key", "level", "updated_by", "updated_at")
SELECT "role",
       'domesticOrders.approval',
       (CASE WHEN "level" = 'NONE' THEN 'NONE' ELSE 'READ' END)::"permission_level",
       "updated_by",
       "updated_at"
  FROM "role_permissions"
 WHERE "area_key" = 'domesticOrders'
ON CONFLICT ("role", "area_key") DO NOTHING;
