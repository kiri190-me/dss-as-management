# 워크플로 기본 틀 편집 — 설계안

_2026-08-18 작성. 구현 착수 전 승인 대기 문서. 확정 사항이 아니라 **제안**이며,
§3의 결정 항목에 답이 나와야 §7 구현을 시작할 수 있다._

## 1. 요구사항

사용자 요청: **"워크플로의 기본 틀을 추가·수정할 수 있게 해달라. A/S 업무 메뉴 아래
새 메뉴로."**

여기서 "기본 틀"은 접수 건이 따라 흘러가는 단계 구성과 그 사이 이동 규칙 전체를
말한다. 구체적으로 네 가지다.

1. 어떤 **단계**가 있는가 (순서, 이름)
2. 각 단계에서 **어디로 갈 수 있는가** (정방향/교정 반환)
3. 그 이동을 **누가** 할 수 있는가 (역할, 담당 엔지니어 여부, 사유 필수 여부)
4. 이동에 **승인**이 필요한가 (수리 검수 / 최종 출하)

## 2. 현재 구조 — 왜 UI만 만들면 안 되는가

**규칙이 DB가 아니라 TypeScript에 하드코딩되어 있다.**

| 무엇 | 어디에 | 규모 |
|---|---|---|
| 단계의 존재·순서·이름 | **DB** `workflow_steps` | 115행 / 10 워크플로 |
| 어디서 어디로 갈 수 있는가 | `transition-definitions.ts` | **183행** |
| 단계 → 접수 상태(RepairStatus) | `step-status-map.ts` | 단계마다 1건 |
| 단계 → 담당 분류(기술/영업/부품출하) | `step-category.ts` | 단계마다 1건 |

DB 모드 mutation(`workflow-transitions.ts:147`)도 이 TS 표를 조회한다. 파일 주석이
못 박아 두었다 — *"이 표가 합법적인 전이의 유일한 출처다."*

따라서 **DB의 `workflow_steps`를 편집하는 UI만 만들면 앱 동작은 바뀌지 않는다.**
새로 만든 단계는 전이표에 행이 없으므로 들어갈 수도 나올 수도 없는 고립 단계가 되고,
상태 매핑도 없어 그 단계에 놓인 접수 건은 목록·대시보드를 읽을 때마다
`UnmappedWorkflowStepError`로 화면 전체를 깨뜨린다.

**즉 이 작업의 본론은 UI가 아니라 "전이 엔진을 DB 기반으로 옮기는 것"이다.**

### 2.1 지금 두 소스는 일치한다 (측정값)

이관 전에 실제로 대조했다.

- DB 단계 중 상태 매핑이 없는 것: **0**
- TS 전이가 참조하는데 DB에 없는 단계: **0**
- 분류가 없는 단계: 17 — 전부 `product_intake`(도달 불가 단계)와
  `shipment_completed`(종료 단계). 의도된 공백이다.
- 전이가 하나도 없는 단계: 13 — 위 + `PENDING_*` 워크플로의 `intake_inspection`.
  유·무상 미확정 건은 애초에 워크플로를 진행할 수 없다(mutation의
  `BILLING_DECISION_REQUIRED` 가드와 일치).

**두 소스가 어긋나 있지 않으므로, TS 표 → DB 이관은 기계적이고 검증 가능한 변환이다.**
이관 마이그레이션이 만들어낸 DB 행이 TS 표와 1:1인지 테스트로 고정할 수 있다(§7 Phase 1).

### 2.2 이미 있는 자산

바닥부터 만들 필요가 없다.

- `workflow_versions`에 **DRAFT / PUBLISHED / ARCHIVED + is_current**가 이미 있고,
  "템플릿당 PUBLISHED+current는 정확히 하나"가 부분 유니크 인덱스로 강제된다.
- `DATABASE_DESIGN.md #13`이 **버전 불변성 정책을 이미 확정**해 두었다:
  발행된 버전의 단계 존재·순서·이름은 변경 불가, 바꾸려면 복제 → 새 DRAFT → 발행.
  `is_active`만 발행 후에도 토글 가능. `repair_cases.workflow_version_id`는 접수
  시점에 고정되며 새 버전이 나와도 **기존 건은 옛 버전 그대로**.
- 동일한 "초안 편집 → 검증 → 발행" UX가 **기술 작업 절차(procedure templates)**에
  이미 구현되어 있다(편집 이력, undo/redo, 구조 검증 포함). 그 패턴을 따르면 된다.

## 3. 결정이 필요한 항목

### 결정 A — 새 워크플로 "종류"를 추가할 수 있어야 하는가? (가장 중요)

`workflow_templates.code`는 Postgres **enum**이고 값 10개가 고정되어 있다
(MATCHER, PAID_MATCHER, …, PENDING_TOTAL_CONTROLLER).

- **A-1. 기존 10종의 내용만 편집** (단계·전이·권한 수정). 종류 추가는 불가.
  → 스키마 변경 최소, enum 손대지 않음. 요청의 "수정"은 충족, "추가"는 단계 추가로 해석.
