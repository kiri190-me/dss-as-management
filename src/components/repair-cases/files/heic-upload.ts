import type { AttachmentCategory } from "@/lib/domain/attachment-category";
import {
  ATTACHMENT_EXTENSION_RULES,
  isCategoryOpenToAnyExtension,
  isExtensionAllowedForCategory,
} from "@/lib/domain/attachment-allowlist";

/**
 * ============================================================================
 * 아이폰 사진(heic) — 고를 수 있게 하고, 보내기 전에 jpg 로 바꾼다 (2026-11-18)
 * ============================================================================
 * 사용자 요청: 「사진 넣을 때 heic 확장자도 포함해줘」(수리 건 상세 [파일 관리]).
 *
 * ── 🔴 왜 「그대로 저장」이 아니라 「바꿔서 저장」인가 (2026-11-18 사용자 결정) ──
 * 크롬·엣지는 heic 를 **그리지 못한다.** 그대로 받아 두면 파일은 멀쩡히 저장되는데
 * 목록에 썸네일이 없고, 뷰어로 안 열리고, 새 탭으로도 안 보인다 — 내려받아 윈도우
 * 사진 앱으로 열어야만 보인다. 서버에는 이미지 라이브러리가 없어서(sharp · jimp 가
 * 한 건도 없다) 올라온 바이트를 그대로 적을 뿐이고, 그래서 다시 굽는 자리는
 * 브라우저밖에 없다. 🔴 **원본 heic 는 남지 않는다** — 고를 때 셋 중에서 고른 길이다.
 *
 * ── 🔴 허용목록은 한 글자도 안 건드렸다 ─────────────────────────────────
 * 서버로 가는 것은 언제나 jpg 다. `ATTACHMENT_EXTENSION_RULES`(14종)에 heic 를 넣을
 * 까닭이 없고, 넣으면 **제한 목록이 없는 분류 전부**가 함께 열려 브라우저가 못 그리는
 * 파일이 통로로 들어온다. 「heic 는 분류 허용목록에서 false」라는 단언
 * (attachment-allowlist.test.ts)은 지금도 그대로 맞다. 여기서 더한 것은 **고르는 창의
 * 힌트(`accept`)** 와 **보내기 전 한 번 굽는 일** 둘뿐이고, 서버 쪽 검사는 그대로다.
 *
 * ── accept 는 약속이 아니라 힌트다 ───────────────────────────────────────
 * 사람은 고르는 창에서 「모든 파일」로 바꿔 무엇이든 집을 수 있고, 폴더에서 끌어다
 * 놓는 길(FileDropZone)은 `accept` 를 아예 지나지 않는다. 그래서 **바꿀지 말지는
 * 고른 파일을 보고** 정한다(isHeicPick) — accept 에 적혀 있으니 heic 일 것이라고
 * 믿지 않는다.
 *
 * ── 🔴 왜 「사진을 받는 분류」에서만인가 ─────────────────────────────────
 * 분류마다 받는 형식이 다르다(allowedExtensionsFor). csv · txt 만 받는 [오실로스코프
 * 데이터]에서 heic 를 골라 jpg 로 바꿔 봐야 그 분류가 jpg 를 안 받아 곧바로 거절된다 —
 * 큰 사진 한 장에 몇 초를 들여 바꾼 **뒤에** 거절하는 것이 가장 나쁘다. 그 판정은
 * 새로 짓지 않고 이미 있던 「이 분류가 사진을 받는가」를 그대로 쓴다(촬영 단추를
 * 내밀지 말지를 정하던 그 식 — categoryTakesPhotos).
 *
 * ── 값으로 시험한다 ──────────────────────────────────────────────────────
 * 실제 heic 를 푸는 일은 wasm 이라 시험에서 돌릴 수 없다. 그래서 **바꾸는 함수를
 * 밖에서 받아**(HeicToJpeg) 가짜 변환기로 잰다 — 이 저장소가 `fetchImpl` 을 넘기는
 * 것과 같은 방식이다(ContactFolderSection 의 loadContactFolderEntries).
 * 진짜 변환기는 heic-to-jpeg.ts 에 따로 있고, 거기서만 라이브러리를 늦게 받는다.
 * ============================================================================
 */

const ALL_EXTENSIONS = ATTACHMENT_EXTENSION_RULES.map((rule) => rule.extension);

