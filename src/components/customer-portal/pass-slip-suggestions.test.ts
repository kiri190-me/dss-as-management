import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import type { SerialCheck } from "@/lib/ocr/pass-slip-goods";
import type { PassSlipReadOutcome } from "@/lib/ocr/pass-slip-reader";
import {
  applyPassSlipSuggestions,
  buildPassSlipRow,
  passSlipMismatchMessage,
} from "./pass-slip-suggestions";

/**
 * ============================================================================
 * 🔴 **통문증이 이 건의 것이 아니면 한 칸도 쓰지 않는가**
 * ============================================================================
 * 통문증을 다른 건에 올려 두면, 항번이 하나뿐인 서류는 S/N 짝을 따지지 않고 읽으므로
 * **남의 PRV No. · Q코드가 칸에 뜬다.** 그러면 사람이 그대로 저장할 여지가 남는다 —
 * 그래서 그런 줄은 **아무것도 쓰지 않고**, 읽기가 끝난 뒤 팝업으로 알린다
 * (사용자 결정 2026-10-01).
 *
 * 🔴 「못 읽음(UNREAD)」은 다르다. 사진이 조금 흐려 S/N 이 안 읽힌 것까지 버리면
 * 쓸 수 있는 값을 버린다 — 그때는 **채우고** 노란 글로 짚어만 둔다.
 *
 * 🔴 팝업이 **저절로 닫히지 않는다**는 것도 여기서 본다. 누가 showSavePopup(성공
 * 알림 전용 · 0.5초 뒤 사라짐)으로 바꿔 끼우면 아무 오류 없이 경고가 사라진다.
 * ============================================================================
 */

const KEYS = { passNumber: "passNumber", prvNumber: "prvNumber", qCode: "qCode" };
const TARGETS = ["prvNumber", "qCode", "passNumber"];

type DoneOutcome = Extract<PassSlipReadOutcome, { status: "DONE" }>;

/** 세 칸을 다 읽어낸 통문증 하나. S/N 맞춰보기 결과만 갈아 끼운다. */
function readOutcome(serial: SerialCheck): DoneOutcome {
  return {
    status: "DONE",
    passNumber: {
      state: "READ",
      value: "EP2604070120",
      dateVerified: true,
      writtenDates: ["07-APR-26"],
    },
    prvNumber: { state: "READ", value: "R2604-2881043", rows: 1, why: "시험" },
    qCode: { state: "READ", value: "QDAD47455", inKnownList: true, why: "시험" },
    serialCheck: serial,
    ms: 3000,
  };
}

const MATCH = { state: "MATCH" as const, documentSerial: "1708075", why: "시험" };
const MISMATCH = { state: "MISMATCH" as const, documentSerial: "1703071", why: "시험" };
const UNREAD = { state: "UNREAD" as const, documentSerial: null, why: "시험" };

describe("🔴 서류의 S/N 이 이 건과 다르면 **한 칸도 쓰지 않는다**", () => {
  const built = buildPassSlipRow({
    outcome: readOutcome(MISMATCH),
    keys: KEYS,
    targetKeys: TARGETS,
  });

  test("세 칸 **모두** 값이 없다", () => {
    for (const key of TARGETS) {
      assert.equal(built.outcome[key]?.value, undefined, `${key} 에 값이 들어갔다`);
    }
  });

  test("채운 칸으로 세지 않는다 — 「불러오지 않음」이다", () => {
    assert.deepEqual(built.counts, {
      filled: 0,
      warned: 0,
      absent: 0,
      missed: 0,
      skipped: 3,
    });
  });

  test("칸 밑 글은 **짧다** — 자세한 것은 팝업이 말한다", () => {
    const notice = built.outcome[TARGETS[0]];
    assert.equal(notice?.text, "통문증이 이 건의 것이 아닙니다");
    assert.ok(notice.text.length <= 20, `칸 밑 글이 길다: ${notice.text}`);
    // 알림은 맨 왼쪽 빈 칸 하나에만 붙는다(세 칸에 되풀이하면 표가 글자로 막힌다).
    assert.deepEqual(Object.keys(built.outcome), [TARGETS[0]]);
  });

  test("팝업에 실을 것을 내놓는다", () => {
    assert.equal(built.mismatch?.documentSerial, "1703071");
  });
});

describe("S/N 이 맞거나 못 읽었으면 **채운다**", () => {
  test("MATCH — 세 칸이 다 찬다", () => {
    const built = buildPassSlipRow({
      outcome: readOutcome(MATCH),
      keys: KEYS,
      targetKeys: TARGETS,
    });
    assert.equal(built.outcome.prvNumber.value, "R2604-2881043");
    assert.equal(built.outcome.qCode.value, "QDAD47455");
    assert.equal(built.outcome.passNumber.value, "EP2604070120");
    assert.equal(built.counts.filled, 3);
    assert.equal(built.counts.skipped, 0);
    assert.equal(built.mismatch, null);
  });

  test("🔴 UNREAD — **채우되** 못 맞춰봤다고 짚는다(흐린 사진에 값을 버리지 않는다)", () => {
    const built = buildPassSlipRow({
      outcome: readOutcome(UNREAD),
      keys: KEYS,
      targetKeys: TARGETS,
    });
    assert.equal(built.outcome.prvNumber.value, "R2604-2881043");
    assert.equal(built.outcome.qCode.value, "QDAD47455");
    assert.equal(built.outcome.passNumber.value, "EP2604070120");
    assert.equal(built.counts.skipped, 0);
    assert.equal(built.mismatch, null, "못 읽음은 팝업을 띄우지 않는다");
    // 맨 왼쪽 칸에 노란 글이 덧붙는다.
    assert.equal(built.outcome.prvNumber.tone, "warn");
    assert.ok(/S\/N/.test(built.outcome.prvNumber.text), built.outcome.prvNumber.text);
  });
});

