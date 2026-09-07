import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getPermissionLevel } from "@/lib/auth/permission-resolver";
import {
  SERVICE_REPORT_PERMISSION_AREA,
  canViewServiceReports,
} from "@/lib/auth/service-report-authorization";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  readServiceReportTemplate,
  ServiceReportTemplateError,
} from "@/lib/storage/service-report-template";
import {
  SERVICE_REPORT_SHEET_NAME,
} from "@/lib/xlsx/service-report-template";
import { resolveSheetDrawingPart, resolveSheetPart } from "@/lib/xlsx/workbook-parts";
import { ZipArchive } from "@/lib/xlsx/zip-reader";

/**
 * ============================================================================
 * GET /api/service-reports/template-image/{파일이름} — 양식 안의 도장
 * ============================================================================
 * 보고서 미리보기(`.../report/service-report/print`)가 쓰는 그림이다. **양식
 * 파일에서 그때그때 꺼낸다** — 따로 복사해서 public/ 에 두면 두 벌이 되고, 도장을
 * 바꾼 뒤로 xlsx 와 미리보기가 서로 다른 도장을 찍는 날이 온다(견적서의 같은
 * 라우트와 같은 판단).
 *
 * ── 🔴 로그인 없이 열 수 없다 ───────────────────────────────────────────
 * **법인 직인**이다. public/ 에 두면 주소를 아는 누구나 회사 직인 이미지를 받아 갈
 * 수 있고, 그건 인감을 인터넷에 올려 두는 것과 같다. 그래서 보고서를 볼 수 있는
 * 사람에게만 내보낸다 — 문턱의 원본은 `auth/service-report-authorization.ts` 다
 * (`canViewServiceReports`). 여기에 `"READ"` 를 적어 두면 그 파일이 정한 것과 다른
 * 답을 내놓는 두 번째 정책이 생긴다.
 *
 * 감사는 남기지 않는다. 이 그림은 문서가 아니라 **문서의 부품**이고, 미리보기를 한
 * 번 열 때마다 두 줄씩 쌓이면 "누가 무엇을 가져갔는가"를 찾을 수 없게 된다. 실제로
 * 나간 문서는 xlsx 라우트가 EXCEL_EXPORT 로 남긴다.
 *
 * ── 🔴 어떤 그림을 내줄지 **이름을 코드에 박지 않는다** ─────────────────
 * 견적서 라우트는 `seal`·`logo` 두 이름을 파일 경로에 못 박아 두었다. 여기서는
 * 그러지 않는다 — 보고서 시트의 그림은 **미리보기가 양식에서 읽어 낸 것**이고
 * (`sheet-print-grid.ts` 의 `pictures`), 그 목록에 이름이 그대로 들어 있다.
 * 그러니 이 라우트가 할 일은 «그 이름이 정말 보고서 시트의 그림인가»를 확인하는
 * 것뿐이다. 확인하는 방법도 이름 대조가 아니라 **어느 파트가 가리키는가**다:
 *
 *   시트 → 그림 파트(`drawing2.xml`) → 그 관계 파일 → 이미지 관계들
 *
 * 🔴 이 길이 곧 안전장치이기도 하다. 요청에 실려 온 글자를 **경로로 쓰지 않고**
 * 위에서 모은 목록의 열쇠로만 쓴다 — `..%2f..%2f` 같은 것이 경로가 될 자리가 아예
 * 없다. 그리고 이 양식에 든 `image1.emf`·`image2.emf` 는 **엑셀 단추(ActiveX)** 에
 * 붙은 것이라 도형 파트가 따로 가리키므로 이 목록에 아예 오르지 않는다 — 인쇄에
 * 나오지도 않고 브라우저가 읽지도 못하는 것이다.
 *
 * ── 어느 양식을 여는가 ──────────────────────────────────────────────────
 * 검사·수리 두 양식은 **같은 통합문서**다(채우개 머리말의 실측 — 다른 곳이 셋뿐).
 * 그래서 종류를 받지 않고 한쪽만 읽는다. 작성 화면이 드롭다운 목록을 읽을 때 이미
 * 같은 판단을 했다(`report/service-report/page.tsx` 의 '두 양식이 같은 통합문서라
 * 한 번만 읽는다').
 *
 * ── 실패 응답에 경로를 싣지 않는다 ──────────────────────────────────────
 * 양식을 못 읽었을 때 그 경로를 응답에 담으면 오류 메시지가 디스크 구조를 알려
 * 주는 창구가 된다. 경로는 서버 로그에만 남는다
 * (`storage/service-report-template.ts`).
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 브라우저가 읽을 수 있는 그림만 내보낸다. 확장자는 **양식 안의 파트 이름**에서
 * 오지 요청에서 오지 않는다(위 '경로로 쓰지 않는다').
 */
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ name: string }> }
): Promise<NextResponse> {
  if (getAuthSource() !== "database") {
    return NextResponse.json({ error: "데이터베이스 저장 모드가 아닙니다." }, { status: 403 });
  }

  const session = await readSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.approvalStatus !== "APPROVED") {
    return NextResponse.json({ error: "계정이 아직 승인되지 않았습니다." }, { status: 403 });
  }
  // 세션에 박혀 있는 role 이 아니라 살아 있는 계정을 다시 읽는다 — 강등된 계정이
  // 토큰 만료 전까지 예전 권한으로 받아 가는 구멍을 막는다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const level = await getPermissionLevel(actingUser, SERVICE_REPORT_PERMISSION_AREA);
  if (!canViewServiceReports(level)) {
    return NextResponse.json({ error: "이 작업을 수행할 권한이 없습니다." }, { status: 403 });
  }

  const { name } = await context.params;

  try {
    const archive = ZipArchive.fromBuffer(await readServiceReportTemplate("REPAIR"));
    const part = resolveReportImagePart(archive, name);
    if (part === null) {
      // 양식이 바뀌어 그림이 없어졌거나, 보고서 시트가 안 쓰는 이름이다.
      // 미리보기는 그림 없이도 읽을 수 있어야 하므로 404 로 답하고, 화면은 빈
      // 자리로 그린다.
      return NextResponse.json({ error: "양식에 그 그림이 없습니다." }, { status: 404 });
    }

    const bytes = archive.readEntry(part.path);
    if (!bytes) {
      return NextResponse.json({ error: "양식에 그 그림이 없습니다." }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": part.contentType,
        // 직인이다. 중간 캐시에 남기지 않고, 브라우저에만 잠깐 둔다.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    if (err instanceof ServiceReportTemplateError) {
      // 🔴 err.message 에는 경로가 들어 있지 않다(storage 쪽이 그렇게 만든다).
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("[service-report-template-image] 그림을 꺼내지 못했다", {
      // 🔴 요청에 실려 온 글자는 로그에도 그대로 담지 않는다 — 길이만 남긴다.
      nameLength: typeof name === "string" ? name.length : 0,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "그림을 불러오지 못했습니다." }, { status: 500 });
  }
}

/**
 * 보고서 시트의 그림 파트가 가리키는 이미지들 중 그 이름의 것. 없으면 null.
 *
 * 요청의 글자는 **모은 목록의 열쇠로만** 쓴다(위 '경로로 쓰지 않는다').
 */
function resolveReportImagePart(
  archive: ZipArchive,
  name: string
): { path: string; contentType: string } | null {
  const sheetPart = resolveSheetPart(archive, SERVICE_REPORT_SHEET_NAME);
  const drawingPart = resolveSheetDrawingPart(archive, sheetPart);
  if (drawingPart === null) return null;

  const relsXml = archive.readTextOrNull(drawingPart.replace(/([^/]+)$/, "_rels/$1.rels"));
  if (relsXml === null) return null;

  for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const tag = match[0];
    if (!/\/relationships\/image"/.test(tag)) continue;

    const target = /\sTarget="([^"]+)"/.exec(tag)?.[1];
    if (target === undefined) continue;

    const path = resolvePartPath(drawingPart, target);
    const fileName = path.split("/").pop() ?? "";
    if (fileName !== name) continue;

    const contentType = CONTENT_TYPES[fileName.split(".").pop()?.toLowerCase() ?? ""];
    // 브라우저가 못 읽는 그림(EMF 등)은 없는 것으로 본다.
    if (contentType === undefined) return null;
    return archive.has(path) ? { path, contentType } : null;
  }

  return null;
}

/** `xl/drawings/drawing2.xml` + `../media/image3.png` → `xl/media/image3.png`. */
function resolvePartPath(fromPart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = fromPart.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === "" || piece === ".") continue;
    if (piece === "..") segments.pop();
    else segments.push(piece);
  }
  return segments.join("/");
}
