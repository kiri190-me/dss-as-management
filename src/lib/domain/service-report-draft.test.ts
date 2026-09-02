import assert from "node:assert/strict";
import { test } from "node:test";

import { SERVICE_REPORT_CAUSES } from "@/lib/xlsx/service-report-template";

import {
  SERVICE_REPORT_DRAFT_SAVE_DEBOUNCE_MS,
  clearServiceReportDraft,
  formatServiceReportDraftSavedAt,
  legacyServiceReportDraftStorageKey,
  readServiceReportDraft,
  serviceReportDraftStorageKey,
  serviceReportDraftStorageKeys,
  writeServiceReportDraft,
  type ServiceReportDraftStore,
} from "./service-report-draft";
import {
  createServiceReportFormValues,
  type ServiceReportFormValues,
} from "./service-report-form";

/**
 * ============================================================================
 * 이 파일이 지키려는 것
 * ============================================================================
 * 1. **적던 내용이 새로고침에 날아가지 않는다.** 적었다가 읽으면 같은 값이 나온다.
 * 2. **저장소가 막혀 있어도 화면이 죽지 않는다.** 사생활 보호 창에서는
 *    `localStorage` 를 읽는 것만으로 던진다 — 그때 여기서 던지면 임시보관 하나
 *    때문에 보고서 화면 전체를 못 쓰게 된다(커밋 8454a2a 가 목록 화면에서 겪은 일).
 * 3. 🔴 **적혀 있던 것이 그대로 화면 상태가 되지 않는다.** 특히 **칸이 빠진 옛
 *    임시보관**에서 `undefined` 가 나오면 그 입력 칸이 통제 불능이 되어 React 가
 *    경고를 뱉고 값이 사라진다.
 * 4. **사람이 다르면, 접수 건이 다르면, 보고서 장이 다르면 섞이지 않는다.** 공용
 *    PC 를 여럿이 쓰고, 한 사람이 탭을 여럿 띄워 두며, 한 접수 건에 검사 한 장 +
 *    수리 한 장이 함께 붙는다.
 * 5. 🔴 **옛 열쇠로 적어 둔 것을 말없이 버리지 않는다.** 보고서가 한 장뿐이던
 *    때의 임시보관이 실제 브라우저에 남아 있다 — 새 장을 열 때 그것을 함께
 *    본다. 다만 **저장된 장에는 붓지 않는다**(남의 보고서를 덮는 길이다).
 *
 * 인정할 원인 코드는 `SERVICE_REPORT_CAUSES` 에서 가져온다 — 목록을 여기 베끼면
 * 양식에 원인이 하나 늘어난 날 이 시험만 통과한다.
 * ============================================================================
 */

const CAUSE_CODES: readonly string[] = SERVICE_REPORT_CAUSES;

/** 「아직 저장하지 않은 새 장」의 열쇠 — 지금까지의 시험이 다루던 자리다. */
const KEY = serviceReportDraftStorageKey("user-1", "case-1", null);

/** 저장된 장 하나의 열쇠. */
const SAVED_KEY = serviceReportDraftStorageKey("user-1", "case-1", "report-1");

/** 보고서가 한 장뿐이던 때의 열쇠. */
const LEGACY_KEY = legacyServiceReportDraftStorageKey("user-1", "case-1");

/** 화면이 처음 열릴 때 만드는 자동 채움 값 — 되살리기의 기준선이다. */
function autofilled(): ServiceReportFormValues {
  return createServiceReportFormValues({
    today: "2026-09-02",
    findingsIntro: "아래와 같이 확인하였습니다.",
    // 이 시험은 「되살리기」를 본다 — 미리 채우는 문구는 form 시험이 본다.
    actionsIntro: { INSPECTION: "", REPAIR: "" },
    summaryIntro: "",
    productNames: ["13.56MHz 30kW"],
    repairCase: {
      customerName: "OO전자",
      modelName: "RFK300FH-AD1",
      lotNumber: "L-1",
      serialNumber: "1502021",
      receivedAt: "2024-03-21",
      productCategory: "RF Generator",
      reportedSymptom: "출력이 나오지 않음",
    },
  });
}

/** 멀쩡한 저장소. */
function healthyStore(): ServiceReportDraftStore & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

