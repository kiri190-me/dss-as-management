# A/S 관리 시스템이 다른 사내 시스템에 내주는 API

- 상대: 재고 관리 시스템(`dss-inventory`) · PO/내자 시스템(`dss-po`).
- 🔴 **읽는 통로 셋과 쓰는 통로 하나**가 있고, **자격이 서로 다릅니다**(1절). 2026-10-18 까지는 읽기뿐이었습니다.
- 처음 연 날: 2026-10-15. 「부품 요청 관리 · 승인 요청건 · O/H 부품 템플릿」을 재고 관리로 옮기면서, 옮긴 화면들이 A/S 만 가진 것 셋을 알아야 해서 열었습니다.
- 쓰는 통로를 연 날: 2026-10-18. PO 의 내자 정리에서 [완료 처리]를 누를 때 **그 줄에 붙은 수리건도 출하 완료로** 넘기기 위해서입니다. 그 판정(최종 출하 승인 확인 · 되돌리기 규칙)을 PO 로 베끼면 규칙이 두 벌이 되므로, PO 가 이 통로를 부르고 규칙은 A/S 한 곳에만 둡니다.
- 🔴 이 문서의 모양은 다른 시스템이 의존하는 **약속**입니다. 칸을 더하는 것은 괜찮지만 이름을 바꾸거나 빼지 않습니다. 바꿔야 하면 `v2` 를 새로 열고 날짜를 정합니다.
- 반대 방향(재고 관리가 A/S·PO 에 부품 목록을 내주는 통로)은 그쪽 저장소의 `API.md` 입니다. 이 문서는 그 거울상이고, 문지기의 판단이 글자 그대로 같습니다.
- 설계 수준의 전체 엔드포인트 목록은 `API_SPECIFICATION.md` 입니다. 이 문서는 **실제로 열려 있는 세 통로**만 다룹니다.

## 1. 인증

서버가 서버를 부르므로 포털 로그인(SSO)도, 사람의 세션도 아닙니다. 양쪽이 나눠 가진 글자 하나입니다.

```
Authorization: Bearer <AS_API_TOKEN>
```

| 경우 | 응답 |
|---|---|
| 토큰이 맞음 | 200 |
| 토큰이 없거나 틀림 | 401 `{ "error": "unauthorized" }` + `www-authenticate: Bearer` |
| A/S 쪽에 토큰이 설정되지 않음 | 503 `{ "error": "api_closed" }` — 통로가 닫힌 상태 |

- 🔴 토큰을 **쿼리 문자열로 받지 않습니다.** 쿼리는 서버 접근 로그와 브라우저 히스토리에 그대로 남습니다.
- 🔴 비어 있다고 **열어 두지 않습니다.** 환경변수를 빠뜨린 서버는 전부 내주는 문이 아니라 닫힌 문이 됩니다.
- 글자 비교는 `node:crypto` 의 `timingSafeEqual` 입니다. 오류 본문에 토큰이나 그 일부를 담지 않습니다.
- 토큰은 A/S 쪽 `.env.local`(개발) / NAS 환경변수(운영)의 `AS_API_TOKEN` 이고, **같은 값**을 재고 관리 쪽 `AS_LOOKUP_TOKEN` 에 넣습니다. 32자 이상. 담당자가 만들어 양쪽에 넣습니다.
- 모든 응답에 `cache-control: no-store` 가 붙습니다.

문지기는 `src/lib/api/shared-token.ts` 하나입니다. 환경변수를 읽는 자리도 거기 한 곳뿐입니다.

### 1-2. 쓰는 통로의 자격 — **읽기와 다른 토큰입니다** (2026-10-18)

```
Authorization: Bearer <AS_WRITE_TOKEN>
```

