import type { AttachmentCategory } from "./attachment-category";

/**
 * ============================================================================
 * 첨부 허용목록 — 실제 저장이 기준으로 삼는 정본
 * ============================================================================
 * 지금까지 확장자 규칙은 데모 화면 전용 파일
 * (src/lib/domain/local/attachments/allowlist.ts) 안에만 있었다. 그 파일은
 * 브라우저 localStorage에 메타데이터만 담는 "실제 저장 없음" 데모라, 실제
 * 디스크에 파일을 쓰는 코드가 거기 있는 목록을 참조할 수는 없다 — 그 파일은
 * 언제든 데모가 걷히면서 사라진다.
 *
 * 그래서 실제 저장(attachments 테이블 + UPLOADS_DIR)이 기준으로 삼을 목록을
 * 여기로 옮긴다. **확장자 규칙은 데모 파일과 정확히 같다** — 새로 만들거나 뺀
 * 확장자가 하나도 없고, attachment-allowlist.test.ts가 두 목록이 어긋나지
 * 않는지 순서까지 검사한다(분류 목록에 attachment-category.test.ts가 하는 것과
 * 같은 방식).
 *
 * ── 크기 상한만 일부러 다르다 ────────────────────────────────────────────
 * 데모 파일의 MAX_ATTACHMENT_SIZE_BYTES는 300MB이고, 여기는 **20MB**다.
 * 이것은 실수가 아니라 승인된 결정이다.
 *
 * 데모는 파일 내용을 한 바이트도 다루지 않는다 — 사용자가 입력한 "크기"라는
 * 숫자를 localStorage에 적을 뿐이라, 300MB든 3GB든 아무 자원도 쓰지 않는다.
 * 여기서부터는 그 숫자가 실제로 디스크를 흐르는 바이트가 된다: 업로드 시간,
 * 임시 파일 자리, 백업 크기, 그리고 NAS로 옮길 때의 복사 시간이 전부 이 값에
 * 달린다. 그래서 실제 저장의 상한은 승인된 20MB로 따로 정했다.
 *
 * 두 값을 억지로 맞추지 않는 이유: 데모 쪽을 20MB로 낮추면 지금 그 화면에서
 * 되던 일이 까닭 없이 막히고, 이쪽을 300MB로 올리면 승인되지 않은 상한이
 * 실제 저장에 적용된다. 그래서 **테스트가 두 값을 비교하지 않는다** —
 * 비교 대상에서 명시적으로 뺐고, 그 사실을 테스트에 적어 두었다.
 * (데모 파일 쪽에는 주석을 달지 못했다. 이번 단계의 지시가 데모 계층
 * `src/lib/domain/local/attachments/*` 수정을 금지하기 때문이다.)
 *
 * ── 순수 파일이다 ─────────────────────────────────────────────────────────
 * server-only / node:fs / drizzle / React 를 import 하지 않는다. 실제 파일
 * 없이 단위 테스트로 전부 검증된다.
 * ============================================================================
 */

/**
 * 실제 저장의 파일 크기 상한. 위 헤더의 "크기 상한만 일부러 다르다" 참조 —
 * 데모 파일의 300MB와 다른 것이 의도된 것이다.
 */
export const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

/**
 * 미리보기(썸네일) 파일의 상한. 브라우저가 긴 변 480px 안팎으로 만들어 보내므로
 * 보통 30~60KB 이고, 이 값은 넉넉한 쪽이다. 이보다 크면 미리보기가 아니라 원본을
 * 보낸 것이니 거절한다 — 목록을 빠르게 하려고 만든 자리가 원본을 한 벌 더 쌓는
 * 자리가 되면 안 된다.
 *
 * 미리보기를 받는 통로가 둘(붙이기 PUT …/preview · 돌린 사진 저장 PUT …/rotation)
 * 이라 값을 여기 하나로 둔다 — 라우트마다 적으면 한쪽만 고쳐져 갈라진다.
 */
export const MAX_ATTACHMENT_PREVIEW_BYTES = 512 * 1024; // 512KB

export type AttachmentExtensionRule = {
  extension: string;
  allowedMimeTypes: readonly string[];
  /** SECURITY_POLICY.md 6번 기준 미리보기 가능 확장자만 true다: jpg, jpeg, png, pdf, txt, csv */
  previewCapable: boolean;
};

/**
 * 값·순서 모두 데모 파일의 ATTACHMENT_EXTENSION_RULES와 정확히 같아야 한다.
 * 어긋남은 attachment-allowlist.test.ts가 잡는다.
 */
