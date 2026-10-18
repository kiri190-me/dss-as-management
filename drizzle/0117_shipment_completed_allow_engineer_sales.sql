-- 출하 완료를 누를 수 있는 역할에 담당 엔지니어(AS_ENGINEER)와 영업(SALES)을 더한다.
--
-- 2026-10-18 사용자 결정이다. 다음 조각에서 「내자 정리의 완료 처리를 누르면 그
-- 수리건이 출하 완료가 된다」를 만드는데, 내자 정리를 쓰는 사람이 담당 엔지니어와
-- 영업이다. 지금의 역할 목록으로는 그 연동이 쓰는 사람 전원에게서 막힌다.
--
-- ── 🔴 부수 효과를 먼저 적는다 ────────────────────────────────────────────
-- 이 변경이 듣는 곳은 내자 정리만이 아니다. 수리건 화면의 [출하 완료] 단추도
-- 같은 workflow_transitions.allowed_roles 를 보므로, 담당 엔지니어와 영업에게
-- 그 단추가 **함께 열린다.** 의도한 결과이며, 인가 경계를 넓히는 변경이라는
-- 뜻이다. 되돌리려면 같은 줄들에서 두 역할을 다시 빼야 한다.
--
-- ── 왜 발행된 판만이 아니라 전부인가 ──────────────────────────────────────
-- 진행 중인 수리건은 접수 당시의 워크플로 판을 끝까지 쓴다 — 아카이브된 옛 판에
-- 아직 걸려 있는 건이 있다. 발행된 판만 고치면 옛 판을 쓰는 건에서는 여전히
-- 막히고, 그 실패가 더 조용하다(오류가 아니라 단추가 안 보일 뿐이다). 그래서
-- 판의 상태(DRAFT / PUBLISHED / ARCHIVED)와 무관하게 action_code 가
-- 'SHIPMENT_COMPLETED' 인 줄을 전부 고친다.
-- 개발 DB 실측(2026-10-18): 22줄 = 발행 6 + 아카이브 14 + 초안 2.
--
-- ── 더하기만 한다, 중복 없이 ──────────────────────────────────────────────
-- 기존 역할은 하나도 빼지 않는다. INVENTORY_MANAGER 가 들어 있던 줄은 그대로 둔
-- 채 둘을 보탤 뿐이다. 이미 AS_ENGINEER 가 들어 있는 줄도 있어서(개발 DB 2줄)
-- 그냥 이어 붙이면 같은 역할이 배열에 두 번 들어간다 — 역할 검사 자체는 통과
-- 하지만 워크플로 화면의 역할 목록에 같은 이름이 두 번 뜬다. 그래서 DISTINCT 로
-- 합친다. 두 번 돌려도 결과가 같고, WHERE 의 마지막 조건이 이미 둘 다 들어 있는
-- 줄은 아예 건드리지 않는다.
--
-- ── 차례는 role_code 의 선언 차례다 ───────────────────────────────────────
-- array_agg(DISTINCT r ORDER BY r) 의 r 은 enum 이라 알파벳순이 아니라 선언 차례
-- (SUPER_ADMIN, ADMIN, AS_ENGINEER, SALES, INVENTORY_MANAGER)로 정렬된다. 이는
-- transition-definitions.ts 가 이미 쓰고 있는 차례와 같다. 배열 차례에 기대는
-- 코드는 없다 — 읽는 쪽은 권한 검사(집합 포함 여부, permissions.ts)와 화면의
-- join(", ") 표시뿐이고, DB↔TS 대조 시험은 양쪽을 정렬해 견준다.
--
-- ── 짝이 있다 ─────────────────────────────────────────────────────────────
-- 같은 규칙이 src/lib/domain/local/workflow/transition-definitions.ts 에도 있다.
-- 새 환경을 세울 때 scripts/migrate-workflow-rules-to-db.ts 가 그 표를 읽어 DB 에
-- 심고, 둘이 어긋나면 불일치를 외친다(그 스크립트의 1:1 대조,
-- src/lib/db/workflow-rules-parity.integration.test.ts). 그래서 그쪽 6줄도 같은
-- 커밋에서 함께 고쳤다. 한쪽만 고치면 조용히 갈라진다.

UPDATE "workflow_transitions" AS "t"
SET "allowed_roles" = (
      SELECT array_agg(DISTINCT "r" ORDER BY "r")
      FROM unnest("t"."allowed_roles" || ARRAY['AS_ENGINEER', 'SALES']::"role_code"[]) AS "r"
    ),
    "updated_at" = now()
WHERE "t"."action_code" = 'SHIPMENT_COMPLETED'
  AND NOT (
    'AS_ENGINEER' = ANY ("t"."allowed_roles")
    AND 'SALES' = ANY ("t"."allowed_roles")
  );
