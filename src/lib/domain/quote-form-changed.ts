import type { QuoteItemKind } from "@/lib/domain/quote-list";
import type { WorkflowKind } from "@/lib/domain/workflow-kind";
import type { QuoteKind, QuoteWorkScopeSection } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * 🔴 **견적서에 저장 안 된 고침이 남아 있는가** (2026-11-01)
 * ============================================================================
 * 「저장되지 않는 내용이 있습니다」 창을 띄울지 말지가 이 한 함수로 갈린다
 * (domain/unsaved-leave-guard.ts — 나가는 길 셋이 이 값 하나만 본다).
 *
 * ── 🔴 왜 `quote-change-detection.ts` 를 안 쓰는가 ───────────────────────
 * 이름이 비슷해 헷갈리기 쉬운데 **재는 것이 다르다.** 그쪽은 `"server-only"` 파일이고,
 * 재는 것은 «DB 에 지금 들어 있는 행 ↔ 저장 요청으로 들어온 값»이다 — 저장이
 * 「아무것도 안 바꿨다」로 끝났는지, 결재를 물려야 하는지를 **서버가** 가리는 자리다.
 * 여기서 재는 것은 «화면이 열릴 때의 값 ↔ 지금 화면의 값»이고, 브라우저에서 돈다.
 * 기준점도 쓰는 곳도 달라서 한 함수로 묶을 수 없다.
 *
 * ── 🔴 **저장에 실리는 것만** 견준다 ────────────────────────────────────
 * 비교의 모양은 `QuoteEditForm` 의 `collectFields()` 가 돌려주는 바로 그것이다.
 * 그래서 **화면 전용 값은 애초에 들어오지 않는다**:
 *
 *   · 줄의 `key`(`generateClientUuid()`) — 매 렌더가 아니라 줄을 만들 때마다 새 값이고,
 *     저장되지 않는다. 넣으면 저장된 장을 열자마자 늘 「바뀜」이 된다.
 *   · 줄의 `sourceKey` · `pickedPart` — 어느 출고 기록에서 담았는지 · 고르개의 기억.
 *     저장되는 것은 거기서 뽑은 **부품 번호 하나**뿐이다(`inventoryPartNo`).
 *   · 작업 내역 줄의 `key` 도 같다 — 저장되는 것은 `section` 과 `text` 뿐이다.
 *   · 펴 둔 고르개(`partPickerKey`) · 미리보기 열림 · 불러오기 안내 — 값이 아니다.
 *
 * ── 🔴 칸이 하나 늘면 tsc 가 **두 번** 잡는다 ───────────────────────────
 *   ① `collectFields()` 의 돌려주는 타입이 아래 `QuoteComparableFields` 다 — 거기에
 *      칸을 더하면 **여기 타입에 없는 칸**이라 그 자리에서 막힌다.
 *   ② 아래 `QUOTE_COMPARABLE_FIELD_KEYS` 는 `Record<keyof …, true>` 라 타입에 칸을
 *      더하면 **키 목록에 없다**고 막힌다.
 *
 * 배열로 적어 두면 새 칸이 조용히 비교에서 빠지고, 그 증상은 「고쳤는데도 묻지 않고
 * 나가 버린다」 — 즉 **적은 것이 말없이 사라지는 것**이다(service-report-draft.ts 가
 * 같은 판단으로 같은 모양을 쓴다).
 *
 * 🔴 **줄 묶음 셋은 한 줄씩 견준다.** 배열은 매 렌더 새로 만들어지므로 참조로 재면
 * 늘 「바뀜」이다. 셋 다 **차례가 뜻을 갖는다** — 품목 줄과 작업 내역 줄은 적힌 순서
 * 그대로 문서에 나가고, 고른 수리 작업은 수량만큼 펴진 줄의 목록이다.
 * ============================================================================
 */

/** 품목 표 한 줄 가운데 **저장되는 것**만. */
export type QuoteComparableItem = {
  partId: string | null;
  isOverhaulPart: boolean;
  kind: QuoteItemKind;
  partNameText: string;
  partSpecText: string | null;
  quantity: number | null;
  unitPrice: string | null;
  inventoryPartNo: string | null;
};

/** 작업 내역 한 줄 — 화면의 `key` 는 들어오지 않는다. */
export type QuoteComparableWorkScopeLine = {
  section: QuoteWorkScopeSection;
  text: string;
};

/** 고른 수리 작업 한 줄 — 수량 N 은 **같은 작업 N 줄**로 펴진 상태다. */
export type QuoteComparableRepairTask = {
  taskId: string;
  taskName: string;
  hours: number;
  hourlyRate: string;
};

/**
 * 🔴 `QuoteEditForm` 의 `collectFields()` 가 돌려주는 모양 **그대로**다.
 *
 * 🔴 **`validation/quote-input.ts` 의 `QuoteFields` 와 일부러 다르다.** 그쪽은 서버가
 * 다듬고 난 모양이라 `intakeNumberText` 가 `string | null` 이고 수량이 걸러진 뒤다.
 * 여기서 재야 하는 것은 **화면이 보낼 값 그대로**라, 서버가 뒤에 어떻게 접는지는
 * 상관이 없다(접기 전후가 다른 칸을 그쪽 타입으로 재면 안 바꿨는데 「바뀜」이 된다).
 */
