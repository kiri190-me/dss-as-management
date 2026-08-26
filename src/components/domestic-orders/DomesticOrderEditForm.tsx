"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import EditSectionActions, {
  editErrorClass,
  editInputClass,
  editLabelClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";
import type { SectionEditConflictError } from "@/components/repair-cases/detail/edit/useSectionEditSubmit";
import { buildDraftText } from "@/lib/domain/edit-draft-text";
import { generateClientUuid } from "@/lib/client-uuid";
import {
  foldBlankToNull,
  formatDomesticOrderDueDates,
} from "@/lib/domain/domestic-order-list";
import {
  filterRepairCaseLinkOptions,
  keepSelectedRepairCaseOption,
} from "@/lib/domain/repair-case-link-search";
import type {
  CustomerOption,
  DomesticOrderListItem,
  RepairCaseLinkOption,
} from "@/lib/db/queries/domestic-orders";
import {
  createDomesticOrderAction,
  updateDomesticOrderAction,
} from "@/lib/server/actions/domestic-orders";

/**
 * ============================================================================
 * 내자 정리 — 한 줄을 통째로 고치는 폼
 * ============================================================================
 * 칸 하나씩 고치는 방식이 아니다. 한 줄의 값 전부(칸 22개 + 납기요청일
 * 목록)를 한 화면에서 고치고 한 번에
 * 저장한다 — 이 시트는 원래 한 줄이 한 건의 이야기(발주 → 견적 → 납품 →
 * 세금계산서 → 입금)라서, 칸 단위로 저장하면 "견적은 들어갔는데 현황은 아직
 * 옛날 값"인 중간 상태가 표에 남는다.
 *
 * ── 고객사·형식·L/N·S/N·고장내역은 비워 두는 것이 기본이다 ──────────────
 * 그 다섯에는 입력칸이 있다. **수리 건 연결이 없는 줄**에는 그 칸이 값을 적을
 * 유일한 자리이기 때문이다(schema/domestic-orders.ts 의 '여기에도 있다').
 *
 * 연결이 있는 줄에서는 **수리 건의 값을 흐린 글씨로 보여만 주고 입력칸은
 * 비워 둔다.** 미리 채워 넣지 않는 것이 이 폼에서 가장 중요한 규칙이다:
 * 채워 넣으면 사용자가 아무것도 고치지 않고 저장만 해도 그 값이 이 행에
 * 복사되고, 그때부터 "일부러 다르게 적었다"와 "그냥 안 건드렸다"를 구분할 수
 * 없게 된다. 그 뒤로 수리 건 쪽에서 모델명 오타를 고쳐도 이 줄은 따라가지
 * 않는다 — 화면에는 아무 흔적도 남지 않은 채로.
 *
 * 그래서 비어 있음이 곧 "수리 건을 따른다"는 뜻이고, 적는 것은 **일부러 다르게
 * 적을 때뿐**이다(발주서의 형식이 수리 건의 형식과 다른 경우 — 그때 청구 근거는
 * 발주서 쪽이다).
 *
 * ── 흐린 글씨는 placeholder 다. value 가 아니다 ─────────────────────────
 * 예전에는 그 힌트를 칸 **아래** 회색 한 줄로 그렸다. 지금은 칸 **안**의 흐린
 * 글씨로 옮겼다 — 빈칸 옆에 놓인 회색 줄보다, 그 칸에 무엇이 보이게 되는지를
 * 훨씬 곧바로 읽히게 한다.
 *
 * **위 규칙은 그대로다.** placeholder 는 브라우저가 그리는 표시일 뿐 입력값이
 * 아니라서, 사용자가 직접 치지 않는 한 state 에 들어가지 않고 collectFields 에도
 * 실리지 않는다. 이 파일에서 수리 건 값이 닿는 곳은 `placeholder=` 하나뿐이고
 * `value=` 에는 어떤 경로로도 닿지 않는다 — 그 성질이 깨지는 순간 "안 건드렸다"와
 * "일부러 다르게 적었다"의 구분이 사라진다.
 *
 * 흐린 글씨는 **지금 고른 건**을 따라간다(아래 linkedRepairCase). 고르개가 그
 * 건의 형식·L/N·S/N·납기일을 함께 들고 있어서 고르는 즉시 바뀐다.
 *
 * ── 납기요청일만 칸이 아니라 묶음이다 ───────────────────────────────────
 * 한 발주를 나눠 납품하면 납기일이 여럿이라, 그 자리는 칸 하나가 아니라
 * **더하고 뺄 수 있는 줄들**이다(schema/domestic-order-due-dates.ts). 줄마다
 * 날짜와 짧은 메모("1차분")가 있고, 저장되는 것은 화면에 늘어놓은 차례
 * 그대로다.
 *
 * 연결된 수리 건의 고객 요청 납기일은 여기서도 **힌트일 뿐**이다. 다른 칸들이
 * placeholder 로 보여 주는 것을 이 묶음은 아래 한 줄로 보여 주는데
 * (requestedDueDateHint), 성질은 똑같다 — 어떤 경로로도 입력값이 되지 않는다.
 *
 * ⚠️ **목록이 그 날짜를 대신 보여 주게 된 뒤에도 이 폼은 그대로다.** 이 줄에
 * 납기요청일이 하나도 없으면 목록의 그 칸에는 수리 건의 날짜가 꼬리표와 함께
 * 보이지만(domain/requested-due-date-link.ts), 그것은 **그릴 값**이지 이 줄에
 * 저장된 값이 아니다. 그 날짜를 여기 dueDates 에 미리 채워 두면, 아무것도 고치지
 * 않고 저장만 눌러도 빌려 오던 날짜가 이 줄에 박제된다.
 *
 * ── ⚠️ 납품일은 입력칸이 아니다. 그래도 저장에는 실린다 ─────────────────
 * 목록의 `납품일` 은 연결된 수리 건의 **실제 출하일**이고, 그 값은 워크플로가
 * 출하 완료 시점에 자동으로 찍는다(mutations/workflow-transitions.ts). 사람이
 * 적을 수 있는 값이 아니라서 이 폼에서도 받지 않는다 — 그 자리에는 지금 값과
 * "왜 못 적는지"를 읽기 전용 한 줄로 적어 둔다(deliveredDateText).
 *
 * ⚠️ **그런데 collectFields 에서는 빼면 안 된다.** 이 화면의 저장은 보낸 칸만
 * 고치지 않는다: 검증이 키 없음(undefined)을 null 로 접고
 * (validation/domestic-order-input.ts) mutation 이 모든 칼럼을 SET 한다
 * (mutations/domestic-orders.ts). 즉 payload 에서 `deliveredDate` 를 빼면 DB 에
 * 남아 있는 옛 납품일이 **저장 한 번에 지워진다** — 화면에서 안 보여 주기로 한
 * 것이 자료를 버리는 것으로 바뀐다. 그래서 읽어 온 값을 손대지 않고 그대로
 * 되돌려 보낸다(state 가 아니라 상수인 이유도 그 선언 주석에 있다).
 *
 * ── 수리 건은 검색해서 고른다 ───────────────────────────────────────────
 * 접수 건이 수백 건이라 `<select>` 하나로는 원하는 건을 찾을 수 없다. 검색 칸을
 * 앞에 두고 목록을 걸러 내되, **고르는 것은 여전히 `<select>`** 다 — 직접 만든
 * 드롭다운과 달리 키보드·스크린리더 동작을 브라우저가 이미 맞게 해 주고,
 * 지금 무엇이 골라져 있는지도 늘 보인다. 무엇이 남는지 정하는 규칙은 화면이
 * 아니라 domain/repair-case-link-search.ts 에 있다(시험할 수 있어야 해서).
 *
 * ── 충돌하면 얼린다 ─────────────────────────────────────────────────────
 * 저장이 CONFLICT 로 돌아오면 이 폼은 더 이상 저장하지 않는다. 낡은 값을 그대로
 * 덮어쓰면 남이 방금 적은 입금 사실이 조용히 사라진다. 얼리는 방식도, "최신
 * 정보 다시 불러오기" 하나만 남는 것도 접수 건 구간 편집과 같다
 * (EditSectionActions) — 이 시스템에서 충돌은 늘 같은 모양으로 보여야 한다.
 *
 * ── 다시 불러올 때 적어 둔 값을 잃지 않는다 ─────────────────────────────
 * 다시 불러오면 이 폼은 언마운트되고 손으로 친 글이 통째로 사라진다. 그래서
 * 얼리기 직전에 저장하려던 값에서 **사람이 직접 친 글만** 뽑아 붙잡아 둔다
 * (buildDraftText + 아래 DRAFT_LABELS). 상자는 읽기 전용 textarea 라 사내망
 * http 환경처럼 navigator.clipboard 가 아예 없는 브라우저에서도 길게 눌러
 * 선택할 수 있다 — 그 판단은 EditSectionActions 가 이미 하고 있다.
 * ============================================================================
 */