/**
 * 이 분류가 받는 확장자 — **셀 수 있을 때만**. 형식을 가리지 않는 분류는 목록으로
 * 적을 수가 없어 null 이다.
 *
 * 🔴 **접수 건에도 그런 분류가 있다**(2026-09-30) — 「점검표」다. 실제로 인쇄한
 * 점검표를 기록으로 올리는 자리라 장비·양식마다 형식이 다르고, 그래서 실행 파일만
 * 빼고 다 받는다(attachment-allowlist.ts 의 ANY_EXTENSION_CATEGORIES).
 *
 * 🔴 2026-11-18 에 FilesScreen 에서 **이리로 옮겨 왔다**(글자는 그대로다). 고르는 창이
 * 무엇을 내미는지(pickerAcceptAttribute)와 heic 를 바꿀지(categoryTakesPhotos)가 전부
 * 이 목록에서 갈리는데, 화면 안에 있으면 그 판정을 값으로 잴 수 없었다.
 * ⚠️ 제품 모델 쪽 두 화면(ProductModelFilesSection · ProductModelKindFilesScreen)에는
 * 같은 이름의 쌍둥이가 그대로 남아 있다 — **이번 일은 수리 건 상세 한 화면**이고,
 * 저쪽까지 이 모듈로 끌어오면 heic 가 저 두 화면에도 함께 열린다(요청 밖이다).
 */
export function allowedExtensionsFor(category: AttachmentCategory): string[] | null {
  if (isCategoryOpenToAnyExtension(category)) return null;
  return ALL_EXTENSIONS.filter((extension) => isExtensionAllowedForCategory(extension, category));
}

/**
 * 이 분류가 **사진을 받는가.**
 *
 * 원래 촬영 단추를 내밀지 정하던 식이다(사진을 아예 안 받는 분류에 촬영 단추를 두면
 * 찍는 순간까지 갔다가 거절당한다). 🔴 heic 도 **같은 식으로** 가린다 — 판정을 둘로
 * 두면 「촬영은 되는데 아이폰 사진은 못 고르는」 분류가 생기고, 그 어긋남은 오류 없이
 * 화면에서만 드러난다.
 *
 * 형식을 가리지 않는 분류(점검표 · null)는 **참**이다 — jpg 도 받으므로 찍어서도,
 * 아이폰 사진으로도 올릴 수 있다.
 */
export function categoryTakesPhotos(allowedExtensions: readonly string[] | null): boolean {
  return (
    allowedExtensions === null ||
    allowedExtensions.includes("jpg") ||
    allowedExtensions.includes("jpeg")
  );
}

/**
 * 🔴 고르는 창에서만 쓰는 확장자. **허용목록이 아니다** — 이 둘로 저장되는 파일은
 * 하나도 없다(전부 jpg 로 바뀐 뒤에 올라간다). `.heif` 를 함께 적는 이유는 같은
 * 규격의 다른 이름이고, 안드로이드·일부 카메라가 그 이름으로 내놓기 때문이다.
 */
export const HEIC_PICKER_EXTENSIONS = ["heic", "heif"] as const;

/*
 * 🔴 **고르기 칸 아래 안내 한 줄(`HEIC_PICKER_HINT`)은 2026-11-18 에 없앴다** — 사용자
 * 요청(「설명은 없어도 될 것 같아」)이다. 지운 글자 그대로는 이랬다:
 *     "아이폰 사진(.heic·.heif)은 올릴 때 .jpg 로 바꿔서 저장합니다 — 원본 heic 는
 *      남지 않습니다."
 * 🔴 **기능은 한 글자도 안 바뀌었다.** heic 는 지금도 고를 수 있고(pickerAcceptAttribute),
 * 보내기 전에 jpg 로 구워진다. 그리고 **바꾼 뒤에는 그대로 알린다** — 아래
 * `heicConversionNotice` 가 어떤 이름이 어떤 이름이 됐는지까지 적는다. 없앤 것은
 * 「미리」 말하던 쪽 하나뿐이다.
 */

/**
 * `<input type="file" accept=…>` 에 넣을 글자.
 *
 * 🔴 형식을 가리지 않는 분류에서는 **undefined** 다 — 빈 문자열이 아니다. 빈 문자열을
 * 넣으면 브라우저가 「받는 형식이 없다」로 읽어 고르는 창이 아무것도 안 내놓는 날이
 * 있다. 속성을 아예 달지 않아야 모든 파일이 보인다(그 분류는 heic 도 이미 보인다).
 *
 * 사진을 받는 분류에만 `.heic,.heif` 가 **뒤에 붙는다.** 앞의 목록은 지금까지와 한
 * 글자도 다르지 않다 — 허용목록에서 뽑은 그대로다.
 */