export const ATTACHMENT_EXTENSION_RULES: readonly AttachmentExtensionRule[] = [
  { extension: "jpg", allowedMimeTypes: ["image/jpeg"], previewCapable: true },
  { extension: "jpeg", allowedMimeTypes: ["image/jpeg"], previewCapable: true },
  { extension: "png", allowedMimeTypes: ["image/png"], previewCapable: true },
  { extension: "pdf", allowedMimeTypes: ["application/pdf"], previewCapable: true },
  { extension: "xls", allowedMimeTypes: ["application/vnd.ms-excel"], previewCapable: false },
  {
    extension: "xlsx",
    allowedMimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    previewCapable: false,
  },
  { extension: "doc", allowedMimeTypes: ["application/msword"], previewCapable: false },
  {
    extension: "docx",
    allowedMimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    previewCapable: false,
  },
  {
    extension: "zip",
    allowedMimeTypes: ["application/zip", "application/x-zip-compressed"],
    previewCapable: false,
  },
  { extension: "csv", allowedMimeTypes: ["text/csv"], previewCapable: true },
  { extension: "txt", allowedMimeTypes: ["text/plain"], previewCapable: true },
  { extension: "log", allowedMimeTypes: ["text/plain"], previewCapable: false },
  { extension: "bin", allowedMimeTypes: ["application/octet-stream"], previewCapable: false },
  {
    extension: "hex",
    allowedMimeTypes: ["application/octet-stream", "text/plain"],
    previewCapable: false,
  },
];

const EXTENSION_RULE_MAP = new Map(ATTACHMENT_EXTENSION_RULES.map((rule) => [rule.extension, rule]));

/**
 * ============================================================================
 * 🔴 서버가 스스로 만든 파일에만 쓰는 확장자 (2026-09-21 — 교산 연락서 원본)
 * ============================================================================
 * **`ATTACHMENT_EXTENSION_RULES` 에 넣지 않는 것이 요점이다.** 거기에 한 줄을
 * 더하면 세 올리기 통로(`api/{repair-cases|product-models|quotes}/…/attachments`)가
 * 맨 먼저 보는 `isAllowedExtension` 이 통과하고, 그러면 **제한 목록이 없는 분류
 * 전부**(INTAKE_PHOTO · CUSTOMER_DOCUMENT · OTHER …)에 그 확장자가 함께 열린다.
 * `.xlsm` 은 매크로가 들어 있는 엑셀이라 **제한 없는 분류 전부에 열어 줄 수는
 * 없다.**
 *
 * 그래서 목록을 **따로** 둔다. 이 목록은 아래 두 함수로만 읽히고, 그 둘을 부르는
 * 곳은 서버가 **자기가 이미 손에 쥔 바이트**를 첨부로 남기는 자리뿐이다
 * (`server/services/kyosan-report-import.ts` — 판독기가 이미 통합문서로 열어 본
 * 파일이다). 사람이 올리는 통로는 이 목록을 **쳐다보지도 않는다**:
 *
 *   · `isAllowedExtension(...)`            — 그대로. `xlsm` 은 여전히 false
 *                                            (허용목록 14종에 넣지 않았다).
 *   · `isExtensionAllowedForCategory(...)` — 🔴 **2026-10-08 에 한 자리가
 *                                            갈라졌다.** 아래 '사람 통로가
 *                                            조건부로 열렸다' 참조.
 *   · `isContentCompatibleWithExtension(...)` — 그대로. 허용목록 밖이면 false.
 *   · 화면의 `ALL_EXTENSIONS`(FilesScreen · ProductModelFilesSection)도 그대로
 *     — 그 목록은 허용목록 14종에서 뽑는다.
 *
 * 🔴 **이 창구를 내면서 느슨해진 검사는 하나도 없다.** 새로 생긴 것은 「서버가 저
 * 바이트를 저 확장자로 적어도 되는가」를 묻는 창구 하나뿐이고, 그 창구는 내용 대조
 * (`isServerOriginContentCompatible`)를 그대로 요구한다.
 *
 * ── 🔴 사람 통로가 조건부로 열렸다 (2026-10-08 사용자 결정) ───────────────
 * 사내에서 쓰는 점검표 양식 가운데 **매크로가 든 엑셀(.xlsm)이 실제로 있다.**
 * 그래서 아래 `EXECUTABLE_EXTENSIONS` 에서 `xlsm` **한 줄만** 뺐고, 그 결과
 * 형식을 가리지 않는 분류 셋(파라미터 · 통전검사 · 점검표)에서만 `.xlsm` 이
 * 통과한다. 까닭 · 그때 알고 있던 위험 · 나머지 아홉을 그대로 막는 이유는
 * `EXECUTABLE_EXTENSIONS` 머리말에 적었다.
 *
 * 🔴 **위 「따로 둔 목록」의 뜻은 그대로다.** `xlsm` 은 여전히 허용목록 14종에
 * 없고, 그래서 사진 · 고객 서류 · 견적서처럼 **제한 목록이 없거나 좁은 분류는
 * 하나도 열리지 않았다.** 이 `SERVER_ORIGIN_EXTENSION_RULES` 창구도 그대로
 * 쓰인다 — 교상 연락서 원본은 분류와 무관하게 서버가 적는 자리이고, 그 길은
 * ZIP 서명 대조(`isServerOriginContentCompatible`)를 계속 요구한다.
 * ============================================================================
 */
