import "server-only";

import { cache } from "react";

import {
  listQuoteArchiveFolderRefs,
  quoteArchiveProductKey,
  readQuoteArchiveNumbersForProducts,
  type QuoteArchiveFolderRef,
} from "../../storage/quote-archive-case-numbers";

/**
 * ============================================================================
 * 수리 건의 **견적서 번호들** — 내자 정리가 먼저, 없을 때만 공유폴더
 * ============================================================================
 * 「고객 안내 현황의 견적서 번호는 수리건의 견적서 폴더의 **파일들의 견적서 번호**를
 * 가져와서 넣어줘. 한 건에 **복수의 견적서**가 있을 수 있어. 만약 **내자 정리에 적힌
 * 견적서 번호가 있다면 그때는 내자정리에 적힌 번호만** 적혀있도록 해줘.」
 * (사용자 지시 2026-10-07)
 *
 * ── 🔴 왜 조회 파일 밖으로 나왔는가 (2026-10-07) ─────────────────────────
 * 하루 전까지 이 다섯 함수는 queries/customer-portal.ts 안의 private 함수였다. 같은 날
 * **주간보고 상세표**도 줄마다 같은 번호를 보여 주게 되면서(견적서 발행일 옆 역삼각),
 * 두 화면이 **같은 규칙**을 써야 할 이유가 생겼다 — 규칙을 베껴 적으면 언젠가 한쪽만
 * 고쳐지고, **두 화면이 서로 다른 견적서 번호를 보이면 사람은 어느 쪽도 믿지 않는다.**
 * 그래서 옮겼다. 🔴 **옮기기만 했고 규칙은 한 글자도 바뀌지 않았다.**
 *
 * ── 🔴 한 요청에서 **훑기는 한 번**이다 ──────────────────────────────────
 * 공유폴더의 연도 폴더를 전부 훑는 일은 실측 851ms 다. 그런데 이 일은 **양식마다**
 * 불리고(고객 안내 현황이 양식 셋을 미리 읽는다), 양식 하나가 고객사 여럿을 돈다.
 * 주간보고까지 더해지면 같은 요청 안에서 대여섯 번이 된다.
 *
 * 그래서 비싼 훑기만 떼어 **React 의 cache() 로 감쌌다**(아래 loadQuoteArchiveFolders).
 * 요청 하나 동안 한 번만 돌고, 그 결과(폴더 이름 목록)를 양식 · 고객사 · 주간보고가
 * 나눠 쓴다. 이 저장소가 이미 같은 이유로 쓰는 방식이다(queries/ui-theme-tokens.ts ·
 * auth/permission-resolver.ts). 🔴 **그 cache() 가 이 모듈에 함께 와야** 두 화면이 한
 * 요청에서 훑기를 한 번으로 끝낸다 — 화면마다 제 cache() 를 두면 요청당 둘이 된다.
 *
 * 🔴 **색인을 인자로 넘기는 쪽을 고르지 않은 까닭**: 그러려면 listPortalItemsForCustomer 와
 * listPortalItemsForForm 의 서명이 바뀌고, 그 호출 모양을 **글자 그대로** 못 박아 둔 시험이
 * 둘 있다(customer-portal-form-view.test.ts · ocr/pass-slip-portal-wiring.test.ts). 더
 * 중요한 것은 엑셀 내보내기도 같은 조회를 지난다는 점이다 — 인자가 늘면 그 길에서 색인을
 * 안 넘기는 실수가 조용히 가능해지고, 그러면 화면 표와 저장된 파일의 번호가 갈린다.
 * cache() 는 부르는 쪽이 아무것도 몰라도 되고, 캐시가 없는 자리에서는(서버 액션) 그냥 한 번
 * 더 도는 것으로 끝난다 — **틀려도 값이 틀리지 않는** 쪽이다.
 *
 * ── 🔴 DB 를 읽지 않는다 ────────────────────────────────────────────────
 * 내자 정리의 견적서번호를 읽는 일은 queries/domestic-orders.ts 의
 * `listQuoteInfoForRepairCases` 하나가 한다(완료된 줄을 빼는 규칙까지 거기 있다). 이
 * 모듈은 그 결과를 **받아서** 규칙을 적용할 뿐이다 — 여기서 표를 읽으면 같은 SQL 이 두
 * 벌이 되고, 두 화면이 다른 조건으로 같은 표를 보게 된다.
 *
 * 🔴 공유폴더가 꺼져 있거나 못 읽으면 **내자 정리 값만** 보인다. 던지지 않는다.
 * ============================================================================
 */

