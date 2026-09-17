import { useId, useState, type MouseEvent } from "react";
import Link from "next/link";
import { StatusBadge, SourceBadge } from "@/components/repair-cases/badges";
import { showSavePopup } from "@/components/common/SavePopup";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { RelatedMatch } from "@/lib/domain/local/product-history-match";
import type { RepairCaseEditSection } from "@/lib/validation/repair-case-update-input";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import { workflowKindLabels, workflowKindOf } from "@/lib/domain/workflow-kind";
import ProductInfoEditForm from "./edit/ProductInfoEditForm";
import OverhaulBadge from "@/components/common/OverhaulBadge";

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value ?? "-"}</dd>
    </div>
  );
}

/**
 * 이력 한 줄 안의 보조 줄(신고증상 · 조치 내용). 값이 없으면 "-" 를 그린다.
 * 🔴 긴 글이 칸을 무너뜨리지 않게 두 줄에서 자른다 — 작업기록 메모는 길이
 * 제한이 느슨해서 그대로 풀면 이력 한 줄이 화면을 다 먹는다.
 */
function HistoryLine({ label, value }: { label: string; value: string | null }) {
  return (
    <span className="flex gap-1.5 text-xs">
      <span className="shrink-0 text-zinc-400 dark:text-zinc-500">{label}</span>
      <span className="line-clamp-2 min-w-0 text-zinc-600 dark:text-zinc-300">{value ?? "-"}</span>
    </span>
  );
}

/**
 * 가로채도 되는 누름인가 — 평범한 왼쪽 클릭 하나뿐이다.
 *
 * 🔴 수식 키(⌘·Ctrl·Shift·Alt)를 짚었거나 왼쪽 단추가 아니면 거짓이다. 그때는
 * preventDefault 하지 않고 <Link href> 가 하던 일을 그대로 두어야 한다 —
 * 새 탭으로 열기·새 창으로 열기를 팝업이 뺏으면 안 된다.
 */
function isPlainLeftClick(event: MouseEvent): boolean {
  return (
    event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
  );
}

/**
 * 과거 A/S 이력 한 줄.
 *
 * 🔴 세 줄 구성(머리 줄 · 신고증상 · 조치 내용)은 눈 확인까지 끝난 모양이다.
 * 접기를 붙이면서 목록이 둘(가장 최근 1건 · 접히는 나머지)로 갈라져 같은 줄을
 * 두 곳에서 그리게 됐을 뿐이라 함수로 뽑았다 — 그린 결과는 한 글자도 다르지
 * 않고, 두 목록이 영영 같은 모양으로 남는다(한쪽만 고쳐지는 날이 없다).
 */
function HistoryItem({
  item,
  actionSummary,
}: {
  item: RelatedMatch;
  /** 이 건의 `조치 내용`(작업기록에서 도출, 없으면 null) — see RepairCaseDetailView. */
  actionSummary: string | null;
}) {
  return (
    <li>
      {/* 누르면 「이전 이력으로 이동합니다.」가 잠깐 떴다가 그 건으로 넘어간다
          (2026-09-17 요구). 저장·등록이 쓰던 팝업을 그대로 부른다 — 부르고 끝이고,
          기다리지도 router.push 하지도 않는다(lib/domain/save-popup.ts 머리말).
          떠 있는 시간(0.5초)도 그 파일의 상수라 여기 다시 적지 않는다.

          🔴 redirectTo 를 반드시 준다. null 이면 0.5초 뒤 팝업만 닫히는데, 수리건
          상세는 서버에서 오는 데 시간이 걸려 팝업이 먼저 사라지고 **누르기 전 화면이
          그대로** 남는다("안 눌렸나?"). 주소를 주면 팝업이 그 0.5초 동안 다음 화면을
          미리 받아 두고(router.prefetch) 도착할 때까지 붙들어 준다.

          🔴 href 는 지우지 않는다. 가로채는 것은 평범한 왼쪽 클릭뿐이고, 그 밖의
          누름은 여기서 손대지 않아 <Link> 가 하던 대로 동작한다. */}
      <Link
        href={`/repair-cases/${item.id}`}
        onClick={(event) => {
          if (!isPlainLeftClick(event)) return;
          event.preventDefault();
          showSavePopup({
            message: "이전 이력으로 이동합니다.",
            redirectTo: `/repair-cases/${item.id}`,
          });
        }}
        className="flex flex-col gap-1 rounded-md border border-zinc-100 p-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
      >
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-50">
            {item.intakeNumber}
            <SourceBadge source={item.source} />
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">접수일 {item.receivedAt}</span>
          {item.status === "SHIPMENT_COMPLETED" && item.actualShipmentDate ? (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              출하 완료 {item.actualShipmentDate}
            </span>
          ) : (
            <StatusBadge status={item.status} />
          )}
        </span>
        <HistoryLine label="신고증상" value={item.reportedSymptom} />
        <HistoryLine label="조치 내용" value={actionSummary} />
      </Link>
    </li>
  );
}