- **A-2. 종류 자체도 추가 가능하게.** `code`를 enum → text로 바꾼다.
  → 마이그레이션 필요. `workflow_type` enum은 `WorkflowType` 타입으로 코드 전반
  (라벨 맵, 접수 폼의 종류 선택, 필터, Excel 이관 매핑)에 퍼져 있어 **영향 범위가 크다**.
  새 종류가 생기면 그 종류의 유·무상 파생 규칙(`workflow-kind.ts`)도 정의해야 한다.

**권장: A-1로 시작.** "추가"의 실질적 필요가 대부분 "단계를 추가하고 싶다"인지
"제품군을 하나 더 만들고 싶다"인지에 따라 갈리므로, 이 답을 먼저 듣고 싶다.

### 결정 B — 편집 권한

`SUPER_ADMIN` 전용 / `SUPER_ADMIN + ADMIN` 중 선택. 워크플로는 전사 업무 규칙이므로
**SUPER_ADMIN 전용을 권장**한다(발행은 특히).

### 결정 C — 진행 중 접수 건 처리

`DATABASE_DESIGN.md #13`에 이미 "기존 건은 옛 버전 유지"로 확정되어 있다.
이 설계는 그대로 따른다. **확인만 필요하다** — 새 버전을 발행해도 진행 중인 250여 건은
예전 단계 구성으로 계속 흘러간다. 원한다면 "특정 접수 건을 새 버전으로 이관" 기능은
별도 작업으로 뺀다(이번 범위 아님).

## 4. 데이터 모델

### 4.1 신규 테이블 `workflow_transitions`

TS 표 183행이 들어갈 자리. 버전에 종속된다(= 버전 불변성이 전이에도 적용된다).

| 컬럼 | 비고 |
|---|---|
| `id` | uuid PK |
| `workflow_version_id` | → `workflow_versions`, restrict |
| `action_code` | enum: STEP_ADVANCED / STEP_RETURNED / SHIPMENT_COMPLETED |
| `from_step_id`, `to_step_id` | → `workflow_steps`, restrict. **같은 버전인지 검사 필요** |
| `allowed_roles` | `role[]` 배열 |
| `requires_assigned_engineer` | boolean |
| `requires_reason` | boolean |
| `required_approval_type` | nullable enum (REPAIR_INSPECTION / FINAL_SHIPMENT) |

유니크: `(workflow_version_id, action_code, from_step_id)` — 현재 TS 표도 이 키로
조회하므로 동일한 불변식이다.

`direction`(FORWARD/RETURN/TERMINAL)과 `to_status`는 **컬럼으로 두지 않는다** —
전자는 `action_code`에서, 후자는 `to_step`의 상태에서 파생된다. 중복 저장하면
어긋날 수 있다.

### 4.2 `workflow_steps`에 컬럼 2개 추가

| 컬럼 | 현재 위치 | 비고 |
|---|---|---|
| `repair_status` | `step-status-map.ts` | **not null**. 이게 비면 그 단계의 접수 건이 읽기마다 터진다 |
| `category` | `step-category.ts` | nullable (도달 불가/종료 단계는 분류 없음 — §2.1) |

### 4.3 마이그레이션 (3개, 전부 되돌릴 수 있음)

1. `workflow_transitions` 테이블 + enum 신설
2. `workflow_steps`에 컬럼 2개 추가 (nullable로) → TS 표 값으로 채우는 데이터 이관 →
   `repair_status`를 not null로 승격
3. TS 표 183행을 `workflow_transitions`로 이관

**전부 기존 데이터를 지우지 않는다.** 3번은 순수 INSERT다. 이관 스크립트는 TS 표를
읽어 그대로 넣고, 끝난 뒤 "DB 행 수 == TS 행 수, 필드별 1:1 일치"를 검증한다.

## 5. 런타임 전환

### 5.1 조회 경로

`findTransitionDefinition(workflowType, actionCode, fromStepKey)`가 지금 배열을
훑는다. 이걸 **버전 단위로 통째로 읽어 캐시**하는 구조로 바꾼다.

```
loadWorkflowRules(workflowVersionId) → { steps, transitions, statusByStep, categoryByStep }
```

- mutation은 이미 트랜잭션 안에서 접수 건의 `workflow_version_id`를 알고 있으므로,
  같은 트랜잭션에서 규칙을 읽으면 된다(추가 왕복 1회).
- 발행된 버전의 규칙은 **불변**이므로(§2.2) 프로세스 메모리에 버전 ID로 캐시해도
  안전하다. 무효화가 필요 없는 캐시다 — 이 설계의 큰 이점이다.

### 5.2 두 모드 문제

`transition-definitions.ts`는 서버(DB 모드)와 **브라우저(mock/로컬 데모 모드)** 양쪽에서
쓰인다(8개 파일). 브라우저에서는 DB를 읽을 수 없다.

- 로컬 데모 모드는 **현재 TS 표를 계속 쓴다**. 이관 후 그 파일은 "로컬 데모 전용
  기본값"으로 역할이 바뀐다(파일 주석의 "유일한 출처" 문구도 그에 맞게 수정).