export type ServerOriginExtensionRule = {
  extension: string;
  /** DB 의 mime_type 칸에 적을 정본. 브라우저가 보낸 값이 아니다. */
  mimeType: string;
};

export const SERVER_ORIGIN_EXTENSION_RULES: readonly ServerOriginExtensionRule[] = [
  /**
   * 교산 연락서 원본(2026-09-18 사용자 결정 — 원본도 첨부로 남긴다). 규격상
   * xlsx 와 같은 ZIP 컨테이너이고, 저장하기 전에 판독기가 이미 통합문서로 열어
   * 읽은 파일이다.
   */
  {
    extension: "xlsm",
    mimeType: "application/vnd.ms-excel.sheet.macroEnabled.12",
  },
];

const SERVER_ORIGIN_RULE_MAP = new Map(
  SERVER_ORIGIN_EXTENSION_RULES.map((rule) => [rule.extension, rule])
);

/** 서버가 스스로 만든 파일에만 허용되는 확장자인가. 올리기 통로는 부르지 않는다. */
export function isServerOriginExtension(extension: string): boolean {
  return SERVER_ORIGIN_RULE_MAP.has(extension);
}

export function serverOriginMimeTypeForExtension(extension: string): string | null {
  return SERVER_ORIGIN_RULE_MAP.get(extension)?.mimeType ?? null;
}

/**
 * 서버 출처 확장자의 앞머리 대조. 🔴 **면제가 아니다** — `xlsm` 은 규격상 ZIP
 * 이므로 ZIP 서명을 그대로 요구한다. 허용목록에 있는 확장자를 넘기면 false 다
 * (그쪽은 `isContentCompatibleWithExtension` 이 본다 — 창구를 섞지 않는다).
 */
export function isServerOriginContentCompatible(extension: string, header: Uint8Array): boolean {
  if (!isServerOriginExtension(extension)) return false;
  if (header.length === 0) return false;
  return isZip(header);
}

export const PREVIEW_CAPABLE_EXTENSIONS: ReadonlySet<string> = new Set(
  ATTACHMENT_EXTENSION_RULES.filter((rule) => rule.previewCapable).map((rule) => rule.extension)
);

/**
 * 5개 분류는 승인된 확장자만 허용한다. 나머지 분류는 여기 목록에 없으므로 전체
 * 허용목록 중 아무 확장자나 쓸 수 있다. 데모 파일의 CATEGORY_EXTENSION_ALLOWLIST와
 * 같아야 하고, 어긋남은 테스트가 잡는다 — 단 SCREENSHOT · SIGNED_QUOTE_PDF ·
 * QUOTE_EXCEL 세 줄은 데모에 없다(데모에 그 분류 자체가 없다. attachment-category.ts
 * 헤더의 '데모 파일과의 관계').
 */
export const CATEGORY_EXTENSION_ALLOWLIST: Partial<Record<AttachmentCategory, readonly string[]>> = {
  OSCILLOSCOPE_DATA: ["csv", "txt"],
  LOG_FILE: ["log", "txt"],
  FIRMWARE: ["bin", "hex", "zip"],
  // 회로도에 사진 확장자를 함께 둔다. 현장의 회로도는 상당수가 종이라, PDF만
  // 받으면 폰으로 찍어 바로 올리는 길이 막히고 결국 스캔해 줄 사람을 기다리게
  // 된다. 지금 넓혀 두는 이유는 나중에 넓히면 그 전에 올린 파일들과 규칙이
  // 어긋나서다 — 같은 분류 안에 "그때는 되던 것"과 "지금 되는 것"이 섞이면
  // 무엇이 규칙인지 아무도 말할 수 없다.
  //
  // 넓힌 것은 이 셋뿐이다. jpg/jpeg/png는 이미 전체 허용목록에 있고
  // previewCapable이며, 앞머리 바이트 대조(isContentCompatibleWithExtension)가
  // 그대로 걸린다 — 이름만 .jpg로 바꾼 파일은 여전히 들어오지 못한다.
  CIRCUIT_DIAGRAM: ["pdf", "jpg", "jpeg", "png"],
  // 개선 요청 글에 붙는 화면 사진 — 이미지만 받는다(2026-09-13 승인). 셋 다
  // 이미 전체 허용목록에 있고 previewCapable이며 앞머리 바이트 대조가 걸린다.
  //
  // webp는 넣지 않았다. 전체 허용목록(ATTACHMENT_EXTENSION_RULES)에 webp가 없고,
  // 여기에 적어도 isExtensionAllowedForCategory 앞의 전체 허용목록 검사에서
  // 걸린다. 전체 목록을 넓히면 제한 없는 분류 전부에 webp가 함께 열리므로 그것은
  // 따로 정할 일이다.
  SCREENSHOT: ["png", "jpg", "jpeg"],
  // 견적서에 붙는 두 칸(2026-09-15). 결재 사인이 들어간 견적서는 PDF 로만 받는다 —
  // 사진으로 찍은 결재본은 받지 않는다(칸 이름이 곧 형식이다). 손으로 만든 엑셀
  // 견적서는 xlsx 와 옛 xls 둘 다. 넷 모두 이미 전체 허용목록에 있고 앞머리 바이트
  // 대조가 그대로 걸린다. 크기 상한은 다른 분류와 같은 20MB 다.
  SIGNED_QUOTE_PDF: ["pdf"],
  QUOTE_EXCEL: ["xlsx", "xls"],
};