- 🔴 **`AS_API_TOKEN`(읽기)과 다른 값을 넣습니다.** 가르는 것은 부르는 쪽이 아니라 **하는 일**입니다 — 읽기 토큰 하나로 쓰기까지 열면 그 토큰을 가진 모든 시스템이 내자 줄을 완료 처리할 수 있게 됩니다. A/S 가 재고 관리를 부를 때도 같은 모양으로 갈라 둡니다(`INVENTORY_API_TOKEN` / `INVENTORY_WRITE_TOKEN`).
- 🔴 같은 값을 넣어도 **코드가 막지 않습니다**(강제하면 배포가 조용히 막힐 수 있어서입니다). 설정하는 사람이 지켜야 합니다.
- 판단은 읽기 쪽과 글자 그대로 같습니다 — Bearer 머리말로만 · `timingSafeEqual` · 설정이 비면 503 으로 닫음 · 거절 까닭을 응답에 담지 않음 · 로그에 토큰을 적지 않음.
- 🔴 **자격이 두 겹입니다.** 토큰은 「어느 시스템이 보냈나」만 확인합니다. 「누가 눌렀나」는 본문의 `requester.sub` 로 오고, **A/S 가 그 사람을 다시 찾아 권한을 직접 확인합니다** — 부르는 쪽이 「이 사람 권한 있어요」라고 말하는 것을 믿지 않습니다.
- ⚠️ 그래도 토큰을 아는 쪽은 `requester.sub` 를 바꿔 보낼 수 있습니다. **PO 는 A/S 와 같은 DB 를 쓰므로 이미 그 표에 직접 쓸 수 있고**, 이 통로가 없던 권한을 새로 주지는 않습니다. 포털이 서명한 토큰(`lib/auth/portal-service-token.ts`) 쪽이 더 튼튼하지만 **그 토큰은 포털만 구울 수 있어** PO 가 쓸 수 없습니다. 포털이 PO 에게 토큰을 구워 주게 되는 날 문지기만 갈아끼우면 됩니다.

문지기는 `src/lib/api/write-token.ts` 입니다.

## 2. 인수번호 조회 — `GET /api/v1/intakes/{인수번호}`

재고 관리가 부품을 반출할 때 "이 인수번호가 어느 고객사의 어느 장비인가"를 물어 **사용처 글자**(`인수번호_기종_S/N_L/N`)를 만듭니다. 받는 쪽은 `dss-inventory/src/lib/stock/intake-lookup.ts` 입니다.

인수번호 모양은 `D` + 숫자 6자리(예 `D260701`)입니다. 재고 관리 쪽 `INTAKE_NUMBER_RE` 와 같은 규칙입니다. 앞뒤 공백은 떼고 소문자 `d` 도 받습니다.

| 경우 | 응답 |
|---|---|
| 찾음 | 200 (아래 모양) |
| 인수번호 모양이 아님 | 400 `{ "error": "bad_request", "message": "..." }` |
| 그런 건이 없음 · **휴지통에 있음** | 404 `{ "error": "not_found" }` |

```json
{
  "intakeNumber": "D260701",
  "customerName": "가나다 주식회사",
  "endUser": "라마바 사업장",
  "productModel": "TG-100",
  "productSerial": "SN-0001",
  "productLot": "LN-0001"
}
```

- 🔴 **없는 값은 빈 글자(`""`)입니다. `null` 을 내보내지 않습니다** — 받는 쪽의 여섯 칸이 전부 `string` 이고, 그 값을 이어 붙여 사용처 글자를 만들기 때문입니다.
- 🔴 **휴지통(삭제)에 든 건은 내주지 않습니다.** 인수번호는 삭제 여부와 무관하게 표 전체에서 하나뿐이지만(`repair_cases_intake_number_unique`), 이 통로는 "지금 살아 있는 그 인수품이 무엇인가"를 답합니다. 지운 건을 내주면 재고 쪽 원장에 A/S 에서 이미 사라진 건이 남습니다.
- 고객사 · End-User · 제품은 `leftJoin` 입니다. 이어지지 않은 칸은 빈 글자로 나갑니다.
- DB 의 CHECK 는 이보다 좁습니다(가운데 두 자리가 달이라 01~12). 거기 걸리는 번호는 400 이 아니라 404 로 나갑니다 — 두 시스템이 **같은 잣대로** 모양을 재기 위해서입니다.

## 3. 결재자가 될 수 있는 사람 — `GET /api/v1/users`

재고 관리로 옮긴 승인 절차(결재선) 화면의 고르개가 씁니다. 재고 관리에는 사람이 한 명뿐이라 A/S 의 명부를 읽어 갑니다.

`ssoSubject` 는 통로를 연 당일(2026-10-15) 뒤이어 더한 칸입니다 — 그 전 모양(칸 넷)으로 맞춰 둔 쪽은 이 칸을 읽도록 고쳐야 사람을 알아볼 수 있습니다.

```json
{
  "generatedAt": "2026-10-15T05:12:00.000Z",
  "count": 12,
  "users": [
    {
      "id": "9f1c…",
      "name": "홍길동",
      "email": "hong@dss21.com",
      "role": "AS_ENGINEER",
      "ssoSubject": "bd06ad30-…"
    },
    { "id": "4a2d…", "name": "김철수", "email": "kim@dss21.com", "role": "SALES", "ssoSubject": null }
  ]
}
```

