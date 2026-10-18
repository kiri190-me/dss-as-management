"use client";

import { useRouter } from "next/navigation";
import {
  cancelSavePopupProgress,
  finishSavePopupProgress,
  showSavePopup,
  showSavePopupProgress,
} from "@/components/common/SavePopup";
import { useState } from "react";
import { MasterDataDeleteDialog } from "@/components/common/master-data-trash-dialogs";
import type { QuoteIssueNoticeLine } from "@/components/quotes/quote-issue-messages";
import { fileNameFromContentDisposition } from "@/lib/domain/content-disposition-file-name";
import { SERVICE_REPORT_DRAFT_LABELS, buildDraftText } from "@/lib/domain/edit-draft-text";
import type { ServiceReportBodyMetrics } from "@/lib/domain/service-report-body-wrap";
import { formatServiceReportNumber } from "@/lib/domain/service-report-file-name";
import { serviceReportValuesChanged } from "@/lib/domain/service-report-draft";
import {
  buildServiceReportRequestBody,
  isServiceReportBodyEmpty,
  serviceReportKindChangePatch,
  serviceReportRowLimitErrors,
  serviceReportSerialNumberWarning,
  type ServiceReportActionsIntro,
  type ServiceReportCauseLabels,
  type ServiceReportFormLimits,
  type ServiceReportFormValues,
} from "@/lib/domain/service-report-form";
import {
  createServiceReportAction,
  deleteServiceReportAction,
  updateServiceReportAction,
} from "@/lib/server/actions/service-reports";
import type { SheetPrintGrid } from "@/lib/xlsx/sheet-print-grid";
import type { ServiceReportKind } from "@/lib/xlsx/service-report-template";
import ServiceReportActions from "./ServiceReportActions";
import ServiceReportDocumentPreviewDialog from "./ServiceReportDocumentPreviewDialog";
import ServiceReportBodyFields from "./ServiceReportBodyFields";
import ServiceReportConflictNotice from "./ServiceReportConflictNotice";
import ServiceReportLeaveConfirmDialog from "./ServiceReportLeaveConfirmDialog";
import ServiceReportDispositionFields from "./ServiceReportDispositionFields";
import ServiceReportHeaderFields from "./ServiceReportHeaderFields";
import { editInputClass, Field, ServiceReportSection } from "./ServiceReportField";
import {
  SERVICE_REPORT_SAVE_PDF_DONE_POPUP_TEXT,
  SERVICE_REPORT_SAVE_PDF_RUNNING_POPUP_TEXT,
  canLeaveAfterServiceReportSavePdf,
  runServiceReportSavePdfConvert,
} from "./service-report-save-pdf-convert";

/**
 * ============================================================================
 * 검사·수리 보고서 폼 — 저장하고, 내려받고, 지운다
 * ============================================================================
 * 서버 쪽은 이미 다 있다. 이 화면이 하는 일은 넷이다:
 *
 *   1. 초기값을 그린다 — 새 장이면 접수 건에서 옮겨 온 자동 채움, 저장된 장이면
 *      DB 에서 읽어 온 값(둘 다 서버 페이지가 만들어 넘긴다),
 *   2. 사람이 고친 값을 서버 액션에 넘겨 **저장**하고,
 *   3. 요청 본문으로 바꿔(`buildServiceReportRequestBody`) 뽑은 xlsx 를 내려받고,
 *   4. 저장된 장을 지운다(휴지통으로).
 *   5. 🔴 **저장이 끝나면** 그 건의 연락서 폴더 분류 폴더에 엑셀을 넣고 PDF 로 바꾼다
 *      (2026-10-12 — 아래 `archiveReportToContactFolder`). 🔴 **2번을 한 글자도 건드리지
 *      않는다** — 공유폴더가 꺼져 있든 느리든 실패하든 보고서는 저장된 채다.
 *
 *   6. 🔴 **저장하지 않은 값으로 문서 한 장을 미리 본다** (2026-10-19 — 아래
 *      `handlePreview`). 지금 폼의 값을 `POST …/service-report/preview-grid` 로
 *      보내고 돌려받은 격자를 창으로 띄운다(`ServiceReportDocumentPreviewDialog`).
 *      🔴 **저장이 아니다** — 서버 액션도, 임시보관 지우기도 일어나지 않는다.
 *
 * 셈은 전부 `domain/service-report-form.ts` 에 있다 — 여기 두면 시험이 붙지
 * 않고, 시험이 없으면 화면과 서버가 어긋난 것을 아무도 모른다.
 *
 * ── 🔴 **브라우저 임시보관을 걷어냈다** (2026-10-19) ───────────────────
 * 사용자 요구: 「보고서에서 적은 내용이 지금은 브라우저에 임시보관 되고 있는데
 * 그러지 말고 **새로고침 하거나 나갔다오면 저장했던 내용으로 뜨도록** 해줘.
 * (임시보관과 진짜 저장된 내용간이 구분하기 힘들어서 **브라우저와 실제 파일이
 * 차이가 생길 것 같아.**)」
 *
 * 2026-09-02 ~ 2026-10-19 사이에는 이 화면이 0.5초마다 `localStorage` 에 적고,
 * 다시 들어오면 그것을 **저장된 값보다 먼저** 되살렸다. 그 장치가 통째로 사라졌다:
 *
 *   · 🔴 **화면이 시작하는 값은 하나뿐이다** — 서버가 넘긴 `initialValues`(새 장이면
 *     자동 채움, 저장된 장이면 DB 의 값). 새로고침하면 **저장된 내용**이 뜬다.
 *   · 🔴 **브라우저에 적는 자리가 없다** — 이 파일에 `localStorage` 가 한 글자도
 *     없다는 것을 시험이 지킨다(`service-report-cancel-screen.test.tsx`).
 *
 * ── 🔴 그 자리를 무엇이 메우는가 ────────────────────────────────────────
 * 임시보관은 「저장 못 하고 나갔을 때 글을 지켜 주는」 장치였다. 없앴으므로 **실수로
 * 나가면 날아간다.** 그래서 **나가는 길마다 묻는다**:
 *
 *   1. [취소]와 머리의 [보고서 탭으로]가 **같은 `handleLeave` 하나**를 지난다 —
 *      고친 것이 있으면 「나가면 적은 내용이 사라집니다」를 묻는다
 *      (`ServiceReportLeaveConfirmDialog`). 문이 둘인데 한쪽만 묻는 일이 없게 한다.
 *   2. 저장 충돌로 얼릴 때는 적어 둔 글을 상자에 붙잡는다(`ServiceReportConflictNotice`).
 *   3. 저장하려던 장이 이미 지워져 있으면 **새 장으로 되돌린다**(아래 `NOT_FOUND`).
 *   4. 지우기는 **묻고 나서** 지운다(아래 `openDelete`·`confirmDelete`).
 *
 * ⚠️ 탭을 그냥 닫거나 전원이 나가는 사고는 이제 막지 않는다 — 사용자가 고른 쪽이다.
 *
 * ── 내려받기 · 전체 미리보기는 저장이 아니다 ────────────────────────────
 * 파일을 뽑았다고, 문서를 창으로 봤다고 화면의 값이 달라지지 않는다. 특히 **전체
 * 미리보기는 창**이라 페이지를 떠나지 않는다 — 열고 닫아도 적던 글이 그대로다
 * (그 창은 폼 **곁에** 그려지고, 닫기는 `setPreviewDocument(null)` 하나뿐이다).
 *
 * ── 🔴 만든 objectURL 을 놓아 준다 ──────────────────────────────────────
 * `URL.createObjectURL` 이 만든 주소는 문서가 살아 있는 동안 그 블롭을 붙들고
 * 있다. 보고서 하나가 수백 KB 고, 이 화면은 한 사람이 여러 장을 연달아 뽑는
 * 자리다 — 놓아 주지 않으면 탭을 닫을 때까지 계속 쌓인다
 * (`files/FilesScreen.tsx` 의 미리보기와 같은 규칙).
 *
 * ── 실패를 사람이 알아들을 말로 ─────────────────────────────────────────
 * 라우트는 실패마다 코드를 붙여 준다. 코드를 그대로 보여 주면(`RENDER_FAILED`)
 * 화면에 영어 개발자 메시지가 뜨는 것과 같다(UI_GUIDELINE 11). 코드마다 무엇을
 * 하면 되는지를 적어 준다.
 * ============================================================================
 */