/**
 * 충돌 상자에 보여 줄 항목과 이름표. **여기 없는 항목은 보여 주지 않는다.**
 *
 * 날짜 다섯과 고르는 값 둘(수리 건 연결 · 고객사 — 둘 다 UUID), 입금완료 체크는
 * 뺐다 — 다시 고르는 데 몇 초면 되고, UUID 는 사람이 읽을 수 없어 보여 주면
 * 오히려 방해다(edit-draft-text.ts 의 '왜 자유 입력만인가'). 금액은 뺄 수 없다:
 * 손으로 친 값이고, 잘못 다시 적으면 합계가 세금계산서와 어긋난다. 형식·L/N·
 * S/N·고장내역도 손으로 친 값이라 함께 붙잡는다 — 특히 이 넷은 **일부러 수리
 * 건과 다르게 적은 값**이라 다시 불러온 화면 어디에도 남아 있지 않다.
 */
const DRAFT_LABELS: Readonly<Record<string, string>> = {
  /**
   * 납기요청일 목록. **collectFields 가 만드는 값이 아니다** — 그쪽은 배열이라
   * buildDraftText 가 통째로 걸러 낸다(그 함수의 '문자열이 아닌 것은 전부').
   * 충돌한 순간에만 한 줄 글자로 만들어 함께 넘긴다(handleSubmit).
   *
   * 다른 날짜 다섯과 달리 붙잡는 이유는 **메모가 손으로 친 글**이기 때문이다.
   * 날짜만이면 다시 고르면 그만이지만, "2차분(김 과장 확인)" 같은 메모는 다시
   * 불러온 화면 어디에도 남아 있지 않다.
   */
  dueDatesText: "납기요청일",
  intakeNumberText: "인수번호(직접 입력)",
  modelNameText: "형식",
  lotNumberText: "L/N",
  serialNumberText: "S/N",
  faultDescriptionText: "고장내역",
  purchaseOrderNumber: "발주서번호",
  projectName: "PJT",
  quoteNumber: "견적서번호",
  progressNote: "현황",
  deliveredBy: "납품자",
  amountExcludingVat: "금액(VAT별도)",
  japanRemittanceNote: "일본 송금",
  historyNote: "이력",
  etcNote: "기타",
};

const textAreaClass = `${editInputClass} min-h-20 resize-y`;

const hintClass = "mt-1 text-xs text-zinc-500 dark:text-zinc-400";