describe("그 밖의 갈래는 예전 그대로다", () => {
  test("읽기가 통째로 실패하면 못 읽음이다", () => {
    const built = buildPassSlipRow({
      outcome: { status: "FAILED", message: "사진을 받지 못했습니다" },
      keys: KEYS,
      targetKeys: TARGETS,
    });
    assert.equal(built.counts.missed, 3);
    assert.equal(built.counts.skipped, 0);
    assert.equal(built.outcome[TARGETS[0]].detail, "사진을 받지 못했습니다");
  });

  test("🔴 「서류에 없음」과 「못 읽음」이 여전히 다른 결이다", () => {
    const outcome: DoneOutcome = {
      ...readOutcome(MATCH),
      prvNumber: { state: "ABSENT", value: null, rows: 1, why: "없다" },
      qCode: { state: "UNREAD", value: null, inKnownList: false, why: "못 읽었다" },
    };
    const built = buildPassSlipRow({ outcome, keys: KEYS, targetKeys: TARGETS });
    assert.equal(built.outcome.prvNumber.tone, "absent");
    assert.equal(built.outcome.qCode.tone, "none");
    assert.equal(built.counts.absent, 1);
    assert.equal(built.counts.missed, 1);
  });

  test("이미 적힌 칸은 읽지 않았으므로 결과도 없다", () => {
    const outcome: DoneOutcome = {
      ...readOutcome(MATCH),
      passNumber: null,
      qCode: null,
    };
    const built = buildPassSlipRow({ outcome, keys: KEYS, targetKeys: ["prvNumber"] });
    assert.deepEqual(Object.keys(built.outcome), ["prvNumber"]);
    assert.equal(built.counts.filled, 1);
  });
});

describe("읽은 값을 칸에 얹는 규칙", () => {
  const fields = buildPassSlipRow({
    outcome: readOutcome(MATCH),
    keys: KEYS,
    targetKeys: TARGETS,
  }).outcome;

  test("손대지 않은 칸에만 얹는다 — 적어 둔 값을 덮지 않는다", () => {
    const values = applyPassSlipSuggestions({ prvNumber: "손으로 적음" }, fields);
    assert.equal(values.prvNumber, "손으로 적음");
    assert.equal(values.qCode, "QDAD47455");
  });

  test("지운 칸(빈 글자)도 다시 채우지 않는다", () => {
    assert.equal(applyPassSlipSuggestions({ qCode: "" }, fields).qCode, "");
  });

  test("값이 없는 칸은 얹을 것이 없다 — S/N 이 어긋난 줄이 그렇다", () => {
    const skipped = buildPassSlipRow({
      outcome: readOutcome(MISMATCH),
      keys: KEYS,
      targetKeys: TARGETS,
    }).outcome;
    assert.deepEqual(applyPassSlipSuggestions({}, skipped), {});
  });
});

