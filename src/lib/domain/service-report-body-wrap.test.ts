import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  SERVICE_REPORT_BODY_COLUMN_WIDTH,
  SERVICE_REPORT_BODY_LABEL_COLUMN_WIDTH,
  SERVICE_REPORT_BODY_LABEL_WIDTH,
  SERVICE_REPORT_BODY_LABELS,
  SERVICE_REPORT_BODY_WRAP_WIDTH,
  SERVICE_REPORT_CLOSING_GAP_ROWS,
  SERVICE_REPORT_CLOSING_MARK,
  SERVICE_REPORT_REMARK_COLUMN_WIDTH,
  SERVICE_REPORT_REMARK_WRAP_WIDTH,
  SERVICE_REPORT_SECTION_GAP_ROWS,
  contentWrapWidth,
  serviceReportBodyPreviewRows,
  serviceReportBodyPreviewSections,
  serviceReportColumnWidthPx,
  serviceReportFindingsLines,
  serviceReportRemarkPreviewLines,
  serviceReportSectionRowCount,
  splitBodyLine,
} from "./service-report-body-wrap";
import { textDisplayWidth } from "./text-wrap";

/**
 * ============================================================================
 * 본문이 문서에서 어디서 나뉘는가 — 화면과 채우개가 **함께 쓰는** 셈 (2026-10-18)
 * ============================================================================
 * 여기서 보는 것은 **값**이다. 「채우개가 실제로 찍은 글자와 같은가」는 양식
 * 파일이 있어야 볼 수 있어서 `xlsx/service-report-template.test.ts` 가 본다
 * (`🔴 미리보기와 문서가 같게 나뉜다` 묶음) — 그 시험이 이 조각의 울타리이고,
 * 이 파일은 그 울타리 **안쪽의 규칙**을 하나씩 못 박는다.
 * ============================================================================
 */

