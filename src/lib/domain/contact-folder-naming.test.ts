import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONTACT_FOLDER_MAX_NAME_LENGTH,
  CONTACT_FOLDER_MAX_SYMPTOM_LENGTH,
  contactFolderName,
  contactFolderSerialKey,
  matchesContactFolder,
  pickContactFolder,
  pickSimilarContactFolders,
  type ContactFolderNamingInput,
} from "./contact-folder-naming";

/*
 * 고객사 · 모델 · S/N 은 가짜다(저장소가 공개다). 디스크를 보지 않는 순수 시험이다.
 *
 * 🔴 `\u` 이스케이프를 쓰지 않는다 — 이 저장소의 도구를 거치면 한 겹이 조용히
 * 삼켜져 진짜 제어문자가 파일에 박힌 적이 있다. 보이지 않는 글자는 전부
 * String.fromCodePoint 로 만든다.
 */
const FULLWIDTH_SPACE = String.fromCodePoint(0x3000);
const NUL = String.fromCodePoint(0x0000);

const CASE: ContactFolderNamingInput = {
  intakeNumber: "D260908",
  customerName: "INVENIA",
  modelName: "T2RCONT-AD2",
  lotNumber: "WN3947",
  serialNumber: "1802034",
  reportedSymptom: "점검요청",
};

const NAME = "D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청";

const FORBIDDEN = ["\\", "/", ":", "*", "?", '"', "<", ">", "|"];

function assertCleanName(name: string): void {
  for (const forbidden of FORBIDDEN) {
    assert.ok(!name.includes(forbidden), `${forbidden} 가 남아 있다: ${name}`);
  }
  assert.ok(!/[\p{Cc}\p{Cf}]/u.test(name), `제어문자가 남았다: ${JSON.stringify(name)}`);
  assert.ok(name.length <= CONTACT_FOLDER_MAX_NAME_LENGTH, `이름이 길다(${name.length}): ${name}`);
  assert.equal(name, name.normalize("NFC"));
  assert.equal(name.trim(), name);
}

test("폴더 이름 — 인수번호 고객사 모델명 L/N S/N 신고증상 을 공백으로 잇는다", () => {
  assert.equal(contactFolderName(CASE), NAME);
  assertCleanName(contactFolderName(CASE));
  // 인수번호가 비면 이름을 만들 수 없다.
  assert.throws(() => contactFolderName({ ...CASE, intakeNumber: "   " }));
  assert.throws(() => contactFolderName({ ...CASE, intakeNumber: "" }));
});

test("🔴 빈 조각은 뺀다 — L/N 없음 · S/N 없음 · 둘 다 없음, 화면의 `-` 도 안 들어간다", () => {
  assert.equal(
    contactFolderName({ ...CASE, lotNumber: null }),
    "D260908 INVENIA T2RCONT-AD2 1802034 점검요청"
  );
  assert.equal(
    contactFolderName({ ...CASE, serialNumber: undefined }),
    "D260908 INVENIA T2RCONT-AD2 WN3947 점검요청"
  );
  assert.equal(
    contactFolderName({ ...CASE, lotNumber: "", serialNumber: "   " }),
    "D260908 INVENIA T2RCONT-AD2 점검요청"
  );

  // 🔴 db/mappers/repair-case.ts 가 화면에 내보내는 `-` 자리표시가 흘러들어와도 빠진다.
  const withPlaceholders = contactFolderName({ ...CASE, lotNumber: "-", serialNumber: "-" });
  assert.equal(withPlaceholders, "D260908 INVENIA T2RCONT-AD2 점검요청");
  assert.ok(!withPlaceholders.includes(" - "), withPlaceholders);

  // 조각이 모두 비면 인수번호만 남는다.
  assert.equal(
    contactFolderName({
      intakeNumber: "D260908",
      customerName: null,
      modelName: null,
      lotNumber: null,
      serialNumber: null,
      reportedSymptom: null,
    }),
    "D260908"
  );
});