- 이름 순. 이름이 같으면 id 순입니다.
- 🔴 **자격 규칙은 A/S 의 기존 함수**(`listSelectableApproverCandidates`)가 정합니다 — `approval_status = 'APPROVED'` · `is_active = true` · `locked_at IS NULL` · `is_deleted = false` 넷. 출하 대표로 지정할 수 있는 조건과 글자 그대로 같고, 까닭은 `src/lib/db/queries/shipment-approval-routes.ts` 의 주석에 있습니다. **역할 제한은 없습니다.**
- 🔴 **칸은 다섯뿐입니다.** 전화번호·부서·비밀번호 관련 칸은 내주지 않습니다.
- `role` 은 A/S 의 역할 코드(`SUPER_ADMIN` · `ADMIN` · `AS_ENGINEER` · `SALES` · `INVENTORY_MANAGER`)입니다. 화면에 보일 이름은 시스템마다 다를 수 있으므로 그쪽에서 바꿔 씁니다.
- `id` 는 A/S 의 `users.id`(UUID)입니다. 포털 쪽 `sub` 가 **아닙니다** — A/S 안에서만 쓰는 번호라 그쪽 사람 번호와 맞지 않습니다.
- 🔴 **사람을 알아보는 열쇠는 `ssoSubject` 입니다.** 로그인 포털(dss-auth)에서의 그 사람 id(= ID 토큰의 `sub`)이고, A/S 와 포털을 잇는 칸은 이것 하나뿐입니다. **메일로 잇지 마세요** — 사람은 메일을 바꿀 수 있어서 신원을 고정하지 못합니다.
- 🔴 **`ssoSubject` 는 `null` 일 수 있고, 그대로 내보냅니다.** 포털로 한 번도 로그인한 적 없는 계정은 아직 안 이어져 있습니다. 빈 글자로 바꾸거나 그 사람을 목록에서 빼지 않습니다 — 받는 쪽이 「이 사람은 아직 알아볼 수 없다」를 알아야 하기 때문입니다. 받는 쪽에서는 그런 줄을 **고를 수 없게 막고 까닭을 보여 주세요**(그 사람이 포털로 한 번 로그인하면 이어집니다).

## 4. 제품 모델 목록 — `GET /api/v1/product-models`

재고 관리로 옮긴 O/H 부품 템플릿 화면의 「모델 잇기」 고르개가 씁니다. 모델 마스터의 주인은 A/S 입니다.

```json
{
  "generatedAt": "2026-10-15T05:12:00.000Z",
  "count": 9,
  "models": [{ "id": "3b7e…", "modelName": "TG-100" }]
}
```

- 모델명 순. 이름이 같으면 id 순입니다.
- 지운 모델(`is_deleted = true`)은 빠집니다.
- 🔴 `id` 는 A/S 의 `product_models.id` 입니다. **모델명이 아니라 이 id 로 이으세요** — 이름으로 이으면 A/S 에서 이름을 고치는 날 끊깁니다.
- A/S 쪽 O/H 템플릿에 이미 붙은 모델도 **전부 나갑니다.** A/S 의 연결 여부로 재고 쪽 고르개를 거르면 안 됩니다.

## 4-2. 🔴 내자 줄 완료 처리·해제 — `POST /api/v1/domestic-orders/{id}/completion`

**이 저장소에서 유일하게 쓰는 통로입니다.** 자격은 1-2절(`AS_WRITE_TOKEN`).

부르는 쪽: PO/내자 시스템(`dss-po`)의 내자 정리 화면. 여는 까닭은 문서 머리말에 있습니다.

요청
```json
{ "completed": true, "expectedVersion": 3, "requester": { "sub": "<포털 쪽 사용자 id>" } }
```

| 칸 | 뜻 |
|---|---|
| `completed` | `true` 면 완료 처리, `false` 면 완료 해제. 🔴 불리언이 아니면 400 입니다 — `undefined` 가 조용히 「해제」로 읽히면 안 됩니다 |
| `expectedVersion` | **내자 줄**의 version. 부르는 쪽 화면이 보고 있던 값 그대로 |
| `requester.sub` | 누가 눌렀는지. 🔴 포털 쪽 사용자 id(`users.sso_subject`)이고 A/S 의 `users.id` 가 **아닙니다** |

성공 200
```json
{ "ok": true, "id": "…", "version": 4, "repairCaseShipmentCompleted": true, "repairCaseShipmentReverted": false }
```
뒤의 두 칸은 **붙어 있던 수리건이 함께 움직였는지**입니다. 부르는 쪽 화면이 성공 문구를 가르는 데 씁니다 — 「완료로 표시했습니다」와 「완료로 표시하고, 연결된 수리 건도 출하 완료로 처리했습니다」는 다른 말입니다.

