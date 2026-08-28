/**
 * 이 파일은 재수출만 한다 — 실제 구현은 `src/lib/xlsx/zip-reader.ts`에 있다.
 *
 * 원래 여기가 원본이었다. 견적서 생성(1단계)이 같은 리더를 **앱 런타임에서**
 * 쓰게 되면서 src 아래로 옮겼다. scripts/ 는 개발 도구 자리이고 앱이 그쪽을
 * 가져다 쓰면 빌드 경계가 흐려진다.
 *
 * 이 줄을 남겨 두는 이유는 workbook-loader.ts / repair-case-xlsx-safety.ts 의
 * `from "./zip-reader"` 를 건드리지 않기 위해서다. 두 파일이 붙어 있는
 * 테스트 8종이 그대로 통과해야 이번 이동이 무해했다고 말할 수 있다.
 */
export { ZipArchive, type ZipEntryMetadata } from "@/lib/xlsx/zip-reader";