/**
 * 통로가 준 코드 → 사람이 알아들을 말. 🔴 [Excel 내려받기]와 [전체 미리보기]가
 * **같은 표를 쓴다** — 막히는 까닭이 같은 문·같은 검사라, 말을 두 벌 지으면 한쪽만
 * 고쳐진다. 그래서 문장에 「내려받기」·「미리보기」를 적지 않는다(2026-10-19 에
 * UNAUTHENTICATED 가 "…내려받아 주세요"였던 것을 고쳤다). 통로마다 다른 것은
 * **아무 코드도 못 읽었을 때의 기본 문구** 하나뿐이다.
 */
const FAILURE_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "로그인이 풀렸습니다. 다시 로그인한 뒤 다시 시도해 주세요.",
  ACCOUNT_NOT_APPROVED: "계정이 아직 승인되지 않았습니다. 관리자에게 문의해 주세요.",
  FORBIDDEN: "이 보고서를 만들 권한이 없습니다. 관리자에게 문의해 주세요.",
  NOT_FOUND: "접수 건을 찾을 수 없습니다. 목록에서 다시 열어 주세요.",
  INVALID_INPUT: "적어 주신 내용을 확인해 주세요. 문제가 있는 칸 밑에 이유를 적어 두었습니다.",
  TEMPLATE_UNAVAILABLE: "보고서 양식을 읽을 수 없습니다. 관리자에게 문의해 주세요.",
  RENDER_FAILED: "보고서를 만들지 못했습니다. 관리자에게 문의해 주세요.",
};

const FALLBACK_FAILURE_MESSAGE = "보고서를 내려받지 못했습니다. 잠시 후 다시 시도해 주세요.";

/**
 * 🔴 [전체 미리보기]가 실패했을 때의 기본 문구. 내려받기와 **말이 달라야 한다** —
 * 파일을 받지 못한 것이 아니라 화면에 그리지 못한 것이고, 그 둘을 같은 말로
 * 적으면 사람은 받지도 않은 파일을 찾으러 간다. 코드별 문구는 둘이 같다
 * (`FAILURE_MESSAGES` — 막히는 까닭이 같은 통로이기 때문이다).
 */
const FALLBACK_PREVIEW_FAILURE_MESSAGE =
  "미리보기를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";

/** 서버가 지금 폼의 값으로 채워 준 문서 한 장. 창이 떠 있는 동안만 들고 있는다. */
type ServiceReportPreviewDocument = {
  grid: SheetPrintGrid;
  kindLabel: string;
  templateImageBase: string;
};

/**
 * 종류의 한글 이름. **종류 드롭다운과 지우기 확인 창이 같은 것을 쓴다** — 한
 * 화면 안에 두 벌이 있으면 문구가 바뀐 날 한쪽만 고쳐진다.
 *
 * 🔴 양식의 제목(`SERVICE_REPORT_TITLES`)을 그대로 가져오지 못한다. 그 파일은
 * 채우개라 `node:fs`·`node:zlib` 를 끌고 오고, 이 화면은 브라우저에서 돈다
 * (`domain/service-report-form.ts` 머리말의 같은 항목). 타입만 가져오는 것은
 * 안전하다 — 컴파일에서 지워진다.
 */
const KIND_LABELS: Record<ServiceReportKind, string> = {
  REPAIR: "수리 보고서",
  INSPECTION: "검사 보고서",
};

/**
 * 클릭이 브라우저의 내려받기로 넘어간 뒤에 주소를 놓아 준다.
 *
 * `click()` 직후에 곧바로 놓으면 브라우저가 아직 블롭을 읽기 전이라 저장이
 * 취소되는 일이 있다. 1초는 사람이 못 느끼고, 그 사이 붙들려 있는 메모리는
 * 어차피 방금 만든 파일 한 벌이다.
 */
const OBJECT_URL_RELEASE_MS = 1000;

type FailurePayload = {
  error?: unknown;
  code?: unknown;
  fieldErrors?: unknown;
};

/** 저장된 장 하나를 가리키는 값. 저장할 때 되돌려 보낼 잠금 토큰까지 한 벌이다. */
type SavedServiceReport = { id: string; version: number };