실패

| 번호 | 몸통 | 언제 |
|---|---|---|
| 400 | `{ ok: false, code: "VALIDATION_ERROR", fieldErrors, message }` | 본문·id 모양이 틀림 |
| 401 | `{ error: "unauthorized" }` | 토큰이 없거나 틀림 — 🔴 까닭을 가르지 않습니다 |
| 403 | `{ ok: false, code: "FORBIDDEN", message }` | 사람을 못 찾음 · 살아 있지 않은 계정 · 권한 없음 — 🔴 셋이 **구별되지 않습니다** |
| 404 | `{ ok: false, code: "NOT_FOUND", message }` | 그런 내자 줄이 없음 |
| 409 | `{ ok: false, code: "CONFLICT", message }` | 그 사이 남이 그 줄을 고침 |
| 409 | `{ ok: false, code: "SHIPMENT_COMPLETION_BLOCKED", message }` | 🔵 **수리건이 막혀 내자 줄도 안 바뀜.** 이 `message` 는 「최종 출하 승인이 완료되어야 진행할 수 있습니다」처럼 **사람에게 그대로 보여 줄 글**입니다 — 숨기지 말고 띄우세요 |
| 503 | `{ error: "api_closed" }` / `{ ok: false, code: "DATABASE_UNAVAILABLE", message }` | 토큰 미설정 / DB 일시 장애 |

- 🔴 **`CONFLICT` 와 `SHIPMENT_COMPLETION_BLOCKED` 가 같은 409 입니다.** 진짜 구분은 `code` 이고 번호는 거드는 값입니다. **`message` 글자를 비교해 가르지 마세요** — 막힌 까닭마다 문장이 다릅니다.
- 무엇을 하는지는 A/S 화면의 [완료 처리]/[완료 해제]와 **완전히 같습니다**(같은 서비스를 부릅니다). 수리건이 안 붙었거나 이미 출하 완료면 내자 줄만 움직입니다.
- 🔴 **되돌린 수리건을 다시 출하 완료로 넘기려면 수리 검수 승인부터 다시** 받아야 합니다(승인이 접수 건의 version 에 묶여 있습니다). 부르는 쪽 확인 창에 그 사실을 적으세요.
- 저장 기록에 남는 사람은 **A/S 가 `sub` 로 되짚은 계정**이지 부르는 쪽이 보낸 값이 아닙니다.

## 5. 주소

| 곳 | 주소 |
|---|---|
| 개발 | `http://localhost:3000` |
| 운영 | NAS 의 A/S 주소 (담당자가 정합니다) |

## 6. 코드가 있는 자리

| 무엇 | 파일 |
|---|---|
| 읽기 문지기 · 환경변수 | `src/lib/api/shared-token.ts` |
| 🔴 **쓰기 문지기 · 환경변수** | `src/lib/api/write-token.ts` |
| 인수번호 모양 검사 · 응답 만들기 | `src/lib/api/intake-lookup.ts` |
| 🔴 **완료 처리 본문 검증(순수)** | `src/lib/api/domestic-order-completion-request.ts` |
| 인수번호 질의 (휴지통 제외) | `src/lib/db/queries/external-intake-lookup.ts` |
| 제품 모델 질의 | `src/lib/db/queries/external-product-models.ts` |
| 🔴 **완료 처리·해제의 업무 규칙** | `src/lib/server/services/complete-domestic-order.ts` · `release-domestic-order.ts` (화면도 **같은 것**을 부릅니다 — 규칙이 한 벌인 까닭입니다) |
| 읽기 라우트 셋 | `src/app/api/v1/intakes/[number]/route.ts` · `src/app/api/v1/users/route.ts` · `src/app/api/v1/product-models/route.ts` |
| 🔴 **쓰기 라우트 하나** | `src/app/api/v1/domestic-orders/[id]/completion/route.ts` |
| 시험 | `src/lib/api/shared-token.test.ts` · `src/lib/api/intake-lookup.test.ts` · `src/app/api/v1/route-source.test.ts` · `src/lib/api/write-token.test.ts` · `src/lib/api/domestic-order-completion-request.test.ts` · `src/app/api/v1/domestic-orders/completion-route.integration.test.ts` |

- 읽는 통로 셋은 스키마를 한 칸도 건드리지 않습니다 — 전부 **읽기**입니다.
- 🔴 쓰는 통로 하나(4-2절)는 **`domestic_orders` 와 `repair_cases` 를 고칩니다.** 다만 자기 SQL 을 쓰지 않고 화면과 **같은 서비스**를 부릅니다 — 규칙을 두 벌로 만들지 않기 위해서입니다.