/**
 * ============================================================================
 * 🔴 형식을 가리지 않는 분류 (2026-09-30 — 제품 모델의 기본 자료 셋)
 * ============================================================================
 * 파라미터 · 통전검사 · 점검표는 **실행 파일만 빼고 무엇이든** 받는다(사용자
 * 결정). 장비마다 도구가 달라 어떤 형식으로 나올지 미리 셀 수 없기 때문이다 —
 * .hwp · .dwg · .par · 벤더 전용 확장자가 실제로 온다.
 *
 * ── 왜 CATEGORY_EXTENSION_ALLOWLIST 에 적지 않는가 ───────────────────────
 * 위 목록은 「이 분류는 이 확장자만」을 적는 자리라 **좁히는 쪽으로만** 쓸 수
 * 있다. 거기에 없는 분류는 전체 허용목록(ATTACHMENT_EXTENSION_RULES · 14종)을
 * 쓰는 것이지 아무거나 쓰는 것이 아니다. 그래서 「넓히는 쪽」은 목록을 따로 둔다 —
 * 위 목록은 **한 글자도 고치지 않았다.**
 *
 * 🔴 **다른 분류는 하나도 안 열렸다.** 아래 이름에 들어 있는 것은 이 셋뿐이다.
 *
 * ── 주인은 셋이 같지 않다 · 형식 규칙은 같다 ─────────────────────────────
 * 파라미터 · 통전검사는 제품 모델 전용이고, **점검표는 수리 건에도 붙는다**
 * (attachment-category.ts 의 PRODUCT_MODEL_ONLY_CATEGORIES 머리말 — 모델의 것은
 * 빈 양식, 수리 건의 것은 채워 인쇄한 기록이다). 그래도 **형식 규칙은 주인과
 * 무관하게 하나다** — 같은 분류가 어느 화면에서 올리느냐에 따라 받는 형식이
 * 달라지면 "점검표는 무엇을 받는가"에 답이 둘이 된다. 그래서 이 목록은 분류만
 * 보고 주인을 보지 않는다.
 *
 * 🔴 그러므로 **접수 건 통로도 이 길을 지난다**(2026-09-30 정정 이후). 견적서
 * 통로만 여전히 닿지 못한다 — 견적서에 붙는 것은 결재 PDF · 수기 엑셀 두 칸뿐이다.
 *
 * ── 크기 상한은 그대로 20MB 다 ───────────────────────────────────────────
 * 형식을 연 것이지 크기를 연 것이 아니다. MAX_ATTACHMENT_SIZE_BYTES 는 손대지
 * 않았다(파일 머리말의 '크기 상한만 일부러 다르다').
 * ============================================================================
 */
export const ANY_EXTENSION_CATEGORIES: readonly AttachmentCategory[] = [
  "PARAMETER",
  "POWER_TEST",
  "CHECKLIST",
];