export default function ServiceReportForm({
  repairCaseId,
  intakeNumber,
  reportHref,
  initialValues,
  actionsIntro,
  savedReport,
  canEdit,
  canDelete,
  limits,
  bodyMetrics,
  choices,
  causeLabels,
  templateError,
}: {
  repairCaseId: string;
  intakeNumber: string;
  /**
   * 돌아갈 자리 — 「보고서」 탭. 지운 뒤에도, 🔴 **[취소]로 나갈 때도** 여기로 온다.
   * 🔴 주소를 화면이 짓지 않는다 — 서버 페이지가 `repairCaseDetailHrefs` 로 만들어
   * 넘긴다(그 함수 한 자리가 탭 주소의 주인이다).
   */
  reportHref: string;
  initialValues: ServiceReportFormValues;
  /**
   * 🔴 「조치」 첫 줄의 정형 문구 **두 벌**(검사·수리). 채우개 옆의
   * `SERVICE_REPORT_ACTIONS_INTRO` 에서 서버 페이지가 읽어 넘긴다 — 화면이
   * 문장을 들고 있으면 두 벌이 되고, 문구가 바뀐 날 한쪽만 고쳐진다.
   *
   * 쓰는 자리는 하나다: **종류를 바꿀 때** 조치 칸이 «바뀌기 전 종류의 기본
   * 문구 그대로»인지 견주는 것(`serviceReportKindChangePatch`).
   */
  actionsIntro: ServiceReportActionsIntro;
  /**
   * 🔴 저장된 장을 열었으면 그 id 와 낙관적 잠금 토큰, 새로 적는 중이면 `null`.
   * **이 하나가 「만들기」와 「고치기」를 가른다** — 저장 단추가 어느 액션을
   * 부르는지, 지우기가 보이는지, 임시보관 열쇠가 어느 칸인지가 전부 여기서 갈린다.
   */
  savedReport: SavedServiceReport | null;
  /** 저장할 수 있는가(WRITE). 🔴 감추는 것은 편의다 — 경계는 서버 액션 안이다. */
  canEdit: boolean;
  /** 지울 수 있는가(MANAGE). 저장보다 좁다. */
  canDelete: boolean;
  limits: ServiceReportFormLimits;
  /**
   * 🔴 **그 건이 쓸 양식에서 읽은 칸 폭 한 벌**(2026-10-18). 본문·비고 미리보기와
   * 적는 칸의 폭이 전부 여기서 나온다 — 화면이 숫자를 굳혀 들고 있으면 사람이
   * 양식을 저장만 해도(Excel 이 열 너비를 다시 쓴다) 미리보기가 거짓말을 한다.
   *
   * 드롭다운 목록과 **같은 양식·같은 try** 에서 오므로 `null` 인 때도 같다.
   */
  bodyMetrics: ServiceReportBodyMetrics | null;
  /** 🔴 양식에서 읽은 드롭다운 목록. 양식을 못 읽었으면 null 이다. */
  choices: { situationRequests: readonly string[]; productNames: readonly string[] } | null;
  /**
   * 🔴 원인 열 가지의 한글 이름. **채우개의 표에서 온다** — 화면이 사본을 들고
   * 있으면 양식의 라벨이 바뀐 날 화면과 문서가 서로 다른 이름을 부른다.
   */
  causeLabels: ServiceReportCauseLabels;
  /** 양식을 못 읽었을 때 사람에게 보여 줄 말. 경로는 담기지 않는다. */
  templateError: string | null;
}) {
  const router = useRouter();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  /** [전체 미리보기]를 눌러 서버가 문서를 짓는 동안. 🔴 타자마다가 아니라 **누를 때만** 돈다. */
  const [isPreviewing, setIsPreviewing] = useState(false);
  /**
   * 🔴 떠 있는 미리보기 창의 내용. **눌렀던 그 순간의 값**으로 만든 문서다 —
   * 창이 떠 있는 동안은 폼이 가려져 고칠 수 없으므로 낡을 일이 없고, 닫으면 놓는다.
   * 저장과는 아무 관계가 없다(이 값이 DB 로 가는 길은 없다).
   */
  const [previewDocument, setPreviewDocument] = useState<ServiceReportPreviewDocument | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | null>(null);

  /**
   * 🔴 [저장] 뒤 **연락서 폴더 · PDF** 결과 줄 (2026-10-12).
   *
   * 도는 동안은 **팝업**이 말하므로 여기는 비어 있고, 줄이 차는 때는 **끝난 뒤**뿐이다 —
   * 그것도 사람이 읽어야 할 것이 남았을 때만이다(아래 `archiveReportToContactFolder`).
   * 🔴 경로 · 파일 이름은 한 글자도 들어 있지 않다(흐름 모듈이 지킨다).
   */
  const [pdfNoticeLines, setPdfNoticeLines] = useState<QuoteIssueNoticeLine[]>([]);

  /**
   * 지우기 확인 창의 상태. 창은 자기 상태를 갖지 않으므로(그 파일의 원칙) 열림
   * 여부·사유·실패 문구를 여기서 들고 있는다. 전송 중인지는 `isSaving` 이 이미
   * 말한다 — 지우는 동안 저장·내려받기가 눌리면 안 되므로 같은 깃발을 쓴다.
   */
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /**
   * 🔴 「저장하지 않고 나가시겠습니까」 창이 떠 있는가 (2026-10-19).
   *
   * 지우기 창과 같은 규칙이다 — 창은 자기 상태를 갖지 않고 여기가 소유한다. 다만
   * **전송 중 깃발이 없다**: 나가는 일은 서버에 아무것도 보내지 않는다.
   */
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  /**
   * 지금 붙들고 있는 장. 서버가 넘긴 것으로 시작하고, **저장에 성공할 때마다
   * 갱신된다.**
   *
   * 🔴 props 를 그대로 쓰지 않는 까닭: 저장이 성공하면 version 이 하나 오른다.
   * 서버가 다시 그려 줄 때까지 낡은 토큰을 들고 있으면, 곧바로 한 번 더 저장할 때
   * **자기 자신과 충돌**한다. 새로 만든 직후에는 id 도 여기서 생긴다.
   */
  const [saved, setSaved] = useState<SavedServiceReport | null>(savedReport);

  /**
   * 저장 충돌. 얼리기 직전에 사람이 친 글을 붙잡아 둔다 —
   * `ServiceReportConflictNotice` 가 그것을 읽기 전용 상자에 담는다.
   */
  const [conflict, setConflict] = useState<{
    message: string;
    draftText: string;
    reloaded: boolean;
  } | null>(null);

  /**
   * 마지막으로 **저장에 성공한** 값 한 벌. 아직 이 화면에서 저장한 적이 없으면 null.
   *
   * 🔴 **[취소]가 물을지 말지의 기준선**이다(아래 `dirty`). 저장이 끝난 뒤에는 서버가
   * 다시 그려 줄 때까지 `initialValues` 가 낡아 있으므로, 그것만 보면 «방금 저장한
   * 그대로»인데도 「나가면 사라집니다」를 묻게 된다 — 읽히지 않는 물음이 하나 늘면
   * 정작 글이 사라질 때도 그냥 넘긴다.
   */
  const [savedValues, setSavedValues] = useState<ServiceReportFormValues | null>(null);

  /**
   * 🔴 **사람이 이번에 고친 값.** 아직 한 칸도 안 고쳤으면 null 이다.
   *
   * 「지금 화면의 값」을 state 하나에 담지 않고 이렇게 갈라 두는 까닭은 **서버가
   * 넘긴 값이 언제나 바닥**이어야 하기 때문이다 — `initialValues` 가 바뀌면(저장된
   * 장을 다시 읽어 오거나, 다른 장으로 갈아 끼우면) 고친 것이 없는 화면은 **그
   * 자리에서 새 값**을 보여 준다. 2026-10-19 에 임시보관을 걷어낸 뒤로 이 둘 사이에
   * 끼어드는 것은 아무것도 없다(위 머리말).
   */
  const [edited, setEdited] = useState<ServiceReportFormValues | null>(null);

  /**
   * 🔴 지금 화면이 열어 둔 장의 id. **서버가 다른 장을 넘겨주면 화면을 갈아
   * 끼우기 위한 표식**이다.
   *
   * 이 화면은 주소만 바뀌고 컴포넌트는 그대로 남을 수 있다(`?id=` 는 같은 경로의
   * 질의문자열이다). 그때 이 갈아 끼우기가 없으면 **A 장의 고친 값이 B 장의 폼에
   * 그대로 남고**, 저장하는 순간 B 에 A 의 글이 찍힌다.
   *
   * 🔴 effect 가 아니라 **그리는 도중에** 맞춘다 — props 가 바뀌었을 때 상태를
   * 고치는 React 의 권장 방식이다. effect 로 하면 낡은 값으로 한 번 그린 뒤 다시
   * 그리게 되고, 그 한 프레임에 남의 장의 글이 보인다. (여기서 상태를 고치면
   * React 가 이 렌더를 버리고 곧바로 다시 그리므로, 위에서 계산해 둔 것들은
   * 화면에 닿지 않는다.)
   */
  const [openedId, setOpenedId] = useState<string | null>(savedReport?.id ?? null);
  if ((savedReport?.id ?? null) !== openedId) {
    setOpenedId(savedReport?.id ?? null);
    setSaved(savedReport);
    // 앞 장에 딸린 것은 전부 놓는다. 🔴 다만 알림 문구(formError·statusMessage)는
    // 그대로 둔다 — 새로 만든 직후가 바로 이 길이라(주소가 `?id=` 로 바뀐다),
    // 여기서 지우면 "새 보고서로 저장했습니다"가 뜨자마자 사라진다.
    setEdited(null);
    setSavedValues(null);
    setConflict(null);
    setFieldErrors(null);
    // 열려 있던 지우기 확인 창도 닫는다 — 앞 장의 이름을 보여 주면서 지우는 것은
    // 새 장이 되는 창을 남겨 두지 않는다.
    setDeleteOpen(false);
    setDeleteError(null);
    // 🔴 「나가시겠습니까」도 닫는다 — 앞 장의 글을 두고 묻던 물음이라, 갈아 끼운
    //    장에서 그대로 「나가기」를 누르면 묻지도 않은 것을 승낙한 꼴이 된다.
    setLeaveConfirmOpen(false);
    // 🔴 떠 있던 미리보기 창도 닫는다 — 앞 장의 문서를 새 장의 화면 위에 띄워 두면
    //    사람은 그것을 **이 장의 문서**로 읽는다.
    setPreviewDocument(null);
  } else if (savedReport !== null && saved !== null && savedReport.version > saved.version) {
    /**
     * 같은 장인데 서버가 **더 앞선 토큰**을 넘겼다 — 충돌 뒤 「최신 내용 다시
     * 불러오기」로 오는 길이다. 토큰만 올린다(값은 초기값이 이미 최신이다).
     *
     * 🔴 **더 클 때만** 받는다. 우리가 방금 저장해 version 을 올린 직후에는 아직
     * 낡은 props 가 남아 있는데, 그것을 그대로 받으면 다음 저장이 **자기 자신과
     * 충돌한다.** 토큰은 오르기만 한다.
     */
    setSaved(savedReport);
  }

  /**
   * 지금 화면의 값 — **고친 것 > 서버가 넘긴 것** 둘뿐이다.
   *
   * 🔴 2026-10-19 에 가운데 있던 「되살린 임시보관」이 빠졌다. 그래서 새로고침하면
   * 언제나 **저장된 내용**이 뜬다(위 머리말).
   */
  const values = edited ?? initialValues;

  function update(patch: Partial<ServiceReportFormValues>) {
    setEdited((previous) => ({ ...(previous ?? values), ...patch }));
  }

  /**
   * 🔴 **저장하지 않은 고침이 남아 있는가** — [취소]가 물을지 말지가 이 하나로
   * 갈린다. 판단은 도메인에 있다(`serviceReportValuesChanged` — 칸이 하나 늘면
   * tsc 가 그쪽을 잡는다).
   *
   * 기준선은 «이 화면이 저장된 것으로 믿는 값»이다: 이 화면에서 저장에 성공했으면
   * 그 값, 아니면 서버가 넘긴 초기값. 🔴 아무것도 안 고쳤으면 **묻지 않고 바로
   * 나간다** — 늘 물으면 사람이 읽지 않고 누르는 손을 배운다.
   */
  const dirty = serviceReportValuesChanged(savedValues ?? initialValues, values);

  /**
   * ── 🔴 [취소] · 머리의 [보고서 탭으로] — 저장하지 않고 나간다 (2026-10-19) ──
   * 사용자 요구: 「[저장] 왼쪽에 [취소] 버튼을 만들어줘. 그 버튼을 누르면 지금
   * 내용이 저장되지 않은 채 보고서 탭으로 빠져나오게 해줘.」
   *
   *  · 🔴 **저장하지 않는다.** 서버 액션도, 통로도 부르지 않는다.
   *  · 🔴 **고친 것이 있으면 묻는다.** 같은 날 임시보관을 걷어내서 **돌아올 길이
   *    없다** — 나가면 사라진다는 사실이 사람에게 보여야 한다
   *    (`ServiceReportLeaveConfirmDialog`).
   *  · 🔴 **문이 둘인데 한쪽만 묻는 일이 없게** 머리의 [보고서 탭으로]도 같은 길을
   *    지난다. 그래서 그것은 이제 `<Link>` 가 아니라 단추다.
   *  · 가는 곳은 `reportHref` 다 — 주소를 여기서 짓지 않는다(서버 페이지가
   *    `repairCaseDetailHrefs` 로 만들어 넘긴다).
   */
  function handleLeave() {
    if (dirty) {
      setLeaveConfirmOpen(true);
      return;
    }
    leaveWithoutSaving();
  }

  function leaveWithoutSaving() {
    setLeaveConfirmOpen(false);
    router.push(reportHref);
  }

  const rowLimitErrors = serviceReportRowLimitErrors(values, limits);
  const bodyEmpty = isServiceReportBodyEmpty(values);
  // 양식을 못 읽으면 서버도 503 을 준다 — 다 채우고 나서 알게 하지 않는다.
  const blocked = templateError !== null;
  /**
   * 충돌로 얼린 상태. 낡은 폼에서 한 번 더 저장하게 두면 **남의 저장을 덮는다** —
   * 편집 폼 셋과 같은 규칙이다(`detail/edit/useSectionEditSubmit.ts`). 다시
   * 불러오고 나면 풀린다.
   */
  const frozen = conflict !== null && !conflict.reloaded;
  /**
   * 🔴 미리보기도 **바쁜 상태**다 — [Excel 내려받기]가 도는 동안 폼을 얼리는 것과
   * 같은 자리, 같은 까닭이다(보낸 값과 화면의 값이 갈라지지 않게). 통로 한 번이라
   * 사람이 멈춤을 느끼지 않는다.
   */
  const busy = isSubmitting || isSaving || isPreviewing;
  const disabled = busy || blocked || frozen;
  const canDownload =
    !disabled && !bodyEmpty && rowLimitErrors.body === undefined && rowLimitErrors.remark === undefined;
  /**
   * 저장은 **적다 만 보고서도 받는다** — 본문이 비었는지, 줄 수가 넘는지는 문서로
   * 나갈 때 보는 규칙이지 저장의 규칙이 아니다
   * (`validation/service-report-save-input.ts` 의 '그 밖의 규칙은 여기서 보지
   * 않는다'). 양식을 못 읽었을 때만 막는다 — 그때는 드롭다운이 비어 있어 화면에
   * 보이는 것이 실제 값과 다를 수 있다.
   */
  const canSave = canEdit && !busy && !frozen && !blocked;

  const mode: "NEW" | "SAVED" = saved === null ? "NEW" : "SAVED";

  /**
   * 확인 창에 적을 «무엇을 지우는가» 한 줄 — 종류와 문서번호.
   *
   * 🔴 **지금 화면의 값(`values`)이 아니라 서버가 넘긴 저장된 값**을 쓴다. 지우는
   * 것은 표에 있는 그 장이고, 아직 저장하지 않은 수정(되살린 임시보관 포함)은
   * 그 장의 이름이 아니다 — 번호 칸을 고쳐 놓고 지우면 창이 저장된 적 없는
   * 번호를 부르게 된다.
   *
   * 번호 세 칸은 다 비운 채로도 저장되므로 **빈 글자일 수 있다.** 그때 이름 없는
   * 줄이 되지 않게 「문서번호 없음」으로 적는다. 세 조각을 잇는 규칙은 파일 이름과
   * 목록이 쓰는 그 함수를 그대로 쓴다 — 여기 베끼면 규칙이 두 곳에 산다.
   *
   * ⚠️ **목록과 일부러 다르다.** 「보고서」 탭의 목록은 줄 이름을
   * `모델명_L/N_S/N` 로 부르지만(`domain/service-report-list.ts`), 이 창은 목록이
   * 아니라 «지금 열어 둔 이 장을 지운다»를 확인하는 자리다 — 어느 장인지는 이미
   * 화면이 말하고 있고, 여기서 답해야 하는 물음은 «표에 저장된 그 번호가
   * 맞는가»이다. 그래서 저장된 문서번호로 부르고, 없으면 그 사실을 그대로 적는다.
   * 목록과 달라 보인다고 맞추려 들지 말 것.
   */
  const savedReportNumber = formatServiceReportNumber({
    prefix: initialValues.reportNumberPrefix,
    middle: initialValues.reportNumberMiddle,
    tail: initialValues.reportNumberTail,
  });
  const deleteTargetName = `${KIND_LABELS[initialValues.kind]} · ${
    savedReportNumber === "" ? "문서번호 없음" : savedReportNumber
  }`;

  /**
   * ── 저장 ─────────────────────────────────────────────────────────────
   * 새 장이면 만들고, 열어 둔 장이면 갱신한다. 어느 쪽인지는 `saved` 하나로
   * 갈린다.
   *
   * 🔴 실패 코드마다 다르게 다룬다:
   *   · `CONFLICT`         적어 둔 글을 붙잡고 폼을 얼린다(아래 상자).
   *   · `NOT_FOUND`        그 장이 사라졌다 — **새 장으로 되돌린다**(아래 주석).
   *   · `VALIDATION_ERROR` 칸 오류를 해당 칸 옆에.
   *   · 그 밖               서버가 준 말을 그대로.
   */
  /**
   * ============================================================================
   * 🔴 [저장]이 끝난 **뒤** 연락서 폴더에 엑셀을 넣고 PDF 로 바꾼다 (2026-10-12)
   * ============================================================================
   * 사용자 요구(2026-10-12): 「보고서 탭에서 [저장]을 누르면 그 건의 연락서 폴더 안 분류
   * 폴더에 엑셀을 쓰고, 그 엑셀을 PDF 로 바꿔 같은 자리에 둔다.」 흐름과 상한은
   * ./service-report-save-pdf-convert.ts 한 자리에 있다(견적서 쪽을 그대로 본떴다).
   *
   *  · 🔴 **저장을 막지 않는다** — 서버 액션이 이미 돌아온 **뒤에** 부른다.
   *  · 🔴 **저장은 되돌아가지 않는다** — 돌려주는 값은 「넘어가도 되는가」뿐이고, 던져도
   *    여기서 삼킨다(밖의 catch 가 「저장 실패」라고 거짓말하지 않게).
   *  · 넘어가도 되는 결과는 둘이다: 공유폴더가 꺼져 있다 · **PDF 를 만들었다**. 그 밖은
   *    사람이 읽을 것이 있어 이 화면에 남는다 — 첫 줄이 「보고서는 저장되었습니다.」다.
   *
   * ── 🔴 도는 동안은 **팝업**이다 ─────────────────────────────────────────
   * 「저장된 엑셀을 PDF 로 바꾸는 중입니다…」가 팝업으로 뜨고, 끝나면 **같은 팝업**이
   * 「완료되었습니다」로 바뀐 뒤 0.5초 뒤 「보고서」 탭으로 넘어간다. 🔴 팝업은 **변환이
   * 진짜 시작될 때만** 뜬다(도우미 주소를 연 그때) — 그 앞에서 끝나는 길은 통로 한두 번이라
   * 팝업이 떴다 지는 깜빡임이 생기지 않게 띄우지 않는다.
   * 🔴 **실패하면 팝업을 닫는다** — 「Excel 이 없는 PC」 같은 말은 사람이 **읽어야 하는**
   * 알림이라 0.5초 뒤 사라지는 팝업으로 전할 수 없다.
   * ============================================================================
   */
  async function archiveReportToContactFolder(serviceReportId: string): Promise<"SAVED" | "POPUP" | "STAY"> {
    // 변환이 **시작됐는가** — 팝업을 띄웠는가와 같은 말이다.
    let converting = false;
    try {
      const outcome = await runServiceReportSavePdfConvert({
        repairCaseId,
        serviceReportId,
        onConvertStart: () => {
          converting = true;
          showSavePopupProgress({
            message: SERVICE_REPORT_SAVE_PDF_RUNNING_POPUP_TEXT,
            redirectTo: reportHref,
          });
        },
      });
      const canLeave = canLeaveAfterServiceReportSavePdf(outcome.kind);
      // 넘어가도 되는 결과면 줄을 남기지 않는다 — 떠날 화면에 알림을 쌓지 않는다.
      setPdfNoticeLines(canLeave ? [] : outcome.lines);
      // 팝업을 띄운 적이 없으면 지금까지와 똑같다 — 저장 팝업을 띄우거나, 화면에 남는다.
      if (!converting) return canLeave ? "SAVED" : "STAY";
      if (!canLeave) {
        cancelSavePopupProgress();
        return "STAY";
      }
      finishSavePopupProgress(SERVICE_REPORT_SAVE_PDF_DONE_POPUP_TEXT);
      return "POPUP";
    } catch (pdfError) {
      // 🔴 오류의 message 를 적지 않는다 — 폴더 이름 · 경로가 섞인다.
      console.error("보고서 연락서 폴더 · PDF 변환에서 예상치 못한 오류", {
        name: pdfError instanceof Error ? pdfError.name : typeof pdfError,
      });
      setPdfNoticeLines([]);
      // 🔴 떠 있는 진행 팝업을 걷는다 — 안 그러면 아무 말 없이 떠 있는 채로 사람이 갇힌다.
      if (converting) cancelSavePopupProgress();
      return "SAVED";
    }
  }

  async function handleSave() {
    if (!canSave) return;

    setIsSaving(true);
    setFormError(null);
    setStatusMessage(null);
    setFieldErrors(null);
    setPdfNoticeLines([]);

    try {
      const result = saved
        ? await updateServiceReportAction({
            serviceReportId: saved.id,
            expectedVersion: saved.version,
            values,
          })
        : await createServiceReportAction({ repairCaseId, values });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          // 얼리기 **전에** 사람이 친 글을 붙잡는다. 무엇을 보여 줄지는
          // `domain/edit-draft-text.ts` 가 혼자 정한다(날짜·고르는 값·정형 문구 제외).
          setConflict({
            message: result.message,
            draftText: buildDraftText(values, SERVICE_REPORT_DRAFT_LABELS),
            reloaded: false,
          });
          return;
        }

        if (result.code === "NOT_FOUND") {
          /**
           * 🔴 누가 이 장을 지웠다. 여기서 오류만 띄우면 **적어 둔 글이 갈 곳을
           * 잃는다** — 이 id 는 다시 열리지 않는다. 임시보관을 걷어낸 2026-10-19
           * 뒤로는 받아 줄 자리가 어디에도 없어서, 이 갈래가 **글이 남는 유일한
           * 길**이다.
           *
           * 그래서 이 화면을 **새 장으로 되돌린다.** 지금 보고 있는 값은 그대로
           * 두고(`setEdited(values)`) 「만들기」로 돌린다. 그러면 [저장하기]가
           * 곧바로 새 보고서를 만든다.
           *
           * ⚠️ **주소는 건드리지 않는다.** `?id=` 를 떼면 서버가 이 화면을 다시
           * 그리고, 그러면 위의 «장이 바뀌었다» 갈래가 돌아 `edited` 를 놓는다 —
           * 방금 지키려던 그 글이 바로 그때 사라진다. 🔴 같은 이유로 **새로고침하면
           * 그 글은 없다** — 그래서 문구가 「지금 화면의 내용은 그대로 남아 있습니다」
           * 로 끝나지 않고 [저장하기]를 누르라고 말한다.
           */
          setEdited(values);
          setSaved(null);
          setSavedValues(null);
          setFormError(
            "이 보고서는 이미 지워졌습니다(다른 사람이 지웠을 수 있습니다). 지금 화면의 내용은 그대로 남아 있습니다 — [저장하기]를 누르면 새 보고서로 저장됩니다."
          );
          return;
        }

        setFieldErrors(result.fieldErrors ?? null);
        setFormError(result.message);
        return;
      }

      /**
       * 성공. 🔴 **지금 화면의 값을 못 박는다**(`setEdited`) — 서버는 아직 이 화면을
       * 다시 그려 주지 않았으므로, 여기서 놓으면 새 장은 **방금 저장한 글이 아니라
       * 자동 채움 값**으로 되돌아간다.
       *
       * 🔴 같은 값을 `savedValues` 에도 둔다. [취소]가 「고친 것이 있는가」를 재는
       * 기준선이라, 이것이 없으면 **방금 저장한 그대로인데도** 「나가면 사라집니다」를
       * 묻게 된다(PDF 변환이 할 말을 남겨 이 화면에 머무는 길이 실제로 있다).
       */
      setEdited(values);
      setSaved({ id: result.id, version: result.version });
      setSavedValues(values);

      /**
       * 🔴 **여기서부터는 저장이 끝난 뒤의 일이다** (2026-10-12). 연락서 폴더에 엑셀을
       * 넣고 PDF 로 바꾼다 — 무슨 일이 나도 위의 저장은 그대로다(위 함수의 머리말).
       */
      const next = await archiveReportToContactFolder(result.id);
      if (next !== "SAVED") return;

      /*
       * 저장 팝업을 0.5초 띄운 뒤 「보고서」 탭(보고서 목록)으로 넘어간다 —
       * 2026-09-15 사용자 요청. 그 전에는 이 화면에 머물며 「저장했습니다」를
       * 적고, 새 장이면 주소를 `?id=` 로 바꿨다. 떠날 화면이라 주소를 바꾸지도
       * 다시 읽지도 않는다 — 넘어가기 직전에 replace·refresh 를 부르면 이동과
       * 다툰다(QuoteEditForm 의 🔴 주석과 같은 사정). 넘기는 것은 팝업이 한다.
       */
      showSavePopup({
        message: saved ? "보고서를 저장했습니다." : "새 보고서를 저장했습니다.",
        redirectTo: reportHref,
      });
    } catch {
      setFormError("서버에 닿지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * ── 지우기 ───────────────────────────────────────────────────────────
   * 휴지통으로 보낸다(영구 삭제가 아니다). 지운 뒤에는 목록으로 돌아간다.
   *
   * 🔴 **묻고 나서 지운다.** 아직 저장하지 않은 수정이 남아 있을 수 있고, 그 장은
   * 다시 열리지 않으므로 그 글도 갈 곳이 없다. 무엇이 함께 사라지는지 물음에
   * 그대로 적는다(아래 `cascadeNote`).
   *
   * 🔴 묻는 창은 **이 저장소의 표준 창**이다(`MasterDataDeleteDialog`). 예전에는
   * 브라우저가 그린 기본 팝업이었는데, 그러면 이 화면만 생김새가 다르다 — 지우는
   * 일의 모양이 화면마다 달라지면 사람은 화면마다 다른 규칙이 있다고 배운다(그
   * 파일 머리말). 견적서가 한 건을 지울 때 하는 그대로 쓴다 — ⚠️ 그 화면은 2026-10-07
   * 부터 공용 묶음의 것이다(`vendor/dss-core/src/ui/quotes/QuoteListScreen.tsx`).
   *
   * 창은 자기 상태를 갖지 않는다 — 열림 여부·사유·전송 중·오류는 전부 여기가
   * 소유한다.
   */
  function openDelete() {
    if (!saved || !canDelete || busy) return;
    setDeleteReason("");
    setDeleteError(null);
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!saved || !canDelete || busy) return;

    setIsSaving(true);
    setDeleteError(null);
    setFormError(null);
    setStatusMessage(null);
    setFieldErrors(null);

    try {
      const result = await deleteServiceReportAction({
        serviceReportId: saved.id,
        expectedVersion: saved.version,
        // 다듬는 규칙은 서버가 한 번 더 본다(`service-report-action-input.ts`).
        // 여기서 미리 접어 보내는 것은 공백만 친 사유를 굳이 실어 보내지 않으려는
        // 것뿐이다 — 견적서와 같은 모양이다.
        reason: deleteReason.trim() === "" ? null : deleteReason.trim(),
      });

      if (!result.ok) {
        if (result.code === "NOT_FOUND") {
          // 이미 없다. 지우려던 일은 어차피 이루어진 셈이라 목록으로 보낸다.
          // 🔴 이 갈래만 창을 띄운 채 화면을 떠난다 — 없는 장에 대한 오류를
          //    창에 남겨 봐야 사람이 할 수 있는 일이 없다.
          router.replace(reportHref);
          router.refresh();
          return;
        }
        /**
         * 🔴 **창을 닫지 않고 그 안에 오류를 보여 준다.** 닫아 버리면 사람이 방금
         * 적은 사유가 함께 사라지고, 무엇이 잘못됐는지도 모른 채 다시 눌러야 한다
         * (견적서와 같은 처리).
         *
         * CONFLICT 도 여기서 얼리지 않는다 — 지우기는 **아무 글도 잃지 않은
         * 실패**다(폼은 그대로다). 최신 내용을 보고 다시 판단하라고만 말한다.
         */
        setDeleteError(result.message);
        return;
      }

      router.replace(reportHref);
      router.refresh();
    } catch {
      setDeleteError("서버에 닿지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * 충돌 뒤 「최신 내용 다시 불러오기」.
   *
   * 🔴 고친 값을 놓는다(`setEdited(null)`) — 안 그러면 다시 불러온 화면에 방금 그
   * 낡은 값이 그대로 남아 서버의 최신 내용을 덮어 보여 준다. 놓아도 되는 까닭은
   * **그 글이 상자에 그대로 남아 있기** 때문이고, 상자는 사람이 「옮겨 적었습니다」를
   * 누를 때에만 사라진다.
   */
  function handleConflictReload() {
    setEdited(null);
    // 버린 글에 붙어 있던 지적이라 함께 지운다 — 안 그러면 없는 글에 대한
    // 오류가 칸 밑에 남는다.
    setFieldErrors(null);
    setFormError(null);
    setStatusMessage(null);
    setConflict((previous) => (previous === null ? null : { ...previous, reloaded: true }));
    router.refresh();
  }

  /**
   * ── 🔴 [전체 미리보기] — 저장하지 않은 값으로 문서 한 장을 본다 (2026-10-19) ──
   * 사용자 요구: 「보고서 수정하고서 **저장을 누르지 않은 채** 저장 옆에 있는
   * 미리보기를 눌렀을 때에 수정한 내용이 반영되도록 해줘.」
   *
   *  · 🔴 **저장하지 않는다.** 여기서 서버 액션을 부르지 않는다 — 시험 삼아 쳐 본
   *    글이 남으면 그 요구가 성립하지 않는다. 보내는 것은 [Excel 내려받기]와 **똑같은
   *    요청 본문**이고(`buildServiceReportRequestBody`), 그 통로도 저장하지 않는다.
   *  · 🔴 **임시보관도 건드리지 않는다** — 내려받기와 같은 판단이다(위 머리말 3번:
   *    「내려받기는 저장이 아니다」). 뽑아 본 뒤 고칠 것을 발견하는 것이 이 화면의
   *    보통 쓰임이다.
   *  · 실패는 내려받기와 **같은 코드표**로 읽는다(`FAILURE_MESSAGES`) — 막히는
   *    까닭이 같은 통로라 말을 두 벌 지을 이유가 없다. 기본 문구만 다르다.
   */
  async function handlePreview() {
    if (!canDownload) return;

    setIsPreviewing(true);
    setFormError(null);
    setStatusMessage(null);
    setFieldErrors(null);

    try {
      const response = await fetch(`/api/repair-cases/${repairCaseId}/service-report/preview-grid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildServiceReportRequestBody(values)),
      });

      if (!response.ok) {
        let payload: FailurePayload = {};
        try {
          payload = (await response.json()) as FailurePayload;
        } catch {
          // 본문이 JSON 이 아닌 실패(프록시·게이트웨이)도 있다. 그때는 아래 기본 문구다.
        }

        const code = typeof payload.code === "string" ? payload.code : "";
        setFieldErrors(
          payload.fieldErrors !== null && typeof payload.fieldErrors === "object"
            ? (payload.fieldErrors as Record<string, string>)
            : null
        );
        setFormError(FAILURE_MESSAGES[code] ?? FALLBACK_PREVIEW_FAILURE_MESSAGE);
        return;
      }

      // 🔴 `document` 라는 이름을 쓰지 않는다 — 전역 `document` 를 가린다.
      const preview = (await response.json()) as ServiceReportPreviewDocument;
      setPreviewDocument(preview);
    } catch {
      setFormError("서버에 닿지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleDownload() {
    setIsSubmitting(true);
    setFormError(null);
    setStatusMessage(null);
    setFieldErrors(null);

    try {
      const response = await fetch(`/api/repair-cases/${repairCaseId}/service-report/xlsx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildServiceReportRequestBody(values)),
      });

      if (!response.ok) {
        let payload: FailurePayload = {};
        try {
          payload = (await response.json()) as FailurePayload;
        } catch {
          // 본문이 JSON 이 아닌 실패(프록시·게이트웨이)도 있다. 그때는 아래 기본 문구다.
        }

        const code = typeof payload.code === "string" ? payload.code : "";
        setFieldErrors(
          payload.fieldErrors !== null && typeof payload.fieldErrors === "object"
            ? (payload.fieldErrors as Record<string, string>)
            : null
        );
        setFormError(FAILURE_MESSAGES[code] ?? FALLBACK_FAILURE_MESSAGE);
        return;
      }

      const blob = await response.blob();
      const fileName =
        fileNameFromContentDisposition(response.headers.get("Content-Disposition")) ??
        "검사수리보고서.xlsx";

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // 🔴 놓아 준다. 위 'OBJECT_URL_RELEASE_MS' 참조.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_RELEASE_MS);

      // 🔴 **내려받았다고 임시보관을 지우지 않는다** — DB 저장이 생긴 뒤에도
      // 그대로다(2026-09-02 재판단, 위 머리말 3번).
      //
      // 내려받기는 저장이 아니다. 아직 [저장하기]를 누르지 않았다면 이 임시보관이
      // 여전히 **유일한 사본**이고, 여기서 지우면 받은 파일을 열어 보고 고칠 것을
      // 발견한 사람이 처음부터 다시 적어야 한다 — 한 장을 두세 번 뽑는 것이 이
      // 화면의 보통 쓰임이다. 저장한 뒤라면 어차피 적어 둘 것이 없다(위 저장
      // 성공 갈래가 이미 지웠고, 그 뒤로 고친 것이 없으면 다시 적히지도 않는다).
      setStatusMessage(`${fileName} 을(를) 내려받았습니다.`);
    } catch {
      setFormError("서버에 닿지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            검사 · 수리 보고서
          </h1>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            인수번호 {intakeNumber} —{" "}
            {mode === "SAVED" ? "저장된 보고서를 고치는 중입니다." : "새 보고서를 적는 중입니다."}
          </p>
        </div>
        {/* 🔴 `<Link>` 가 아니라 단추다 (2026-10-19) — [취소]와 **같은 `handleLeave`**
            를 지나야 고친 것이 있을 때 묻는다. 링크로 두면 문이 둘인데 한쪽만 묻는다. */}
        <button
          type="button"
          onClick={handleLeave}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          보고서 탭으로
        </button>
      </div>

      {/* 🔴 충돌 상자는 「옮겨 적었습니다」를 누를 때까지 남는다 — 그 안의 글이
          이 화면에서 잃을 뻔한 전부다. */}
      {conflict !== null && (
        <ServiceReportConflictNotice
          message={conflict.message}
          draftText={conflict.draftText}
          reloaded={conflict.reloaded}
          onReload={handleConflictReload}
          onDismiss={() => setConflict(null)}
          disabled={busy}
        />
      )}

      {/* 🔴 경로는 담지 않는다 — 오류 메시지가 디스크 구조를 알려 주는 창구가 되면 안 된다. */}
      {templateError && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {templateError}
        </p>
      )}

      {formError && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {formError}
        </p>
      )}

      {statusMessage && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400">
          {statusMessage}
        </p>
      )}

      {/* 🔴 [저장] 뒤 연락서 폴더 · PDF 결과(2026-10-12). 도는 동안은 팝업이 말하므로
          여기 줄이 차는 때는 **끝난 뒤 · 사람이 읽을 것이 남았을 때**뿐이다. 첫 줄이
          「보고서는 저장되었습니다.」라 저장이 끝났다는 것이 먼저 읽힌다. */}
      <ServiceReportSavePdfNotice lines={pdfNoticeLines} onLeave={() => router.push(reportHref)} />

      {/*
        🔴 **단추 줄이 「보고서 종류」 위다** (2026-10-19 사용자 요구: 「그 버튼들을
        [보고서 종류] 창 위에 위치하도록 해줘」). 예전에는 폼 맨 아래였다 — 본문이
        길어지면 [저장]을 누르러 스무 줄을 내려가야 했다. 🔴 **순서가 곧 요구**라서
        이 자리를 옮기면 시험이 깨진다(`service-report-cancel-screen.test.tsx`).
      */}
      <ServiceReportActions
        mode={mode}
        canEdit={canEdit}
        canDelete={canDelete}
        isSaving={isSaving}
        isDownloading={isSubmitting}
        isPreviewing={isPreviewing}
        canSave={canSave}
        canDownload={canDownload}
        // 🔴 **저장된 장**의 인쇄 화면이다(DB 에 저장된 값을 그린다). 주소는 지금
        //    보고 있는 화면(`usePathname`)이 아니라 「보고서」 탭에서 만든다. 두
        //    화면은 형제라 같은 부모에서 갈라져 나오고, 그래야 질의문자열이 붙은
        //    주소에서도 자리가 흔들리지 않는다.
        savedPrintHref={saved === null ? null : `${reportHref}/service-report/print?id=${saved.id}`}
        // 🔴 내려받기와 **전체 미리보기**를 함께 막는 조건이다 — 저장은 적다 만
        //    보고서도 받는다. 반쪽짜리 문서를 보여 주면 사람이 그것을 결과물로 믿는다.
        hint={
          bodyEmpty && !blocked
            ? "확인내용이나 조치를 한 줄이라도 적어야 미리보거나 내려받을 수 있습니다."
            : null
        }
        // 🔴 저장하지 않고 「보고서」 탭으로. 고친 것이 있으면 아래 창이 먼저 묻는다.
        onCancel={handleLeave}
        onSave={() => void handleSave()}
        onPreview={() => void handlePreview()}
        onDownload={() => void handleDownload()}
        onDelete={openDelete}
      />

      <ServiceReportSection
        title="보고서 종류"
        description="수리를 고르면 「정리」와 「조치 완료」 칸이 나타납니다. 검사에는 그 둘이 없습니다."
      >
        <div className="sm:w-64">
          <Field label="종류" required>
            <select
              value={values.kind}
              /**
               * 🔴 종류만 바꾸는 것이 아니다 — 「조치」의 정형 문구가 종류마다
               * 시제가 다르므로, **손대지 않은 기본 문구면** 새 종류의 것으로
               * 함께 갈아 끼운다. 한 글자라도 고쳤으면 사람의 글이라 그대로 둔다.
               * 판단은 전부 도메인 함수에 있다(시험이 붙는 자리다).
               */
              onChange={(event) =>
                update(
                  serviceReportKindChangePatch(
                    values,
                    event.target.value === "INSPECTION" ? "INSPECTION" : "REPAIR",
                    actionsIntro
                  )
                )
              }
              disabled={disabled}
              className={editInputClass}
            >
              <option value="REPAIR">{KIND_LABELS.REPAIR}</option>
              <option value="INSPECTION">{KIND_LABELS.INSPECTION}</option>
            </select>
          </Field>
        </div>
      </ServiceReportSection>

      <ServiceReportHeaderFields
        values={values}
        onChange={update}
        fieldErrors={fieldErrors}
        choices={choices ?? { situationRequests: [], productNames: [] }}
        serialNumberWarning={serviceReportSerialNumberWarning(values)}
        disabled={disabled}
      />

      <ServiceReportDispositionFields
        values={values}
        onChange={update}
        fieldErrors={fieldErrors}
        causeLabels={causeLabels}
        // 🔴 「현품 인수」를 체크할 때 번호 칸에 들어갈 값이다. 폼 값이 아니라
        //    prop 으로 내려보내는 까닭은 `ServiceReportRepairCaseSeed` 머리말에
        //    적어 두었다 — 저장된 장을 열 때도 같은 길로 와야 한다.
        intakeNumber={intakeNumber}
        disabled={disabled}
      />

      <ServiceReportBodyFields
        values={values}
        onChange={update}
        fieldErrors={fieldErrors}
        limits={limits}
        bodyMetrics={bodyMetrics}
        rowLimitErrors={rowLimitErrors}
        disabled={disabled}
      />

      {/* 🔴 저장하지 않은 값으로 그린 문서 한 장(2026-10-19). 창이 하는 일은
          **보여 주기만** 이다 — 여기서 DB 로 가는 길은 없다. */}
      {previewDocument !== null && (
        <ServiceReportDocumentPreviewDialog
          grid={previewDocument.grid}
          kindLabel={previewDocument.kindLabel}
          templateImageBase={previewDocument.templateImageBase}
          onClose={() => setPreviewDocument(null)}
        />
      )}

      {/* 🔴 [취소] · 머리의 [보고서 탭으로] 확인 창 (2026-10-19).

          **고친 것이 있을 때만** 뜬다(`dirty`). 여기서 [돌아가서 계속 적기]를 누르면
          창만 닫힌다 — `setLeaveConfirmOpen(false)` 하나뿐이라 **적던 글은 한 글자도
          건드리지 않는다.** 같은 날 임시보관을 걷어내서, 한 번 나가면 돌아올 길이 없다. */}
      <ServiceReportLeaveConfirmDialog
        isOpen={leaveConfirmOpen}
        onConfirm={leaveWithoutSaving}
        onCancel={() => setLeaveConfirmOpen(false)}
      />

      {/* 🔴 지우기 확인 — 고객사·제품 모델·견적서가 쓰는 그 창이다. 견적서와 같은
          이유로 **보관 문구를 우리 것으로 넘긴다**: 보고서에는 자동 만료도 영구
          삭제도 없어서(`mutations/service-reports.ts` 의 '영구 삭제는 없다') 기본
          문장(15일 뒤 완전 삭제)이 사실이 아니다. */}
      <MasterDataDeleteDialog
        isOpen={deleteOpen}
        entityLabel="보고서"
        names={saved === null ? [] : [deleteTargetName]}
        retentionNote={
          <>
            지운 보고서는 목록에서 사라지지만 완전히 없어지지는 않고,
            <strong className="font-medium text-zinc-800 dark:text-zinc-200">
              {" "}
              관리자가 되살릴 수 있습니다
            </strong>
            . 보고서는 자동으로 완전히 삭제되지 않습니다.
          </>
        }
        cascadeNote={
          <>
            <strong className="font-medium text-zinc-800 dark:text-zinc-200">
              아직 저장하지 않은 수정 내용도 함께 사라집니다.
            </strong>{" "}
            저장된 확인내용·조치 줄과 고른 원인은 그대로 남고, 되살리면 함께 돌아옵니다.
          </>
        }
        reason={deleteReason}
        isSubmitting={isSaving}
        submitError={deleteError}
        onReasonChange={setDeleteReason}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}

/** 줄의 결 — 견적서의 결과 줄(QuoteIssueNoticeLines)과 **같은 색표**다. */
const PDF_LINE_TONE_CLASS: Record<QuoteIssueNoticeLine["tone"], string> = {
  normal: "text-zinc-700 dark:text-zinc-300",
  muted: "text-zinc-400 dark:text-zinc-500",
  warning: "font-medium text-amber-700 dark:text-amber-400",
};

/**
 * [저장] 뒤 연락서 폴더 · PDF 결과 한 칸 (2026-10-12).
 *
 * 🔴 **견적서의 QuoteSavePdfNotice 와 같은 결**이다 — 노란 칸, 첫 줄이 「보고서는
 * 저장되었습니다.」, 곁에 떠날 단추 하나. 줄 자체는 흐름 모듈이 값으로 정하고 이 조각은
 * **그리기만** 한다(경로 · 파일 이름이 한 글자도 없다는 것은 그쪽이 지킨다).
 *
 * 🔴 **도는 동안은 그리지 않는다** — 그때는 팝업이 말한다(common/SavePopup.tsx 의
 * showSavePopupProgress). 줄이 비면 이 조각은 아무것도 그리지 않는다.
 */
export function ServiceReportSavePdfNotice({
  lines,
  onLeave,
  leaveLabel = "보고서 탭으로",
}: {
  lines: readonly QuoteIssueNoticeLine[];
  /** 있으면 곁에 단추를 그린다. 없으면 줄만 그린다. */
  onLeave?: () => void;
  leaveLabel?: string;
}) {
  if (lines.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <ul role="status" className="flex flex-col gap-0.5 text-xs">
        {lines.map((line, index) => (
          <li key={`${index}-${line.text}`} className={`break-all ${PDF_LINE_TONE_CLASS[line.tone]}`}>
            {line.text}
          </li>
        ))}
      </ul>
      {onLeave && (
        <button
          type="button"
          onClick={onLeave}
          className="mt-2 rounded-md border border-amber-400 px-2 py-1 text-xs dark:border-amber-700"
        >
          {leaveLabel}
        </button>
      )}
    </div>
  );
}