- DB 모드 화면(`DatabaseWorkflowControlPanel` 등)은 서버가 내려준 규칙을 prop으로 받는다.
  지금도 `serverBaseCases` 같은 prop을 받는 패턴이 있으므로 새로운 구조가 아니다.

### 5.3 영향 파일

전이표 8개 + 상태맵 3개 + 분류 6개 = **중복 제외 15개 파일**(테스트 제외).
통합 테스트도 함께 손봐야 한다.

## 6. 편집 UI

**메뉴**: A/S 업무 그룹 아래 `워크플로 관리` (`/workflows`) 신설.
`navigation.ts`의 `navItems` + `navGroups`에 추가, 권한 술어는 결정 B에 따름.

**화면 3개**

1. `/workflows` — 워크플로 10종 목록. 각 행에 현재 발행 버전 번호, 단계 수,
   그 버전을 쓰는 접수 건 수.
2. `/workflows/[code]` — 버전 이력. 현재 발행본과 과거 버전, "새 초안 만들기"(현재
   발행본 복제).
3. `/workflows/[code]/versions/[id]/edit` — **초안 편집기**. 단계 목록(추가/이름
   변경/순서 변경/비활성), 각 단계의 상태·분류 지정, 전이 편집(어디로 / 누가 /
   사유 필수 / 승인 필요).

**발행 전 검증** (구조가 깨진 채로 발행되면 그 워크플로의 접수 건이 전부 멈춘다):

- 모든 단계에 `repair_status`가 있는가
- 시작 단계에서 종료 단계까지 정방향 경로가 실제로 존재하는가
- 도달 불가 단계가 없는가 (있다면 경고)
- 종료 단계(`shipment_completed` 상당)가 정확히 하나인가
- 승인이 필요한 전이의 승인 종류가 유효한가

이 검증은 **순수 함수로 분리**해 단위 테스트로 고정하고, 발행 mutation이 서버에서
다시 실행한다(화면 표시는 힌트일 뿐이라는 이 프로젝트의 일관된 규율).

## 7. 구현 단계 — 각 단계가 독립적으로 배포·검증 가능

| Phase | 내용 | 위험 | 사용자에게 보이는 변화 |
|---|---|---|---|
| **1** | 마이그레이션 3개 + TS 표 → DB 이관 + 1:1 검증 테스트 | HIGH (마이그레이션) | **없음** — 런타임은 여전히 TS 표를 읽는다 |
| **2** | `loadWorkflowRules()` 도입, DB 모드 런타임을 DB 기반으로 전환. 전환 후 두 소스가 같은 답을 내는지 대조 테스트 | HIGH (인가·전이 의미) | 없음 (동작 동일해야 함) |
| **3** | 조회 전용 화면 2개(`/workflows`, 버전 이력) + 메뉴 | LOW | 워크플로를 **볼 수** 있음 |
| **4** | 초안 생성(복제) + 단계 편집 + 발행 + 검증 | HIGH (쓰기·발행) | 편집 가능 |
| **5** | 전이 편집(권한·사유·승인) | HIGH | 규칙 편집 가능 |
| **6** | (결정 A가 A-2일 때만) 새 워크플로 종류 추가 | HIGH | 종류 추가 가능 |

**Phase 1과 2가 이 작업의 진짜 몸통이다.** 3~5는 그 위의 UI다.
Phase 2까지 끝나면 UI가 없어도 이미 "DB를 고치면 앱 동작이 바뀌는" 상태가 된다.

각 Phase는 CLAUDE.md대로 **직전에 계획을 보고하고 승인받은 뒤** 착수한다.

## 8. 위험과 완화

| 위험 | 완화 |
|---|---|
| 이관 중 규칙이 미묘하게 바뀌어 접수 건이 멈춘다 | Phase 1에서 DB↔TS 1:1 대조 테스트. Phase 2에서 두 구현의 답이 모든 (워크플로, 단계, 액션, 역할) 조합에 대해 같은지 대조 |
| 잘못된 초안이 발행되어 워크플로가 마비 | 발행 전 구조 검증(§6) + 서버 재검증. 이전 버전은 그대로 남아 있으므로 되돌리기는 "옛 버전을 다시 current로" |
| 진행 중 250여 건에 영향 | 버전 고정 정책(§3-C)상 영향 없음. Phase 2 완료 후 회귀 테스트로 확인 |
| 로컬 데모 모드와 DB 모드가 갈라짐 | §5.2대로 역할을 명시적으로 분리하고 주석에 기록 |
| enum 값 추가는 되돌릴 수 없음 | `action_code`/`approval_type`은 기존 값 재사용. 새 enum은 신규 테이블에만 도입 |

## 9. 이번 범위에서 명시적으로 빼는 것

- 진행 중 접수 건을 새 버전으로 이관하는 기능
- 워크플로 종류 삭제 (기존 접수 건이 참조하므로 애초에 불가)
- 로컬 데모(mock) 모드의 워크플로 편집
- 단계별 SLA·자동 알림 등 새로운 개념