/**
 * 🔴 **실행 파일로 보는 확장자.** 형식을 가리지 않는 분류에서만 쓰이는 거절
 * 목록이다(다른 분류는 애초에 14종 허용목록 밖을 받지 않으므로 이것을 볼 일이
 * 없다).
 *
 * 고른 기준은 **"두 번 눌러서, 또는 한 줄 명령으로 코드가 도는 것"** 이다. 사내에서
 * 서로 나누는 자리라 한 번 잘못 올라가면 그대로 퍼진다.
 *
 *   · 윈도 실행체·설치본   exe com scr pif msi msp msix appx appxbundle application
 *   · 윈도 적재 모듈       dll ocx cpl sys drv        (rundll32 한 줄이면 돈다)
 *   · 윈도 스크립트        bat cmd ps1 psm1 psd1 vbs vbe js jse wsf wsh hta
 *   · 윈도 손잡이·설정     lnk scf inf reg msc gadget (누르면 다른 것을 실행한다)
 *   · 유닉스/맥           sh bash zsh ksh csh fish run out elf so dylib app
 *                         command pkg dmg deb rpm appimage
 *   · 해석기 스크립트      py pyc pyo pyw rb pl pm php lua ahk vb ws
 *   · 자바/안드로이드      jar apk class dex
 *   · 매크로 오피스        xlsb xlam xla docm dotm pptm potm ppam sldm
 *                         (🔴 `xlsm` 은 2026-10-08 에 **빠졌다** — 아래 참조)
 *
 * ⚠️ **bin · hex 는 여기 없다.** 펌웨어·계측 덤프의 확장자이고(전체 허용목록에
 * 이미 있다), 윈도도 리눅스도 그 이름만으로 실행하지 않는다. 파라미터 파일이
 * .bin 으로 나오는 장비가 실제로 있어 막으면 이 기능의 뜻이 없어진다. 실행 파일
 * 서명(MZ · ELF)은 아래 내용 대조가 확장자와 무관하게 따로 막는다.
 *
 * ⚠️ 매크로 오피스를 넣은 까닭은 **매크로는 코드**라서다. 그 판단은 지금도
 * 살아 있다 — 아홉은 그대로 여기 있다.
 *
 * ── 🔴 `xlsm` 하나만 뺐다 (2026-10-08 사용자 결정) ───────────────────────
 * 이 줄은 **2026-09-21 에 적힌 「xlsm 을 사람 통로에서 막아 온 이 저장소의 결정과
 * 같은 줄이다」를 대신한다.** 그 문장은 더 이상 사실이 아니다. 지우지 않고 무엇이
 * 바뀌었는지 남긴다:
 *
 *   · **왜 열었나** — 사내에서 쓰는 점검표 양식 가운데 매크로가 든 엑셀이 실제로
 *     있고, 그것을 「종류별 공통서류」에 올려야 한다. 그 분류 셋(파라미터 ·
 *     통전검사 · 점검표)은 2026-09-30 결정으로 **이미 형식을 안 가린다** —
 *     `.hwp` · `.dwg` · `.bin` 이 들어가는 자리다. `xlsm` 만 이 거절 목록에
 *     걸려 있었다.
 *
 *   · 🔴 **그때 알고 있던 위험** — 악성코드 검사기가 **아직 없다.** 첨부의
 *     `malware_scan_status` 는 전부 `NOT_SCANNED` 이고, 내려받기를 막지 않는다.
 *     앞머리 바이트 대조는 「형식을 속인 파일」까지만 막지 매크로 **안쪽 내용**은
 *     보지 않는다. 사용자는 이것을 **듣고 나서** 열기로 정했다.
 *
 *   · 🔴 **왜 나머지 아홉은 그대로 막는가** — 요구된 것이 `.xlsm` 하나뿐이고,
 *     「매크로는 코드다」라는 판단 자체는 바뀌지 않았다. 필요 없는 것까지 함께
 *     열면 「무엇이 왜 열렸는가」에 답할 수 없게 된다. `xlsb` · `xlam` · `xla` ·
 *     `docm` · `dotm` · `pptm` · `potm` · `ppam` · `sldm` 은 **전부 거절**이다.
 *
 *   · **열린 곳은 셋뿐이다** — `ANY_EXTENSION_CATEGORIES`(파라미터 · 통전검사 ·
 *     점검표). `xlsm` 을 `ATTACHMENT_EXTENSION_RULES`(허용목록 14종)에는
 *     **넣지 않았으므로** 사진 · 고객 서류 · 견적서 · 그 밖의 분류는 그대로
 *     막혀 있다. 크기 상한(`MAX_ATTACHMENT_SIZE_BYTES`)도 손대지 않았다.
 *
 *   · ⚠️ **앞머리 대조는 ZIP 을 요구하지 않는다** — `xlsm` 은 허용목록 14종
 *     밖이라 `CONTENT_CHECK_BY_EXTENSION` 표에 없고, 사람 통로의
 *     `isUploadContentCompatible` 은 목록 밖 확장자를 펌웨어(bin · hex)와 같은
 *     자리에서 다룬다 — **실행 파일 서명(MZ · ELF)만** 되돌려 보낸다. `.hwp` ·
 *     `.dwg` 와 똑같은 취급이고, 이 조각이 바꾼 것이 아니다. ZIP 서명을 요구하는
 *     것은 서버 출처 길(`isServerOriginContentCompatible`) 하나뿐이다.
 */
export const EXECUTABLE_EXTENSIONS: readonly string[] = [
  // 윈도 실행체·설치본
  "exe", "com", "scr", "pif", "msi", "msp", "msix", "appx", "appxbundle", "application",
  // 윈도 적재 모듈
  "dll", "ocx", "cpl", "sys", "drv",
  // 윈도 스크립트
  "bat", "cmd", "ps1", "psm1", "psd1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta",
  // 윈도 손잡이·설정 — 스스로 코드는 아니지만 누르면 다른 것을 실행한다
  "lnk", "scf", "inf", "reg", "msc", "gadget",
  // 유닉스·맥
  "sh", "bash", "zsh", "ksh", "csh", "fish", "run", "out", "elf", "so", "dylib",
  "app", "command", "pkg", "dmg", "deb", "rpm", "appimage",
  // 해석기 스크립트
  "py", "pyc", "pyo", "pyw", "rb", "pl", "pm", "php", "lua", "ahk", "vb", "ws",
  // 자바·안드로이드
  "jar", "apk", "class", "dex",
  // 매크로가 들어가는 오피스 형식 — 매크로는 코드다.
  // 🔴 `xlsm` 은 여기 **없다**(2026-10-08 사용자 결정 — 위 머리말). 나머지 아홉은
  // 그대로다. 한 줄 더하거나 빼기 전에 위 머리말을 읽을 것.
  "xlsb", "xlam", "xla", "docm", "dotm", "pptm", "potm", "ppam", "sldm",
];