test("신고증상 — 자유 입력 4000 자가 와도 제 상한까지만 쓴다", () => {
  const name = contactFolderName({ ...CASE, reportedSymptom: "증".repeat(4000) });

  assertCleanName(name);
  assert.equal(name, `D260908 INVENIA T2RCONT-AD2 WN3947 1802034 ${"증".repeat(CONTACT_FOLDER_MAX_SYMPTOM_LENGTH)}`);
  // 다른 조각은 하나도 줄지 않았다 — 신고증상이 먼저 잘려 전체 상한에 닿지 않았다.
  assert.ok(name.includes(" INVENIA T2RCONT-AD2 WN3947 1802034 "), name);
});

test("신고증상 — 줄바꿈 · 탭 · 일본어 · 금지 글자 · 빈 값", () => {
  // 실제로 흔한 모양: 「출력 저하/노이즈」의 슬래시는 폴더 이름에 쓸 수 없는 글자다.
  assert.equal(
    contactFolderName({ ...CASE, reportedSymptom: "출력 저하/노이즈" }),
    "D260908 INVENIA T2RCONT-AD2 WN3947 1802034 출력 저하 노이즈"
  );
  // 줄바꿈 · 탭은 제어문자라 공백이 되고, 연속 공백은 한 칸으로 접힌다.
  assert.equal(
    contactFolderName({ ...CASE, reportedSymptom: "출력 저하\r\n\t노이즈" }),
    "D260908 INVENIA T2RCONT-AD2 WN3947 1802034 출력 저하 노이즈"
  );
  // 일본어(연락서는 교산에서 온다).
  assert.equal(
    contactFolderName({ ...CASE, reportedSymptom: "出力低下・ノイズ" }),
    "D260908 INVENIA T2RCONT-AD2 WN3947 1802034 出力低下・ノイズ"
  );
  // 빈 값이면 그 조각만 빠진다.
  assert.equal(
    contactFolderName({ ...CASE, reportedSymptom: "" }),
    "D260908 INVENIA T2RCONT-AD2 WN3947 1802034"
  );
  assert.equal(
    contactFolderName({ ...CASE, reportedSymptom: `${FULLWIDTH_SPACE} \t ` }),
    "D260908 INVENIA T2RCONT-AD2 WN3947 1802034"
  );

  for (const symptom of ["출력 저하/노이즈", "出力低下・ノイズ", "증".repeat(4000), `a${NUL}b`]) {
    assertCleanName(contactFolderName({ ...CASE, reportedSymptom: symptom }));
  }
});

test("결과 이름에 금지 글자가 하나도 없다 — 모든 조각에 섞어 넣어도", () => {
  const name = contactFolderName({
    intakeNumber: "D260908",
    customerName: '가나/상사:본사*"<>|?\\',
    modelName: `MODEL${NUL}X1`,
    lotNumber: "..",
    serialNumber: "S456...",
    reportedSymptom: "출력 저하/노이즈",
  });

  assert.equal(name, "D260908 가나 상사 본사 MODEL X1 S456 출력 저하 노이즈");
  assertCleanName(name);
});

test("🔴 길이 상한 — 가장 긴 조각부터 줄고 인수번호는 안 잘린다", () => {
  const long: ContactFolderNamingInput = {
    intakeNumber: "D260908",
    // 모두 한글 — UTF-8 바이트로 가장 무거운 경우.
    customerName: "가".repeat(200),
    modelName: "모".repeat(150),
    lotNumber: "L123",
    serialNumber: "시".repeat(100),
    reportedSymptom: "증".repeat(4000),
  };

  const name = contactFolderName(long);

  assert.equal(name.length, CONTACT_FOLDER_MAX_NAME_LENGTH);
  // 🔴 인수번호는 한 글자도 잘리지 않는다 — 다음에 이 폴더를 찾는 열쇠다.
  assert.ok(name.startsWith("D260908 "), name);
  // 짧은 조각은 살아남는다 — 가장 긴 조각부터 줄이기 때문이다.
  assert.ok(name.includes(" L123 "), name);
  assertCleanName(name);

  // NAS(Linux) 한도 — 이 이름으로 만든 폴더 안에 같은 이름의 파일을 둬도 255 바이트 안.
  assert.ok(Buffer.byteLength(`${name} (99).xlsx`) <= 255, String(Buffer.byteLength(`${name} (99).xlsx`)));

  // 자른 자리에 공백 · 점이 남지 않는다.
  const cut = contactFolderName({
    ...CASE,
    reportedSymptom: undefined,
    customerName: `${"가".repeat(40)}. ${"나".repeat(40)}`,
  });
  assert.equal(cut.trim(), cut);
  assert.ok(!/[.\s]\s/.test(cut), cut);
  assertCleanName(cut);

  // 인수번호가 비정상적으로 길어도 인수번호는 자르지 않는다(조각만 모두 빠진다).
  const longNumber = `D${"9".repeat(80)}`;
  assert.equal(contactFolderName({ ...CASE, intakeNumber: longNumber }), longNumber);
});