export function pickerAcceptAttribute(
  allowedExtensions: readonly string[] | null
): string | undefined {
  if (allowedExtensions === null) return undefined;
  const offered = [...allowedExtensions];
  if (categoryTakesPhotos(allowedExtensions)) offered.push(...HEIC_PICKER_EXTENSIONS);
  return offered.map((extension) => `.${extension}`).join(",");
}

/** 이름에서 뽑은 마지막 확장자(소문자). 없으면 빈 글자다. */
function lastExtensionOf(fileName: string): string {
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === trimmed.length - 1) return "";
  return trimmed.slice(lastDot + 1).toLowerCase();
}

/**
 * 🔴 **확장자와 MIME 을 둘 다 본다.**
 *
 * 기기에 따라 `image/heic` 로도 `image/heif` 로도 오고, **빈 글자로 오는 일이 흔하다**
 * (윈도우에서 특히 — 탐색기가 그 형식을 모르면 타입을 안 붙인다). 거꾸로 이름이
 * `IMG_1234.jpg` 인데 속은 heic 인 파일도 있다(변환기를 거친 이름만 바뀐 파일).
 * 한쪽만 보면 둘 중 한 갈래가 조용히 샌다 — 샌 파일은 목록에 썸네일 없이 남는다.
 */
export function isHeicPick(file: { name: string; type: string }): boolean {
  const mime = file.type.trim().toLowerCase();
  if (mime.startsWith("image/heic") || mime.startsWith("image/heif")) return true;
  return (HEIC_PICKER_EXTENSIONS as readonly string[]).includes(lastExtensionOf(file.name));
}

/**
 * 바꾼 뒤의 이름. `IMG_1234.HEIC` → `IMG_1234.jpg`.
 *
 * 🔴 **대문자 확장자가 흔하다**(아이폰이 그렇게 붙인다). 그리고 이름의 확장자를 꼭
 * 같이 바꿔야 한다 — 서버는 확장자로 분류 허용 여부와 저장 경로를 정하고
 * (attachment-allowlist.ts), 앞머리 바이트가 JPEG 인지도 **확장자가 말하는 형식과**
 * 대조한다. `.heic` 이름으로 jpg 바이트를 보내면 거기서 걸린다.
 *
 * 마지막 확장자를 떼고 `.jpg` 를 붙인다 — 이름에 확장자가 없으면(`IMG_1234`) 그냥
 * 붙인다. heic 가 아닌 확장자가 붙어 있는 경우(MIME 만 heic 인 파일)도 같다:
 * 실제로 보내는 바이트가 jpeg 이므로 이름도 거기에 맞춘다.
 */
export function jpegNameForHeic(fileName: string): string {
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  const stem = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  return `${stem}.jpg`;
}

/** 진짜 변환기(heic-to-jpeg.ts)와 가짜 변환기가 함께 맞추는 모양. */
export type HeicToJpeg = (file: File) => Promise<Blob>;

/** 못 바꾼 파일에 붙는 까닭. 올리기 실패 목록에 `이름(까닭)` 으로 적힌다. */
export const HEIC_CONVERT_FAILED_REASON = "아이폰 사진을 jpg 로 바꾸지 못했습니다";

/** 바뀐 이름 한 쌍 — 사람에게 「무엇이 무엇이 됐는지」 그대로 보여 주려고 모은다. */
export type HeicRename = { from: string; to: string };

export type HeicConversionOutcome = {
  /**
   * 🔴 **올리기에 그대로 태울 목록.** heic 가 아니던 파일은 **손대지 않은 그 객체**가
   * 그대로 들어 있다(바이트도 이름도 한 글자 안 바뀐다). 못 바꾼 heic 는 빠진다.
   */
  files: File[];
  /** 실제로 바뀐 것들. 비어 있으면 화면이 아무 말도 하지 않는다. */
  renamed: HeicRename[];
  /** 못 바꾼 것들. 올리기 쪽 실패 목록과 **같은 모양**이라 거기 그대로 합친다. */
  failures: { name: string; reason: string }[];
};

