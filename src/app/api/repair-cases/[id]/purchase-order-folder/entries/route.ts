import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { listQuoteInfoForRepairCases } from "@/lib/db/queries/domestic-orders";
import { getRepairCaseContactFolderNamingById } from "@/lib/db/queries/repair-cases";
import { isQuoteFolderRelativePath } from "@/lib/domain/quote-folder-link";
import { findPurchaseOrderArchiveFolder, resolvePurchaseOrderArchiveRoot } from "@/lib/storage/purchase-order-archive";

/**
 * ============================================================================
 * GET /api/repair-cases/{id}/purchase-order-folder/entries
 * — 이 장비의 **발주서 폴더 안**에 무엇이 있는가 (2026-10-12)
 * ============================================================================
 * 수리 건 상세 「발주서」 탭의 공유폴더 구역이 부른다. 문지기는 이웃 통로
 * (api/repair-cases/[id]/quote-archive-folders)를 본떴다 — 차례도 404 규칙도 같다.
 * 다른 것은 **권한 영역 하나**와 그 뒤의 일이다.
 *
 * ── 🔴 권한은 `domesticOrders` READ 다 — 새 영역을 만들지 않았다 ───────────
 * 나가는 것은 **고객사가 우리에게 낸 발주서(내자)** 자료다. 폴더 이름에 발주 금액이 들어
 * 있고(`… - 16,720,000원`), 보는 조건 자체가 내자 정리의 **발주발행일**이다. 「발주서를 볼
 * 수 있는가」는 이미 그 하나가 답하고 있다 — 견적서 열쇠(`quotes`)를 쓰면 금액이 든 서류가
 * 엉뚱한 문으로 새고, 새 영역을 만들면 관리자가 한쪽만 풀어 둔 상태가 생긴다.
 *
 * ── 🔴 **발주발행일이 비어 있으면 공유폴더를 아예 안 본다** ────────────────
 * 사용자 결정 2026-10-12. 발행일이 없는 건은 발주가 아직 나가지 않은 건이다 — 그런 건에
 * 지난 발주서를 붙이면 **남의 발주서를 이 건의 것처럼** 보여 주게 된다. 그래서
 * `no-order-date` 로 끝내고 🔴 **저장소 모듈을 부르지 않는다**(= 디스크를 보지 않는다).
 *  · 🔴 날짜는 내자 정리의 `orderIssuedDate` 하나다(queries/domestic-orders.ts 의
 *    listQuoteInfoForRepairCases — 완료된 줄을 빼는 규칙까지 거기 있다). 견적서 쪽이 바로
 *    오늘 같은 조건을 넣은 것과 **같은 결**이다(queries/repair-case-quote-numbers.ts 의
 *    readsArchive). 🔴 조건을 여기서 다시 짜지 않고 **그 조회가 내는 값**만 본다.
 *  · 내자 줄이 **아예 없는** 건(또는 완료된 줄만 있는 건)은 그 표에 자리가 없다 — 그때도
 *    발행일이 없는 것이라 **보지 않는다.**
 *  · 🔴 공유폴더 설정이 꺼져 있으면 그 판단이 **먼저**다(`disabled`). 꺼진 환경에서 구역은
 *    통째로 그려지지 않는 것이 맞고, 거기서 「아직 발주발행일이…」를 내밀면 설정이 없는
 *    개발 PC 가 설정이 있는 운영처럼 보인다.
 *
 * ── 🔴 목록만 낸다 — 파일 바이트를 중계하지 않는다 ──────────────────────────
 * 나가는 것은 **이름 · 크기 · 수정 시각 · 폴더인가** 넷뿐이다. 공유폴더의 파일은 첨부 통로의
 * 권한 · 확장자 검사 · 앞머리 바이트 대조 **밖**에 있다 — 우리 출처로 내보내면 그 방어선이
 * 통째로 빠진다. 파일을 **여는** 일은 그 PC 의 탐색기 도우미가 한다.
 *
 * ── 🔴 아무것도 만들지 않는다 ──────────────────────────────────────────────
 * 폴더가 없으면 `not-found` 로 끝난다 — **발주서 폴더는 사람이 만든다.** 이 파일에는 폴더
 * 만들기 · 파일 쓰기 · DB 쓰기가 없고, 쓰기 메서드(POST · PUT)도 없다. 감사도 남기지
 * 않는다 — 기록할 변경이 없다. 그 사실을 route-source.test.ts 가 원본을 글자로 읽어 못 박는다.
 *
 * ── 🔴 절대 경로를 싣지 않는다 ─────────────────────────────────────────────
 * 응답 타입에 컨테이너 안 경로(루트)를 담는 칸이 아예 없다. 줄마다 나가는 이름은 **그 폴더
 * 안에서의 이름**이고, 폴더를 가리키는 값은 **루트 기준 상대 경로**(`연도/고객사/발주 건`)
 * 뿐이다. 전체 공유폴더 주소(uncPath)는 내지 않는다 — 이 구역에는 [위치 복사]가 없다.
 *
 * ── 🔴 맞는 폴더가 여럿이면 목록을 내지 않는다 ─────────────────────────────
 * 날짜가 같은 폴더가 둘이면 `multiple` 하나로 끝낸다(경로도 내지 않는다). 어느 폴더인지
 * 모르는 채로 내용을 보이면 **남의 발주서를 보여 줄 수 있다.**
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 저장 모드 → 2) 세션 · 살아 있는 계정 · 승인 → 3) 권한(domesticOrders READ)
 *  → 4) 수리 건(휴지통이면 없는 것) → 5) 공유폴더 루트(꺼져 있으면 disabled)
 *  → 6) 발주발행일(비면 no-order-date — 여기서 끝난다) → 7) 장비로 찾아 읽기
 *  → 8) 주소 규칙 → 9) JSON
 *
 * 권한이 조회보다 앞이다 — 권한이 없는 사람에게는 그 id 의 수리 건이 있다는 사실도 알려 주지
 * 않는다. 문턱을 넘었는데 그 건이 안 보이면 404 다(403 으로 갈라 답하면 존재가 새어 나간다).
 *
 * ── 응답 ────────────────────────────────────────────────────────────────
 *  · 200 `{ status: "found", relativePath, issuedDate, entries, totalCount, truncated }`
 *  · 200 `{ status: "multiple" }` · `{ status: "not-found" }` · `{ status: "no-order-date" }`
 *  · 200 `{ status: "disabled" }` · `{ status: "failed", reason }`
 *  · 실패 `{ error, code }` — 401 · 403 · 404. 모두 `Cache-Control: no-store`(JSON 성공 응답).
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode = "DATABASE_MODE_REQUIRED" | "UNAUTHENTICATED" | "ACCOUNT_NOT_APPROVED" | "FORBIDDEN" | "NOT_FOUND";

/** 한 줄. 🔴 **경로를 담는 칸이 타입 수준에 없다** — 이름은 폴더 안에서의 이름뿐이다. */
type PurchaseOrderEntryBody = {
  name: string;
  isDirectory: boolean;
  /** 폴더는 0 이다 — 안으로 내려가지 않으므로 재지 않는다. */
  sizeBytes: number;
  /** 수정 시각(ISO). 그 한 줄의 stat 이 막혔으면 **이 칸만 빠진다.** */
  modifiedAt?: string;
};

