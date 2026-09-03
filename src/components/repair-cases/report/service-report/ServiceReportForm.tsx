"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { MasterDataDeleteDialog } from "@/components/common/master-data-trash-dialogs";
import { SERVICE_REPORT_DRAFT_LABELS, buildDraftText } from "@/lib/domain/edit-draft-text";
import { formatServiceReportNumber } from "@/lib/domain/service-report-file-name";
import {
  SERVICE_REPORT_DRAFT_SAVE_DEBOUNCE_MS,
  clearServiceReportDraft,
  readServiceReportDraft,
  serviceReportDraftStorageKeys,
  writeServiceReportDraft,
  type ServiceReportDraft,
  type ServiceReportDraftStore,
} from "@/lib/domain/service-report-draft";
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
import type { ServiceReportKind } from "@/lib/xlsx/service-report-template";
import ServiceReportActions from "./ServiceReportActions";
import ServiceReportBodyFields from "./ServiceReportBodyFields";
import ServiceReportConflictNotice from "./ServiceReportConflictNotice";
import ServiceReportDraftNotice from "./ServiceReportDraftNotice";
import ServiceReportDispositionFields from "./ServiceReportDispositionFields";
import ServiceReportHeaderFields from "./ServiceReportHeaderFields";
import { editInputClass, Field, ServiceReportSection } from "./ServiceReportField";

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
 *
 * 셈은 전부 `domain/service-report-form.ts` 에 있다 — 여기 두면 시험이 붙지
 * 않고, 시험이 없으면 화면과 서버가 어긋난 것을 아무도 모른다.
 *
 * ── 🔴 임시보관과 저장의 관계 (2026-09-02 판단) ────────────────────────
 * 판단의 근거는 `domain/service-report-draft.ts` 머리말에 있고, 그것을 실제로
 * 실행하는 자리가 이 파일이다. 세 줄로:
 *
 *   1. **저장에 성공하면 그 장의 임시보관을 지운다.** 저장이 더 나은 사본이고,
 *      남겨 두면 다음에 열었을 때 저장된 값 대신 그것이 되살아난다 — 사람은
 *      «저장된 내용»을 보고 있다고 믿으면서 다른 글을 보게 된다.
 *   2. **열 때는 임시보관이 이긴다.** 저장된 장에 임시보관이 남아 있다는 것은
 *      «저장하지 못한 채 나갔다»는 뜻뿐이다(성공한 저장은 1번에서 지웠다). 저장된
 *      값을 대신 보여 주면 그 못 저장한 글이 조용히 사라진다. 반대 실수(임시보관이
 *      낡은 것)는 되돌릴 수 있다 — 저장된 값은 DB 에 그대로 있고, 안내가 그 사실을
 *      말하며 「저장된 내용으로」가 함께 있다(`ServiceReportDraftNotice`).
 *      **한쪽 실수만 영구적**이라, 영구적이지 않은 쪽으로 기운다.
 *   3. **내려받기는 저장이 아니다.** 파일을 뽑았다고 지우지 않는다(예전 판단
 *      그대로 — 뽑아 본 뒤 고칠 것을 발견하는 것이 이 화면의 보통 쓰임이다).
 *
 * 지우기만 예외다 — 그때는 **묻고 나서** 지운다(아래 `openDelete`·`confirmDelete`).
 *
 * ── 🔴 임시보관 열쇠는 보고서 장마다 갈린다 ────────────────────────────
 * 한 접수 건에 여러 장이 붙으므로 사람 + 접수 건만으로는 서로 덮는다. 옛 열쇠로
 * 적어 둔 것을 버리지 않는 방법까지 `serviceReportDraftStorageKeys` 가 정한다.
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
 *
 * ── 적던 내용을 이 브라우저에 임시로 보관한다 ───────────────────────────
 * 새로고침 한 번에 본문 스무 줄이 통째로 날아가지 않게 한다. 판단과 모양은 전부
 * `domain/service-report-draft.ts` 에 있고, 여기 있는 것은 `window.localStorage`
 * 를 실제로 두드리는 일과 언제 읽고 언제 적을지 정하는 일뿐이다.
 * ============================================================================
 */