test("폴더 대조 — 인수번호로 시작하고 바로 뒤가 공백", () => {
  assert.equal(matchesContactFolder(NAME, "D260908"), true);
  // 이름이 인수번호 그 자체인 폴더도 맞다.
  assert.equal(matchesContactFolder("D260908", "D260908"), true);

  // 🔴 번호가 이어지는 다른 수리 건은 맞지 않는다 — 걸리면 남의 건에 이번 자료를 넣는다.
  assert.equal(matchesContactFolder("D2609081 다른상사 점검", "D260908"), false);
  assert.equal(matchesContactFolder("D260908X 다른상사 점검", "D260908"), false);
  assert.equal(matchesContactFolder("D260909 다른상사 점검", "D260908"), false);
  // 가운데에 있는 번호는 맞지 않는다(접두어만 본다).
  assert.equal(matchesContactFolder("백업 D260908 INVENIA", "D260908"), false);
  // 번호가 비면 어느 폴더와도 맞지 않는다.
  assert.equal(matchesContactFolder(NAME, "   "), false);
  assert.equal(matchesContactFolder(NAME, ""), false);
});

test("🔴 폴더 대조 — 대소문자를 접는다(리눅스에서 d260908 은 다른 이름이다)", () => {
  assert.equal(matchesContactFolder("d260908 INVENIA 점검요청", "D260908"), true);
  assert.equal(matchesContactFolder("D260908 INVENIA 점검요청", "d260908"), true);
  assert.equal(matchesContactFolder("d260908", "D260908"), true);
  // 접어도 경계는 그대로 본다.
  assert.equal(matchesContactFolder("d2609081 다른상사", "D260908"), false);
});

test("폴더 대조 — 사람이 적은 공백 두 칸 · 전각 공백 · 탭 · 풀어쓴(NFD) 한글", () => {
  assert.equal(matchesContactFolder("D260908  INVENIA  점검요청", "D260908"), true);
  assert.equal(matchesContactFolder(`D260908${FULLWIDTH_SPACE}INVENIA 점검요청`, "D260908"), true);
  assert.equal(matchesContactFolder("D260908\tINVENIA 점검요청", "D260908"), true);
  // 이름 뒤가 전각 공백 · 탭뿐이어도 걸린다(정규화가 접는다).
  assert.equal(matchesContactFolder(`D260908${FULLWIDTH_SPACE}`, "D260908"), true);
  assert.equal(matchesContactFolder("D260908\t", "D260908"), true);
  assert.equal(matchesContactFolder(" D260908 INVENIA ", "D260908"), true);
  // 풀어쓴 한글로 적힌 이름.
  assert.equal(matchesContactFolder(NAME.normalize("NFD"), "D260908"), true);
});

test("찾기 판정 — 하나면 found, 여럿이면 multiple, 없으면 not-found", () => {
  const names = [
    "D260907 다른상사 점검",
    NAME,
    "D2609081 번호가 이어지는 남의 폴더",
    "메모",
  ];

  assert.deepEqual(pickContactFolder("D260908", names), { status: "found", folderName: NAME });
  assert.deepEqual(pickContactFolder("D260907", names), {
    status: "found",
    folderName: "D260907 다른상사 점검",
  });
  assert.deepEqual(pickContactFolder("D260999", names), { status: "not-found" });
  assert.deepEqual(pickContactFolder("D260908", []), { status: "not-found" });
  // 번호가 비면 아무것도 고르지 않는다.
  assert.deepEqual(pickContactFolder("  ", names), { status: "not-found" });

  // 🔴 여럿이면 앱이 고르지 않는다 — 사람이 폴더를 둘 만들어 두었다는 뜻이다.
  const twice = ["D260908 나중에 만든 폴더", NAME];
  const picked = pickContactFolder("D260908", twice);
  assert.equal(picked.status, "multiple");
  if (picked.status !== "multiple") throw new Error("unreachable");
  assert.deepEqual(picked.folderNames.slice().sort(), twice.slice().sort());
});