export type QuoteComparableFields = {
  quoteNumber: string;
  kind: QuoteKind;
  quoteDate: string;
  repairCaseId: string | null;
  intakeNumberText: string;
  customerId: string | null;
  customerNameText: string;
  modelNameText: string;
  lotNumberText: string;
  serialNumberText: string;
  faultDescriptionText: string;
  subject: string;
  validity: string;
  delivery: string;
  payment: string;
  remarks: string | null;
  workCost: string;
  laborEquipmentKind: WorkflowKind | null;
  laborBaseCost: string | null;
  powerTestExcluded: boolean;
  laborPowerTestDeduction: string | null;
  investigationExcluded: boolean;
  documentExcluded: boolean;
  isExcelOnly: boolean;
  manualSupplyAmount: string | null;
  repairTasks: readonly QuoteComparableRepairTask[];
  workScopeLines: readonly QuoteComparableWorkScopeLine[];
  items: readonly QuoteComparableItem[];
};

/**
 * 견줄 **모든 칸 이름**. 🔴 칸이 하나 늘면 tsc 가 여기를 잡는다(위 머리말).
 *
 * 🔴 **줄 묶음 셋(`repairTasks` · `workScopeLines` · `items`)은 아래에서 따로 다룬다.**
 * 새 칸이 또 배열이면 여기 이름만 더해서는 안 되고 **견주는 길도 함께** 더해야 한다 —
 * 빠뜨리면 참조로 재어 늘 「바뀜」이 되고, 그것을 잡는 시험이
 * quote-form-changed.test.ts 의 「새 배열이어도 내용이 같으면 안 바뀜」이다.
 */
const QUOTE_COMPARABLE_FIELD_KEYS: Record<keyof QuoteComparableFields, true> = {
  quoteNumber: true,
  kind: true,
  quoteDate: true,
  repairCaseId: true,
  intakeNumberText: true,
  customerId: true,
  customerNameText: true,
  modelNameText: true,
  lotNumberText: true,
  serialNumberText: true,
  faultDescriptionText: true,
  subject: true,
  validity: true,
  delivery: true,
  payment: true,
  remarks: true,
  workCost: true,
  laborEquipmentKind: true,
  laborBaseCost: true,
  powerTestExcluded: true,
  laborPowerTestDeduction: true,
  investigationExcluded: true,
  documentExcluded: true,
  isExcelOnly: true,
  manualSupplyAmount: true,
  repairTasks: true,
  workScopeLines: true,
  items: true,
};

const QUOTE_COMPARABLE_ITEM_KEYS: Record<keyof QuoteComparableItem, true> = {
  partId: true,
  isOverhaulPart: true,
  kind: true,
  partNameText: true,
  partSpecText: true,
  quantity: true,
  unitPrice: true,
  inventoryPartNo: true,
};

const QUOTE_COMPARABLE_WORK_SCOPE_LINE_KEYS: Record<keyof QuoteComparableWorkScopeLine, true> = {
  section: true,
  text: true,
};

const QUOTE_COMPARABLE_REPAIR_TASK_KEYS: Record<keyof QuoteComparableRepairTask, true> = {
  taskId: true,
  taskName: true,
  hours: true,
  hourlyRate: true,
};

/**
 * 줄 목록 둘을 **한 줄씩** 견준다 — 차례까지 본다.
 *
 * 🔴 줄의 칸 이름도 `Record<keyof …, true>` 로 받는다. 줄에 칸이 하나 늘면 그쪽
 * 목록에서 tsc 가 잡는다(바깥 칸과 같은 규율).
 */
function rowsChanged<T>(
  before: readonly T[],
  after: readonly T[],
  keys: Record<keyof T, true>
): boolean {
  if (before.length !== after.length) return true;
  const names = Object.keys(keys) as (keyof T)[];
  for (let index = 0; index < before.length; index += 1) {
    for (const name of names) {
      if (before[index][name] !== after[index][name]) return true;
    }
  }
  return false;
}

/**
 * **사람이 고친 것이 있는가** — 나가는 길 셋이 보는 단 하나의 판단.
 *
 * 기준선(`before`)은 «이 화면이 저장된 것으로 믿는 값»이다: 저장된 장을 연 그 값,
 * 이 화면에서 저장에 성공한 값, 또는 기계가 채워 넣고 난 새 장의 값
 * (`QuoteEditForm` 의 기준선 머리말 — 사람이 친 글만 「고침」으로 센다).
 *
 * 🔴 «아무것도 안 고쳤으면 묻지 않는다»가 이 함수의 값어치다. 늘 물으면 사람은 읽지
 * 않고 누르는 손을 배우고, 그러면 정작 글이 사라질 때도 그냥 넘긴다.
 */
export function quoteFormValuesChanged(
  before: QuoteComparableFields,
  after: QuoteComparableFields
): boolean {
  for (const key of Object.keys(QUOTE_COMPARABLE_FIELD_KEYS) as (keyof QuoteComparableFields)[]) {
    if (key === "items") {
      if (rowsChanged(before.items, after.items, QUOTE_COMPARABLE_ITEM_KEYS)) return true;
      continue;
    }
    if (key === "workScopeLines") {
      if (
        rowsChanged(
          before.workScopeLines,
          after.workScopeLines,
          QUOTE_COMPARABLE_WORK_SCOPE_LINE_KEYS
        )
      ) {
        return true;
      }
      continue;
    }
    if (key === "repairTasks") {
      if (rowsChanged(before.repairTasks, after.repairTasks, QUOTE_COMPARABLE_REPAIR_TASK_KEYS)) {
        return true;
      }
      continue;
    }
    if (before[key] !== after[key]) return true;
  }
  return false;
}
