import { PRODUCT_MODEL_KIND_CODES, type ProductModelKind } from "@/lib/validation/product-model-input";
import type { WorkflowKind } from "./workflow-kind";

/**
 * ============================================================================
 * 제품 종류(제너레이터 · 매쳐 · Total Controller) — 화면에 적히는 글자를 한 자리로
 * ============================================================================
 * 코드 목록의 정본은 **옮기지 않았다.** `PRODUCT_MODEL_KIND_CODES` 는 지금까지처럼
 * src/lib/validation/product-model-input.ts 에 있고 여기서는 그것을 가져다 다시
 * 내보낸다 — 그 파일은 수정 폼이 보내는 값을 거르는 자리라 목록이 거기 있는 것이
 * 맞고, 옮기면 그 파일을 읽는 통로·시험이 전부 따라 움직인다.
 *
 * ── 여기로 모은 것은 **이름표**다 ────────────────────────────────────────
 * 같은 세 글자가 네 화면에 따로 적혀 있었다 — ProductModelListScreen ·
 * ProductModelDetailScreen · ProductModelEditForm · CustomerDetailScreen. 그 중
 * 세 곳의 주석이 「형제 화면과 같은 말을 돌려준다」고 서로를 가리키고 있었는데,
 * 가리키는 것과 같은 것을 쓰는 것은 다르다 — 한 곳만 고쳐지는 날 같은 모델이
 * 화면마다 달라 보이고, 그때 아무 오류도 나지 않는다.
 *
 * 🔴 **보이는 글자는 한 글자도 바뀌지 않았다.** 네 화면이 들고 있던 값이 서로
 * 같았고(실측), 그 값을 그대로 옮겼다. 미지정(kind === null)의 글자도 네 곳이
 * 같았다.
 *
 * ── 「매쳐」와 「Matcher」는 다른 축의 이름이다 — 섞지 말 것 ───────────────
 * domain/workflow-kind.ts 의 `workflowKindLabels` 는 **수리 건의 워크플로 종류**
 * (repair_cases.workflow_type)를 한국어로 적는다 — 「매쳐」 · 「제너레이터」.
 * 이 파일은 **모델 마스터의 종류**(product_models.kind)를 적고, 그 화면들은
 * 영문 표기를 쓴다 — 「Matcher」 · 「Generator」. 스키마 주석이 두 축을 일부러
 * 안 섞는다고 세 번 못 박고 있으므로, 어느 쪽 이름표를 쓸지는 **그 화면이 무엇을
 * 보여 주는가**로 정한다. 한국어로 적는 자리의 철자는 「매쳐」다(「메쳐」가 아니다).
 *
 * ── 순수 파일이다 ────────────────────────────────────────────────────────
 * server-only / drizzle / React 를 import 하지 않는다 — 서버 컴포넌트와 클라이언트
 * 컴포넌트가 모두 이것을 가져다 쓴다.
 * ============================================================================
 */

export { PRODUCT_MODEL_KIND_CODES };
export type { ProductModelKind };

/**
 * 화면에 보이는 글자. 🔴 **값을 바꾸지 말 것** — 네 화면이 지금 이 글자를 보이고
 * 있고, 그것이 사용자가 아는 이름이다.
 */
export const PRODUCT_MODEL_KIND_LABELS: Record<ProductModelKind, string> = {
  GENERATOR: "Generator",
  MATCHER: "Matcher",
  TOTAL_CONTROLLER: "Total Controller (T/C)",
};

/** 종류를 고르지 않은 모델. 네 화면이 모두 이 글자였다. */
export const PRODUCT_MODEL_KIND_UNSPECIFIED_LABEL = "미지정";

/**
 * 목록에 있는 코드인가. URL 마디나 질의문자열처럼 **아무 글자나 올 수 있는 자리**가
 * 이것으로 좁힌다 — 셋 중 하나가 아니면 화면은 404, 통로는 400 이다.
 */
export function isProductModelKind(value: unknown): value is ProductModelKind {
  return typeof value === "string" && (PRODUCT_MODEL_KIND_CODES as readonly string[]).includes(value);
}

