import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { averagePerImageBytes } from "../../../lib/domain/image-shrink";

/**
 * ============================================================================
 * 「줄여서 내려받기」의 숫자는 **한 장 기준으로 읽혀야 한다**(2026-09-29)
 * ============================================================================
 * 이 시험이 지키는 것은 계산이 아니라 **읽히는 방식**이다. 줄이는 계산은 처음부터
 * 옳았다 — resolveTargetBytes(target, item.fileSize) 가 사진마다 따로 잰다. 그런데
 * 화면에 뜨는 숫자가 전부 합계였다: "한 장당 500KB"로 정하고 3장을 고르면 예상이
 * 1.46MB 로 떠서 "아 총합 기준이구나"로 읽힌다(실제로는 500KB×3 이다). 사용자가
 * "총합 기준을 한 장 기준으로 바꿔 달라"고 한 것이 이 오해였다.
 *
 * 그래서 네 자리를 **한 장 기준을 앞에, 합계를 뒤에**로 바꿨다.
 *
 * 🔴 **합계를 지우지는 않는다.** 메일에 붙일 때 전체가 얼마인지도 필요하다. 이
 * 시험이 순서만이 아니라 "합계가 아직 있는가"를 함께 보는 까닭이다 — 다음 사람이
 * "한 장 기준으로"를 읽고 합계를 걷어내면 다른 쪽이 망가진다.
 *
 * 🔴 **비율과 목표 용량은 서로 다른 말을 해야 한다.** 비율은 "한 장당 원본의
 * 50%"이고 목표 용량은 "한 장당 500.0 KB 이하"다. 한 문장으로 뭉뚱그리면 50%가
 * 합계의 절반인지 장마다 절반인지 다시 알 수 없어진다.
 *
 * 🔴 **나누기는 화면이 하지 않는다.** 자리마다 "0장인가"를 붙이면 한 곳이 반드시
 * 빠지고, 빠진 자리에는 NaN 이 뜬다. 그 판단은 averagePerImageBytes 한 곳이 갖는다.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * ShrinkDownloadDialog 는 캔버스·Blob·내려받기에 묶인 클라이언트 컴포넌트라
 * 인자만으로 "고른 사진이 실린 화면"을 만들 수 없다. 보려는 것이 글자의 순서이므로
 * 같은 폴더의 이웃(preview-object-fit.test.ts)과 같은 방법으로 원본을 읽는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");
/**
 * 주석을 지운다. 이 화면은 "한 장당"이 왜 필요한지를 **주석에도** 길게 적어 두므로,
 * 글자를 그냥 세면 주석 한 줄에 시험이 거짓으로 통과한다.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const dialog = read("src/components/repair-cases/files/ShrinkDownloadDialog.tsx");
const domain = read("src/lib/domain/image-shrink.ts");
const screen = flat(code(dialog));

describe("🔴 네 자리가 한 장 기준을 앞에 세운다", () => {
  test("머리말 — 원본 한 장 평균이 먼저고 합계는 괄호 안이다", () => {
    assert.ok(
      screen.includes(
        "사진 {items.length}장 · 원본 한 장 평균 {formatBytes(originalAverage)} (합계"
      ),
      "합계만 보여 주면 「한 장당 500KB」로 정해도 총합 기준으로 읽힌다"
    );
  });

  test("예상 — 한 장당 목표가 먼저고 장수·합계가 뒤다", () => {
    assert.ok(
      screen.includes("한 장당 <strong>{perImageTarget}</strong>"),
      "이 줄의 앞머리는 「한 장에 무엇을 하는지」여야 한다"
    );
    assert.ok(
      screen.includes("· 예상 {items.length}장 합계 {formatBytes(estimated ?? 0)} (원본 합계"),
      "장수를 함께 적지 않으면 합계가 왜 그 값인지 알 수 없다"
    );
  });

  test("비율 모드 — 「장마다 적용된다」를 화면이 밝힌다", () => {
    assert.ok(
      screen.includes(
        "사진 <strong>한 장마다</strong> 원본의 이 비율로 줄입니다 — 합계를 나누는 것이 아닙니다."
      ),
      "🔴 목표 용량 쪽에는 입력칸 앞뒤에 「한 장당 … 이하」가 있지만 비율에는 그 말이 붙을 자리가 없다"
    );
  });

  test("결과 — 실제 한 장 평균이 먼저고 합계는 괄호 안이다", () => {
    assert.ok(
      screen.includes("{outcome.savedCount}장을 받았습니다 · 실제 한 장 평균"),
      "받고 난 뒤의 숫자도 같은 순서로 읽혀야 한다"
    );
    assert.ok(
      screen.includes(
        "{formatBytes(averagePerImageBytes(outcome.totalBytes, outcome.savedCount))}"
      ),
      "실제 평균은 받은 장수로 낸다 — 고른 장수가 아니다(중간에 실패하면 다르다)"
    );
    assert.ok(
      screen.includes("(합계 {formatBytes(outcome.totalBytes)})"),
      "실제 합계가 사라지면 메일에 붙일 때 전체를 알 수 없다"
    );
  });
});

describe("🔴 합계를 없애지 않았다", () => {
  test("원본 합계가 머리말과 예상 두 자리에 남아 있다", () => {
    assert.equal(
      code(dialog).match(/formatBytes\(originalTotal\)/g)?.length ?? 0,
      2,
      "🔴 「한 장 기준으로」를 읽고 합계를 걷어내면 메일에 붙일 전체 용량을 알 수 없다"
    );
  });

  test("예상 합계와 실제 합계가 그대로 있다", () => {
    assert.ok(screen.includes("{formatBytes(estimated ?? 0)}"), "예상 합계");
    assert.ok(screen.includes("{formatBytes(outcome.totalBytes)}"), "실제 합계");
  });

  test("옛 「예상 용량 …」 한 덩어리 표기로 되돌아가지 않았다", () => {
    assert.ok(
      !screen.includes("예상 용량 <strong>{formatBytes(estimated ?? 0)}</strong>"),
      "그 표기가 총합 기준으로 읽히는 원인이었다"
    );
  });
});

describe("🔴 비율과 목표 용량이 서로 다른 말을 한다", () => {
  test("비율은 「원본의 n%」다", () => {
    assert.ok(
      screen.includes("? `원본의 ${Math.round(target.ratio * 100)}%`"),
      "비율은 원본 대비라는 것이 글자에 남아야 한다"
    );
  });

  test("목표 용량은 「n KB 이하」다", () => {
    assert.ok(
      screen.includes(": `${formatBytes(target.bytes)} 이하`"),
      "🔴 목표 용량은 상한이다 — 「이하」가 빠지면 정확히 그 크기로 나오는 것처럼 읽힌다"
    );
  });

  test("「이하」는 목표 용량 쪽에만 붙는다", () => {
    assert.ok(
      !screen.includes("${Math.round(target.ratio * 100)}% 이하"),
      "비율에 「이하」를 붙이면 50%가 상한인지 목표인지 다시 흐려진다"
    );
  });

  test("두 갈래가 한 문장으로 합쳐지지 않았다", () => {
    assert.ok(
      screen.includes('target.kind === "ratio"') &&
        screen.includes("const perImageTarget ="),
      "한 문장으로 뭉뚱그리면 「50%가 합계의 절반인가」라는 오해가 그대로 돌아온다"
    );
  });
});

describe("🔴 나누기는 화면이 하지 않는다", () => {
  test("한 장 평균은 세 자리 모두 averagePerImageBytes 를 부른다", () => {
    // 🔴 2026-10-05(조각 12) — 자리가 둘에서 **셋**이 되었다. [DATA에 저장]이 「줄인 결과」
    //    한 줄을 더 내기 때문이고(받은 것과 보낸 것은 다른 일이라 줄을 나눴다), 그 줄도
    //    나누기를 화면에서 하지 않는다. 🔴 느슨해진 것이 없다 — 아래 「직접 나누는 곳이
    //    없다」가 그대로이고, 숫자가 늘면 여기서 다시 멈춘다.
    assert.equal(
      code(dialog).match(/averagePerImageBytes\(/g)?.length ?? 0,
      3,
      "머리말(원본 평균) · 내려받은 결과 · DATA 로 보낸 결과 세 자리다"
    );
  });

  test("화면 원본에 장수로 직접 나누는 곳이 없다", () => {
    assert.ok(
      !/\/\s*(items\.length|originalSizes\.length|outcome\.savedCount|savedCount)/.test(
        code(dialog)
      ),
      "🔴 자리마다 「0장인가」를 붙이면 한 곳이 반드시 빠지고, 빠진 자리에는 NaN 이 뜬다"
    );
  });

  test("0장을 막는 일은 함수가 한다 — 그래서 화면이 안 막아도 된다", () => {
    assert.equal(averagePerImageBytes(1234, 0), 0);
    assert.equal(averagePerImageBytes(0, 0), 0);
  });

  test("그 함수는 계산 쪽 파일에 있다", () => {
    assert.ok(
      domain.includes("export function averagePerImageBytes("),
      "화면이 아니라 src/lib/domain/image-shrink.ts 가 갖는다 — 시험할 수 있는 자리다"
    );
  });
});

describe("🔴 줄이는 계산은 건드리지 않았다", () => {
  test("목표는 여전히 사진마다 따로 잰다", () => {
    assert.ok(
      screen.includes("const targetBytes = resolveTargetBytes(target, item.fileSize);"),
      "🔴 이 줄이 「한 장 기준」의 본체다 — 표시를 고치다 여기를 건드리면 결과가 달라진다"
    );
  });

  test("예상은 여전히 장별 목표의 합이다", () => {
    assert.ok(
      screen.includes("const estimated = target ? estimateTotalBytes(target, originalSizes) : null;"),
      "합계를 장수로 나눠 목표를 내는 식으로 바뀌면 안 된다"
    );
  });
});