/**
 * 연도 폴더 훑기 — 🔴 **요청 하나에 한 번**이다(파일 머리말).
 *
 * disabled(설정이 비었다) · failed(NAS 가 느리다 · 끊겼다) 둘 다 빈 목록이다 — 그러면
 * 아래 읽기가 디스크를 아예 안 보고, 번호 칸은 내자 정리 값만 쓴다.
 */
const loadQuoteArchiveFolders = cache(async (): Promise<readonly QuoteArchiveFolderRef[]> => {
  const scanned = await listQuoteArchiveFolderRefs();
  return scanned.status === "found" ? scanned.folders : [];
});

/** 번호를 찾아 줄 수리 건 하나. 두 화면의 조회가 이미 싣고 있는 칸 이름 그대로다. */
export type QuoteNumberCase = {
  id: string;
  lotNumber: string | null;
  serialNumber: string | null;
};

/**
 * 내자 정리에 번호가 **없는** 건들만 모아 공유폴더에서 번호를 읽는다 — 장비 열쇠 → 번호들.
 *
 * 🔴 번호가 이미 있는 건은 열쇠조차 만들지 않는다. 사용자 규칙이 「있으면 그것만」이라
 * 공유폴더를 보는 일 자체가 낭비이고, 열어 보는 폴더 수(= NAS 왕복)가 그만큼 줄어든다.
 */
export async function listArchiveQuoteNumbers(
  cases: readonly QuoteNumberCase[],
  quoteInfo: Map<string, { quoteNumber: string | null }>
): Promise<Map<string, string[]>> {
  const products = cases
    .filter((row) => orderedQuoteNumber(quoteInfo.get(row.id)?.quoteNumber ?? null) === null)
    .map((row) => ({ lotNumber: row.lotNumber, serialNumber: row.serialNumber }));
  if (products.length === 0) return new Map();

  const folders = await loadQuoteArchiveFolders();
  const read = await readQuoteArchiveNumbersForProducts({ folders, products });
  return read.status === "found" ? read.numbersByProduct : new Map();
}

/** 내자 정리에 **사람이 적어 둔** 번호. 비었으면 null — 공백만 적힌 칸도 빈 것으로 본다. */
function orderedQuoteNumber(quoteNumber: string | null | undefined): string | null {
  const text = typeof quoteNumber === "string" ? quoteNumber.trim() : "";
  return text === "" ? null : text;
}

/**
 * 그 줄에 보일 견적서 번호들. 🔴 **내자 정리에 있으면 그것만**이고, 없을 때만 공유폴더에서
 * 읽은 번호들이다(사용자 지시 2026-10-07 — 위 머리말).
 *
 * 🔴 **고객 안내 현황과 주간보고가 이 한 함수를 그대로 부른다.** 규칙을 베껴 적으면 두
 * 화면이 다른 번호를 보이는 날이 온다.
 */
export function repairCaseQuoteNumbers(
  quoteNumber: string | null | undefined,
  archiveNumbers: Map<string, string[]>,
  lotNumber: string | null,
  serialNumber: string | null
): string[] {
  const ordered = orderedQuoteNumber(quoteNumber);
  if (ordered !== null) return [ordered];
  // 🔴 열쇠는 저장소 모듈의 함수로 만든다 — 손으로 이으면 다듬기 규칙이 갈린다.
  const key = quoteArchiveProductKey(lotNumber, serialNumber);
  return key === null ? [] : (archiveNumbers.get(key) ?? []);
}

/**
 * 🔴 고객 안내 현황의 화면 칸(`quoteNumbers`)과 엑셀 칸(`quoteNumber`)이 **같은 출처에서
 * 나오는 유일한 자리**다. 따로 구하면 언젠가 둘이 갈라지고, 담당자가 본 표와 고객사에 나간
 * 파일이 달라진다.
 *
 * ⚠️ 주간보고는 이 함수를 쓰지 않는다 — 그쪽은 엑셀로 나가는 칸이 없고 번호를 **칸 안에
 * 위아래로** 그린다(WeeklyReportQuoteNumbersCell).
 */
export function joinQuoteNumbers(numbers: readonly string[]): string | null {
  return numbers.length === 0 ? null : numbers.join("\n");
}
