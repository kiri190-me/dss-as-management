import "server-only";
import { like } from "drizzle-orm";
import { db } from "../client";
import { repairCases } from "../schema";
import { nextReportNumber, reportNumberYearDigit } from "@/lib/domain/repair-case-report-number";
import { toKstDateOnly } from "@/lib/domain/date-only";

/**
 * ============================================================================
 * A/S 접수 폼이 보여 줄 "다음 보고서번호" — 읽기만 한다
 * ============================================================================
 * 인수번호 미리보기(queries/intake-number-preview.ts)와 **같은 결**이다. 접수
 * 폼의 보고서번호 칸은 비워 두면 제출 시점에 서버가 매긴다(2026-10-18부터).
 * 담당자는 그 번호를 미리 보고 싶어 하지만 브라우저는 이미 쓰인 번호들을 볼 수
 * 없으므로, 서버가 대신 **SELECT 한 번**으로 읽어 준다.
 *
 *  🔴 **규칙을 여기에 다시 적지 않는다.** 앞자리·순번·2030년·999 초과·무엇을
 *     세고 무엇을 빼는가는 전부 domain/repair-case-report-number.ts 의
 *     `nextReportNumber` 가 안다. 실제로 매기는 자리
 *     (db/mutations/repair-cases.ts 의 allocateLegacyReportNumber)가 부르는
 *     **바로 그 함수**를 여기서도 부른다 — 한쪽에 규칙을 베껴 두면 예상값과
 *     실제 번호가 조용히 어긋난다.
 *
 *  🔴 **좁히는 조건도 그쪽과 같다.** `like('{앞자리}%')` 로 끌어오고 네 자리인지
 *     ·올해 것인지는 순수 모듈이 다시 본다. 휴지통에 간 건(is_deleted)도 거르지
 *     않는다 — 그쪽이 세는 것을 여기서 빼면 한 칸 앞선 번호를 약속하게 된다.
 *
 *  🔴 **기준은 인수일이 아니라 오늘(한국 날짜)이다.** 보고서번호는 등록한
 *     차례대로 나가는 번호다. 그래서 인수번호 미리보기와 달리 인수일을 받지
 *     않고, 날짜가 바뀌었는지 대조할 일도 없다 — 폼을 열 때 한 번 읽으면 된다.
 *
 *  🔴 **절대 쓰지 않는다.** INSERT 도 UPDATE 도 없다. 미리보기를 열어 보는
 *     것만으로 번호가 소모되면 아무도 접수하지 않은 날에 구멍이 뚫린다.
 *
 *  ⚠️ 이 값은 **예상이다.** 읽은 뒤 다른 사람이 먼저 접수하면 실제 번호는 한 칸
 *     뒤가 된다. 화면도 "(예상)"이라고 적어 그렇게 읽히게 한다.
 * ============================================================================
 */

/**
 * 오늘 기준으로 **다음에 나갈** 보고서번호.
 *
 * null 은 "미리보기가 없을 뿐"이고 접수 자체는 그대로 된다 — 부르는 쪽은 null 을
 * 오류로 다루지 않는다. 세 경우다.
 *  - 번호를 매길 수 없는 해(2030년 이후 · 2021년 이전) — 앞자리를 지어내지 않는다
 *  - 올해 999건을 다 썼다 — 모양이 깨지는 번호를 약속하지 않는다
 *  - 조회 자체가 실패했다(부르는 액션이 삼킨다)
 *
 * 앞의 둘은 제출 때도 번호가 비는 경우다(allocateLegacyReportNumber 가 같은
 * 이유로 null 을 낸다) — 그때 화면이 흐린 글씨를 감추는 것이 맞다.
 */
export async function getNextReportNumberPreview(): Promise<string | null> {
  const today = toKstDateOnly(new Date());
  const yearDigit = reportNumberYearDigit(today);

  // 매길 수 없는 해면 조회조차 하지 않는다 — 뮤테이션과 같은 순서다.
  if (yearDigit === null) return null;

  const used = (
    await db
      .select({ value: repairCases.legacyReportNumber })
      .from(repairCases)
      .where(like(repairCases.legacyReportNumber, `${yearDigit}%`))
  ).map((row) => row.value);

  const next = nextReportNumber(used, today);
  return next.ok ? next.reportNumber : null;
}