/** 손대는 것만으로 던지는 저장소(사생활 보호 창, 「사이트 데이터 차단」). */
const throwingStore: ServiceReportDraftStore = {
  getItem: () => {
    throw new Error("SecurityError: 저장소를 읽을 수 없습니다");
  },
  setItem: () => {
    throw new Error("SecurityError: 저장소에 적을 수 없습니다");
  },
  removeItem: () => {
    throw new Error("SecurityError: 저장소를 지울 수 없습니다");
  },
};

/** 읽기는 되는데 적을 때만 던지는 저장소(저장 공간이 꽉 참). */
function writeThrowsStore(): ServiceReportDraftStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

/** 저장소에 글자를 직접 심어 둔다 — 남이 넣어 둔 값, 옛 판의 값을 흉내 낸다. */
function storeWith(raw: string): ServiceReportDraftStore & { readonly data: Map<string, string> } {
  const store = healthyStore();
  store.data.set(KEY, raw);
  return store;
}

function read(store: ServiceReportDraftStore | null, fallback = autofilled()) {
  return readServiceReportDraft(store, [KEY], fallback, CAUSE_CODES);
}

// ───────────────────────────────────────────────────────────────── 열쇠

test("열쇠에 판 번호 · 사람 · 접수 건이 모두 들어간다", () => {
  const key = serviceReportDraftStorageKey("user-1", "case-1", null);
  assert.ok(key.includes("v1"), "판 번호가 있어야 모양이 바뀐 날 옛 값을 버릴 수 있다");
  assert.ok(key.includes("user-1"));
  assert.ok(key.includes("case-1"));
});

test("사람이 다르면 열쇠가 다르다 — 공용 PC 에서 남의 보고서가 되살아나지 않는다", () => {
  assert.notEqual(
    serviceReportDraftStorageKey("user-1", "case-1", null),
    serviceReportDraftStorageKey("user-2", "case-1", null)
  );
});

test("접수 건이 다르면 열쇠가 다르다 — 탭을 여럿 띄워도 서로 덮지 않는다", () => {
  assert.notEqual(
    serviceReportDraftStorageKey("user-1", "case-1", null),
    serviceReportDraftStorageKey("user-1", "case-2", null)
  );
});

test("🔴 보고서 장이 다르면 열쇠가 다르다 — 검사 보고서의 글이 수리 보고서에 되살아나지 않는다", () => {
  const inspection = serviceReportDraftStorageKey("user-1", "case-1", "report-1");
  const repair = serviceReportDraftStorageKey("user-1", "case-1", "report-2");
  assert.notEqual(inspection, repair);
  // 새로 만드는 장도 저장된 장과 갈린다 — 같으면 "한 장 더 만들기"가 방금 저장한
  // 장의 글로 시작한다.
  assert.notEqual(inspection, serviceReportDraftStorageKey("user-1", "case-1", null));
});

test("🔴 저장된 장의 열쇠 목록에는 옛 열쇠가 없다 — 남이 저장해 둔 보고서를 덮지 않는다", () => {
  assert.deepEqual(serviceReportDraftStorageKeys("user-1", "case-1", "report-1"), [SAVED_KEY]);
});

test("새 장의 열쇠 목록은 새 열쇠가 먼저, 옛 열쇠가 뒤다", () => {
  // 적는 것은 언제나 맨 앞 열쇠다. 옛 열쇠는 읽고 지울 때만 따라온다.
  assert.deepEqual(serviceReportDraftStorageKeys("user-1", "case-1", null), [KEY, LEGACY_KEY]);
});

// ─────────────────────────────────────────────────── 적기 · 읽기 · 지우기

test("적었다가 읽으면 같은 값이 나온다", () => {
  const store = healthyStore();
  const values: ServiceReportFormValues = {
    ...autofilled(),
    kind: "INSPECTION",
    findings: "1. 전원부 확인\n\n2. 출력단 확인",
    actions: "부품 교체",
    remark: "재발 시 연락 바랍니다.",
    onSiteRepair: true,
    goodsReceiptChecked: true,
    goodsReceiptOn: "2026-08-30",
    causes: ["AGING", "PART_DEFECT"],
    occurredOnMode: "TEXT",
    occurredOnText: "―――",
  };

  writeServiceReportDraft(store, KEY, values, "2026-09-02T05:33:00.000Z");

  const draft = read(store);
  assert.notEqual(draft, null);
  assert.deepEqual(draft?.values, values);
  assert.equal(draft?.savedAt, "2026-09-02T05:33:00.000Z");
});

test("적어 둔 적이 없으면 되살릴 것이 없다(null)", () => {
  assert.equal(read(healthyStore()), null);
});