describe("팝업에 뜰 글", () => {
  test("🔴 두 S/N 이 **둘 다** 들어 있고, 어느 줄인지 말한다", () => {
    const body = passSlipMismatchMessage([
      {
        rowNumber: 4,
        intakeNumber: "D260820",
        caseSerial: "1708075",
        documentSerial: "1703071",
      },
    ]).lines.join("\n");
    assert.ok(body.includes("4번 줄"), body);
    assert.ok(body.includes("D260820"), body);
    assert.ok(body.includes("1708075"), body);
    assert.ok(body.includes("1703071"), body);
    assert.ok(body.includes("불러오지 않았습니다"), body);
  });

  test("🔴 **무엇을 하면 되는지**가 들어 있다 — 길을 안 알려 주면 사람이 갇힌다", () => {
    const body = passSlipMismatchMessage([
      { rowNumber: 1, intakeNumber: null, caseSerial: "A", documentSerial: "B" },
    ]).lines.join("\n");
    assert.ok(body.includes("사진"), body);
    assert.ok(/직접 적으시면/.test(body), body);
  });

  test("🔴 어긋난 줄이 여럿이면 **한 팝업에 모인다**", () => {
    const message = passSlipMismatchMessage([
      { rowNumber: 2, intakeNumber: "D1", caseSerial: "A1", documentSerial: "B1" },
      { rowNumber: 5, intakeNumber: "D2", caseSerial: "A2", documentSerial: "B2" },
    ]);
    assert.equal(message.lines.length, 3, "줄마다 한 문단 + 할 일 한 문단");
    assert.ok(message.lines[0].startsWith("2번 줄"));
    assert.ok(message.lines[1].startsWith("5번 줄"));
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 🔴 팝업이 언제 어떻게 뜨는가 — 원본을 글자로 읽는다
 * ────────────────────────────────────────────────────────────────────────── */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  fs.readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
const flat = (source: string) => source.replace(/\s+/g, " ");

const popup = read("src/components/common/NoticePopup.tsx");
const panel = read("src/components/customer-portal/PassSlipOcrPanel.tsx");
const screen = read("src/components/customer-portal/CustomerPortalScreen.tsx");

describe("🔴 팝업은 **읽기가 끝난 뒤 한 번만** · 사람이 닫아야 닫힌다", () => {
  test("줄마다 띄우지 않는다 — 모아 두었다가 다 끝나고 한 번 연다", () => {
    const body = flat(code(panel));
    assert.ok(body.includes("mismatchRows.push({"), "어긋난 줄을 모으는 자리가 사라졌다");
    assert.ok(
      body.includes("if (mismatchRows.length > 0) setMismatch(mismatchRows);"),
      "읽기가 다 끝난 뒤 한 번 여는 모양이 바뀌었다"
    );
    // 여는 자리는 한 군데뿐이다(루프 안에서 또 열면 여러 번 닫아야 한다).
    assert.equal((body.match(/setMismatch\(mismatchRows\)/g) ?? []).length, 1);
  });

  test("스스로 닫는 타이머가 없다", () => {
    assert.ok(!/setTimeout|setInterval/.test(code(popup)), "팝업이 저절로 닫히는 길이 생겼다");
  });

  test("🔴 저장 팝업(0.5초 뒤 사라짐)을 쓰지 않는다 — 성공 알림 전용이다", () => {
    assert.ok(!code(popup).includes("showSavePopup"));
    assert.ok(flat(code(panel)).includes("<NoticePopup"), "경고 팝업이 사라졌다");
    assert.ok(
      !/showSavePopup[\s\S]{0,200}통문증/.test(code(panel)),
      "통문증 경고를 저장 팝업으로 띄운다"
    );
  });

  test("🔴 브라우저 기본 alert · confirm 을 쓰지 않는다 — 페이지가 멈춘다", () => {
    for (const [name, source] of Object.entries({ popup, panel })) {
      assert.ok(
        !/(^|[^.\w])(alert|confirm)\s*\(/.test(code(source)),
        `${name} 에서 기본 대화상자를 쓴다`
      );
    }
  });

  test("닫기 단추와 Esc 둘 다 닫는다 · 초점이 팝업으로 간다", () => {
    const body = flat(code(popup));
    assert.ok(body.includes("onCancel={(event) => { event.preventDefault(); onClose(); }}"), "Esc");
    assert.ok(body.includes("autoFocus"), "열릴 때 초점이 팝업으로 가지 않는다");
    assert.ok(body.includes("onClick={onClose}"), "닫기 단추");
    assert.ok(body.includes('role="dialog"') && body.includes('aria-modal="true"'));
    assert.ok(body.includes("dialog.showModal()"), "뒤 화면이 눌리지 않아야 한다");
  });
});

describe("🔴 [저장] 단추가 짓눌리지 않는다", () => {
  const body = flat(code(screen));

  test("🔴 저장 단추가 표 밖으로 나왔다 — 짓눌릴 마지막 열 자체가 없다", () => {
    /*
     * 🔴 표가 넓어질 때 희생되는 것은 언제나 마지막 열이다 — 「저장」이 세로로
     *    쪼개져 보였다(사용자 지적 2026-10-01). 그때는 그 열의 폭을 못 박아
     *    막았는데, 2026-10-07 에 [저장]이 표 밖(PortalSaveBar)으로 나가면서
     *    **눌릴 열 자체가 없어졌다.** 되돌아가면 같은 고장이 함께 돌아온다.
     */
    assert.ok(
      !body.includes('<th scope="col" className="w-20 px-3 py-2 whitespace-nowrap"> 저장 </th>'),
      "줄마다의 저장 열이 되살아났다 — 열이 열셋인 양식에서 글자가 세로로 쪼개진다"
    );
    assert.ok(
      !body.includes('<td className="w-20 px-3 py-2 whitespace-nowrap">'),
      "줄마다의 저장 칸이 되살아났다"
    );
    // 표 밖으로 나온 단추도 글자가 줄바꿈되지 않아야 한다.
    const bar = body.slice(body.indexOf("function PortalSaveBar("));
    assert.ok(
      bar.includes("text-sm font-semibold whitespace-nowrap text-white"),
      "단추 글자가 줄바꿈될 수 있다"
    );
  });

  test("🔴 통문증 알림을 **시스템 칸**(탈착품 S/N 등) 밑에 붙이지 않는다 — 그 열이 넓어진다", () => {
    assert.ok(
      body.includes("function Cell({ value }: { value: string | null }) {"),
      "시스템 칸이 다시 알림을 받고 있다"
    );
    assert.ok(!body.includes("rowNoticeOf"), "줄 알림을 시스템 칸에 붙이던 길이 되살아났다");
  });
});