/**
 * 폼이 편집하는 납기 요청일 한 줄.
 *
 * `key` 는 저장된 행의 id 이거나, 방금 추가한 줄에 붙인 임시 UUID 다. **배열
 * index 를 React key 로 쓰지 않기 위해서** 있다 — 가운데 줄을 지우면 그 뒤
 * 줄들의 index 가 하나씩 당겨지고, index 를 key 로 쓰면 React 는 "지워진 것은
 * 마지막 줄"이라고 읽어 남은 입력칸에 엉뚱한 값이 남는다.
 *
 * 값은 둘 다 문자열이다(빈 문자열 = 안 적음). 검증이 그 빈 값을 접는다
 * (validation/domestic-order-input.ts 의 '완전히 빈 줄은 거절하지 않고 뺀다').
 */
type DueDateDraft = { key: string; dueDate: string; note: string };

/** 납기일 한 줄의 date 입력칸 id. 추가한 뒤 그리로 포커스를 옮기는 데 쓴다. */
function dueDateInputId(key: string): string {
  return `domestic-order-dueDate-${key}`;
}

export default function DomesticOrderEditForm({
  row,
  repairCaseOptions,
  customerOptions,
  onDone,
}: {
  /** 고칠 줄. null 이면 새 줄을 추가하는 중이다. */
  row: DomesticOrderListItem | null;
  repairCaseOptions: RepairCaseLinkOption[];
  customerOptions: CustomerOption[];
  onDone: () => void;
}) {
  const router = useRouter();

  const [repairCaseId, setRepairCaseId] = useState(row?.repairCaseId ?? "");
  /**
   * 수리 건 검색어. **저장되는 값이 아니다** — 목록에서 무엇을 보여 줄지만
   * 정한다. 그래서 collectFields 에도 DRAFT_LABELS 에도 없다.
   */
  const [repairCaseQuery, setRepairCaseQuery] = useState("");
  const [intakeNumberText, setIntakeNumberText] = useState(row?.intakeNumberText ?? "");
  /**
   * 이 다섯은 **이 행에 적힌 값만** 담는다(row.customerId · row.modelNameText …).
   * 화면 표가 그리는 row.customerName · row.modelName 은 이미 수리 건 값이 섞여
   * 정해진 값이라, 그것을 초기값으로 쓰면 저장하는 순간 수리 건의 값이 이 행에
   * 복사된다(파일 헤더).
   */
  const [customerId, setCustomerId] = useState(row?.customerId ?? "");
  const [modelNameText, setModelNameText] = useState(row?.modelNameText ?? "");
  const [lotNumberText, setLotNumberText] = useState(row?.lotNumberText ?? "");
  const [serialNumberText, setSerialNumberText] = useState(row?.serialNumberText ?? "");
  const [faultDescriptionText, setFaultDescriptionText] = useState(
    row?.faultDescriptionText ?? ""
  );
  const [displayOrder, setDisplayOrder] = useState(
    row?.displayOrder === null || row?.displayOrder === undefined ? "" : String(row.displayOrder)
  );
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState(row?.purchaseOrderNumber ?? "");
  const [projectName, setProjectName] = useState(row?.projectName ?? "");
  const [orderIssuedDate, setOrderIssuedDate] = useState(row?.orderIssuedDate ?? "");
  /**
   * 납기 요청일 **목록**. 저장된 차례 그대로 시작하고, 빈 목록이 정상이다 —
   * 납기일이 아직 없는 줄이 실제로 있다.
   *
   * 다른 칸들과 달리 여기에는 수리 건의 값이 어떤 경로로도 들어오지 않는다.
   * 연결된 건의 고객 요청 납기일은 **아래 힌트 한 줄로만** 보여 준다 —
   * 내자의 납기 요청일은 발주서에 적힌 날짜라 뜻이 다르고(queries 주석), 여기
   * 미리 채워 넣으면 아무것도 안 고치고 저장만 해도 그 날짜가 이 줄에
   * 박제된다(파일 헤더의 'placeholder 다. value 가 아니다').
   */
  const [dueDates, setDueDates] = useState<DueDateDraft[]>(() =>
    (row?.dueDates ?? []).map((dueDate) => ({
      key: dueDate.id,
      dueDate: dueDate.dueDate,
      note: dueDate.note ?? "",
    }))
  );
  const [quoteIssuedDate, setQuoteIssuedDate] = useState(row?.quoteIssuedDate ?? "");
  const [quoteNumber, setQuoteNumber] = useState(row?.quoteNumber ?? "");
  const [progressNote, setProgressNote] = useState(row?.progressNote ?? "");
  /**
   * ⚠️ **state 가 아니라 상수다. 고칠 길이 없어야 한다.**
   *
   * 납품일은 이제 이 폼에서 적는 값이 아니다 — 화면에 보이는 것은 연결된 수리
   * 건의 실제 출하일이고(아래 deliveredDateText), 이 칼럼은 손으로 적던 시절의
   * 값으로 DB 에 남아 있다.
   *
   * 그런데도 이 줄이 필요한 이유는 하나다: **이 화면의 저장은 모든 칼럼을
   * SET 한다.** collectFields 에서 `deliveredDate` 키가 빠지면 검증이 undefined 를
   * null 로 접고(validation/domestic-order-input.ts) mutation 이 그 칼럼을
   * 비운다 — 화면에서 안 보여 주기로 한 것이 **저장 한 번에 지워지는** 것으로
   * 바뀐다. 그래서 읽어 온 값을 그대로 붙잡아 두었다가 그대로 되돌려 보낸다.
   *
   * setState 를 두지 않은 것이 그 규약을 코드로 못 박는 자리다. 입력칸이 없으니
   * 값이 바뀔 일도 없고, 바꿀 함수 자체가 없으니 나중에 누가 이 칸에 입력칸을
   * 되살리려면 이 주석을 지나가야 한다.
   */
  const deliveredDate = row?.deliveredDate ?? "";
  const [deliveredBy, setDeliveredBy] = useState(row?.deliveredBy ?? "");
  const [taxInvoiceDate, setTaxInvoiceDate] = useState(row?.taxInvoiceDate ?? "");
  const [amountExcludingVat, setAmountExcludingVat] = useState(row?.amountExcludingVat ?? "");
  const [paymentCompleted, setPaymentCompleted] = useState(row?.paymentCompleted ?? false);
  const [japanRemittanceNote, setJapanRemittanceNote] = useState(row?.japanRemittanceNote ?? "");
  const [historyNote, setHistoryNote] = useState(row?.historyNote ?? "");
  const [etcNote, setEtcNote] = useState(row?.etcNote ?? "");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | SectionEditConflictError | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  const disabled = isSubmitting || isConflict;

  /**
   * 방금 추가한 줄로 포커스를 옮기기 위한 자리. **키보드만으로 쓸 수 있어야
   * 하기 때문**이다 — '추가'를 누르면 새 줄이 폼 중간에 생기는데, 포커스가
   * 버튼에 남아 있으면 그 줄까지 Tab 을 거꾸로 세어 가야 한다.
   *
   * state 가 아니라 ref 인 것은 일부러다. 이 값은 **그리는 데 쓰이지 않으므로**
   * 바뀐다고 다시 그릴 이유가 없고, state 로 두면 effect 안에서 그것을 비우는
   * setState 가 필요해져 렌더가 한 번 더 돈다. 아래 effect 는 목록이 바뀔 때만
   * 돌면서, 옮길 곳이 적혀 있으면 옮기고 그 자리를 비운다.
   */
  const pendingDueDateFocusRef = useRef<string | null>(null);
  const addDueDateButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const key = pendingDueDateFocusRef.current;
    if (key === null) return;
    pendingDueDateFocusRef.current = null;
    document.getElementById(dueDateInputId(key))?.focus();
  }, [dueDates]);

  function addDueDate() {
    // 저장된 행의 id 와 섞이지 않는 임시 key 다. LAN 평문 HTTP 에서도
    // 만들어져야 해서 crypto.randomUUID 를 직접 부르지 않는다(client-uuid.ts).
    const key = generateClientUuid();
    pendingDueDateFocusRef.current = key;
    setDueDates((previous) => [...previous, { key, dueDate: "", note: "" }]);
  }

  function updateDueDate(key: string, patch: Partial<Omit<DueDateDraft, "key">>) {
    setDueDates((previous) =>
      previous.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry))
    );
  }

  function removeDueDate(key: string) {
    setDueDates((previous) => previous.filter((entry) => entry.key !== key));
    // 지운 줄과 함께 포커스가 사라지면 키보드 사용자는 갈 곳을 잃는다.
    // 남은 줄의 번호가 당겨지므로 어느 줄로 보내도 어색하고, '추가' 버튼은
    // 이 묶음에 늘 있는 자리라 그리로 돌려보낸다.
    addDueDateButtonRef.current?.focus();
  }

  /**
   * 저장돼 있는 연결. 지금 고른 것과 다를 수 있다.
   *
   * 고장내역 힌트는 **이 값을 그대로 두고 있을 때만** 그린다 — 고르개가 실어
   * 오는 항목에는 고장내역이 없어서(조회 쪽 RepairCaseLinkOption), 다른 건을
   * 고르면 그 건의 고장내역을 알 길이 없다. 그때도 옛 힌트를 띄우면 사용자는
   * 방금 고른 건의 값이라고 읽는다 — 틀린 값을 보여 주느니 아무것도 보여 주지
   * 않는 편이 낫다.
   */
  const savedRepairCaseId = row?.repairCaseId ?? "";
  const showSavedFaultHint = repairCaseId !== "" && repairCaseId === savedRepairCaseId;

  /**
   * 검색어로 걸러 낸 목록과, 실제로 `<select>` 에 그릴 목록.
   *
   * 둘을 나눠 두는 이유: 지금 고른 건은 검색어에 걸리지 않아도 목록에 남아야
   * 하는데(안 남기면 select 가 '연결 없음'을 보여 주면서 state 에는 연결이
   * 남는다), 그 붙잡아 둔 항목까지 세면 "맞는 수리 건이 없습니다"를 낼 수
   * 없게 된다.
   */
  const matchedRepairCases = useMemo(
    () => filterRepairCaseLinkOptions(repairCaseOptions, repairCaseQuery),
    [repairCaseOptions, repairCaseQuery]
  );
  const visibleRepairCases = useMemo(
    () => keepSelectedRepairCaseOption(repairCaseOptions, matchedRepairCases, repairCaseId),
    [repairCaseOptions, matchedRepairCases, repairCaseId]
  );

  /**
   * 흐린 글씨의 출처 — **지금 고른 수리 건**이다.
   *
   * 고르개 목록에서 먼저 찾는다(고르는 즉시 그 건의 값으로 바뀐다). 목록에
   * 없는데 저장돼 있는 연결이면 목록 조회가 실어 온 값으로 내려온다 — 휴지통에
   * 들어간 수리 건이 그렇다. 그런 줄도 연결은 살아 있고(조회의 LEFT JOIN),
   * 힌트가 사라질 이유는 없다.
   *
   * 여기서 나온 값이 닿는 곳은 placeholder 뿐이다(파일 헤더).
   */
  const linkedRepairCase = useMemo(() => {
    if (repairCaseId === "") return null;
    const picked = repairCaseOptions.find((option) => option.id === repairCaseId);
    if (picked) {
      return {
        intakeNumber: picked.intakeNumber,
        customerName: picked.customerName,
        modelName: picked.modelName,
        lotNumber: picked.lotNumber,
        serialNumber: picked.serialNumber,
        requestedDueDate: picked.customerRequestedDueDate,
      };
    }
    if (!row || repairCaseId !== savedRepairCaseId) return null;
    return {
      intakeNumber: row.intakeNumber,
      customerName: row.repairCaseCustomerName,
      modelName: row.repairCaseModelName,
      lotNumber: row.repairCaseLotNumber,
      serialNumber: row.repairCaseSerialNumber,
      requestedDueDate: row.repairCaseCustomerRequestedDueDate,
    };
  }, [repairCaseId, repairCaseOptions, row, savedRepairCaseId]);

  /**
   * 흐린 글씨 한 줄. 값이 없으면 undefined 를 돌려준다 — 빈 문자열을 넘기면
   * placeholder 속성이 붙은 채로 아무것도 안 보여서, 나중에 이 칸을 읽는 쪽이
   * "힌트가 있다"고 잘못 읽는다.
   */
  function repairCasePlaceholder(value: string | null | undefined): string | undefined {
    return foldBlankToNull(value) ?? undefined;
  }

  /**
   * 검색 칸에서 Enter 를 눌렀을 때.
   *
   * **먼저 폼 저장을 막는다.** 입력칸 하나에서 Enter 를 누르면 브라우저가 폼을
   * 제출한다 — 검색어를 치다 습관적으로 Enter 를 누른 사람이 아직 고르지도
   * 않은 상태의 줄을 저장하게 된다.
   *
   * 그 자리를 놀리지 않고, 걸린 건이 **딱 하나면** 그것을 고른다. 인수번호를
   * 끝까지 치면 늘 하나만 남으므로, 마우스는 물론 Tab 도 없이 고를 수 있다.
   */
  function handleRepairCaseSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (matchedRepairCases.length === 1) setRepairCaseId(matchedRepairCases[0].id);
  }

  /** 고객사 드롭다운의 '연결 없음'에 덧붙일 이름. 연결이 없으면 null 이다. */
  const linkedCustomerName = repairCasePlaceholder(linkedRepairCase?.customerName) ?? null;

  /**
   * 납기요청일 묶음 아래 한 줄. **흐린 글씨로는 안 된다** — `<input
   * type="date">` 에는 placeholder 를 넘겨도 브라우저가 그리지 않고(칸 안이
   * 이미 `연도-월-일` 같은 자기 글자로 차 있다), 이제는 칸이 여럿이라 어느
   * 칸에 넣어야 할지도 말할 수 없다. 그래서 묶음 밑에 한 줄로 둔다.
   *
   * ⚠️ **이 값은 저장되지 않는다.** 내자의 납기 요청일은 발주서에 적힌
   * 날짜라 수리 건의 고객 요청 납기일과 같아야 할 이유가 없고(조회 쪽 주석),
   * 목록의 값을 대신하지도 않는다. 그래서 여기서 나온 글자가 닿는 곳은 이
   * 안내 문장 하나뿐이다 — 위 dueDates state 에는 어떤 경로로도 들어가지
   * 않는다. 비워 둔다고 이 날짜가 표에 뜨지 않으므로 "그대로 보입니다"가
   * 아니라 "적혀 있습니다"라고 적는다.
   */
  function requestedDueDateHint(): ReactNode {
    const hint = repairCasePlaceholder(linkedRepairCase?.requestedDueDate);
    if (hint === undefined) return null;
    return <p className={hintClass}>연결된 수리 건의 고객 요청 납기일: {hint}</p>;
  }

  /**
   * 고장내역 칸 아래 한 줄. 이 칸만 흐린 글씨를 못 쓰는 이유는 자료가 없어서다
   * — 고르개 항목에는 고장내역이 없어서 **저장돼 있는 연결을 그대로 둘 때만**
   * 값을 안다(위 showSavedFaultHint).
   */
  function faultDescriptionHint(): ReactNode {
    if (!showSavedFaultHint) return null;
    const hint = foldBlankToNull(row?.repairCaseReportedSymptom);
    if (hint === null) return null;
    return (
      <p className={hintClass}>
        연결된 수리 건{row?.intakeNumber ? ` ${row.intakeNumber}` : ""}: {hint}
        <br />
        비워 두면 이 값이 그대로 보입니다.
      </p>
    );
  }

  /**
   * 납품일 자리에 **글자로** 적을 값. 입력칸이 아니라 읽기 전용 한 줄이다.
   *
   * 세 가지 경우를 서로 다른 말로 적는다 — 셋 다 화면에는 "날짜가 없다"로
   * 똑같이 보이지만, 사람이 다음에 해야 할 일이 전부 다르기 때문이다:
   *
   *  - 연결이 없다 → 수리 건을 이어 붙여야 한다.
   *  - 방금 **다른** 건을 골랐다 → 저장하기 전에는 그 건의 출하일을 알 수 없다.
   *    고르개가 실어 오는 항목에 실제 출하일이 없어서다(조회 쪽
   *    RepairCaseLinkOption) — 그때 저장돼 있던 옛 날짜를 그대로 두면 사용자는
   *    방금 고른 건의 값이라고 읽는다. 고장내역 힌트가 같은 이유로 같은 조건을
   *    쓴다(위 showSavedFaultHint).
   *  - 연결은 그대로인데 날짜가 없다 → 그 건이 아직 안 나갔다. 기다리는 것 말고
   *    이 폼에서 할 수 있는 일이 없다.
   */
  function deliveredDateText(): string {
    if (repairCaseId === "") return "연결된 수리 건이 없습니다";
    if (repairCaseId !== savedRepairCaseId) {
      return "저장하면 지금 고른 수리 건의 실제 출하일이 보입니다";
    }
    return foldBlankToNull(row?.repairCaseActualShipmentDate) ?? "아직 출하 기록이 없습니다";
  }

  /**
   * 충돌 상자에 넣을 납기일 한 줄 — "2026-01-20 (1차분), 2026-02-15".
   *
   * 아무것도 안 적은 줄은 뺀다(붙잡을 글이 없다). 날짜 없이 메모만 친 줄은
   * 남긴다 — 그 메모가 바로 다시 불러온 화면에서 사라지는 글이다. 목록을
   * 글자로 만드는 규칙은 표와 같은 함수를 쓴다.
   */
  function dueDatesDraftText(): string {
    const written = dueDates.filter(
      (entry) => entry.dueDate.trim() !== "" || entry.note.trim() !== ""
    );
    if (written.length === 0) return "";
    return (
      formatDomesticOrderDueDates(
        written.map((entry) => ({
          dueDate: entry.dueDate.trim() === "" ? "(날짜 없음)" : entry.dueDate.trim(),
          note: entry.note,
        }))
      ) ?? ""
    );
  }

  function collectFields(): Record<string, unknown> {
    return {
      repairCaseId: repairCaseId || null,
      intakeNumberText,
      customerId: customerId || null,
      modelNameText,
      lotNumberText,
      serialNumberText,
      faultDescriptionText,
      displayOrder,
      purchaseOrderNumber,
      projectName,
      orderIssuedDate,
      // 폼에 늘어놓은 **차례 그대로** 보낸다 — 차례는 저장하는 쪽이 이 배열의
      // index 로 매긴다(validation 의 DomesticOrderDueDateInput 주석). 여기서
      // 빈 줄을 걸러 내지 않는 것은 일부러다: 무엇이 빈 줄인지 정하는 규칙은
      // 검증 한 곳에 있어야 하고, 화면이 미리 걸러 내면 두 곳이 어긋난다.
      dueDates: dueDates.map((entry) => ({ dueDate: entry.dueDate, note: entry.note })),
      quoteIssuedDate,
      quoteNumber,
      progressNote,
      // ⚠️ **입력칸이 없어진 뒤에도 반드시 실어 보낸다.** 이 저장은 모든 칼럼을
      // SET 하므로, 여기서 빼면 DB 에 남아 있는 옛 납품일이 저장 한 번에
      // 지워진다(위 deliveredDate 선언의 주석). 값은 읽어 온 그대로다.
      deliveredDate,
      deliveredBy,
      taxInvoiceDate,
      amountExcludingVat,
      paymentCompleted,
      japanRemittanceNote,
      historyNote,
      etcNote,
    };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});
    const fields = collectFields();
    try {
      const result = row
        ? await updateDomesticOrderAction({ id: row.id, expectedVersion: row.version, fields })
        : await createDomesticOrderAction({ fields });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          // 얼리기 **전에** 적어 둔 글을 붙잡는다 — 곧 폼이 사라지기 때문이다.
          setIsConflict(true);
          setSubmitError({
            message: result.message,
            // 납기일 목록은 배열이라 buildDraftText 가 걸러 낸다. 손으로 친
            // 메모를 잃지 않도록 여기서만 한 줄 글자로 만들어 얹는다
            // (DRAFT_LABELS 의 dueDatesText). 서버로 가는 fields 는 그대로다.
            draftText: buildDraftText(
              { ...fields, dueDatesText: dueDatesDraftText() },
              DRAFT_LABELS
            ),
          });
          return;
        }
        setFieldErrors(result.fieldErrors ?? {});
        setSubmitError(result.message);
        return;
      }

      router.refresh();
      onDone();
    } finally {
      setIsSubmitting(false);
    }
  }

  function reloadAfterConflict() {
    router.refresh();
    onDone();
  }

  function renderText(
    key: string,
    label: string,
    value: string,
    onChange: (next: string) => void,
    options: {
      type?: string;
      long?: boolean;
      inputMode?: "numeric" | "decimal";
      /** 입력칸 아래 회색으로 붙는 안내. 값은 건드리지 않는다(파일 헤더). */
      hint?: ReactNode;
      /**
       * 칸 안의 흐린 글씨. **value 와 섞이지 않는다** — 브라우저가 그리는
       * 표시일 뿐이라 사용자가 직접 치지 않으면 state 에 들어가지 않는다
       * (파일 헤더의 'placeholder 다. value 가 아니다').
       */
      placeholder?: string;
    } = {}
  ) {
    return (
      <div className={options.long ? "sm:col-span-2 lg:col-span-3" : undefined}>
        <label className={editLabelClass} htmlFor={`domestic-order-${key}`}>
          {label}
        </label>
        {options.long ? (
          <textarea
            id={`domestic-order-${key}`}
            className={textAreaClass}
            value={value}
            placeholder={options.placeholder}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            id={`domestic-order-${key}`}
            type={options.type ?? "text"}
            inputMode={options.inputMode}
            className={editInputClass}
            value={value}
            placeholder={options.placeholder}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {fieldErrors[key] && <p className={editErrorClass}>{fieldErrors[key]}</p>}
        {options.hint}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-lg border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {row ? "줄 수정" : "행 추가"}
      </h2>

      {/* 비워 두는 것이 기본이라는 사실을 폼 맨 위에 적는다 — 입력칸만 보면
          "채워야 하는 칸"으로 읽히고, 그렇게 채운 값은 수리 건 쪽이 바뀌어도
          따라가지 않는다(파일 헤더).

          흐린 글씨가 무엇인지도 여기서 한 번 말한다. placeholder 만 보면
          "왜 안 채워지지?"로 읽혀서, 사용자가 굳이 그대로 옮겨 적게 된다 —
          그 순간 그 값은 이 줄에 박제되어 수리 건을 따라가지 않는다. */}
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        고객사 · 형식 · L/N · S/N · 고장내역은 <strong className="font-semibold">비워 두면</strong>{" "}
        연결된 수리 건의 값을 그대로 따라갑니다. 발주서에 다르게 적힌 경우에만 직접 입력하세요.
        <br />
        칸 안의 <strong className="font-semibold">흐린 글씨</strong>는 연결된 수리 건에 적혀 있는
        값입니다. 그대로 두면(비워 두면) 목록에 그 값이 보이며, 저장되지는 않습니다.
      </p>

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {renderText("displayOrder", "순번", displayOrder, setDisplayOrder, { inputMode: "numeric" })}

        <div>
          <label className={editLabelClass} htmlFor="domestic-order-repairCaseId">
            수리 건 연결
          </label>
          {/* 검색 칸이 먼저다. 여기서 무엇을 치든 저장되는 값은 아니고,
              아래 select 에 무엇이 남는지만 정한다. */}
          <input
            type="search"
            className={`${editInputClass} mb-1`}
            value={repairCaseQuery}
            disabled={disabled}
            placeholder="인수번호로 검색 (고객사 · 형식도 됩니다)"
            aria-label="수리 건 검색"
            aria-controls="domestic-order-repairCaseId"
            autoComplete="off"
            onChange={(e) => setRepairCaseQuery(e.target.value)}
            onKeyDown={handleRepairCaseSearchKeyDown}
          />
          <select
            id="domestic-order-repairCaseId"
            className={editInputClass}
            value={repairCaseId}
            disabled={disabled}
            onChange={(e) => setRepairCaseId(e.target.value)}
          >
            {/* 연결 없는 줄이 정상이다 — 수리 없이 납품만 있는 줄, 발주는
                받았지만 아직 접수 전인 줄이 실제로 있다(schema 헤더).
                검색어가 무엇이든 이 항목은 **절대 걸러지지 않는다.** 연결을
                끊을 길이 검색어에 따라 사라지면 안 된다. */}
            <option value="">연결 없음</option>
            {visibleRepairCases.map((option) => (
              <option key={option.id} value={option.id}>
                {[option.intakeNumber, option.customerName, option.modelName]
                  .filter((part): part is string => Boolean(part))
                  .join(" · ")}
              </option>
            ))}
          </select>
          {/* 아무것도 안 걸렸다는 사실을 말해 준다. 이 말이 없으면 '연결 없음'
              하나만 남은 목록이 "연결할 수 있는 건이 없다"로 읽힌다. */}
          {matchedRepairCases.length === 0 && repairCaseOptions.length > 0 && (
            <p className={hintClass} role="status">
              맞는 수리 건이 없습니다. 검색어를 지우면 전체 {repairCaseOptions.length}건이 다시
              보입니다.
            </p>
          )}
          {fieldErrors.repairCaseId && <p className={editErrorClass}>{fieldErrors.repairCaseId}</p>}
        </div>

        <div>
          <label className={editLabelClass} htmlFor="domestic-order-customerId">
            고객사
          </label>
          <select
            id="domestic-order-customerId"
            className={editInputClass}
            value={customerId}
            disabled={disabled}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            {/* '연결 없음'이 기본값이다 — 고르지 않으면 연결된 수리 건의
                고객사를 따르고, 연결도 없으면 목록에서 '(고객사 미지정)'
                묶음에 들어간다. 값을 지울 길이 없으면 한 번 잘못 고른 고객사를
                되돌릴 방법이 없어진다.

                여기만은 흐린 글씨를 쓸 수 없다(select 에는 placeholder 가
                없다). 그래서 **고르지 않았을 때 무엇이 보이게 되는지를 그
                항목 이름에 적는다** — 이 말이 없으면 '연결 없음'이 "고객사가
                비어 있는 줄"로 읽힌다. */}
            <option value="">
              {linkedCustomerName === null
                ? "연결 없음"
                : `연결 없음 (수리 건: ${linkedCustomerName})`}
            </option>
            {customerOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          {fieldErrors.customerId && <p className={editErrorClass}>{fieldErrors.customerId}</p>}
        </div>

        {renderText("intakeNumberText", "인수번호(직접 입력)", intakeNumberText, setIntakeNumberText, {
          placeholder: repairCasePlaceholder(linkedRepairCase?.intakeNumber),
        })}
        {renderText("modelNameText", "형식", modelNameText, setModelNameText, {
          placeholder: repairCasePlaceholder(linkedRepairCase?.modelName),
        })}
        {renderText("lotNumberText", "L/N", lotNumberText, setLotNumberText, {
          placeholder: repairCasePlaceholder(linkedRepairCase?.lotNumber),
        })}
        {renderText("serialNumberText", "S/N", serialNumberText, setSerialNumberText, {
          placeholder: repairCasePlaceholder(linkedRepairCase?.serialNumber),
        })}
        {renderText("purchaseOrderNumber", "발주서번호", purchaseOrderNumber, setPurchaseOrderNumber)}
        {renderText("projectName", "PJT", projectName, setProjectName)}
        {renderText("orderIssuedDate", "발주발행일", orderIssuedDate, setOrderIssuedDate, { type: "date" })}
        {/* 납기요청일은 **여러 개**다 — 분할 납품이면 같은 발주에 날짜가
            각각 붙는다(schema/domestic-order-due-dates.ts). 다른 칸들과 달리
            한 칸이 아니라 묶음이라 표 너비를 다 쓴다.

            추가·삭제 버튼과 각 줄의 입력칸이 전부 진짜 <button>/<input> 이라
            마우스 없이도 다룰 수 있다. */}
        <fieldset className="sm:col-span-2 lg:col-span-3">
          <legend className={editLabelClass}>납기요청일</legend>

          {dueDates.length === 0 ? (
            // 빈 목록이 정상이라는 사실을 적어 둔다 — 아무것도 없는 자리는
            // "고장 났나?"로 읽힌다.
            <p className={hintClass}>납기요청일이 없습니다. 필요하면 아래에서 추가하세요.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {dueDates.map((entry, index) => {
                const errorKey = `dueDates.${index}`;
                return (
                  // key 는 index 가 아니다 — 가운데 줄을 지웠을 때 남은 칸에
                  // 엉뚱한 값이 남지 않게 한다(DueDateDraft 주석).
                  <li key={entry.key} className="flex flex-col gap-1">
                    {/* 폭은 감싸는 칸이 정한다 — editInputClass 에 이미
                        w-full 이 있어서, 같은 문자열에 w-auto 를 덧붙여도
                        어느 쪽이 이길지는 클래스 이름의 순서가 아니라
                        만들어진 CSS 의 순서가 정한다(목록 화면이 배경색을
                        겹쳐 쓰지 않는 것과 같은 이유). */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="w-44 flex-none">
                        <input
                          id={dueDateInputId(entry.key)}
                          type="date"
                          className={editInputClass}
                          value={entry.dueDate}
                          disabled={disabled}
                          // 한 화면에 여러 개라 "납기요청일"만으로는 화면
                          // 낭독기가 어느 줄인지 말할 수 없다.
                          aria-label={`납기요청일 ${index + 1}`}
                          onChange={(e) => updateDueDate(entry.key, { dueDate: e.target.value })}
                        />
                      </div>
                      <div className="min-w-40 flex-1">
                        <input
                          type="text"
                          className={editInputClass}
                          value={entry.note}
                          disabled={disabled}
                          placeholder="메모 (예: 1차분)"
                          aria-label={`납기요청일 ${index + 1} 메모`}
                          onChange={(e) => updateDueDate(entry.key, { note: e.target.value })}
                        />
                      </div>
                      <button
                        type="button"
                        className="flex-none rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-700"
                        disabled={disabled}
                        onClick={() => removeDueDate(entry.key)}
                      >
                        삭제
                        <span className="sr-only"> — 납기요청일 {index + 1}</span>
                      </button>
                    </div>
                    {fieldErrors[errorKey] && (
                      <p className={editErrorClass}>{fieldErrors[errorKey]}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <button
            type="button"
            ref={addDueDateButtonRef}
            className="mt-2 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-700"
            disabled={disabled}
            onClick={addDueDate}
          >
            납기요청일 추가
          </button>

          {/* 목록 전체가 잘못된 경우(개수 상한 초과 등)의 자리. 줄마다의
              오류는 위에서 그 줄 밑에 붙는다. */}
          {fieldErrors.dueDates && <p className={editErrorClass}>{fieldErrors.dueDates}</p>}
          {requestedDueDateHint()}
        </fieldset>
        {renderText("quoteIssuedDate", "견적발행일", quoteIssuedDate, setQuoteIssuedDate, { type: "date" })}
        {renderText("quoteNumber", "견적서번호", quoteNumber, setQuoteNumber)}
        {/* ⚠️ **납품일에는 입력칸이 없다.** 빈 자리로 두지 않고 지금 값과 까닭을
            함께 적는 이유는, 있던 칸이 그냥 사라지면 "고장 났다"로 읽히기
            때문이다 — 이 폼의 납기요청일 빈 묶음에도 같은 이유로 한 줄이 붙어
            있다.

            값은 손으로 적는 것이 아니라 워크플로가 출하 완료 때 자동으로 찍는다
            (mutations/workflow-transitions.ts). 여기서 받을 방법이 없으므로 받는
            척도 하지 않는다.

            ⚠️ 그래도 **저장에는 옛 값이 그대로 실린다**(collectFields 의
            deliveredDate) — 이 저장은 모든 칼럼을 SET 하므로, 안 보여 주는 것과
            지우는 것은 다르게 다뤄야 한다. */}
        <div>
          <span className={editLabelClass}>납품일</span>
          <p className={`${editInputClass} text-zinc-600 dark:text-zinc-300`}>
            {deliveredDateText()}
          </p>
          <p className={hintClass}>
            납품일은 연결된 수리 건의{" "}
            <strong className="font-semibold">실제 출하일</strong>이라 여기서 직접 적을 수
            없습니다. 출하 완료 처리를 하면 그 날짜가 자동으로 적힙니다.
          </p>
        </div>
        {renderText("deliveredBy", "납품자", deliveredBy, setDeliveredBy)}
        {renderText("taxInvoiceDate", "세금계산서발행일", taxInvoiceDate, setTaxInvoiceDate, { type: "date" })}
        {/* type="number" 를 쓰지 않는다 — 목록이 1,234,567 처럼 끊어 보여 주므로
            사용자가 그 모양 그대로 붙여 넣는 일이 실제로 있고, number 입력은
            그런 값을 조용히 빈칸으로 만든다. 쉼표는 검증 쪽이 걷어 낸다. */}
        {renderText("amountExcludingVat", "금액(VAT별도)", amountExcludingVat, setAmountExcludingVat, {
          inputMode: "decimal",
        })}
        {renderText("japanRemittanceNote", "일본 송금", japanRemittanceNote, setJapanRemittanceNote)}

        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={paymentCompleted}
              disabled={disabled}
              onChange={(e) => setPaymentCompleted(e.target.checked)}
            />
            입금완료
          </label>
          {fieldErrors.paymentCompleted && (
            <p className={editErrorClass}>{fieldErrors.paymentCompleted}</p>
          )}
        </div>

        {renderText(
          "faultDescriptionText",
          "고장내역",
          faultDescriptionText,
          setFaultDescriptionText,
          { long: true, hint: faultDescriptionHint() }
        )}
        {renderText("progressNote", "현황", progressNote, setProgressNote, { long: true })}
        {renderText("historyNote", "이력", historyNote, setHistoryNote, { long: true })}
        {renderText("etcNote", "기타", etcNote, setEtcNote, { long: true })}
      </div>

      <EditSectionActions
        isSubmitting={isSubmitting}
        isConflict={isConflict}
        submitError={submitError}
        onCancel={onDone}
        onReloadAfterConflict={reloadAfterConflict}
      />
    </form>
  );
}