test("지우면 없어진다 — 「새로 시작」", () => {
  const store = healthyStore();
  writeServiceReportDraft(store, KEY, autofilled(), "2026-09-02T05:33:00.000Z");
  assert.notEqual(read(store), null);

  clearServiceReportDraft(store, [KEY]);
  assert.equal(read(store), null);
  assert.equal(store.data.size, 0, "저장소에서 실제로 사라진다");
});

test("지우기는 남의 열쇠를 건드리지 않는다", () => {
  const store = healthyStore();
  const otherKey = serviceReportDraftStorageKey("user-1", "case-2", null);
  writeServiceReportDraft(store, KEY, autofilled(), "2026-09-02T05:33:00.000Z");
  writeServiceReportDraft(store, otherKey, autofilled(), "2026-09-02T05:33:00.000Z");

  clearServiceReportDraft(store, [KEY]);
  assert.equal(store.data.has(otherKey), true, "다른 접수 건의 임시보관은 그대로다");
});

// ────────────────────────────────────────────── 옛 열쇠로 적힌 임시보관

test("🔴 옛 열쇠로 적어 둔 것을 새 장에서 되살린다 — 말없이 버리지 않는다", () => {
  const store = healthyStore();
  store.data.set(
    LEGACY_KEY,
    JSON.stringify({
      savedAt: "2026-09-02T05:33:00.000Z",
      values: { findings: "한 장뿐이던 때 적어 둔 확인내용" },
    })
  );

  const draft = readServiceReportDraft(
    store,
    serviceReportDraftStorageKeys("user-1", "case-1", null),
    autofilled(),
    CAUSE_CODES
  );
  assert.equal(draft?.values.findings, "한 장뿐이던 때 적어 둔 확인내용");
  assert.equal(draft?.savedAt, "2026-09-02T05:33:00.000Z");
});

test("🔴 옛 열쇠로 적어 둔 것이 저장된 장에는 부어지지 않는다", () => {
  const store = healthyStore();
  store.data.set(
    LEGACY_KEY,
    JSON.stringify({ savedAt: "2026-09-02T05:33:00.000Z", values: { findings: "남의 글" } })
  );

  const draft = readServiceReportDraft(
    store,
    serviceReportDraftStorageKeys("user-1", "case-1", "report-1"),
    autofilled(),
    CAUSE_CODES
  );
  assert.equal(draft, null, "저장된 장은 자기 열쇠만 본다");
});

test("새 열쇠에 적어 둔 것이 옛 열쇠보다 이긴다", () => {
  const store = healthyStore();
  store.data.set(
    LEGACY_KEY,
    JSON.stringify({ savedAt: "2026-09-01T05:33:00.000Z", values: { findings: "옛 글" } })
  );
  writeServiceReportDraft(
    store,
    KEY,
    { ...autofilled(), findings: "지금 적던 글" },
    "2026-09-02T05:33:00.000Z"
  );

  const draft = readServiceReportDraft(
    store,
    serviceReportDraftStorageKeys("user-1", "case-1", null),
    autofilled(),
    CAUSE_CODES
  );
  assert.equal(draft?.values.findings, "지금 적던 글");
});

test("🔴 옛 열쇠에 깨진 값이 적혀 있어도 안 터진다", () => {
  // 손으로 고친 값, 판이 어긋난 값이 그대로 남아 있을 수 있다.
  for (const raw of ["{", "[1,2,3]", "null", "", "   "]) {
    const store = healthyStore();
    store.data.set(LEGACY_KEY, raw);

    let draft: ReturnType<typeof readServiceReportDraft> | undefined;
    assert.doesNotThrow(() => {
      draft = readServiceReportDraft(
        store,
        serviceReportDraftStorageKeys("user-1", "case-1", null),
        autofilled(),
        CAUSE_CODES
      );
    }, `적혀 있던 것: ${JSON.stringify(raw)}`);
    assert.equal(draft, null);
  }
});

test("🔴 「새로 시작」은 옛 열쇠까지 지운다 — 버린 글이 다음에 되살아나지 않는다", () => {
  const store = healthyStore();
  store.data.set(
    LEGACY_KEY,
    JSON.stringify({ savedAt: "2026-09-01T05:33:00.000Z", values: { findings: "옛 글" } })
  );
  writeServiceReportDraft(store, KEY, autofilled(), "2026-09-02T05:33:00.000Z");

  clearServiceReportDraft(store, serviceReportDraftStorageKeys("user-1", "case-1", null));

  assert.equal(store.data.has(KEY), false);
  assert.equal(store.data.has(LEGACY_KEY), false, "옛 열쇠가 남아 있으면 버린 글이 되살아난다");
});

