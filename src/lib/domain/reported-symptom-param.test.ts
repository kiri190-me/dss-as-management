import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_REPORTED_SYMPTOM_LENGTH,
  REPORTED_SYMPTOM_PARAM,
  reportedSymptomFromParam,
  reportedSymptomFromSearchParams,
  repairCasesReportedSymptomHref,
} from "./reported-symptom-param";

/**
 * ============================================================================
 * 주소가 나르는 신고 증상 — 믿지 않고 읽는다
 * ============================================================================
 * 신고 증상은 **자유 입력 칸**이다. 사람이 친 글자가 그대로 주소에 실리고,
 * 주소는 사람이 손으로 고칠 수 있는 자리다. 그래서 이 시험이 못 박는 것은
 * "되는가"보다 **"이상한 값이 와도 목록이 안 깨지는가"**다:
 *
 *   · 읽을 수 없으면 null 이고, 부르는 쪽은 그것을 **필터 없음**으로 다룬다.
 *     오류를 띄우지 않는다(workflow-publish-counts-param.ts 와 같은 판단).
 *   · **만드는 쪽과 읽는 쪽이 같은 문을 지난다.** 링크가 만들어졌는데 눌러
 *     보면 안 걸리는 어긋남이 생길 자리가 없어야 한다.
 * ============================================================================
 */

// ─────────────────────────────────────────────── 정상

describe("읽을 수 있는 값", () => {
  test("그대로 걸린다", () => {
    assert.equal(reportedSymptomFromParam("전원 인가 불가"), "전원 인가 불가");
  });

  test("앞뒤 공백은 걷어낸다 — 세는 쪽과 같은 규칙이라야 건수가 맞는다", () => {
    // fault-symptom-breakdown.ts 는 증상을 trim 한 글자로 묶는다. 여기서
    // 걷어내지 않으면 대시보드에서 5건이던 조각이 목록에서 0건이 된다.
    assert.equal(reportedSymptomFromParam("  전원 인가 불가  "), "전원 인가 불가");
  });

  test("가운데 공백·기호는 그대로 둔다 — 원문 표기가 곧 묶는 기준이다", () => {
    assert.equal(reportedSymptomFromParam("RF 출력 저하 (30% 이하)"), "RF 출력 저하 (30% 이하)");
    assert.equal(reportedSymptomFromParam("A & B 동시 불량"), "A & B 동시 불량");
  });

  test("딱 상한 길이까지는 받는다", () => {
    const atLimit = "증".repeat(MAX_REPORTED_SYMPTOM_LENGTH);
    assert.equal(reportedSymptomFromParam(atLimit), atLimit);
  });
});

// ─────────────────────────────────────────────── 🔴 이상한 값

describe("🔴 읽을 수 없는 값 — 필터를 걸지 않는다(오류가 아니다)", () => {
  test("없음", () => {
    assert.equal(reportedSymptomFromParam(undefined), null);
    assert.equal(reportedSymptomFromParam(null), null);
  });

  test("빈 값 · 공백뿐인 값", () => {
    assert.equal(reportedSymptomFromParam(""), null);
    assert.equal(reportedSymptomFromParam("   "), null);
    assert.equal(reportedSymptomFromParam("\t "), null);
  });

  test("같은 이름이 두 번 온 경우(배열) — 어느 쪽을 고르든 근거가 없다", () => {
    assert.equal(reportedSymptomFromParam(["전원 인가 불가", "소음"]), null);
    // 하나뿐이어도 배열이면 버린다 — "배열로 왔다"는 사실 자체가 우리가 만든
    // 링크가 아니라는 뜻이다.
    assert.equal(reportedSymptomFromParam(["전원 인가 불가"]), null);
  });

  test("아주 긴 값 — 상한을 한 글자 넘기면 버린다", () => {
    const tooLong = "증".repeat(MAX_REPORTED_SYMPTOM_LENGTH + 1);
    assert.equal(reportedSymptomFromParam(tooLong), null);
    // 공백을 걷어낸 **뒤**의 길이로 잰다 — 공백으로 부풀린 값이 통과하지 않는다.
    assert.equal(reportedSymptomFromParam(`  ${"증".repeat(MAX_REPORTED_SYMPTOM_LENGTH)}  `)?.length, MAX_REPORTED_SYMPTOM_LENGTH);
  });

  test("제어 문자가 섞인 값 — 줄바꿈·탭·NUL", () => {
    assert.equal(reportedSymptomFromParam("전원 인가 불가\n두 번째 줄"), null);
    assert.equal(reportedSymptomFromParam("전원\t인가 불가"), null);
    assert.equal(reportedSymptomFromParam(`전원${String.fromCharCode(0)}불가`), null);
    assert.equal(reportedSymptomFromParam(`전원${String.fromCharCode(127)}불가`), null);
  });

  test("주소창에 아무 글자나 쳐 넣어도 그냥 걸리거나 그냥 안 걸릴 뿐이다", () => {
    // 던지지 않는다는 것이 이 시험의 요점이다 — 이상한 값에 예외를 던지면
    // 목록 화면이 통째로 뜨지 않는다.
    for (const weird of ["%%%", "<script>", "../../etc/passwd", "0", "null", "undefined"]) {
      assert.doesNotThrow(() => reportedSymptomFromParam(weird));
    }
    // 위 값들은 "이상한 글자"가 아니라 그냥 짧은 글자다 — 그런 증상으로 걸러
    // 봐야 0건일 뿐, 화면이 깨지지 않는다.
    assert.equal(reportedSymptomFromParam("<script>"), "<script>");
  });
});