const EXECUTABLE_EXTENSION_SET: ReadonlySet<string> = new Set(EXECUTABLE_EXTENSIONS);

/** 실행 파일로 보는 확장자인가. 이름은 이미 소문자로 눕혀진 것을 넘긴다. */
export function isExecutableExtension(extension: string): boolean {
  return EXECUTABLE_EXTENSION_SET.has(extension);
}

/**
 * 확장자의 **모양** — 소문자 영숫자 1~16자. normalizeFileExtension 과 이
 * 상수 하나를 함께 본다(따로 적으면 갈라진다). 점·경로 구분자·".." ·윈도우
 * 예약 문자가 확장자로 둔갑해 디스크 경로를 만드는 일을 이 모양이 막는다.
 */
const EXTENSION_SHAPE_PATTERN = /^[a-z0-9]{1,16}$/;

/**
 * 🔴 **저장 경로의 확장자 자리에 놓아도 되는가** — attachment-path.ts 의 세 경로
 * 생성기가 부른다.
 *
 * 경로 생성기가 묻는 것은 「이 분류가 이 확장자를 받아도 되는가」가 아니라
 * **「옮길 수 있는 경로가 되는가」**다(attachment-path.ts 견적서 벌의 머리말:
 * "PDF · 엑셀로 좁히는 것은 여기가 아니라 분류 허용목록이 맡는다 — 경로 함수는
 * '옮길 수 있는 경로인가'만 본다"). 그래서 여기서 보는 것은 **모양과 실행 파일
 * 둘뿐**이다.
 *
 * ⚠️ 예전에는 경로 생성기가 `isAllowedExtension` 을 대신 썼다. 그때는 허용목록
 * 14종이 곧 "올라올 수 있는 확장자 전부"라 두 물음의 답이 같았기 때문이다.
 * 형식을 가리지 않는 분류가 생기면서 그 전제가 깨졌다 — `.hwp` 를 올리면 통로는
 * 전부 통과하고 **경로를 만들다 던진다.** 그러면 임시 파일이 남은 채 500 이
 * 나간다. 그 자리를 이 함수가 메운다.
 *
 * 🔴 **느슨해진 것이 없다.** `EXECUTABLE_EXTENSIONS` 에 적힌 것은 여전히 전부
 * 거절이고(숫자는 적지 않는다 — 적으면 목록이 바뀔 때 거짓이 된다), 모양 검사가
 * 경로를 깨는 글자를 전부 막는다. 어느 분류가 어느 확장자를 받는지는 통로가
 * 이미 `isExtensionAllowedForCategory` 로 판정한 뒤다.
 *
 * ⚠️ 2026-10-08 에 `xlsm` 이 그 목록에서 빠지면서 **이 함수가 `.xlsm` 에 true 를
 * 돌려준다.** 그래야 점검표로 올라온 매크로 엑셀이 경로를 만들다 던지지 않는다
 * (바로 위 `.hwp` 와 같은 자리다). 어느 분류가 받는지는 여기서 보지 않는다.
 */
export function isStorableExtension(extension: string): boolean {
  return EXTENSION_SHAPE_PATTERN.test(extension) && !isExecutableExtension(extension);
}

/** 이 분류는 형식을 가리지 않는가(실행 파일만 거절). */
export function isCategoryOpenToAnyExtension(category: AttachmentCategory): boolean {
  return ANY_EXTENSION_CATEGORIES.includes(category);
}

/**
 * 사용자가 올린 이름에서 확장자만 뽑아 소문자로 정규화한다.
 *
 * 소문자로 고정하는 이유는 NAS 이식 때문이다 — Windows는 "A.JPG"와 "a.jpg"를
 * 같은 파일로 보지만 Linux 컨테이너는 다른 파일로 본다. 디스크 경로에 들어갈
 * 값을 여기서 한 번 소문자로 눕혀 두면, 옮긴 뒤 "일부 파일만 안 열리는" 일이
 * 생기지 않는다(attachment-path.ts의 같은 규칙과 짝이다).
 *
 * 점이 없거나, 마지막 점 뒤가 비었거나, 영숫자가 아닌 문자가 섞였으면 null이다.
 * 여기서 걸러 두면 "..", 경로 구분자, 윈도우 예약 문자가 확장자로 둔갑해
 * 디스크 경로를 만드는 일이 애초에 불가능해진다.
 */
export function normalizeFileExtension(fileName: string): string | null {
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === trimmed.length - 1) return null;
  const extension = trimmed.slice(lastDot + 1).toLowerCase();
  // 모양 규칙은 EXTENSION_SHAPE_PATTERN 하나를 본다 — isStorableExtension 과
  // 같은 상수라야 두 자리가 갈리지 않는다.
  if (!EXTENSION_SHAPE_PATTERN.test(extension)) return null;
  return extension;
}

