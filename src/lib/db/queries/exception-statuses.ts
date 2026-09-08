import "server-only";

import { cache } from "react";
import { db } from "../client";
import { exceptionStatuses } from "../schema";
import { getAuthSource } from "@/lib/config/auth-source";
import type { ExceptionStatusLabelRow } from "@/lib/domain/ui-text";

/**
 * ============================================================================
 * 예외 상태 이름표 읽기
 * ============================================================================
 * exception_statuses 는 관리자가 늘리고 끌 수 있는 **주인 있는 표**다(코드 9개가
 * 이미 씨앗으로 들어 있다). 그런데 화면 셋 — 수리 상세의 예외 상태 안내,
 * 내 담당 작업의 예외 상태 배지, 내 담당 작업 필터 — 이 여태 코드 표
 * (domain/types.ts 의 exceptionStatusLabels)를 읽고 있었다. 같은 문구의 진실이
 * 두 곳에 있었다는 뜻이고, DB 쪽 label 을 고쳐도 화면은 꿈쩍하지 않았다.
 * 이 조회가 그 이중 진실을 닫는다.
 *
 * ── 코드 표를 지우지 않는다 ─────────────────────────────────────────────
 * 여기서 못 읽었을 때(표가 없거나, 그 코드의 행이 없거나, 로컬 데모 모드)
 * 돌아갈 자리가 필요하다. 병합은 domain/ui-text.ts 가 하고, 이 파일은 읽기만
 * 한다 — ui-text-overrides.ts 가 등록부와 대조하지 않는 것과 같은 분업이다.
 *
 * ── 3단이 아니라 2단인 이유 ─────────────────────────────────────────────
 * queries/ui-theme-tokens.ts · ui-text-overrides.ts 는 "그대로 읽기 / 화면용
 * 너그러운 읽기 / 편집기용 view" 3단이다. 여기에는 세 번째 단이 없다 — 예외
 * 상태를 **편집하는 화면이 아직 없기 때문**이다. 쓰지 않는 view 를 미리 만들어
 * 두면 그것이 어떤 화면의 요구를 담은 것인지 아무도 모르는 채로 남는다.
 * 편집 화면이 생기는 날, 그 화면의 요구(표가 없다는 사실을 삼키지 않는다)에
 * 맞춰 buildExceptionStatusView 를 더하면 된다.
 * ============================================================================
 */

/** Postgres: 관계(테이블)가 존재하지 않음. */
const UNDEFINED_TABLE = "42P01";

/** 표가 없을 때의 답. 코드의 기본 문구가 그 빈자리를 채운다. */
const NO_EXCEPTION_STATUS_LABELS: readonly ExceptionStatusLabelRow[] = [];

/**
 * 저장된 행을 그대로 읽는다.
 *
 * is_active 를 조건으로 걸지 않는다. 꺼 둔 예외 상태라도 **이미 그 값을 가진
 * 접수 건**이 목록과 상세에 남아 있고, 그때 이름표가 사라지면 화면에는 빈칸만
 * 보인다 — 관리자에게 그것은 고장과 구별되지 않는다. 끄는 것은 "새로 고를 수
 * 없게" 하는 뜻이지 "지난 것을 못 읽게" 하는 뜻이 아니다.
 */
export async function loadStoredExceptionStatusLabels(): Promise<ExceptionStatusLabelRow[]> {
  return db
    .select({ code: exceptionStatuses.code, label: exceptionStatuses.label })
    .from(exceptionStatuses);
}

/**
 * 화면이 쓰는 읽기. 표가 아직 없어도 죽지 않는다.
 *
 * 🔴 이 조회는 **루트 레이아웃**에 붙는다 — 앱의 모든 화면이 그 아래에 있다.
 * 마이그레이션을 아직 적용하지 않은 DB(다른 개발자 PC, NAS 첫 배포)에서 여기서
 * 예외를 그대로 던지면 화면이 한꺼번에 죽고, 고치러 들어갈 화면조차 안 뜬다.
 * 표가 없다는 것은 관리자가 문구를 손댄 적이 없다는 뜻이고, 그때의 동작은
 * 정확히 이 기능을 넣기 전의 동작이다 — 삼켜도 잃는 것이 없다.
 *
 * "표 없음" 하나만 삼킨다. 연결 실패·권한 오류까지 조용히 넘기면, 문구를 바꿔 둔
 * 운영 환경에서 DB 가 잠깐 흔들리는 사이 앱 전체가 기본 문구로 돌아갔다 오는
 * 상태가 되고, 그 깜빡임의 원인을 로그에서 찾을 길이 없다.
 *
 * AUTH_SOURCE 가 database 가 아니면 DB 를 아예 읽지 않는다 — 로컬 데모 모드에는
 * 이 표가 없을 수 있고, 없다고 해서 화면이 죽으면 안 된다.
 *
 * React 의 cache() 로 감싸 요청 한 번에 조회 한 번만 돈다.
 */
export const loadExceptionStatusLabels = cache(
  async (): Promise<readonly ExceptionStatusLabelRow[]> => {
    if (getAuthSource() !== "database") return NO_EXCEPTION_STATUS_LABELS;
    try {
      return await loadStoredExceptionStatusLabels();
    } catch (err) {
      if (isUndefinedTableError(err)) {
        console.warn(
          "exception_statuses 테이블이 없습니다 — 마이그레이션 적용 전까지 코드의 기본 문구로 동작합니다."
        );
        return NO_EXCEPTION_STATUS_LABELS;
      }
      throw err;
    }
  }
);

function isUndefinedTableError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === UNDEFINED_TABLE
  );
}
