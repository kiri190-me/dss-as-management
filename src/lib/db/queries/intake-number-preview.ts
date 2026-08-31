import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { repairCaseIntakeSequences } from "../schema";
import { formatIntakeNumber, yearMonthFromDate } from "@/lib/domain/local/intake-number";
import { isValidDateString } from "@/lib/domain/local/validation";

/**
 * ============================================================================
 * A/S 접수 폼이 보여 줄 "다음 인수번호" — 읽기만 한다
 * ============================================================================
 * 접수 폼의 인수번호 칸은 비워 두면 제출 시점에 서버가 채번한다. 담당자는 그
 * 번호를 미리 알고 싶어 하지만, 브라우저는 채번 시퀀스를 볼 수 없다 — 예전에
 * 있던 미리보기가 그달 내내 같은 고정값만 내놓다가 제거된 이유다.
 *
 * 그래서 서버가 대신 읽어 준다. 여기서 하는 일은 **SELECT 한 번뿐이다.**
 *
 *  🔴 절대 채번하지 않는다. repair_case_intake_sequences 를 INSERT 하지도,
 *     UPDATE 하지도 않는다 — 미리보기를 열어 보는 것만으로 번호가 소모되면
 *     아무도 접수하지 않은 달에 구멍이 뚫린다. 실제 채번은 지금도 제출
 *     트랜잭션(db/mutations/repair-cases.ts) 한 곳뿐이다.
 *
 *  ⚠️ 이 값은 **예상이다.** 읽은 뒤 다른 사람이 먼저 접수하면 실제 번호는
 *     한 칸 뒤가 된다. 화면도 "(예상)"이라고 적어 그렇게 읽히게 한다 —
 *     단언하지 않는 것이 예전 미리보기와 다른 점이다.
 * ============================================================================
 */

/**
 * 인수일이 속한 달에서 채번기가 **다음에 내줄** 인수번호.
 *
 * null 을 돌려주는 경우는 셋이다. 모두 "미리보기가 없을 뿐"이고 접수 자체는
 * 그대로 된다 — 부르는 쪽은 null 을 오류로 다루지 않는다.
 *  - 인수일이 아직 유효한 날짜가 아니다(사람이 타이핑하는 중)
 *  - 그달을 이미 99건까지 다 썼다(제출 시 기존 INTAKE_SEQUENCE_EXHAUSTED 가 막는다)
 *  - 조회 자체가 실패했다(부르는 액션이 삼킨다)
 */
export async function getNextIntakeNumberPreview(receivedAt: string): Promise<string | null> {
  if (!isValidDateString(receivedAt)) return null;

  const { yy, mm } = yearMonthFromDate(receivedAt);

  const [row] = await db
    .select({ lastSequence: repairCaseIntakeSequences.lastSequence })
    .from(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, `${yy}${mm}`))
    .limit(1);

  // 그달 행이 아직 없으면 채번기의 첫 값은 1 이다 — 뮤테이션의
  // `values({ lastSequence: 1 })` 와 같은 수를 여기서도 쓴다.
  const next = (row?.lastSequence ?? 0) + 1;

  // 채번기의 setWhere(last_sequence < 99)와 같은 한계다. 99 를 넘어서는
  // 번호를 미리 보여 주면 제출할 수 없는 값을 약속하는 셈이 된다.
  if (next > 99) return null;

  return formatIntakeNumber(yy, mm, next);
}
