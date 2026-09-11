import "server-only";

import { db } from "../client";
import { domesticOrderSheetSettings } from "../schema";
import {
  DEFAULT_DOMESTIC_ORDER_SHEET_HEADING,
  type DomesticOrderSheetHeadingText,
} from "@/lib/domain/domestic-order-sheet-heading";

/**
 * ============================================================================
 * 내자 정리 머리말 읽기
 * ============================================================================
 * 행이 없으면 **코드의 기본 문구**를 돌려준다(domain/domestic-order-sheet-heading.ts).
 * 설치 시점에 한 줄 심어 두지 않는 이유는 스키마 주석에 있다.
 *
 * ── 🔴 표가 아직 없어도 화면은 죽지 않는다 ────────────────────────────────
 * 마이그레이션 0092 를 적용하기 전의 DB(다른 개발자 PC, NAS 첫 배포, 지금 떠 있는
 * 개발 서버)에서 여기서 예외를 던지면 **내자 정리 화면이 통째로 죽는다.** 표가
 * 없다는 것은 저장된 머리말이 존재할 수 없다는 뜻이고, 그때의 답은 정확히 이 기능을
 * 넣기 전의 문구다 — 삼켜도 잃는 것이 없다. ui-text-overrides.ts · permission-resolver.ts
 * 와 같은 처리다.
 *
 * 42P01(표 없음) 하나만 삼킨다. 연결 실패 같은 다른 사고까지 삼키면 저장해 둔 문구가
 * DB 가 흔들리는 사이 기본 문구로 돌아갔다 오고, 그 원인을 로그에서 찾을 길이 없다.
 * ============================================================================
 */

export type DomesticOrderSheetHeadingView = DomesticOrderSheetHeadingText & {
  /** 저장된 행이 있는가. 없으면 위 두 값은 코드의 기본 문구다. */
  isCustomized: boolean;
};

/** Postgres: 관계(테이블)가 존재하지 않음. */
const UNDEFINED_TABLE = "42P01";

function isUndefinedTableError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if ("code" in err && (err as { code?: unknown }).code === UNDEFINED_TABLE) return true;
  // drizzle 이 드라이버 오류를 cause 로 감싸 던지는 경우가 있다.
  const cause = (err as { cause?: unknown }).cause;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === UNDEFINED_TABLE
  );
}

/** 저장된 행 그대로. 없으면 null — 기본 문구를 섞지 않는다(시험이 이 둘을 가른다). */
export async function loadStoredDomesticOrderSheetHeading(): Promise<DomesticOrderSheetHeadingText | null> {
  const [row] = await db
    .select({
      greetingText: domesticOrderSheetSettings.greetingText,
      internalMemo: domesticOrderSheetSettings.internalMemo,
    })
    .from(domesticOrderSheetSettings)
    .limit(1);
  return row ?? null;
}

/** 화면이 쓰는 읽기. 행이 없거나 표가 아직 없으면 기본 문구다. */
export async function getDomesticOrderSheetHeading(): Promise<DomesticOrderSheetHeadingView> {
  try {
    const stored = await loadStoredDomesticOrderSheetHeading();
    if (stored) return { ...stored, isCustomized: true };
  } catch (err) {
    if (!isUndefinedTableError(err)) throw err;
    console.warn(
      "domestic_order_sheet_settings 테이블이 없습니다 — 마이그레이션 적용 전까지 기본 머리말로 동작합니다."
    );
  }
  return { ...DEFAULT_DOMESTIC_ORDER_SHEET_HEADING, isCustomized: false };
}