const FAILURE_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "로그인이 풀렸습니다. 다시 로그인한 뒤 내려받아 주세요.",
  ACCOUNT_NOT_APPROVED: "계정이 아직 승인되지 않았습니다. 관리자에게 문의해 주세요.",
  FORBIDDEN: "이 보고서를 만들 권한이 없습니다. 관리자에게 문의해 주세요.",
  NOT_FOUND: "접수 건을 찾을 수 없습니다. 목록에서 다시 열어 주세요.",
  INVALID_INPUT: "적어 주신 내용을 확인해 주세요. 문제가 있는 칸 밑에 이유를 적어 두었습니다.",
  TEMPLATE_UNAVAILABLE: "보고서 양식을 읽을 수 없습니다. 관리자에게 문의해 주세요.",
  RENDER_FAILED: "보고서를 만들지 못했습니다. 관리자에게 문의해 주세요.",
};

const FALLBACK_FAILURE_MESSAGE = "보고서를 내려받지 못했습니다. 잠시 후 다시 시도해 주세요.";

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

/** `attachment; filename="..."; filename*=UTF-8''...` 에서 사람이 볼 이름을 꺼낸다. */
export function fileNameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;

  // 한글 이름은 이쪽에만 온전히 들어 있다(ASCII 쪽은 `_` 로 바뀌어 있다).
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // 잘못 인코딩된 헤더 하나 때문에 내려받기를 포기하지는 않는다.
    }
  }

  const ascii = /filename="([^"]*)"/i.exec(header);
  return ascii && ascii[1] !== "" ? ascii[1] : null;
}

type FailurePayload = {
  error?: unknown;
  code?: unknown;
  fieldErrors?: unknown;
};

/**
 * 저장소를 집는다. 🔴 **속성을 읽는 것 자체가 던진다**(사생활 보호 창, 「사이트
 * 데이터 차단」). 그래서 꺼내 오는 것부터 감싼다 — 이 한 겹이 없으면
 * `service-report-draft.ts` 안의 try/catch 가 아무 소용이 없다. 이 저장소가 실제로
 * 겪은 사고다(커밋 8454a2a).
 */
function serviceReportDraftStore(): ServiceReportDraftStore | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

const draftListeners = new Set<() => void>();

/**
 * 🔴 이 화면이 **처음 본** 임시보관을 열쇠마다 들고 있는 자리. 두 가지를 한꺼번에
 * 푼다:
 *
 *   1. **useSyncExternalStore 의 스냅샷은 값이 안 바뀌었으면 같은 것이어야 한다.**
 *      부를 때마다 저장소를 읽어 JSON 을 새로 풀면 매번 새 객체가 나와 React 가
 *      "계속 바뀐다"고 보고 무한히 다시 그린다(커밋 8454a2a 가 목록 26개에서 막은
 *      바로 그 함정이다).
 *   2. **되살리기는 화면에 들어온 그 순간의 사실이다.** 이 화면은 0.5초마다
 *      스스로 저장소에 적으므로, 계속 다시 읽으면 사람이 글을 치는 도중에
 *      「되살렸습니다」 안내가 튀어나온다 — 되살린 적이 없는데도.
 */
const seenDrafts = new Map<string, ServiceReportDraft | null>();

function subscribeDraft(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
    // 이 화면을 떠나면 들고 있던 것을 놓는다. 다시 들어왔을 때 **방금 적어 둔
    // 것까지** 되살리려면 그때 저장소를 새로 읽어야 한다.
    if (draftListeners.size === 0) seenDrafts.clear();
  };
}