export function isAllowedExtension(extension: string): boolean {
  return EXTENSION_RULE_MAP.has(extension);
}

export function getAllowedMimeTypesForExtension(extension: string): readonly string[] {
  return EXTENSION_RULE_MAP.get(extension)?.allowedMimeTypes ?? [];
}

/**
 * DB의 mime_type 컬럼에 적을 값. **브라우저가 보낸 Content-Type을 쓰지 않는다** —
 * 그 값은 클라이언트가 마음대로 정할 수 있어서, 그대로 저장하면 나중에
 * 다운로드 응답 헤더가 공격자가 고른 타입으로 나간다. 확장자는 허용목록으로
 * 이미 좁혀져 있으므로, 그 확장자의 정본 MIME을 서버가 직접 고른다.
 */
export function canonicalMimeTypeForExtension(extension: string): string | null {
  return EXTENSION_RULE_MAP.get(extension)?.allowedMimeTypes[0] ?? null;
}

export function isExtensionMimeCompatible(extension: string, mimeType: string): boolean {
  const rule = EXTENSION_RULE_MAP.get(extension);
  if (!rule) return false;
  return rule.allowedMimeTypes.includes(mimeType);
}

export function isExtensionAllowedForCategory(extension: string, category: AttachmentCategory): boolean {
  // 형식을 가리지 않는 분류는 **전체 허용목록을 거치지 않는다** — 실행 파일만
  // 거절한다(위 ANY_EXTENSION_CATEGORIES 머리말). 빈 확장자는 애초에
  // normalizeFileExtension 이 null 로 돌려보내므로 여기에 오지 않지만, 이 함수만
  // 따로 불러도 열리지 않게 한 번 더 본다.
  if (isCategoryOpenToAnyExtension(category)) {
    return extension.length > 0 && !isExecutableExtension(extension);
  }
  const restricted = CATEGORY_EXTENSION_ALLOWLIST[category];
  if (!restricted) return isAllowedExtension(extension);
  return restricted.includes(extension);
}

export function isPreviewCapableExtension(extension: string): boolean {
  return PREVIEW_CAPABLE_EXTENSIONS.has(extension);
}

/**
 * ============================================================================
 * 내용 대조 — 확장자가 말하는 것과 실제 바이트가 같은가
 * ============================================================================
 * 브라우저가 보낸 MIME도, 사용자가 붙인 확장자도 그 자체로는 아무 증거가 아니다.
 * `bad.exe`를 `report.pdf`로 이름만 바꿔 올리면 둘 다 "PDF"라고 말한다. 그래서
 * 실제로 저장하기 전에 **파일 앞머리 바이트**를 확장자가 주장하는 형식과 대조한다.
 *
 * 이것은 악성코드 검사가 아니다(검사 엔진은 아직 없고, malware_scan_status는
 * 전부 NOT_SCANNED로 남는다). 여기서 막는 것은 "형식을 속인 파일"까지다.
 *
 * bin/hex(펌웨어)에는 대조할 서명이 없다 — 펌웨어 덤프는 정의상 임의의 바이트라
 * 어떤 서명도 요구할 수 없다. 그 자리는 나중에 붙을 검사 엔진이 맡는다.
 * ============================================================================
 */

/** 앞머리 몇 바이트를 대조에 쓰는가. PDF 규격이 %PDF- 를 앞 1024바이트 안에 허용한다. */
export const CONTENT_SNIFF_BYTES = 1024;

type ContentCheck = "JPEG" | "PNG" | "PDF" | "ZIP" | "OFFICE_LEGACY" | "TEXT" | "UNCHECKED";

const CONTENT_CHECK_BY_EXTENSION: Readonly<Record<string, ContentCheck>> = {
  jpg: "JPEG",
  jpeg: "JPEG",
  png: "PNG",
  pdf: "PDF",
  // xlsx/docx는 규격상 ZIP 컨테이너다.
  zip: "ZIP",
  xlsx: "ZIP",
  docx: "ZIP",
  // 옛 Office는 OLE2 복합 문서다. ZIP도 받아 주는 것은 실무 때문이다 —
  // .xlsx를 .xls로 이름만 바꿔 보내는 일이 흔한데, 그건 형식을 속이려는
  // 시도가 아니라 사무실에서 늘 일어나는 실수다. 실행 파일·스크립트는
  // 두 서명 중 어느 쪽도 아니라 여전히 걸린다.
  xls: "OFFICE_LEGACY",
  doc: "OFFICE_LEGACY",
  csv: "TEXT",
  txt: "TEXT",
  log: "TEXT",
  // 펌웨어 — 대조할 서명이 없다(위 주석 참조).
  bin: "UNCHECKED",
  hex: "UNCHECKED",
};

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