/** 응답 본문. 🔴 컨테이너 안 경로 · 전체 공유폴더 주소를 담는 칸이 없다. */
type PurchaseOrderFolderEntriesResponse =
  | {
      status: "found";
      /** 루트 기준 슬래시 경로 — `연도/고객사/발주 건`. 화면이 줄의 [열기] 주소에 쓴다. */
      relativePath: string;
      /** 폴더 이름에서 읽은 발주발행일 `YYYY-MM-DD`. */
      issuedDate: string;
      entries: PurchaseOrderEntryBody[];
      /** 거른 뒤의 전체 줄 수. 아래 truncated 가 참이면 entries.length 보다 크다. */
      totalCount: number;
      /** 🔴 줄 수 상한에 걸려 잘렸는가 — 화면이 「더 있습니다」를 세운다. */
      truncated: boolean;
    }
  /** 🔴 목록도 경로도 없다 — 어느 폴더인지 모르는 채로 내용을 보이지 않는다. */
  | { status: "multiple" }
  | { status: "not-found" }
  /** 🔴 내자 정리에 발주발행일이 없다 — 공유폴더를 **보지 않았다**는 뜻이다. */
  | { status: "no-order-date" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/** 이웃 통로와 **같은 결**의 문장이다 — 도우미가 받을 수 없는 이름이면 미리 알린다. */
const UNOPENABLE_FOLDER_REASON =
  "발주서 폴더 이름에 탐색기 도우미가 열 수 없는 글자가 있습니다. 공유폴더에서 직접 열어 주세요.";

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

function respond(body: PurchaseOrderFolderEntriesResponse): NextResponse {
  return NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
}

/** 에포크 ms → ISO. 못 읽은 줄(null)은 **칸이 통째로 빠진다**(빈 문자열을 내지 않는다). */
function modifiedAtOf(modifiedAtMs: number | null): { modifiedAt?: string } {
  if (modifiedAtMs === null || !Number.isFinite(modifiedAtMs)) return {};
  return { modifiedAt: new Date(modifiedAtMs).toISOString() };
}

/** 칸에 **적혀 있는** 값인가 — 공백만 적힌 칸도 빈 것으로 본다(견적서 쪽 filledText 와 같은 잣대). */
function isFilled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  // ── 1) 저장 모드 ──────────────────────────────────────────────────────
  if (getAuthSource() !== "database") {
    return fail(403, "DATABASE_MODE_REQUIRED", "데이터베이스 저장 모드가 아닙니다.");
  }

  // ── 2) 세션 · 살아 있는 계정 · 승인 ──────────────────────────────────
  const session = await readSession();
  if (!session) {
    return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  }
  // 세션에 박힌 값이 아니라 살아 있는 계정을 다시 읽는다 — 정지 · 삭제 · 강등됐을 수 있다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return fail(401, "UNAUTHENTICATED", "사용자 정보를 확인할 수 없습니다.");
  }
  if (actingUser.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "계정이 아직 승인되지 않았습니다.");
  }

  // ── 3) 권한 — 조회보다 앞이다 ────────────────────────────────────────
  if (!(await hasPermission(actingUser, "domesticOrders", "READ"))) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 4) 수리 건 — 없다 · 휴지통 · id 모양이 아니다를 모두 404 로 모은다 ──
  //    🔴 L/N · S/N 을 얻으려고 **이미 있는 가벼운 조회**를 그대로 쓴다(이웃 통로와 같다).
  const { id } = await context.params;
  const repairCase = await getRepairCaseContactFolderNamingById(id);
  if (!repairCase) {
    return fail(404, "NOT_FOUND", "해당 수리 건을 찾을 수 없습니다.");
  }

  // ── 5) 공유폴더 루트 — 이 값은 찾기 · 읽기에만 쓰고 응답에 싣지 않는다 ───
  const archiveRoot = resolvePurchaseOrderArchiveRoot();
  if (archiveRoot === null) {
    return respond({ status: "disabled" });
  }

  // ── 6) 🔴 발주발행일이 비면 **여기서 끝난다** — 공유폴더를 보지 않는다 ───
  const quoteInfo = await listQuoteInfoForRepairCases([repairCase.id]);
  if (!isFilled(quoteInfo.get(repairCase.id)?.orderIssuedDate)) {
    return respond({ status: "no-order-date" });
  }

  // ── 7) 장비로 찾아 읽는다 — 🔴 L/N 과 S/N 이 **둘 다** 맞는 폴더만 ──────
  const found = await findPurchaseOrderArchiveFolder({
    root: archiveRoot,
    lotNumber: repairCase.lotNumber,
    serialNumber: repairCase.serialNumber,
  });

  // ── 8~9) JSON — 상대 경로 · 줄 · 짧은 사유만 ─────────────────────────
  if (found.status === "found") {
    // 도우미가 받지 않을 이름이면 줄마다의 [열기] 주소를 만들 수 없다 — 미리 알린다.
    if (!isQuoteFolderRelativePath(found.relativePath)) {
      return respond({ status: "failed", reason: UNOPENABLE_FOLDER_REASON });
    }
    return respond({
      status: "found",
      relativePath: found.relativePath,
      issuedDate: found.issuedDate,
      entries: found.entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory,
        sizeBytes: entry.sizeBytes,
        ...modifiedAtOf(entry.modifiedAtMs),
      })),
      totalCount: found.totalCount,
      truncated: found.truncated,
    });
  }
  if (found.status === "multiple") {
    return respond({ status: "multiple" });
  }
  if (found.status === "not-found") {
    return respond({ status: "not-found" });
  }
  if (found.status === "disabled") {
    // 루트를 먼저 보았으므로 여기에 닿지 않지만, 상태가 하나 늘면 컴파일러가 짚게 둔다.
    return respond({ status: "disabled" });
  }
  return respond({ status: "failed", reason: found.reason });
}
