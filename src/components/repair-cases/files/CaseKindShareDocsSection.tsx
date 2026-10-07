"use client";

import {
  KIND_SHARE_DOCS_HINT,
  KindShareDocList,
  KindShareDocsHelperNotice,
  type KindShareDocRow,
} from "@/components/product-models/KindShareDocsSection";
import { PRODUCT_MODEL_KIND_LABELS, type ProductModelKind } from "@/lib/domain/product-model-kind";

/**
 * ============================================================================
 * 파일 관리 탭의 **이 종류 공통 서류(공유폴더 가리킴)** 구역 (2026-10-07)
 * ============================================================================
 * 「이 때 지정되는 파일은 업로드 되는게 아니라, **수리건 상세에서도 바로 파일을 열 수
 * 있도록** 할꺼야」(사용자 요구 2026-10-07). 제품 모델 관리에서 종류마다 가리켜 둔 공유폴더
 * 자리를, 그 종류의 수리 건 상세에서 **그대로 보고 바로 연다.**
 *
 * ── 🔴 **보고 여는 자리**다 — 담기도 지우기도 없다 ───────────────────────
 * 고치는 곳은 「제품 모델 관리 → 종류별 공통 서류」 한 곳뿐이다. 여기서 한 줄을 지우면
 * **그 종류의 모든 수리 건**에서 사라진다 — 그런 조작을 건 상세에 두면 한 건을 보던 사람이
 * 전체를 바꾼다. 그래서 `KindShareDocList` 에 `onRemove` 를 **주지 않는다**(주지 않으면 단추가
 * 한 줄에도 그려지지 않는다 — 그 조각의 머리말).
 *
 * ── 🔴 베끼지 않았다 — 줄을 그리는 조각을 그대로 가져다 쓴다 ─────────────
 * 줄의 생김새 · 이름이 빌 때의 규칙 · [열기]를 그릴 줄의 판정(canOpenKindShareDoc)은 전부
 * components/product-models/KindShareDocsSection 의 것이다. 🔴 **공유폴더 맨 위 칸에 바로 놓인
 * 파일에는 [열기]가 없다** — 도우미 주소가 `폴더/파일` 모양이라 앞에 붙일 폴더가 없으면
 * 주소를 만들 수 없다. 그 판정도 그 조각 안에 있으므로 여기서는 한 글자도 다시 적지 않는다.
 *
 * ── 🔴 한 줄도 없으면 구역을 **아예 그리지 않는다** ──────────────────────
 * 이웃 구역들과 같은 규율이다(QuoteArchiveProductFolderSection · ContactFolderSection 의
 * `disabled`). 파일 관리 탭은 이미 빽빽하고, 「아직 가리켜 둔 서류가 없습니다」 상자는 이 탭에
 * 온 사람이 할 수 있는 일이 아무것도 없는 안내다 — 고치는 자리는 다른 화면이다.
 *
 * ── 🔴 인쇄에 안 찍힌다 ─────────────────────────────────────────────────
 * 바깥 틀에 `print:hidden` 을 건다. 바로 위 공유폴더 구역이 그은 선과 **같다**: 공유폴더는
 * 그때그때 달라지는 바깥 사정이라 종이에 남길 것이 아니고, 줄에 적히는 것은 **경로**지
 * 이 건의 사실이 아니다. 종이에 남는 것은 이 건에 실제로 올라온 파일 목록이다.
 *
 * ── 🔴 어느 종류인가는 **이 조각이 정하지 않는다** ────────────────────────
 * 받아서 쓸 뿐이다. 수리 건에는 `product_model_kind` 칸이 없고, 워크플로 종류에서 옮기는
 * 자리는 저장소에 하나뿐이다(domain/product-model-kind.ts 의 productModelKindOfWorkflowKind).
 * 부르는 쪽(FilesScreen)이 그 함수를 부른다.
 * ============================================================================
 */

/** 머리 — 어느 종류의 서류인지와 몇 줄인지 함께 적는다. */
export function caseKindShareDocsSectionTitle(kind: ProductModelKind, count: number): string {
  return `${PRODUCT_MODEL_KIND_LABELS[kind]} 공통 서류 (${count}건)`;
}

/** 🔴 고치는 자리를 알려 준다 — 여기서는 지울 수 없다는 사실이 함께 읽히게. */
export const CASE_KIND_SHARE_DOCS_MANAGE_HINT =
  "이 목록은 「제품 모델 관리 → 종류별 공통 서류」에서 정합니다 — 이 화면에서는 보고 열기만 합니다.";

export default function CaseKindShareDocsSection({
  kind,
  docs,
}: {
  kind: ProductModelKind;
  /** 🔴 서버가 DB 에서 읽어 **보이는 차례 그대로** 넘긴 줄들. 여기서 다시 정렬하지 않는다. */
  docs: readonly KindShareDocRow[];
}) {
  // 🔴 한 줄도 없으면 구역 자체가 없다(머리말).
  if (docs.length === 0) return null;

  return (
    <section
      aria-labelledby="case-kind-share-docs-title"
      data-case-kind-share-docs-section=""
      className="print:hidden flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 id="case-kind-share-docs-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {caseKindShareDocsSectionTitle(kind, docs.length)}
        </h2>
        {/* 🔴 「왜 내려받기가 없지」에서 멈추지 않게 — 저쪽 구역과 **같은 문장**이다. */}
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{KIND_SHARE_DOCS_HINT}</span>
      </div>

      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{CASE_KIND_SHARE_DOCS_MANAGE_HINT}</p>

      {/* 🔴 `onRemove` 를 주지 않는다 — 지우기 단추가 한 줄에도 그려지지 않는다. */}
      <KindShareDocList docs={docs} />

      {/* 예전 도우미는 새 루트도 `openfile` 주소도 모른다 — 받으면 조용히 끝난다. */}
      <KindShareDocsHelperNotice />
    </section>
  );
}