function containsAscii(bytes: Uint8Array, ascii: string): boolean {
  const needle = Array.from(ascii, (char) => char.charCodeAt(0));
  outer: for (let i = 0; i + needle.length <= bytes.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];
const ZIP_SPANNED = [0x50, 0x4b, 0x07, 0x08];
const WINDOWS_EXECUTABLE = [0x4d, 0x5a]; // "MZ"
const ELF_EXECUTABLE = [0x7f, 0x45, 0x4c, 0x46]; // "\x7fELF"

function isZip(header: Uint8Array): boolean {
  return startsWith(header, ZIP_LOCAL) || startsWith(header, ZIP_EMPTY) || startsWith(header, ZIP_SPANNED);
}

/**
 * 텍스트로 보이는가. NUL 바이트가 하나라도 있으면 텍스트가 아니다 — 실행
 * 파일·이미지·압축 파일은 앞머리 몇 백 바이트 안에 반드시 NUL이 나온다.
 * 실행 파일 서명은 그와 별개로 한 번 더 명시적으로 막는다.
 */
function looksLikeText(header: Uint8Array): boolean {
  if (startsWith(header, WINDOWS_EXECUTABLE) || startsWith(header, ELF_EXECUTABLE)) return false;
  if (isZip(header) || startsWith(header, OLE2_MAGIC) || startsWith(header, PNG_MAGIC)) return false;
  return !header.includes(0x00);
}

/**
 * 이 확장자의 파일이라면 앞머리가 이렇게 생겨야 한다 — 아니면 거부한다.
 *
 * 허용목록에 없는 확장자는 여기서도 false다(앞선 단계에서 이미 걸리지만, 이
 * 함수만 따로 불러도 열리지 않아야 한다).
 */
export function isContentCompatibleWithExtension(extension: string, header: Uint8Array): boolean {
  if (!isAllowedExtension(extension)) return false;
  if (header.length === 0) return false;

  switch (CONTENT_CHECK_BY_EXTENSION[extension] ?? "UNCHECKED") {
    case "JPEG":
      return startsWith(header, JPEG_MAGIC);
    case "PNG":
      return startsWith(header, PNG_MAGIC);
    case "PDF":
      // 규격은 %PDF- 가 앞 1024바이트 안에 있으면 된다고 본다(BOM/여백이 앞에
      // 붙은 실제 파일이 있다).
      return containsAscii(header, "%PDF-");
    case "ZIP":
      return isZip(header);
    case "OFFICE_LEGACY":
      return startsWith(header, OLE2_MAGIC) || isZip(header);
    case "TEXT":
      return looksLikeText(header);
    case "UNCHECKED":
      // 펌웨어. 다만 실행 파일 서명은 확장자와 무관하게 되돌려 보낸다 —
      // .bin 으로 위장한 실행 파일까지 통과시킬 이유는 없다.
      return !startsWith(header, WINDOWS_EXECUTABLE) && !startsWith(header, ELF_EXECUTABLE);
    default:
      return false;
  }
}

/**
 * ============================================================================
 * 올리기 통로가 부르는 내용 대조 — 분류까지 함께 본다 (2026-09-30)
 * ============================================================================
 * 세 통로(`api/{repair-cases|product-models|quotes}/…/attachments`)가 이것 하나를
 * 부른다. 🔴 **느슨해진 것이 하나도 없다** — 형식을 가리지 않는 분류가 생기면서
 * 갈라진 자리가 하나 생겼을 뿐이다:
 *
 *   · 여느 분류            `isContentCompatibleWithExtension` **그대로**.
 *                          허용목록 밖 확장자는 여전히 false 다.
 *   · 형식을 안 가리는 분류
 *       - 허용목록 안 확장자 → **역시 `isContentCompatibleWithExtension`.**
 *         `.pdf` 라고 적었으면 여전히 PDF 여야 한다. 분류가 열렸다고 해서
 *         이름만 바꾼 파일이 들어오지는 않는다.
 *       - 허용목록 밖 확장자 → 대조할 서명이 없다(.hwp · .dwg · 벤더 전용).
 *         펌웨어(bin/hex)의 UNCHECKED 와 같은 자리이고, 같은 방식으로
 *         **실행 파일 서명(MZ · ELF)만** 되돌려 보낸다. 이름을 `.par` 로 바꾼
 *         exe 는 여기서 걸린다.
 *
 * 빈 파일은 어느 쪽에서도 통과하지 않는다.
 * ============================================================================
 */
export function isUploadContentCompatible(
  extension: string,
  category: AttachmentCategory,
  header: Uint8Array
): boolean {
  if (header.length === 0) return false;
  if (!isCategoryOpenToAnyExtension(category)) {
    return isContentCompatibleWithExtension(extension, header);
  }
  if (isAllowedExtension(extension)) return isContentCompatibleWithExtension(extension, header);
  return !startsWith(header, WINDOWS_EXECUTABLE) && !startsWith(header, ELF_EXECUTABLE);
}