// ────────────────────────────────────── 저장소가 막혀 있어도 죽지 않는다

test("🔴 읽는 것만으로 던지는 저장소 — 안 터지고 되살릴 것이 없다고 답한다", () => {
  let draft: ReturnType<typeof read> | undefined;
  assert.doesNotThrow(() => {
    draft = read(throwingStore);
  });
  assert.equal(draft, null);
});

test("🔴 적을 때 던지는 저장소 — 안 터진다(용량 초과 · 저장 차단)", () => {
  assert.doesNotThrow(() =>
    writeServiceReportDraft(writeThrowsStore(), KEY, autofilled(), "2026-09-02T05:33:00.000Z")
  );
  assert.doesNotThrow(() =>
    writeServiceReportDraft(throwingStore, KEY, autofilled(), "2026-09-02T05:33:00.000Z")
  );
});

test("지우기가 던지는 저장소 — 안 터진다", () => {
  assert.doesNotThrow(() => clearServiceReportDraft(throwingStore, [KEY, LEGACY_KEY]));
});

test("저장소가 아예 없어도(null) 전부 무사하다", () => {
  // 꺼내 오는 것 자체가 실패한 경우다 — 화면이 null 을 넘긴다.
  assert.equal(read(null), null);
  assert.doesNotThrow(() =>
    writeServiceReportDraft(null, KEY, autofilled(), "2026-09-02T05:33:00.000Z")
  );
  assert.doesNotThrow(() => clearServiceReportDraft(null, [KEY]));
});

// ──────────────────────────────── 적혀 있던 것을 그대로 믿지 않는다

test("깨진 JSON · 배열 · 숫자 · null · 빈 글자 — 전부 되살릴 것이 없다고 답한다", () => {
  for (const raw of ["{", "깨진 값", "[1,2,3]", "42", "null", "true", '"글자"', "", "   "]) {
    assert.equal(read(storeWith(raw)), null, `적혀 있던 것: ${JSON.stringify(raw)}`);
  }
});

test("값 없이 시각만 적혀 있으면 임시보관이 아니다", () => {
  assert.equal(read(storeWith(JSON.stringify({ savedAt: "2026-09-02T05:33:00.000Z" }))), null);
  assert.equal(read(storeWith(JSON.stringify({ savedAt: "…", values: null }))), null);
  assert.equal(read(storeWith(JSON.stringify({ values: [] }))), null);
});

test("🔴 칸이 빠진 옛 임시보관 — 빠진 칸이 자동 채움 값으로 채워진다", () => {
  // 폼에 칸이 늘어나면 옛 임시보관에는 그 칸이 없다. `undefined` 가 화면 상태로
  // 들어가면 그 입력 칸이 통제 불능이 되어 React 가 경고를 뱉고 값이 사라진다.
  const fallback = autofilled();
  const store = storeWith(
    JSON.stringify({
      savedAt: "2026-09-02T05:33:00.000Z",
      values: { findings: "적어 둔 확인내용", actions: "적어 둔 조치" },
    })
  );

  const draft = read(store, fallback);
  assert.notEqual(draft, null);
  const values = draft!.values;

  // 적어 둔 칸은 살아 있다.
  assert.equal(values.findings, "적어 둔 확인내용");
  assert.equal(values.actions, "적어 둔 조치");

  // 빠진 칸은 자동 채움 값이다.
  assert.equal(values.modelName, fallback.modelName);
  assert.equal(values.findingsIntro, fallback.findingsIntro);
  assert.equal(values.issuedOn, fallback.issuedOn);
  assert.equal(values.kind, fallback.kind);
  assert.deepEqual(values.causes, fallback.causes);

  // 🔴 어느 칸도 undefined 가 아니다 — 이것이 이 시험의 핵심이다.
  for (const [key, value] of Object.entries(values)) {
    assert.notEqual(value, undefined, `${key} 이(가) undefined 다`);
  }
  assert.deepEqual(Object.keys(values).sort(), Object.keys(fallback).sort(), "칸이 빠지지 않는다");
});

