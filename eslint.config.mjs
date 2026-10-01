import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 별도 저장소(git submodule)다. 그쪽은 제 eslint 설정으로 스스로 검사한다 —
    // 여기서 또 보면 이 저장소의 규칙으로 남의 코드를 고치게 된다.
    "vendor/dss-ui/**",
    "vendor/dss-core/**",
    // 남이 만든 글자 인식 라이브러리(tesseract.js)다 — 압축된 배포본이라
    // 우리가 고칠 코드가 아니다. 여기서 고쳐 봐야 다음에 새 판으로 바꿀 때
    // 그대로 덮어쓰인다. 2026-10-01 통문증 글자 인식을 넣으며 들어왔다.
    "public/ocr/**",
  ]),
]);

export default eslintConfig;
