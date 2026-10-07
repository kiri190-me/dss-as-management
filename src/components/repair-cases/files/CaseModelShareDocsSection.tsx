"use client";

import {
  MODEL_SHARE_DOCS_HINT,
  ModelShareDocList,
  type ModelShareDocRow,
} from "@/components/product-models/ModelShareDocsSection";
import { KindShareDocsHelperNotice } from "@/components/product-models/KindShareDocsSection";

/**
 * ============================================================================
 * 파일 관리 탭의 **이 제품 모델 전용 서류(공유폴더 가리킴)** 구역 (2026-10-08)
 * ============================================================================
 * 「제품 상세에도 … 창을 만들어서 **해당 제품으로 등록된 수리건 상세에서 파일을 열어볼 수
 * 있도록** 해줘」(사용자 요구 2026-10-07). 제품 모델 상세에서 그 모델 하나에 가리켜 둔
 * 공유폴더 자리를, 그 모델의 수리 건 상세에서 **그대로 보고 바로 연다.**
 *
 * 바로 위 형제(CaseKindShareDocsSection)를 **본떴고**, 🔴 그 파일은 한 글자도 건드리지
 * 않았다. 다른 것은 **주인 하나**다 — 저쪽 주인은 제품 **종류**(enum)이고 이쪽 주인은 이
 * 건의 장비가 물고 있는 **제품 모델의 행**이다.
 *
 * ── 🔴 파일 관리 탭에 공유폴더 쪽 구역이 **셋**이다 — 뜻이 다르다 ────────
 *  · ContactFolderSection      = **이 건 하나**의 연락서 폴더 안
 *  · CaseKindShareDocsSection  = 그 **종류 전체**가 함께 쓰는 자리
 *  · 여기                      = **이 제품 모델**의 자리(모델이 다르면 다른 줄이다)
 * 셋이 나란히 서므로 **제목이 그 차이를 말한다** — 아래 caseModelShareDocsSectionTitle 은
 * 「이 제품 모델 전용」이라 적고, 종류 쪽은 「Generator 공통」처럼 종류 이름을 적는다.
 *
 * ── 🔴 **보고 여는 자리**다 — 담기도 지우기도 없다 ───────────────────────
 * 고치는 곳은 「제품 모델 관리 → 그 모델 상세」 한 곳뿐이다. 여기서 한 줄을 지우면 **그
 * 모델의 모든 수리 건**에서 사라진다 — 그런 조작을 건 상세에 두면 한 건을 보던 사람이
 * 모델 전체를 바꾼다. 그래서 `ModelShareDocList` 에 `onRemove` 를 **주지 않는다**(주지
 * 않으면 단추가 한 줄에도 그려지지 않는다 — 그 조각의 머리말). 서버 액션도 물지 않는다.
 *
 * ── 🔴 베끼지 않았다 — 줄을 그리는 조각을 그대로 가져다 쓴다 ─────────────
 * 줄의 생김새 · 이름이 빌 때의 규칙 · [열기]를 그릴 줄의 판정(canOpenModelShareDoc)은 전부
 * components/product-models/ModelShareDocsSection 의 것이다. 🔴 **공유폴더 맨 위 칸에 바로
 * 놓인 파일에는 [열기]가 없다** — 도우미 주소가 `폴더/파일` 모양이라 앞에 붙일 폴더가
 * 없으면 주소를 만들 수 없다. 그 판정도 그 조각 안에 있으므로 여기서는 한 글자도 다시
 * 적지 않는다. 도우미 안내도 공용 조각(KindShareDocsHelperNotice) 그대로다.
 *
 * ── 🔴 한 줄도 없으면 구역을 **아예 그리지 않는다** ──────────────────────
 * 이웃 구역들과 같은 규율이다. 🔴 **0건이 되는 길이 둘 더 있다**: 이 건의 장비가 모델
 * 마스터에 안 묶였거나(`products.product_model_id` 는 NULL 을 허용한다), 묶인 모델이
 * 휴지통에 있다. 둘 다 서버가 `getProductModelIdForProduct` 에서 `null` 로 받아 **DB 를 더
 * 읽지 않고** 빈 목록을 내려 준다(files/page.tsx) — 화면은 그 빈 목록을 여느 0건과 똑같이
 * 다룬다. 「모델이 없습니다」 상자를 세우지 않는다: 이 탭에 온 사람이 할 수 있는 일이
 * 아무것도 없는 안내다.
 *
 * ── 🔴 인쇄에 안 찍힌다 ─────────────────────────────────────────────────
 * 바깥 틀에 `print:hidden` 을 건다. 위 두 구역이 그은 선과 **같다**: 줄에 적히는 것은
 * **경로**지 이 건의 사실이 아니다. 종이에 남는 것은 이 건에 실제로 올라온 파일 목록이다.
 *
 * ── 🔴 어느 모델인가는 **이 조각이 정하지 않는다** ────────────────────────
 * 받아서 쓸 뿐이다. 수리 건 → 장비 → 모델 마스터를 잇는 자리는 저장소에 하나뿐이고
 * (db/queries/repair-cases.ts 의 getProductModelIdForProduct), 서버 컴포넌트가 그 함수를
 * 부른다.
 * ============================================================================
 */

/** 머리 — 🔴 종류 구역과 **구별되게** 적는다(머리말). 몇 줄인지 함께. */
export function caseModelShareDocsSectionTitle(count: number): string {
  return `이 제품 모델 전용 서류 (${count}건)`;
}

/** 🔴 고치는 자리를 알려 준다 — 여기서는 지울 수 없다는 사실이 함께 읽히게. */
export const CASE_MODEL_SHARE_DOCS_MANAGE_HINT =
  "이 목록은 「제품 모델 관리 → 그 모델 상세」에서 정합니다 — 이 화면에서는 보고 열기만 합니다.";

export default function CaseModelShareDocsSection({
  docs,
}: {
  /** 🔴 서버가 DB 에서 읽어 **보이는 차례 그대로** 넘긴 줄들. 여기서 다시 정렬하지 않는다. */
  docs: readonly ModelShareDocRow[];
}) {
  // 🔴 한 줄도 없으면 구역 자체가 없다(머리말). 모델을 못 찾은 경우도 여기로 들어온다.
  if (docs.length === 0) return null;

  return (
    <section
      aria-labelledby="case-model-share-docs-title"
      data-case-model-share-docs-section=""
      className="print:hidden flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 id="case-model-share-docs-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {caseModelShareDocsSectionTitle(docs.length)}
        </h2>
        {/* 🔴 「왜 내려받기가 없지」에서 멈추지 않게 — 모델 상세 구역과 **같은 문장**이다. */}
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{MODEL_SHARE_DOCS_HINT}</span>
      </div>

      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{CASE_MODEL_SHARE_DOCS_MANAGE_HINT}</p>

      {/* 🔴 `onRemove` 를 주지 않는다 — 지우기 단추가 한 줄에도 그려지지 않는다. */}
      <ModelShareDocList docs={docs} />

      {/* 예전 도우미는 새 루트도 `openfile` 주소도 모른다 — 받으면 조용히 끝난다. */}
      <KindShareDocsHelperNotice />
    </section>
  );
}