describe("🔴 이 파일은 순수 계산이다 — 화면도 서버도 부를 수 있어야 한다", () => {
  test("server-only · node · React · 브라우저의 물건을 물지 않는다", () => {
    const source = readFileSync(new URL("./service-report-body-wrap.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(imports, ["@/lib/kyosan/report-terms", "./text-wrap"]);
    for (const forbidden of ["server-only", "node:", "react", "window", "document"]) {
      assert.ok(
        !imports.some((name) => name.includes(forbidden)),
        `순수하지 않은 import 가 들어왔다: ${forbidden}`
      );
    }
  });
});

describe("열 너비 → 줄 폭 환산", () => {
  test("🔴 2026-10-15 실측값 그대로다 — 채우개에서 자리만 옮겼다", () => {
    //   본문 H:AU  75칸      × 8px = 600px → ⌊(600−5−7)÷7⌋ = 84칸(한글 42자)
    //   비고 H:AF  46.875칸  × 8px = 375px → ⌊(375−5−7)÷7⌋ = 51칸(한글 25자)
    assert.equal(contentWrapWidth(75), 84);
    assert.equal(contentWrapWidth(46.875), 51);
    assert.equal(contentWrapWidth(150), 169);
  });

  test("칸이 말이 안 되게 좁으면 던진다", () => {
    assert.throws(() => contentWrapWidth(1), /본문 칸이 너무 좁습니다/);
  });

  test("🔴 화면이 들고 있는 양식 폭에서 그 값이 나온다", () => {
    // 양식이 바뀌면 이 상수가 어긋나는데, 그것은 실제 양식을 여는 쪽이 잡는다
    // (`xlsx/service-report-template.test.ts` 의 「양식의 칸 폭이 …」).
    assert.equal(SERVICE_REPORT_BODY_COLUMN_WIDTH, 40 * 1.875); // H~AU
    assert.equal(SERVICE_REPORT_REMARK_COLUMN_WIDTH, 25 * 1.875); // H~AF
    assert.equal(SERVICE_REPORT_BODY_WRAP_WIDTH, contentWrapWidth(SERVICE_REPORT_BODY_COLUMN_WIDTH));
    assert.equal(
      SERVICE_REPORT_REMARK_WRAP_WIDTH,
      contentWrapWidth(SERVICE_REPORT_REMARK_COLUMN_WIDTH)
    );
    assert.ok(
      SERVICE_REPORT_REMARK_WRAP_WIDTH < SERVICE_REPORT_BODY_WRAP_WIDTH,
      "비고가 본문보다 좁지 않다"
    );
  });
});

describe("한 줄을 칸 폭에 맞춰 나눈다", () => {
  test("🔴 줄 안의 줄바꿈을 먼저 가른다 — 공백처럼 다루면 두 줄이 한 줄로 붙는다", () => {
    assert.deepEqual(splitBodyLine("가\n나\r\n다", 84), ["가", "나", "다"]);
  });

  test("폭을 넘으면 낱말을 자르지 않고 넘긴다", () => {
    const line = `${"가".repeat(40)} ${"나".repeat(10)}`;
    const split = splitBodyLine(line, 84);
    assert.equal(split.length, 2);
    for (const piece of split) assert.ok(textDisplayWidth(piece) <= 84, piece);
    assert.equal(split.join("").replace(/\s/gu, ""), line.replace(/\s/gu, ""));
  });

  test("빈 줄은 빈 줄로 남는다", () => {
    assert.deepEqual(splitBodyLine("", 84), [""]);
  });
});

describe("확인내용 첫 줄의 정형 문구", () => {
  test("내용이 비면 정형 문구만 남지 않는다 — 구역이 통째로 빈다", () => {
    assert.deepEqual(serviceReportFindingsLines([], "인수품에 대하여"), []);
  });

  test("문구를 비우면 본문만 들어간다", () => {
    assert.deepEqual(serviceReportFindingsLines(["외관 확인"], ""), ["외관 확인"]);
  });

  test("문구가 있으면 **첫 줄**이다", () => {
    assert.deepEqual(serviceReportFindingsLines(["외관 확인"], "머리글"), ["머리글", "외관 확인"]);
  });
});

describe("미리보기가 그리는 본문 구역", () => {
  const body = {
    findingsIntro: "인수품에 대하여 이하의 항목을 확인하였습니다.",
    findings: ["외관 손상 없음"],
    actions: ["퓨즈 교체"],
    summary: ["정상 동작을 확인하였습니다."],
  };

  test("세 구역이 차례대로, 정형 문구는 확인내용의 첫 줄로", () => {
    assert.deepEqual(serviceReportBodyPreviewSections(body), [
      {
        title: "확인내용",
        labelLines: SERVICE_REPORT_BODY_LABELS.findings,
        lines: ["인수품에 대하여 이하의 항목을 확인하였습니다.", "외관 손상 없음"],
      },
      {
        title: "조치",
        labelLines: SERVICE_REPORT_BODY_LABELS.actions,
        lines: ["퓨즈 교체"],
      },
      {
        title: "정리",
        labelLines: SERVICE_REPORT_BODY_LABELS.summary,
        lines: ["정상 동작을 확인하였습니다."],
      },
    ]);
  });

  test("🔴 라벨은 **문서의 글자** 그대로다 — 화면이 지어내지 않았다", () => {
    const sections = serviceReportBodyPreviewSections(body);
    assert.deepEqual(
      sections.map((section) => section.labelLines),
      [
        SERVICE_REPORT_BODY_LABELS.findings,
        SERVICE_REPORT_BODY_LABELS.actions,
        SERVICE_REPORT_BODY_LABELS.summary,
      ]
    );
    // 🔴 같은 글자를 두 번 적지 않았다 — **같은 물건**이어야 한다.
    assert.equal(sections[0].labelLines, SERVICE_REPORT_BODY_LABELS.findings);
  });

  test("🔴 줄이 한 줄도 없는 구역은 통째로 빠진다 — 채우개도 그렇다", () => {
    const sections = serviceReportBodyPreviewSections({ ...body, findings: [], summary: [] });
    assert.deepEqual(
      sections.map((section) => section.title),
      ["조치"]
    );
  });

  test("🔴 폭을 넘는 줄은 나뉘어 **여러 칸**이 된다", () => {
    const long = `${"가".repeat(60)} ${"나".repeat(20)}`;
    const sections = serviceReportBodyPreviewSections({ ...body, findings: [long] });
    const lines = sections[0].lines;
    assert.ok(lines.length > 2, `나뉘지 않았다: ${lines.length}줄`);
    for (const line of lines) {
      assert.ok(textDisplayWidth(line) <= SERVICE_REPORT_BODY_WRAP_WIDTH, line);
    }
  });

  test("🔴 연락서 낱말은 문서에 찍히는 한글로 바뀐 뒤에 나뉜다", () => {
    const sections = serviceReportBodyPreviewSections({
      ...body,
      findingsIntro: "",
      findings: ["部品不良"],
    });
    assert.deepEqual(sections[0].lines, ["부품불량"]);
  });

  test("폭을 좁게 주면 그 폭으로 나눈다 — 폭이 붙박이가 아니다", () => {
    const sections = serviceReportBodyPreviewSections(
      { ...body, findingsIntro: "", findings: ["가나다 라마바"] },
      6
    );
    assert.deepEqual(sections[0].lines, ["가나다", "라마바"]);
  });
});

describe("미리보기가 그리는 비고", () => {
  test("🔴 나누지 않는다 — 채우개가 비고를 나누지 않기 때문이다", () => {
    const long = "가".repeat(40); // 80칸 — 비고 51칸을 한참 넘는다
    const lines = serviceReportRemarkPreviewLines([long]);
    assert.deepEqual(
      lines.map((line) => line.text),
      [long]
    );
  });

  test("칸보다 긴 줄에 표시가 붙는다", () => {
    const lines = serviceReportRemarkPreviewLines([
      "보증 기간 밖입니다.",
      "가".repeat(26), // 52칸 — 51칸을 한 칸 넘는다
      "가".repeat(25), // 50칸 — 들어간다
    ]);
    assert.deepEqual(
      lines.map((line) => line.overflows),
      [false, true, false]
    );
  });

  test("연락서 낱말은 여기서도 문서에 찍히는 글자로 바뀐다", () => {
    assert.deepEqual(serviceReportRemarkPreviewLines(["部品不良"]), [
      { text: "부품불량", overflows: false },
    ]);
  });
});

/**
 * ============================================================================
 * 🔴 문서의 **모양** — 미리보기가 「최종 결과물처럼」 보이는 데 쓰는 것들
 * ============================================================================
 * 라벨·맺음 표시·여백은 2026-10-18 둘째 조각에서 채우개에서 여기로 **옮겨 온**
 * 것이다. 글자가 양식의 것과 같은지(전각 공백까지)는 채우개 쪽 시험이 코드
 * 포인트로 못 박고 있고(`xlsx/service-report-template.test.ts`), 그 시험은 이제
 * **여기 있는 값**을 다시 내보낸 것으로 본다 — 두 벌이 아니다.
 * ============================================================================
 */
describe("라벨 열의 폭", () => {
  test("🔴 라벨 글자에서 잰다 — 넷 다 6칸이다", () => {
    const widths = Object.values(SERVICE_REPORT_BODY_LABELS)
      .flat()
      .map((line) => textDisplayWidth(line));
    assert.deepEqual(widths, [6, 6, 6, 6]);
    assert.equal(SERVICE_REPORT_BODY_LABEL_WIDTH, Math.max(...widths));
    assert.equal(SERVICE_REPORT_BODY_LABEL_WIDTH, 6);
  });

  /**
   * 🔴 **라벨 글자의 폭과 라벨 칸의 폭은 다르다.** 위의 6칸은 「글자가 몇 칸을
   * 먹는가」이고, 아래 8.75 는 「양식이 그 칸에 준 열 너비」다(`C`~`G`). 미리보기가
   * 문서와 같은 모양으로 보이려면 **칸 쪽**을 써야 한다 — 글자 폭으로 그리면
   * 라벨 칸이 문서보다 좁아져 본문 상자가 통째로 왼쪽으로 밀린다.
   */
  test("🔴 라벨 **칸**의 열 너비는 따로다 — `C`~`G` 5열 × 1.75", () => {
    assert.equal(SERVICE_REPORT_BODY_LABEL_COLUMN_WIDTH, 5 * 1.75);
    // 본문 열(1.875)과 한 열의 너비가 다르다 — 같은 곱을 쓰면 틀린다.
    assert.notEqual(SERVICE_REPORT_BODY_LABEL_COLUMN_WIDTH, 5 * 1.875);
  });
});

describe("열 너비 → 화면 픽셀", () => {
  test("🔴 열 너비 한 칸 = 기본 글꼴의 숫자 한 자 = 8px (96dpi 라 CSS 픽셀과 1:1)", () => {
    assert.equal(serviceReportColumnWidthPx(SERVICE_REPORT_BODY_COLUMN_WIDTH), 600);
    assert.equal(serviceReportColumnWidthPx(SERVICE_REPORT_REMARK_COLUMN_WIDTH), 375);
    assert.equal(serviceReportColumnWidthPx(SERVICE_REPORT_BODY_LABEL_COLUMN_WIDTH), 70);
  });

  test("🔴 이 픽셀이 줄 폭 환산의 **앞 절반**과 같은 값이다 — 두 벌이 아니다", () => {
    // `contentWrapWidth` 는 ⌊(열 너비 × 8 − 5 − 7) ÷ 7⌋ 이다. 그 «열 너비 × 8» 이
    // 여기서 돌려주는 픽셀이고, 그래서 미리보기 상자 안에서 줄이 먼저 끊긴다.
    for (const columnWidth of [75, 46.875, 8.75, 150]) {
      assert.equal(
        contentWrapWidth(columnWidth),
        Math.floor((serviceReportColumnWidthPx(columnWidth) - 5 - 7) / 7)
      );
    }
  });
});

describe("구역이 먹는 줄 수", () => {
  test("🔴 라벨이 내용보다 길면 라벨 쪽이 이긴다 — 반쪽 라벨이 안 나게", () => {
    assert.equal(serviceReportSectionRowCount(1, 2), 2);
    assert.equal(serviceReportSectionRowCount(5, 2), 5);
    assert.equal(serviceReportSectionRowCount(1, 1), 1);
  });

  test("줄이 없는 구역은 0 — 라벨만으로는 자리를 먹지 않는다", () => {
    assert.equal(serviceReportSectionRowCount(0, 2), 0);
  });
});

describe("문서의 줄 차례로 편 미리보기", () => {
  const sections = serviceReportBodyPreviewSections({
    findingsIntro: "인수품에 대하여 이하의 항목을 확인하였습니다.",
    findings: ["외관 손상 없음"],
    actions: ["퓨즈 교체"],
    summary: ["정상 동작을 확인하였습니다."],
  });

  test("🔴 라벨·구역 사이 빈 줄·맺음 표시가 채우개와 같은 자리에 선다", () => {
    assert.equal(SERVICE_REPORT_SECTION_GAP_ROWS, 1);
    assert.equal(SERVICE_REPORT_CLOSING_GAP_ROWS, 1);
    assert.deepEqual(serviceReportBodyPreviewRows(sections), [
      { label: "확　내", text: "인수품에 대하여 이하의 항목을 확인하였습니다.", closing: false },
      { label: "인　용", text: "외관 손상 없음", closing: false },
      { label: "", text: "", closing: false },
      { label: "조  치", text: "퓨즈 교체", closing: false },
      { label: "", text: "", closing: false },
      { label: "정  리", text: "정상 동작을 확인하였습니다.", closing: false },
      { label: "", text: "", closing: false },
      { label: "", text: SERVICE_REPORT_CLOSING_MARK, closing: true },
    ]);
  });

  test("🔴 맺음 표시 글자를 지어내지 않았다 — 상수 그대로다", () => {
    const rows = serviceReportBodyPreviewRows(sections);
    const closing = rows.filter((row) => row.closing);
    assert.equal(closing.length, 1);
    assert.equal(closing[0].text, SERVICE_REPORT_CLOSING_MARK);
    // 🔴 전각 물결표·전각 공백이다. 보통 글자로 베껴 적으면 여기서 깨진다.
    assert.deepEqual(
      [...SERVICE_REPORT_CLOSING_MARK].map((char) => char.codePointAt(0)?.toString(16)),
      ["ff5e", "c774", "3000", "c0c1", "ff5e"]
    );
  });

  test("🔴 확인내용이 한 줄뿐이어도 라벨 두 줄이 온전하다 — 문서에서도 두 줄이다", () => {
    const one = serviceReportBodyPreviewSections({
      findingsIntro: "",
      findings: ["외관 손상 없음"],
      actions: [],
      summary: [],
    });
    assert.deepEqual(serviceReportBodyPreviewRows(one), [
      { label: "확　내", text: "외관 손상 없음", closing: false },
      { label: "인　용", text: "", closing: false },
      { label: "", text: "", closing: false },
      { label: "", text: SERVICE_REPORT_CLOSING_MARK, closing: true },
    ]);
  });

  test("🔴 아무것도 안 적었으면 맺음 표시도 안 그린다", () => {
    assert.deepEqual(serviceReportBodyPreviewRows([]), []);
  });
});
