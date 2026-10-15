# A/S 관리 시스템이 다른 사내 시스템에 내주는 API

- 상대: 재고 관리 시스템(`dss-inventory`). **읽기 전용**입니다. 쓰는 통로(POST·PATCH·DELETE)는 없습니다.
- 처음 연 날: 2026-10-15. 「부품 요청 관리 · 승인 요청건 · O/H 부품 템플릿」을 재고 관리로 옮기면서, 옮긴 화면들이 A/S 만 가진 것 셋을 알아야 해서 열었습니다.
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

## 5. 주소

| 곳 | 주소 |
|---|---|
| 개발 | `http://localhost:3000` |
| 운영 | NAS 의 A/S 주소 (담당자가 정합니다) |

## 6. 코드가 있는 자리

| 무엇 | 파일 |
|---|---|
| 문지기 · 환경변수 | `src/lib/api/shared-token.ts` |
| 인수번호 모양 검사 · 응답 만들기 | `src/lib/api/intake-lookup.ts` |
| 인수번호 질의 (휴지통 제외) | `src/lib/db/queries/external-intake-lookup.ts` |
| 제품 모델 질의 | `src/lib/db/queries/external-product-models.ts` |
| 라우트 셋 | `src/app/api/v1/intakes/[number]/route.ts` · `src/app/api/v1/users/route.ts` · `src/app/api/v1/product-models/route.ts` |
| 시험 | `src/lib/api/shared-token.test.ts` · `src/lib/api/intake-lookup.test.ts` · `src/app/api/v1/route-source.test.ts` |

스키마는 한 칸도 건드리지 않았습니다 — 전부 **읽기**입니다.