test("🔴 찾기 판정이 돌려주는 이름은 디스크의 실제 이름이다 — 다듬은 이름이 아니다", () => {
  // 사람이 적은 이름: 풀어쓴(NFD) 한글 + 공백 두 칸. 이 글자 그대로 돌아와야
  // 경로를 이을 수 있다 — 다듬은 이름으로 이으면 없는 폴더가 된다.
  const human = "d260908  INVENIA  점검요청".normalize("NFD");
  const picked = pickContactFolder("D260908", [human]);

  assert.deepEqual(picked, { status: "found", folderName: human });
  if (picked.status !== "found") throw new Error("unreachable");
  assert.equal(picked.folderName, human);
  assert.notEqual(picked.folderName, NAME);
});

/*
 * ────────────────────────────────────────────────────────────────────────────
 * 🔴 만들기 직전의 안전장치 — 비슷한 폴더 훑기 (조각 5)
 * ────────────────────────────────────────────────────────────────────────────
 */

test("S/N 견줌 열쇠 — 공백을 지우고 대문자로, 비면 null", () => {
  assert.equal(contactFolderSerialKey("1912 120"), "1912120");
  assert.equal(contactFolderSerialKey(" wn3947 "), "WN3947");
  // 전각 숫자도 같은 값이 된다(NFKC).
  assert.equal(contactFolderSerialKey("１８０２０３４"), "1802034");
  for (const empty of [null, undefined, "", "   "]) {
    assert.equal(contactFolderSerialKey(empty), null, String(empty));
  }
});

test("🔴 인수번호 없이 사람이 만든 폴더만 훑는다 — 하나뿐이어도 돌려준다", () => {
  const human = "INVENIA T2RCONT-AD2 WN3947 1802034 점검요청";
  const names = [
    human,
    // 🔴 지난번 수리 건 — 인수번호가 붙어 있으므로 후보가 아니다(S/N 은 고유키가 아니다).
    "D250101 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청",
    "메모 폴더",
  ];

  assert.deepEqual(pickSimilarContactFolders("1802034", names), [human]);
});

test("마디 경계를 본다 — 일부로만 들어 있으면 후보가 아니다", () => {
  const names = ["INVENIA 18020345 점검", "INVENIA X1802034 점검", "INVENIA 180203 점검"];
  assert.deepEqual(pickSimilarContactFolders("1802034", names), []);

  // 띄어 적은 S/N 은 붙여서 본다(`1912 120` ↔ `1912120`), 소문자도 접는다.
  assert.deepEqual(pickSimilarContactFolders("1912120", ["주성 1912 120 점검"]), ["주성 1912 120 점검"]);
  assert.deepEqual(pickSimilarContactFolders("wn3947", ["주성 WN3947 점검"]), ["주성 WN3947 점검"]);
});

test("🔴 S/N 이 비면 아무것도 걸리지 않는다 — 훑지 않는다", () => {
  const names = ["INVENIA 1802034 점검", "메모 폴더"];
  for (const empty of [null, undefined, "", "   "]) {
    assert.deepEqual(pickSimilarContactFolders(empty, names), [], String(empty));
  }
});

test("후보가 여럿이면 이름순으로, 디스크의 실제 이름 그대로 돌려준다", () => {
  const names = ["나중 1802034 폴더", "가장먼저 1802034 폴더".normalize("NFD")];
  const picked = pickSimilarContactFolders("1802034", names);

  assert.equal(picked.length, 2);
  assert.equal(picked[0], "가장먼저 1802034 폴더".normalize("NFD"));
  assert.equal(picked[1], "나중 1802034 폴더");
});