export default function ProductInfoSection({
  resolved,
  related,
  relatedActionSummaries,
  editableFields,
  editingSection,
  referenceData,
  onStartEdit,
  onDone,
}: {
  resolved: EffectiveRepairCase;
  related: RelatedMatch[];
  /** 건 id → 이력 줄에 그릴 `조치 내용`(작업기록에서 도출, 없으면 null) — see RepairCaseDetailView. */
  relatedActionSummaries: Record<string, string | null>;
  editableFields: readonly string[] | null;
  editingSection: RepairCaseEditSection | null;
  referenceData: IntakeReferenceData | null;
  onStartEdit: () => void;
  onDone: () => void;
}) {
  const isEditing = editingSection === "PRODUCT";
  const canShowEditButton = editableFields !== null && editingSection === null;

  /**
   * 과거 A/S 이력에서 **가장 최근 1건만** 펴 두고 나머지는 접는다(2026-09-17
   * 요구). 오래 쓴 제품은 이력이 열 건을 넘기도 하는데, 그 목록이 제품 정보 칸
   * 아래로 화면 한 판을 밀어내고 있었다. 접혀도 머리 문구("…: N건")는 그대로
   * 남는다 — 몇 건인지는 펼치지 않고도 알아야 한다.
   *
   * 기본은 접힘이다. 정렬은 조회가 준 그대로(접수일 내림차순)라 목록의 첫 줄이
   * 곧 가장 최근 건이다 — 여기서 다시 정렬하지 않는다.
   *
   * ⚠️ <details>/<summary> 를 쓰지 않는다. 이 저장소가 그것을 못 쓰는 자리에서
   * 왜 평범한 상태 하나로 푸는지는 FilterDisclosure 헤더에 적혀 있다.
   */
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  /**
   * 토글 단추가 aria-controls 로 가리킬 id. **고정 문자열을 쓰면 안 된다** —
   * 이 화면은 제품 정보 칸을 한 문서에 하나만 그리지만, 박아 두는 습관이
   * 대시보드 쪽에서 실제로 같은 id 를 둘 만든 적이 있다.
   */
  const olderHistoryId = useId();
  /** 접히는 건수(= 첫 줄을 뺀 나머지). 0이면 접을 것이 없어 단추를 그리지 않는다. */
  const olderCount = Math.max(related.length - 1, 0);

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">제품 정보</h2>
        {canShowEditButton && (
          <button
            type="button"
            onClick={onStartEdit}
            className="text-xs font-medium text-zinc-600 hover:underline dark:text-zinc-400"
          >
            수정
          </button>
        )}
      </div>

      {isEditing && editableFields ? (
        <div className="mt-3">
          <ProductInfoEditForm
            resolved={resolved}
            editableFields={editableFields}
            referenceData={referenceData}
            onDone={onDone}
          />
        </div>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="종류" value={workflowKindLabels[workflowKindOf(resolved.workflowType)]} />
          <Field label="Model" value={resolved.modelName} />
          <Field label="L/N" value={resolved.lotNumber} />
          <Field label="S/N" value={resolved.serialNumber} />
          {/* O/H 대상 표시. S/N 에 생산 연월이 들어 있어 4년 기준을 볼 수 있다
              (domain/overhaul.ts). **알려 주기만 한다** — O/H 대상이어도 일반
              견적서와 OH 견적서를 모두 발행하므로, 이 표시로 무엇이 갈라지지
              않는다. 형식이 다른 S/N 이면 아무것도 그리지 않는다. */}
          <div className="col-span-2">
            <OverhaulBadge serialNumber={resolved.serialNumber} referenceDate={new Date()} />
          </div>
          <Field label="동봉 액세서리" value={resolved.accessoryList} />
          <Field label="외관 상태 요약" value={resolved.externalConditionSummary} />
          <Field label="탈거 사유" value={resolved.reasonForRemoval} />
        </dl>
      )}

      <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        {related.length > 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            이 제품의 과거 A/S 이력: {related.length}건
          </p>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            동일 장비의 이전 A/S 이력이 없습니다.
          </p>
        )}
        {/* 매칭 기준 안내. DATABASE 건은 제품 개체 FK(product_id)로 맞추므로
            예전의 "실제 운영 매칭 로직이 아닙니다" 문구는 더 이상 사실이
            아니다 — 데모 자료(MOCK/LOCAL_DEMO)일 때만 그 문구를 보인다. */}
        {resolved.source === "DATABASE" ? (
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            매칭 기준: 등록된 같은 제품으로 접수된 건을 찾습니다. Model·L/N·S/N
            표기가 달라도 같은 제품이면 나오고, 세 값이 같아도 다른 제품이면
            나오지 않습니다.
          </p>
        ) : (
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            데모 매칭 기준: 모의 데이터끼리는 동일 제품 ID로, 로컬 데모 데이터가
            포함된 비교는 정규화된 Model + L/N + S/N 일치로 매칭합니다. 실제
            운영 매칭 로직이 아닙니다.
          </p>
        )}
        {related.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {/* 늘 보이는 가장 최근 1건. 목록의 첫 줄이 곧 그것이다(정렬은 조회 몫). */}
            <ul className="flex flex-col gap-2">
              <HistoryItem
                item={related[0]}
                actionSummary={relatedActionSummaries[related[0].id] ?? null}
              />
            </ul>
            {olderCount > 0 && (
              <>
                {/* ⚠️ 접힌 몸통은 지우지 않고 hidden 으로 둔다(FilterDisclosure 와 같다).
                    조건부로 아예 안 그리면 aria-controls 가 없는 id 를 가리키게 된다.
                    display:none 인 자식은 flex 항목이 아니라 gap 도 함께 사라지므로,
                    접었을 때 이 자리는 최근 1건과 단추 한 줄 높이 그대로다. */}
                <ul
                  id={olderHistoryId}
                  className={`flex-col gap-2 ${isHistoryExpanded ? "flex" : "hidden"}`}
                >
                  {related.slice(1).map((item) => (
                    <HistoryItem
                      key={item.id}
                      item={item}
                      actionSummary={relatedActionSummaries[item.id] ?? null}
                    />
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => setIsHistoryExpanded((prev) => !prev)}
                  aria-expanded={isHistoryExpanded}
                  aria-controls={olderHistoryId}
                  className="flex items-center gap-1 self-start rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {isHistoryExpanded ? "이전 이력 접기" : `이전 이력 ${olderCount}건 더 보기`}
                  {/* 화면 낭독기에는 aria-expanded 가 이미 같은 사실을 말한다 —
                      이 표시는 눈으로 보는 사람 몫이라 읽히지 않게 둔다. */}
                  <span
                    aria-hidden="true"
                    className={`text-zinc-400 transition-transform dark:text-zinc-500 ${
                      isHistoryExpanded ? "rotate-90" : ""
                    }`}
                  >
                    ▸
                  </span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
