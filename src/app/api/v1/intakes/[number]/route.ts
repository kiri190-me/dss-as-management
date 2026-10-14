import { NextResponse, type NextRequest } from "next/server";

import {
  buildIntakeLookupResponse,
  isValidIntakeNumber,
  normalizeIntakeNumber,
} from "@/lib/api/intake-lookup";
import { NO_STORE, checkSharedApiToken } from "@/lib/api/shared-token";
import { findIntakeForExternalLookup } from "@/lib/db/queries/external-intake-lookup";

/**
 * ============================================================================
 * GET /api/v1/intakes/{인수번호} — 인수번호로 그 인수품이 무엇인지 (읽기 전용)
 * ============================================================================
 * 부르는 쪽: 재고 관리 시스템의 서버(`src/lib/stock/intake-lookup.ts`). 부품을
 * 반출할 때 "이 인수번호가 어느 고객사의 어느 장비인가"를 물어 사용처 글자를
 * 만든다. 자격은 공유 토큰 하나다 — `lib/api/shared-token.ts` 의 머리 주석.
 *
 *   200  { intakeNumber, customerName, endUser, productModel, productSerial, productLot }
 *   400  { error: "bad_request" }   인수번호 모양이 아님
 *   401  { error: "unauthorized" }  토큰이 없거나 틀림
 *   404  { error: "not_found" }     그런 건이 없거나 휴지통에 있음
 *   503  { error: "api_closed" }    A/S 에 토큰이 설정되지 않음
 *
 * 🔴 **휴지통에 든 건은 없는 것과 같게 404 다.** 질의가 왜 기존 함수를 쓰지 않는지는
 * `lib/db/queries/external-intake-lookup.ts` 의 주석에 있다.
 *
 * 설명서: `API_FOR_INTERNAL_SYSTEMS.md`.
 * ============================================================================
 */
export async function GET(request: NextRequest, context: { params: Promise<{ number: string }> }) {
  // 🔴 문지기가 맨 먼저다. 막히면 DB 를 두드리지 않는다.
  const denied = checkSharedApiToken(request);
  if (denied) return denied;

  // Next 가 이미 URL 디코딩해 넘겨준다 — 여기서 또 풀면 `%25` 같은 글자가 깨진다.
  const { number } = await context.params;
  const intakeNumber = normalizeIntakeNumber(number ?? "");

  if (!isValidIntakeNumber(intakeNumber)) {
    return NextResponse.json(
      { error: "bad_request", message: "인수번호는 D 와 숫자 6자리입니다 (예: D260701)." },
      { status: 400, headers: NO_STORE }
    );
  }

  const row = await findIntakeForExternalLookup(intakeNumber);
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }

  return NextResponse.json(buildIntakeLookupResponse(row), { headers: NO_STORE });
}