/**
 * 되살릴 임시보관. 저장소를 읽는 일은 `service-report-draft.ts` 가 하고(던지지
 * 않는다), 여기서는 그 결과를 **한 번만** 받아 들고 있는다 — 위 seenDrafts 참조.
 */
function draftSnapshot(
  storageKeys: readonly string[],
  fallback: ServiceReportFormValues,
  causeCodes: readonly string[]
): ServiceReportDraft | null {
  // 들고 있는 열쇠는 **적는 열쇠**(맨 앞)다. 뒤에 오는 옛 열쇠는 같은 장을 가리키는
  // 다른 이름일 뿐이라, 둘을 따로 세면 같은 임시보관을 두 번 들고 있게 된다.
  const cacheKey = storageKeys[0];
  const seen = seenDrafts.get(cacheKey);
  if (seen !== undefined) return seen;

  const draft = readServiceReportDraft(
    serviceReportDraftStore(),
    storageKeys,
    // 없거나 모양이 틀린 칸이 떨어질 자리 — 지금 화면이 만든 자동 채움 값이다.
    fallback,
    causeCodes
  );
  seenDrafts.set(cacheKey, draft);
  return draft;
}

/**
 * 서버에는 저장소가 없다. **되살릴 것이 없는 사람과 같은 화면**을 준다.
 *
 * 이 한 줄이 hydration 을 맞추는 자리다 — 첫 렌더에서 그냥 읽으면 서버가 그린
 * 것과 달라지고, effect 에서 읽어 setState 하면 자동 채움 값이 한 프레임 스쳐
 * 지나간다. useSyncExternalStore 가 정확히 이 상황을 위한 것이다
 * (`common/responsive-list.tsx` 의 readServer 와 같은 판단).
 */
function draftServerSnapshot(): ServiceReportDraft | null {
  return null;
}

/** 저장된 장 하나를 가리키는 값. 저장할 때 되돌려 보낼 잠금 토큰까지 한 벌이다. */
type SavedServiceReport = { id: string; version: number };

