/**
 * ============================================================================
 * 「같은 장비의 지난 견적서」 구역을 그릴지 가르는 순수 판정 (2026-10-06)
 * ============================================================================
 * 수리 건의 L/N · S/N 이 **장비를 가리킬 수 있는 값인가**만 본다. 파일시스템도, 통로도,
 * React 도 쓰지 않는다.
 *
 * ── 🔴 왜 이 함수가 따로 선 파일에 있는가 ─────────────────────────────────
 * 이 판정을 부르는 쪽은 **서버 컴포넌트**다(app/(app)/repair-cases/[id]/quotes/page.tsx 가
 * 구역을 그릴지 말지 여기서 가른다). 그런데 구역을 그리는 화면
 * (QuoteArchiveProductFolderSection.tsx)은 첫 줄이 `"use client"` 인 파일이다.
 *
 * 🔴 **`"use client"` 파일이 내보낸 것은 서버가 부를 수 없다.** 그 파일의 export 는 번들러가
 * 「클라이언트 참조」로 바꿔치기해서, 서버에서는 컴포넌트로 **그리거나** 클라이언트
 * 컴포넌트의 props 로 **넘기는** 것만 된다. 순수 함수라도 서버에서 괄호를 붙여 부르면
 * 그 자리에서 터진다:
 *
 *     Attempted to call hasQuoteArchiveProductKeys() from the server but
 *     hasQuoteArchiveProductKeys is on the client.
 *
 * 🔴 이 고장은 **타입 검사도 단위 시험도 못 잡는다.** 타입은 맞고, 시험은 두 파일을 모두
 * 클라이언트로 불러 쓰기 때문이다. `npm run build` 를 돌리거나 실제로 화면을 열어야 드러난다.
 * 그래서 함수를 `"use client"` 가 없는 **이 중립 파일**에 둔다 — 서버도 클라이언트도 똑같이
 * 가져다 쓸 수 있다. 같은 폴더의 quote-archive-folder-groups.ts 가 같은 까닭으로 따로 선다.
 *
 * 🔴 **다시 화면 파일로 옮기지 마라.** 옮기는 순간 「견적서」 탭이 안 열린다.
 * 이 규율은 src/app/server-client-boundary-source.test.ts 가 저장소 전체에서 지킨다.
 * ============================================================================
 */

/**
 * 🔴 이 값이 **장비를 가리킬 수 있는가** — 글자나 숫자가 한 자라도 있어야 한다.
 * 수리 건 조회는 빈 칸을 `-` 로 채워 내려보낸다(mappers/repair-case.ts). 그 `-` 를 열쇠로
 * 쓰면 공유폴더에서 엉뚱한 폴더가 걸리므로 **빈 값과 똑같이** 다룬다.
 */
function isUsableProductKey(value: string | null | undefined): boolean {
  return typeof value === "string" && /[\p{L}\p{N}]/u.test(value);
}

/**
 * 🔴 **L/N 과 S/N 이 둘 다 있어야** 이 구역을 그린다. S/N 하나로는 장비가 확정되지 않는다 —
 * 이 시스템에는 같은 S/N 에 모델이 셋인 사례가 실제로 있다. 서버도 같은 판단을 한 번 더
 * 한다(storage/quote-archive-product-folders.ts) — 여기서 거르는 것은 **쓸데없는 왕복**이다.
 */
export function hasQuoteArchiveProductKeys(
  lotNumber: string | null | undefined,
  serialNumber: string | null | undefined
): boolean {
  return isUsableProductKey(lotNumber) && isUsableProductKey(serialNumber);
}