/**
 * 모델 한 줄에 적을 종류 이름. 종류가 비어 있으면 「미지정」이고, 목록 밖의 값이
 * 들어오면 **그 값을 그대로** 보인다 — 네 화면이 지금 하던 그대로다(값이 비어
 * 보이면 칸이 밀린 것인지 모르는 것인지 가릴 수 없다).
 */
export function productModelKindLabel(kind: string | null | undefined): string {
  if (!kind) return PRODUCT_MODEL_KIND_UNSPECIFIED_LABEL;
  return PRODUCT_MODEL_KIND_LABELS[kind as ProductModelKind] ?? kind;
}

/**
 * ============================================================================
 * 🔴 **워크플로 종류 → 제품 종류** — 두 축을 잇는 자리는 여기 하나뿐이다 (2026-10-06)
 * ============================================================================
 * 수리 건에는 **접수할 때 사람이 고른 종류**가 있다. 그것은 워크플로 축의 값이고
 * (domain/workflow-kind.ts 의 `workflowKindOf(workflowType)`), 이 파일이 다루는
 * **제품 종류**(product_models.kind · 종류 공통 서류함의 주인)와는 **다른 축**이다 —
 * 스키마 주석이 두 축을 일부러 안 섞는다고 세 번 못 박고 있고, 위 머리말도 이름표가
 * 서로 다르다는 사실로 같은 말을 한다.
 *
 * ── 왜 변환이 필요한가 ───────────────────────────────────────────────────
 * 접수 건의 **공통 서류**를 고르려면 「이 건이 어느 종류인가」를 제품 종류 축의 값으로
 * 바꿔야 한다. 🔴 그때 **제품 모델 마스터의 `kind` 를 쓰지 않는다**: 그 칸은 비어 있는
 * 모델이 많고, 같은 장비가 들어올 때마다 다른 종류로 다뤄진 실제 사례가 있다. 쓰는 것은
 * **접수할 때 사람이 고른 종류**다.
 *
 * ── 🔴 값이 같아도 타입을 바꿔치기하지 않는다 ───────────────────────────
 * `WORKFLOW_KIND_CODES` 와 `PRODUCT_MODEL_KIND_CODES` 는 지금 **같은 세 글자**다
 * (`MATCHER` · `GENERATOR` · `TOTAL_CONTROLLER` — 적힌 차례만 다르다). 그래서 변환이
 * 자명하지만, 자명하다고 `as ProductModelKind` 를 부르는 쪽마다 적으면 **한쪽 축에 값이
 * 하나 느는 날** 그 자리들이 전부 조용히 틀린다. 옮기는 자리를 여기 하나로 두고, 아래
 * 표를 손으로 적어 **값마다 한 번씩** 짝을 명시한다(둘 중 하나가 늘면 컴파일러가 짚는다).
 *
 * ── 🔴 함정 — 레거시 `MATCHER` 는 제너레이터로 읽힌다 ────────────────────
 * DB enum 에는 유·무상 접미사가 없는 **레거시 `MATCHER`** workflowType 이 아직 남아
 * 있고, `workflowKindOf` 는 접미사를 못 찾으면 **조용히 `GENERATOR` 를 돌려준다**
 * (끝에 `_MATCHER` 도 `_TOTAL_CONTROLLER` 도 아니기 때문이다). 새 접수에는 그 값이 들어
 * 오지 않지만(접수 검증이 허용 목록으로 막는다), 과거 건을 이 길에 태우면 매쳐 건에
 * 제너레이터 서류가 붙는다. **지난 건에 소급 적용하지 않는 까닭 가운데 하나다.**
 * ============================================================================
 */
const PRODUCT_MODEL_KIND_BY_WORKFLOW_KIND: Record<WorkflowKind, ProductModelKind> = {
  MATCHER: "MATCHER",
  GENERATOR: "GENERATOR",
  TOTAL_CONTROLLER: "TOTAL_CONTROLLER",
};

/** 워크플로 축의 종류를 제품 종류 축의 값으로 옮긴다. 🔴 옮기는 자리는 여기 하나뿐이다. */
export function productModelKindOfWorkflowKind(kind: WorkflowKind): ProductModelKind {
  return PRODUCT_MODEL_KIND_BY_WORKFLOW_KIND[kind];
}