test("모양이 틀린 칸은 자동 채움 값으로 떨어진다", () => {
  const fallback = autofilled();
  const store = storeWith(
    JSON.stringify({
      savedAt: "2026-09-02T05:33:00.000Z",
      values: {
        // 글자 칸에 글자가 아닌 것
        findings: 123,
        modelName: null,
        remark: { 엉뚱한: "객체" },
        issuedOn: ["2026-09-02"],
        // 체크 칸에 불리언이 아닌 것
        onSiteRepair: "true",
        completionChecked: 1,
        // 정해진 값 밖
        kind: "SOMETHING_ELSE",
        occurredOnMode: "MAYBE",
        // 배열이 아닌 원인
        causes: "AGING",
      },
    })
  );

  const values = read(store, fallback)!.values;
  assert.equal(values.findings, fallback.findings);
  assert.equal(values.modelName, fallback.modelName);
  assert.equal(values.remark, fallback.remark);
  assert.equal(values.issuedOn, fallback.issuedOn);
  assert.equal(values.onSiteRepair, fallback.onSiteRepair);
  assert.equal(values.completionChecked, fallback.completionChecked);
  assert.equal(values.kind, fallback.kind);
  assert.equal(values.occurredOnMode, fallback.occurredOnMode);
  assert.deepEqual(values.causes, fallback.causes);
});

test("원인은 인정하는 코드만 남는다 — 중복도 접힌다", () => {
  const store = storeWith(
    JSON.stringify({
      savedAt: "2026-09-02T05:33:00.000Z",
      values: { causes: ["AGING", "없는코드", 7, null, "AGING", "PART_DEFECT"] },
    })
  );

  assert.deepEqual(read(store)!.values.causes, ["AGING", "PART_DEFECT"]);
});

test("원인이 빈 배열이면 「아무것도 안 골랐다」로 그대로 둔다", () => {
  // 기본값으로 되돌리면, 체크를 일부러 전부 푼 사람이 다시 열었을 때 되살아난다.
  const fallback: ServiceReportFormValues = { ...autofilled(), causes: ["AGING"] };
  const store = storeWith(
    JSON.stringify({ savedAt: "2026-09-02T05:33:00.000Z", values: { causes: [] } })
  );

  assert.deepEqual(read(store, fallback)!.values.causes, []);
});

test("종류와 발생일 방식은 정해진 값일 때만 되살아난다", () => {
  const store = storeWith(
    JSON.stringify({
      savedAt: "2026-09-02T05:33:00.000Z",
      values: { kind: "INSPECTION", occurredOnMode: "TEXT" },
    })
  );

  const values = read(store)!.values;
  assert.equal(values.kind, "INSPECTION");
  assert.equal(values.occurredOnMode, "TEXT");
});

test("시각이 없거나 글자가 아니어도 값은 되살린다", () => {
  // 지금은 이 임시보관이 유일한 사본이라, 시각 한 줄 때문에 적어 둔 글을 버리지
  // 않는다.
  const store = storeWith(JSON.stringify({ savedAt: 123, values: { findings: "살아 있어야 한다" } }));

  const draft = read(store);
  assert.equal(draft?.savedAt, null);
  assert.equal(draft?.values.findings, "살아 있어야 한다");
});

// ───────────────────────────────────────────────────── 적어 둔 시각

test("적어 둔 시각은 KST 로 적힌다", () => {
  // 05:33 UTC = 14:33 KST.
  assert.equal(formatServiceReportDraftSavedAt("2026-09-02T05:33:00.000Z"), "2026-09-02 14:33");
  // 날짜가 넘어가는 자리도 KST 기준이다(15:00 UTC = 다음 날 00:00 KST).
  assert.equal(formatServiceReportDraftSavedAt("2026-09-02T15:00:00.000Z"), "2026-09-03 00:00");
});

test("읽을 수 없는 시각은 지어내지 않는다", () => {
  assert.equal(formatServiceReportDraftSavedAt(null), null);
  assert.equal(formatServiceReportDraftSavedAt(""), null);
  assert.equal(formatServiceReportDraftSavedAt("어제쯤"), null);
});

// ────────────────────────────────────────────────────── 묶어서 적기

test("묶는 시간은 사람이 못 느끼면서 잃을 것도 적은 값이다", () => {
  // 0 이면 글자마다 저장소를 때리고, 너무 길면 이 기능이 막으려던 사고가 다시
  // 열린다(창이 갑자기 닫히면 그만큼이 날아간다).
  assert.ok(SERVICE_REPORT_DRAFT_SAVE_DEBOUNCE_MS > 0);
  assert.ok(SERVICE_REPORT_DRAFT_SAVE_DEBOUNCE_MS <= 1000);
});
