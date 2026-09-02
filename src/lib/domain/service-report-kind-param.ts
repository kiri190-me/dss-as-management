import type { ServiceReportKind } from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * 주소의 `?kind=` → 보고서 종류
 * ============================================================================
 * 「보고서」 탭의 갈림길 화면이 `?kind=INSPECTION` · `?kind=REPAIR` 를 붙여 작성
 * 화면으로 보낸다. 그 글자를 읽는 일이 화면이 아니라 이 파일에 있는 까닭이 둘이다:
 *
 *   · **주소는 사람이 손으로 고칠 수 있는 자리다.** 받은 글자를 그대로
 *     `ServiceReportKind` 인 척 넘기면 `?kind=repair` 하나로 폼이 "종류를 모르는"
 *     상태가 된다 — `<select>` 의 value 가 목록에 없어 아무것도 안 고른 것처럼
 *     보이는데, 아무 오류도 안 나서 아무도 모른다.
 *   · **순수 계산이라 시험이 붙는다.** 페이지 안에 두면 붙지 않는다.
 *
 * ── 🔴 기본값을 여기 적지 않는다 ────────────────────────────────────────
 * 못 고르면 `null` 이고, **기본값은 폼 씨앗 하나가 정한다**
 * (`service-report-form.ts` 의 `seed.kind ?? "REPAIR"`). 여기에 사본을 두면 두
 * 곳이 서로 다른 기본값을 갖게 되는 날이 온다 — 그때 증상은 "주소로 들어올 때만
 * 종류가 다르다"라서 찾기 어렵다.
 *
 * ── ⚠️ 타입만 가져온다 ──────────────────────────────────────────────────
 * `@/lib/xlsx/*` 를 값으로 가져오면 `node:fs`·`node:zlib` 가 딸려 온다. 지금은
 * 서버 컴포넌트에서만 부르지만, 타입만 쓰면(컴파일에서 지워진다) 나중에
 * 클라이언트에서 불러도 안전하다 — `service-report-form.ts` 와 같은 규칙이다.
 * ============================================================================
 */

/**
 * 인정하는 값. 🔴 배열이 아니라 `Record<T, true>` 로 적어 둔다 — 배열이면 종류가
 * 하나 늘어도 tsc 가 아무 말을 안 하고, 그때 새 종류가 조용히 기본값으로 떨어진다
 * (`service-report-draft.ts` 의 `pickOneOf` 와 같은 판단).
 */
const SERVICE_REPORT_KINDS: Record<ServiceReportKind, true> = { INSPECTION: true, REPAIR: true };

/**
 * `searchParams.kind` → 보고서 종류. 고를 수 없으면 `null`(= 폼 씨앗의 기본값).
 *
 * 🔴 **다듬지도 대소문자를 맞추지도 않는다.** `?kind=repair` 를 받아 주는 것은
 * 친절이 아니라 규칙이 하나 더 생기는 것이다 — 우리가 만드는 링크는 언제나 이 두
 * 글자를 그대로 보낸다. 손으로 고친 주소는 기본값으로 떨어지면 그만이고, 화면
 * 안에서 종류를 바꾸는 길은 그대로 열려 있다.
 */
export function serviceReportKindFromParam(
  value: string | string[] | undefined | null
): ServiceReportKind | null {
  // 같은 이름이 두 번 올 수 있는 자리다(`?kind=A&kind=B` → 배열). 어느 쪽을
  // 고르든 근거가 없으므로 통째로 버린다 — 주간보고의 `?week=` 과 같은 판단
  // (`dashboard/weekly-report/page.tsx`).
  if (typeof value !== "string") return null;

  // 🔴 `value in SERVICE_REPORT_KINDS` 로 견주지 않는다. 그러면 `?kind=constructor`
  //    같은 프로토타입 이름이 통과해 그대로 종류 행세를 한다. 자기 키만 도는
  //    `Object.keys` 로 견주면 그 함정이 없고, 타입 단언도 필요 없다.
  return (Object.keys(SERVICE_REPORT_KINDS) as ServiceReportKind[]).find((kind) => kind === value) ?? null;
}