export default function ServiceReportForm({
  repairCaseId,
  actingUserId,
  intakeNumber,
  reportHref,
  initialValues,
  actionsIntro,
  savedReport,
  canEdit,
  canDelete,
  limits,
  choices,
  causeLabels,
  templateError,
}: {
  repairCaseId: string;
  /**
   * 🔴 임시보관 열쇠에 쓸 **사람 id 하나뿐**이다. 이름·역할·이메일은 받지
   * 않는다 — 화면이 안 쓰는 것을 클라이언트로 내려보내지 않는다.
   */
  actingUserId: string;
  intakeNumber: string;
  /** 돌아갈 자리 — 「보고서」 탭. 지운 뒤에도 여기로 온다. */
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
  const pathname = usePathname();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | null>(null);

  /**
   * 지우기 확인 창의 상태. 창은 자기 상태를 갖지 않으므로(그 파일의 원칙) 열림
   * 여부·사유·실패 문구를 여기서 들고 있는다. 전송 중인지는 `isSaving` 이 이미
   * 말한다 — 지우는 동안 저장·내려받기가 눌리면 안 되므로 같은 깃발을 쓴다.
   */
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
   * 마지막으로 **저장에 성공한** 값의 사본(JSON).
   *
   * 이것이 있어야 "저장한 뒤로 아직 아무것도 안 고쳤다"를 알 수 있다. 그 상태에서
   * 임시보관을 다시 적으면, 저장된 것과 똑같은 글이 «아직 저장하지 못한 것»인 척
   * 남아 다음에 열 때 안내가 뜬다 — 위 머리말 1번이 막으려던 그 혼란이다.
   */
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);

  /**
   * 이 장의 임시보관 열쇠들. **맨 앞이 적는 열쇠**다.
   *
   * 🔴 `saved?.id` 가 들어간다 — 한 접수 건에 여러 장이 붙으므로 장마다 갈라야
   * 서로 덮지 않는다. 새로 만드는 중이면 `null` 이고, 그때만 옛 열쇠까지 함께
   * 본다(`serviceReportDraftStorageKeys` 의 판단).
   */
  const draftKeys = useMemo(
    () => serviceReportDraftStorageKeys(actingUserId, repairCaseId, saved?.id ?? null),
    [actingUserId, repairCaseId, saved?.id]
  );

  /**
   * 되살릴 때 인정할 원인 코드. 🔴 **채우개의 표에서 온 것**을 그대로 쓴다
   * (`causeLabels`) — 목록을 여기 베끼면 양식에 원인이 하나 늘어난 날 체크가
   * 조용히 풀린다.
   */
  const causeCodes = useMemo(() => Object.keys(causeLabels), [causeLabels]);

  /** 들어올 때 되살린 임시보관. 없으면 null. 위 seenDrafts 주석 참조. */
  const restoredDraft = useSyncExternalStore(
    subscribeDraft,
    () => draftSnapshot(draftKeys, initialValues, causeCodes),
    draftServerSnapshot
  );

  /**
   * 🔴 **사람이 이번에 고친 값.** 아직 한 칸도 안 고쳤으면 null 이다.
   *
   * 「지금 화면의 값」을 state 하나에 담지 않고 이렇게 갈라 두는 까닭이 둘이다:
   *
   *   · **hydration.** 되살린 값은 브라우저에만 있으므로 서버가 그린 첫 화면은
   *     언제나 자동 채움 값이어야 한다. 위 useSyncExternalStore 가 그 자리를
   *     맡고(서버 스냅샷은 null), 이 state 는 그 위에 얹힌다.
   *   · **열어만 보고 나간 화면은 적지 않는다.** 이 값이 null 인 동안은 적어 둘
   *     것이 없다 — 그렇지 않으면 보고서 화면을 열어 본 접수 건마다 임시보관이
   *     하나씩 쌓여 저장소가 이유 없이 찬다.
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
    setSavedSnapshot(null);
    setConflict(null);
    setFieldErrors(null);
    // 열려 있던 지우기 확인 창도 닫는다 — 앞 장의 이름을 보여 주면서 지우는 것은
    // 새 장이 되는 창을 남겨 두지 않는다.
    setDeleteOpen(false);
    setDeleteError(null);
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

  /** 지금 화면의 값 — 고친 것 > 되살린 것 > 자동 채움. 이 순서를 바꾸지 말 것. */
  const values = edited ?? restoredDraft?.values ?? initialValues;

  function update(patch: Partial<ServiceReportFormValues>) {
    setEdited((previous) => ({ ...(previous ?? values), ...patch }));
  }

  /**
   * ── 적는 대로 보관한다 — 다만 묶어서 ─────────────────────────────────
   * 글자마다 적으면 한 글자에 한 번씩 폼 전체를 JSON 으로 만들어 저장소를
   * 때린다(`localStorage` 쓰기는 동기라 그대로 입력의 끊김이 된다). 그래서
   * 0.5초 묶어서 적는다 — 그 값을 고른 까닭은
   * `SERVICE_REPORT_DRAFT_SAVE_DEBOUNCE_MS` 주석에 있다.
   *
   * 값이 바뀔 때마다 앞의 시계를 버리고 새로 건다(cleanup) — 글자를 치는 동안은
   * 아무것도 안 적히고, 손을 떼고 0.5초가 지나야 한 번 적힌다.
   */
  useEffect(() => {
    if (edited === null) return;

    const timer = window.setTimeout(() => {
      /**
       * 🔴 저장에 성공한 그대로면 **적는 대신 지운다.** 임시보관의 뜻은 «아직
       * 저장하지 못한 것»이라(위 머리말), 저장된 것과 똑같은 글을 남겨 두면 다음에
       * 열 때 「저장하지 못한 내용을 되살렸습니다」라는 거짓말이 뜬다.
       */
      if (savedSnapshot !== null && JSON.stringify(edited) === savedSnapshot) {
        clearServiceReportDraft(serviceReportDraftStore(), draftKeys);
        return;
      }
      writeServiceReportDraft(
        serviceReportDraftStore(),
        // 적는 것은 언제나 맨 앞 열쇠다 — 옛 열쇠에 새로 적지 않는다.
        draftKeys[0],
        edited,
        new Date().toISOString()
      );
    }, SERVICE_REPORT_DRAFT_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [edited, draftKeys, savedSnapshot]);

  /**
   * 임시보관을 지우고 화면이 들고 있던 것도 놓는다.
   *
   * 🔴 `seenDrafts` 까지 비워야 안내가 그 자리에서 사라진다 — 저장소만 지우면
   * 이 화면은 아까 읽어 둔 것을 계속 들고 있다.
   */
  function forgetDraft() {
    clearServiceReportDraft(serviceReportDraftStore(), draftKeys);
    seenDrafts.set(draftKeys[0], null);
    for (const listener of draftListeners) listener();
  }

  /**
   * 「새로 시작」(새 장) · 「저장된 내용으로」(저장된 장).
   *
   * 두 경우 모두 임시보관을 버리고 **서버가 넘겨준 초기값**으로 돌아간다 — 새
   * 장이면 자동 채움 값이고, 저장된 장이면 DB 에 저장된 값이다.
   */
  function handleDiscardDraft() {
    forgetDraft();
    setEdited(null);
    // 버린 글에 붙어 있던 지적이라 함께 지운다 — 안 그러면 없는 글에 대한
    // 오류가 칸 밑에 남는다.
    setFieldErrors(null);
    setFormError(null);
    setStatusMessage(null);
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
  const busy = isSubmitting || isSaving;
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
   * 줄이 되지 않게 「문서번호 없음」으로 적는다(`ServiceReportList` 가 같은 자리에서
   * 하는 그대로). 세 조각을 잇는 규칙은 파일 이름과 목록이 쓰는 그 함수를 그대로
   * 쓴다 — 여기 베끼면 규칙이 두 곳에 산다.
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
  async function handleSave() {
    if (!canSave) return;

    setIsSaving(true);
    setFormError(null);
    setStatusMessage(null);
    setFieldErrors(null);

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
           * 잃는다** — 이 id 는 다시 열리지 않으므로 그 열쇠에 적힌 임시보관도
           * 영영 안 읽힌다.
           *
           * 그래서 이 화면을 **새 장으로 되돌린다.** 지금 보고 있는 값은 그대로
           * 두고(`setEdited(values)`) 「만들기」로 돌린다. 그러면 [저장하기]가
           * 곧바로 새 보고서를 만들고, 임시보관도 새 장의 칸으로 따라간다(열쇠가
           * `saved?.id` 를 따르므로 다음 0.5초에 그리로 적힌다).
           *
           * ⚠️ **주소는 건드리지 않는다.** `?id=` 를 떼면 서버가 이 화면을 다시
           * 그리고, 그러면 위의 «장이 바뀌었다» 갈래가 돌아 `edited` 를 놓는다 —
           * 방금 지키려던 그 글이 바로 그때 사라진다. 새로고침하면 404 를 보게
           * 되지만, 그때도 글은 새 장의 임시보관에 남아 있어 「보고서」 탭에서
           * 새로 만들기로 들어가면 되살아난다.
           */
          setEdited(values);
          setSaved(null);
          setSavedSnapshot(null);
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
       * 성공. 🔴 **지금 화면의 값을 못 박고**(`setEdited`) 임시보관을 지운다.
       *
       * 못 박는 것이 먼저인 까닭: 되살린 임시보관을 그대로 저장한 사람은 아직
       * `edited` 가 없다. 임시보관을 먼저 지우면 화면이 서버의 초기값으로
       * 되돌아가는데, 새 장이라면 그것은 **방금 저장한 글이 아니라 자동 채움
       * 값**이다.
       */
      setEdited(values);
      setSaved({ id: result.id, version: result.version });
      setSavedSnapshot(JSON.stringify(values));
      forgetDraft();
      setStatusMessage(saved ? "저장했습니다." : "새 보고서로 저장했습니다.");

      if (!saved) {
        // 주소를 「고치기」로 바꾼다 — 새로고침해도 방금 만든 장이 열린다.
        // 여기서 `?kind=` 는 자연히 떨어진다(저장된 장의 종류는 그 장에 있다).
        router.replace(`${pathname}?id=${result.id}`);
      }
      router.refresh();
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
   * 🔴 **묻고 나서 지운다.** 여기서만 임시보관을 사람의 글째로 버리기 때문이다 —
   * 아직 저장하지 않은 수정이 남아 있을 수 있고, 그 장은 다시 열리지 않으므로
   * 그 글도 갈 곳이 없다. 무엇이 함께 사라지는지 물음에 그대로 적는다(아래
   * `cascadeNote`).
   *
   * 🔴 묻는 창은 **이 저장소의 표준 창**이다(`MasterDataDeleteDialog`). 예전에는
   * 브라우저가 그린 기본 팝업이었는데, 그러면 이 화면만 생김새가 다르다 — 지우는
   * 일의 모양이 화면마다 달라지면 사람은 화면마다 다른 규칙이 있다고 배운다(그
   * 파일 머리말). 견적서가 한 건을 지울 때 하는 그대로 쓴다
   * (`quotes/QuoteListScreen.tsx`).
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
          forgetDraft();
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

      forgetDraft();
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
   * 🔴 낡은 임시보관까지 함께 버린다 — 안 그러면 다시 불러온 화면에 방금 그
   * 낡은 값이 되살아난다. 버려도 되는 까닭은 **그 글이 상자에 그대로 남아
   * 있기** 때문이고, 상자는 사람이 「옮겨 적었습니다」를 누를 때에만 사라진다.
   */
  function handleConflictReload() {
    handleDiscardDraft();
    setConflict((previous) => (previous === null ? null : { ...previous, reloaded: true }));
    router.refresh();
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
        <Link
          href={reportHref}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          보고서 탭으로
        </Link>
      </div>

      {/* 지금 적는 것이 어디에 남는지, 되살린 것이 있으면 그 사실과 버리는 길. */}
      <ServiceReportDraftNotice
        mode={mode}
        restored={restoredDraft !== null}
        savedAt={restoredDraft?.savedAt ?? null}
        onDiscard={handleDiscardDraft}
        disabled={busy}
      />

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
        rowLimitErrors={rowLimitErrors}
        disabled={disabled}
      />

      <ServiceReportActions
        mode={mode}
        canEdit={canEdit}
        canDelete={canDelete}
        isSaving={isSaving}
        isDownloading={isSubmitting}
        canSave={canSave}
        canDownload={canDownload}
        // 🔴 저장된 장에만 붙는다 — 미리보기 화면은 DB 에 저장된 값을 그린다.
        //    주소는 지금 보고 있는 화면(`usePathname`)이 아니라 「보고서」 탭에서
        //    만든다. 두 화면은 형제라 같은 부모에서 갈라져 나오고, 그래야
        //    질의문자열이 붙은 주소에서도 자리가 흔들리지 않는다.
        previewHref={saved === null ? null : `${reportHref}/service-report/print?id=${saved.id}`}
        // 내려받기만 막는 조건이다 — 저장은 적다 만 보고서도 받는다.
        hint={
          bodyEmpty && !blocked
            ? "확인내용이나 조치를 한 줄이라도 적어야 내려받을 수 있습니다."
            : null
        }
        onSave={() => void handleSave()}
        onDownload={() => void handleDownload()}
        onDelete={openDelete}
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