/**
 * 고른 파일들 가운데 heic 만 골라 jpg 로 바꾼다.
 *
 * 🔴 **한 장이 실패해도 나머지는 올라간다.** 묶음 전체를 거절하면 열 장 중 한 장이
 * 깨졌을 때 아홉 장까지 못 올린다 — 올리기 고리가 장마다 따로 판정하는 것과 같은
 * 뜻이다(FilesScreen 의 rejectionReasonFor 머리말).
 *
 * 🔴 **조용히 삼키지 않는다.** 못 바꾼 파일은 `failures` 로 나가고, 화면은 그것을
 * 올리기 실패와 같은 줄에 적는다. 아무 말도 안 하면 사람은 올라간 줄 안다.
 *
 * 🔴 heic 가 아니면 `convert` 를 **한 번도 부르지 않는다.** 진짜 변환기는 그 안에서
 * 1.4MB 짜리 라이브러리를 받으므로, 여기서 함부로 부르면 heic 를 쓰지 않는 사람에게도
 * 그 짐이 간다. 🔴 **아이폰이 이미 jpg 로 바꿔 준 사진도 이 길로 그냥 지나간다** —
 * iOS 는 `accept` 에 heic 가 없으면 OS 가 알아서 JPEG 를 건네주는데(이름도 `.jpg` 가
 * 된다), 그 파일은 확장자도 MIME 도 jpeg 라 변환기를 거치지 않는다.
 *
 * 🔴 **한 장씩 차례로 바꾼다.** `Promise.all` 로 나란히 세우지 않는다 — 폰에서 큰
 * 사진 여러 장을 한꺼번에 디코딩하면 wasm 이 사진마다 화소 버퍼를 통째로 잡아 탭이
 * 그대로 죽는다. 현장에서 여러 장을 한 번에 고르는 것이 가장 흔한 쓰임이라 이 차이가
 * 드물게 나는 일이 아니다. 올리기 고리가 한 장씩 보내는 것과도 같은 줄이다.
 *
 * `onProgress` 는 **바꿀 것이 있을 때만** 울린다(몇 장 중 몇 장째). 폰에서 큰 사진은
 * 한 장에 몇 초가 걸려서, 아무 표시가 없으면 멈춘 줄 알고 다시 누른다.
 */
export async function convertPickedHeic(
  files: readonly File[],
  options: { convert: HeicToJpeg; onProgress?: (current: number, total: number) => void }
): Promise<HeicConversionOutcome> {
  const total = files.filter((file) => isHeicPick(file)).length;
  const outcome: HeicConversionOutcome = { files: [], renamed: [], failures: [] };
  if (total === 0) {
    outcome.files = [...files];
    return outcome;
  }

  let done = 0;
  for (const file of files) {
    if (!isHeicPick(file)) {
      // 🔴 같은 객체를 그대로 넘긴다 — 다시 만들면 바이트는 같아도 lastModified 가
      //    바뀌고, 무엇보다 「안 건드렸다」를 값으로 잴 수 없게 된다.
      outcome.files.push(file);
      continue;
    }

    done += 1;
    options.onProgress?.(done, total);
    try {
      const converted = await options.convert(file);
      const name = jpegNameForHeic(file.name);
      outcome.files.push(new File([converted], name, { type: "image/jpeg" }));
      outcome.renamed.push({ from: file.name, to: name });
    } catch {
      outcome.failures.push({ name: file.name, reason: HEIC_CONVERT_FAILED_REASON });
    }
  }
  return outcome;
}

/** 이름을 몇 쌍까지 적을지. 더 많으면 「외 N장」으로 줄인다. */
const NAMED_RENAME_LIMIT = 3;

/**
 * 🔴 **파일이 바뀌었다는 사실을 숨기지 않는다.**
 *
 * `IMG_1234.HEIC` 를 골랐는데 목록에는 `IMG_1234.jpg` 가 뜬다. 말하지 않으면 사람은
 * 자기가 올린 사진을 목록에서 못 찾거나, 다른 사람이 올린 것으로 읽는다.
 *
 * 🔴 저장 팝업에 싣지 않는다 — 그 팝업은 0.5초 뒤 저절로 닫히는 성공 전용이라 읽어야
 * 하는 문장을 담을 자리가 아니다(contact-folder-copy-notice.ts 와 같은 규율).
 * 화면에 남는 알림 칸으로 간다.
 */
export function heicConversionNotice(renamed: readonly HeicRename[]): string | null {
  if (renamed.length === 0) return null;
  const shown = renamed.slice(0, NAMED_RENAME_LIMIT).map((pair) => `${pair.from} → ${pair.to}`);
  const rest = renamed.length - shown.length;
  const names = rest > 0 ? `${shown.join(", ")} 외 ${rest}장` : shown.join(", ");
  return `아이폰 사진 ${renamed.length}장을 jpg 로 바꿔서 올렸습니다 — ${names}. 원본 heic 는 저장되지 않습니다.`;
}