// ─────────────────────────────── URLSearchParams 에서 읽는 자리

describe("URLSearchParams 에서 읽기", () => {
  const read = (search: string) => reportedSymptomFromSearchParams(new URLSearchParams(search));

  test("이름이 한 번 오면 읽는다", () => {
    assert.equal(read("?reportedSymptom=%EC%86%8C%EC%9D%8C"), "소음");
  });

  test("이름이 아예 없으면 null", () => {
    assert.equal(read("?status=RECEIVED"), null);
  });

  test("🔴 이름이 두 번 오면 null — get 은 조용히 첫 값을 준다", () => {
    assert.equal(read("?reportedSymptom=소음&reportedSymptom=과열"), null);
  });

  test("이름은 이 파일 하나가 갖는다", () => {
    assert.equal(REPORTED_SYMPTOM_PARAM, "reportedSymptom");
  });
});

// ─────────────────────────────── 🔴 링크를 짓는 쪽

describe("🔴 누르면 가는 주소", () => {
  test("수리 건 목록으로 가고, 증상이 인코딩되어 실린다", () => {
    const href = repairCasesReportedSymptomHref("전원 인가 불가");
    assert.equal(href, "/repair-cases?reportedSymptom=%EC%A0%84%EC%9B%90+%EC%9D%B8%EA%B0%80+%EB%B6%88%EA%B0%80");
  });

  test("🔴 주소를 다시 읽으면 원래 글자가 나온다 — 인코딩이 한 바퀴 돈다", () => {
    // 주소에서 뜻이 있는 글자(`&` `?` `#` `%` `+` 공백)가 들어 있어도 그대로
    // 돌아와야 한다. 여기가 깨지면 링크는 멀쩡해 보이는데 목록이 0건이 된다.
    for (const symptom of [
      "전원 인가 불가",
      "A & B 동시 불량",
      "출력 저하 (30% 이하)",
      "1+1 증상",
      "해시#기호",
      "물음표?포함",
      "슬래시/포함",
    ]) {
      const href = repairCasesReportedSymptomHref(symptom);
      assert.ok(href, symptom);
      const parsed = new URL(href, "http://example.test");
      assert.equal(parsed.pathname, "/repair-cases", symptom);
      assert.equal(reportedSymptomFromSearchParams(parsed.searchParams), symptom, symptom);
    }
  });

  test("🔴 실을 수 없는 값이면 주소를 만들지 않는다 — 링크와 판정이 같은 문이다", () => {
    // 만드는 쪽이 더 너그러우면 "눌러도 아무 일이 없는 링크"가 생긴다. 화면은
    // null 을 받아 그 줄을 누를 수 없는 글자로 두고 까닭을 한 줄 적는다.
    assert.equal(repairCasesReportedSymptomHref(""), null);
    assert.equal(repairCasesReportedSymptomHref("   "), null);
    assert.equal(repairCasesReportedSymptomHref(null), null);
    assert.equal(repairCasesReportedSymptomHref(undefined), null);
    assert.equal(repairCasesReportedSymptomHref("여러 줄\n증상"), null);
    assert.equal(repairCasesReportedSymptomHref("증".repeat(MAX_REPORTED_SYMPTOM_LENGTH + 1)), null);
  });

  test("주소에 실리는 값은 공백을 걷어낸 뒤의 글자다", () => {
    assert.equal(
      repairCasesReportedSymptomHref("  소음  "),
      repairCasesReportedSymptomHref("소음")
    );
  });
});
