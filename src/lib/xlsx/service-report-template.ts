import { wrapTextToWidth } from "@/lib/domain/text-wrap";

import { ZipArchive } from "./zip-reader";
import { writeZip, type ZipEntryInput } from "./zip-writer";
import {
  clearCell,
  findCell,
  setCellStyle,
  setDate,
  setFormula,
  setInlineString,
  setIsoDate,
  setNumber,
} from "./sheet-patch";
import {
  cloneRowMergeCells,
  parseSheetRows,
  readRowHeightAttribute,
  resizeRowBlock,
  setRowHeightAttribute,
  shiftMergeCellRows,
  shiftSqrefRows,
  syncDimension,
  writeSheetRows,
} from "./sheet-rows";
import { createCellTextReader } from "./sheet-text";
import {
  addAlignedCellXfs,
  CALC_CHAIN_PART,
  CONTENT_TYPES_PART,
  enableFullCalcOnLoad,
  removeCalcChainOverride,
  removeCalcChainRelationship,
  resolveSheetDrawingPart,
  resolveSheetPart,
  SHARED_STRINGS_PART,
  shiftDrawingAnchorRows,
  shiftPrintArea,
  STYLES_PART,
  WORKBOOK_PART,
  WORKBOOK_RELS_PART,
} from "./workbook-parts";

/**
 * ============================================================================
 * 검사 보고서 · 수리 보고서 — 두 양식을 한 모듈에서 채운다
 * ============================================================================
 * 두 양식은 **같은 통합문서**다. 실측해 보면 다른 곳이 셋뿐이다:
 *
 *   1. `C11` 제목      — `검　사　보　고　서` / `수　리　보　고　서`
 *   2. `X28` 조치 완료 체크 — 수리에만
 *   3. `AF28` 조치 완료 날짜 — 수리에만(양식에는 `=AO8` 수식으로 들어 있다)
 *
 * 그리고 「정리」 구역이 수리 보고서에만 쓰인다. 나눠 두 벌을 만들면 나머지
 * 99% 가 두 곳에 적히고, 한쪽만 고쳐지는 날이 온다 — 그때 증상은 "검사
 * 보고서만 이상하다" 라서 그 종류를 쓰는 사람이 말해 주기 전에는 아무도
 * 모른다(견적서 채우개 셋을 나눠 두고 겪은 것과 같은 자리).
 *
 * ── 🔴 양식 파일이 '빈 양식'이 아니다 ───────────────────────────────────
 * 두 파일 모두 **실제로 발행된 보고서의 사본**이다. 고객사 이름·형식·L/N·
 * 접수일·인수 No.·원인 체크가 그대로 들어 있다. 그래서 이 채우개는 **자기가
 * 다루는 칸을 하나도 빠짐없이 쓰거나 지운다.** "값을 안 주면 양식 그대로
 * 둔다"는 견적서의 규칙(기본 문구를 살리려는 것)을 여기서는 쓸 수 없다 —
 * 그랬다가는 다른 고객사의 자료가 섞인 문서가 나간다.
 *
 * ── 🔴 양식의 글상자에 견본 글자가 남아 있다 ───────────────────────────
 * 본문 위에는 **투명한 글상자 두 개**가 떠 있다(`xl/drawings/drawing2.xml`).
 * 테두리도 배경도 없어서 눈으로는 셀처럼 보이지만 실제로는 도형이고, 그 안에
 * 견본 글자가 들어 있다:
 *
 *   · 본문 자리를 덮는 상자 — `인수품에 대하여 …` + `～이　상～`
 *   · 라벨 자리를 덮는 상자 — `확　내` / `인　용` / `조  치`(+ 수리는 `정  리`)
 *
 * 그대로 복사해 내보내면 **라벨이 두 번 보이고 본문 첫 줄이 견본 문장과
 * 겹친다.** 그리고 글상자는 크기가 고정이라 본문이 길어져도 늘어나지 않는다.
 *
 * 그래서 **글자만 비우고**(`clearDrawingTextInRows`) 라벨·본문·`～이　상～` 을
 * 전부 셀로 그린다. 🔴 도형 자체는 지우지 않는다 — 지우면 관계(rels)와 그림
 * 번호가 함께 흔들리고, 그 결과는 Excel 의 "복구할 수 없는 내용" 대화상자다.
 *
 * ── 🔴 자리를 어떻게 정했나 ─────────────────────────────────────────────
 * 견적서에서 배운 것은 "행을 코드에 박지 않는다" 였다. 여기서도 같다:
 *
 *   · **본문 29줄** — 양식의 `BC` 열에 글자수 도우미가 공유 수식으로 들어 있다:
 *       `<f t="shared" ref="BC31:BC59" si="0">LEN(H31)</f>`
 *     이 `ref` 가 곧 본문 줄의 범위이고, `LEN(...)` 안의 열이 곧 본문 내용
 *     열이다. 사람이 Excel 에서 본문 줄을 끼워 넣으면 Excel 이 이 `ref` 를
 *     함께 늘려 준다 — 그래서 이것을 읽으면 자리가 양식을 따라간다.
 *     `findBodyBlock` 이 그 일을 한다.
 *   · **라벨 열** — 본문 첫 줄의 병합 칸 중 **내용 열 바로 왼쪽에서 끝나는
 *     것**(`C31:G31`)의 시작 열. 라벨 칸의 너비가 바뀌어도 따라간다.
 *   · **비고 4줄** — 「비　고」 라벨의 병합 칸(`C60:G63`)이 줄 범위와 내용 열을
 *     둘 다 알려 준다. `findLabelledBlock` 이 그 일을 한다.
 *   · **나머지 머리·체크 칸** — 주소를 못 박는다. 대신 **쓰기 전에 그 옆의
 *     라벨 칸이 우리가 아는 글자인지 확인하고, 아니면 던진다**(`assertLayout`).
 *     양식이 바뀌면 엉뚱한 칸에 `○` 를 찍는 대신 멈춘다.
 *
 * ── 🔴 세 구역은 **각자 정해진 자리에서** 시작한다 ──────────────────────
 * 발행본은 「확인내용」·「조치」·「정리」가 본문 안에서 서로 떨어진 자리에
 * 앉는다. 구역을 줄줄이 이어 붙이면 세 구역이 문서 위쪽에 몰리고 아래 20여
 * 줄이 통째로 빈다 — 같은 양식으로 만든 문서인데 우리 것만 모양이 다르다.
 *
 * 🔴 **그 자리도 코드에 박지 않는다.** 원본의 배치가 양식 안에 남아 있다:
 * 라벨 글상자(`Text Box 9`)의 문단이 그것이다. 「확　내」가 1번째, 「조  치」가
 * 14번째, 「정  리」가 27번째 문단이고, 사이는 빈 문단이다. 문단마다
 * `<a:lnSpc><a:spcPts val="1100"/></a:lnSpc>`(=11.00pt) 로 줄간격이 정확히
 * 박혀 있고, `<a:bodyPr … tIns="18288">` 가 위쪽 안쪽여백을, 앵커의
 * `<xdr:from>` 이 상자가 어느 행 어디쯤에서 시작하는지를 알려 준다. 그래서
 *
 *     N번째 문단의 세로 위치 = rowOff + tIns + (앞 문단들의 줄간격 합)
 *
 * 를 본문 행 높이를 따라 훑어 내려가면 **몇 행에 해당하는지** 나온다
 * (`readSectionStartRows`). 단위는 EMU 이고 `1pt = 12700 EMU` 다.
 *
 * ⚠️ 줄간격은 **문단마다 따로** 읽는다. 두 양식이 같은 통합문서인데도 검사
 * 양식은 앞 14문단이 13pt(라벨 글꼴이 12pt)이고 수리 양식은 11pt(10pt)다.
 * 하나로 뭉뚱그리면 한쪽이 두 행 어긋난다.
 *
 * 양식이 바뀌어 라벨 글상자를 못 찾거나 줄간격을 못 읽으면 **짐작하지 않고
 * 던진다** — `assertLayout` 과 같은 판단이다. 엉뚱한 자리에 그린 문서를
 * 고객사로 내보내는 것보다 멈추는 편이 낫다.
 *
 * ── 🔴 「확인내용」만 글상자보다 **한 줄 아래**다 ───────────────────────
 * 위 계산은 「확인내용」에 31행을 준다. 양식의 두 글상자(본문 상자·라벨 상자)가
 * 둘 다 31행을 가리키기 때문이고, 실측으로 확인한 것이다. **그런데 실제
 * 발행본은 32행에서 시작한다** — 2026-09-02 사용자 결정이다.
 *
 * 🔴 그러니 나중에 이 자리를 보고 "글상자 계산이 31을 주는데 왜 32지? 버그인가?"
 * 하고 되돌리지 말 것. **계산은 옳고, 그 위에 규칙이 하나 얹혀 있는 것**이다
 * (`SERVICE_REPORT_FINDINGS_ROW_OFFSET`·`shiftFindingsSectionDown`). 계산을
 * 왜곡해 32를 내놓게 만들지 않은 이유도 같다 — 그렇게 하면 양식의 글상자를
 * 따라간다는 성질이 죽고, 「조치」·「정리」까지 함께 밀린다.
 *
 * 결과적으로 31행은 비고, 「확인내용」 구역은 32~40행이다(수리 기준. 「조치」
 * 41행 · 「정리」 51행은 그대로다). 내용이 그보다 길면 여느 때처럼 아래 구역을
 * 밀어낸다.
 *
 * ── 🔴 46행의 높이는 **실수다** — 먼저 고르게 편다 ─────────────────────
 * 본문 행은 전부 14.1pt 인데 **수리 양식의 46행만 75.6pt** 다. 같은 통합문서인
 * 검사 양식의 46행은 13.9pt 다. 즉 설계가 아니라, 그 발행본을 만든 사람이 46행을
 * 손으로 잡아 늘린 것이 사본에 그대로 굳은 **손자국**이다.
 *
 * 그대로 두면 두 가지가 함께 깨진다. 본문이 그 행에 닿는 순간 문서 한가운데
 * 손가락만 한 구멍이 뚫리고, 위의 구역 자리 계산이 그 행에서 통째로 뒤틀린다
 * (실측: 「정리」가 51행이 아니라 47행으로 나온다). 그래서 **구역 자리를 셈하기
 * 전에** 본문 행 높이를 그 블록의 **최빈값**으로 통일한다
 * (`normalizeBodyRowHeights`). 🔴 값을 코드에 박지 않고 **세어서** 고른다 —
 * 사람이 양식의 본문 행 높이를 바꾸는 날 코드가 따라가야 한다.
 *
 * ── 🔴 체크칸은 라벨의 **왼쪽**이다 ─────────────────────────────────────
 * 눈으로는 헷갈리는 자리인데, 양식이 스스로 답을 갖고 있다. `○` 드롭다운이
 * 걸린 칸이 데이터 유효성 검사에 적혀 있다:
 *
 *   `sqref="P29:Q30 AF29:AG30 X27:Y30 H27:I30 AN29:AO30"`
 *
 * 즉 체크칸은 `H·P·X·AF·AN` 다섯 열이고, 라벨은 그 오른쪽의
 * `J·R·Z·AH·AP` 다섯 열이다. (지시서에 적힌 "AN30 = 재현 안됨의 체크칸"은
 * 실제로는 **기타**의 체크칸이다 — 재현 안됨은 `AF30`.)
 *
 * ── 날짜는 ISO 8601 로 적는다 ───────────────────────────────────────────
 * 이 통합문서는 `conformance="strict"` 에 `<workbookPr dateCompatibility="0">`
 * 이다. 일련번호를 쓰지 않겠다는 선언이므로 `t="d"` 로 적는다
 * (sheet-patch.ts 의 `setIsoDate`). 판단은 양식을 보고 한다 — 언젠가 양식이
 * 보통(transitional) 통합문서로 다시 저장되면 자동으로 일련번호로 돌아간다.
 *
 * ── 🔴 본문 줄 수에 상한이 없다 — 모자라면 줄을 끼워 넣는다 ────────────
 * 양식의 본문은 29줄이지만 그것이 상한은 아니다. 담을 것이 더 많으면 **행을
 * 끼워 넣는다.** 조용히 자르는 것은 「조치」의 마지막 줄이 아무 표시 없이
 * 사라진 문서를 고객사로 보내는 일이다.
 *
 * 끼워 넣는 자리는 본문 **마지막 줄의 바로 위**다. 마지막 줄에는 상자의
 * 밑변(아래 테두리)이 붙어 있어서, 그 아래에 넣으면 테두리가 문서 한가운데
 * 남는다. 본으로 복제하는 줄도 그래서 마지막 줄이 아니라 그 위의 줄이다.
 *
 * 행이 밀리면 **함께 밀려야 하는 것이 여섯**이고, 하나만 빠뜨려도 문서가
 * 깨진다. 이 파일이 여섯을 전부 맡는다:
 *
 *   1. `<sheetData>` 의 행 번호와 셀 주소 — `resizeRowBlock`
 *   2. 병합 칸 — 아래쪽을 밀고(`shiftMergeCellRows`), 새 줄에 새로
 *      만든다(`cloneRowMergeCells`). 이 양식의 병합은 221개고 본문 아래에
 *      비고(`C60:G63`)·담당/승인(`AG60:AU63`)·문서번호(`C64:I64`)가 있다.
 *   3. **인쇄 영역** — `'Repair_Report (한글)'!$B$8:$AV$64`. 안 밀면 비고와
 *      도장이 인쇄에서 잘린다(견적서에서 실제로 겪었고 화면으로는 안 보인다).
 *   4. **공유 수식** — `<f t="shared" ref="BC31:BC59" si="0">LEN(H31)</f>`.
 *      줄이 늘면 `ref` 밖에 딸린 셀이 생기고, **어긋난 공유 수식은 Excel 이
 *      파일 열기를 거부하는 사유다.** `ref` 를 늘리는 대신 **보통 수식으로
 *      갈아 끼운다** — 새로 복제한 줄에는 수식이 아예 없어서 `ref` 만 늘리면
 *      "범위 안에 빈 칸이 섞인 공유 수식"이 되고, 그것이 맞는지는 Excel 판마다
 *      다르다. 보통 수식은 판을 안 탄다(견적서 채우개 셋과 같은 판단).
 *   5. **그림·도형의 고정 행** — `drawing2.xml` 의 앵커. 안 밀면 표만 내려가고
 *      도장과 글상자는 제자리에 남는다.
 *   6. 조건부 서식·유효성 검사의 `sqref` 와 `<dimension>`.
 *
 * ⚠️ ActiveX 단추 둘(`CommandButton1·2`)은 이 양식에서 3~7행이라 삽입 지점보다
 * 위다 — 밀 것이 없다. 아래로 내려오는 날을 대비해 **확인하고, 아니면 던진다**
 * (`assertControlsAreAboveBody`). 단추의 자리는 시트의 `<controls>` 와
 * `vmlDrawing2.vml` 두 곳에 적혀 있어서, 한쪽만 밀면 둘이 어긋난다.
 *
 * ── 🔴 「확인내용」의 첫 줄은 정형 문구다 ───────────────────────────────
 * 글상자를 비우면서 「인수품에 대하여 이하의 항목을 확인하였습니다.」 도 함께
 * 사라졌다. 이것은 그 건의 내용이 아니라 **늘 들어가는 정형 문구**이고, 실제
 * 발행본에서도 확인내용 맨 앞에 있다. 그래서 셀로 다시 넣는다.
 *
 * 🔴 **박아 두지 않는다.** 고객사에 따라 「인수품에 대해 이하의 항목을
 * 실시하였습니다.」 로 적힌 발행본이 있다. 그래서 세 갈래로 받는다
 * (`ServiceReportBody.findingsIntro`):
 *
 *   · 안 주면(`undefined`) → `SERVICE_REPORT_FINDINGS_INTRO` 가 들어간다
 *   · 다른 문장을 주면 → 그 문장이 들어간다
 *   · 빈 문자열(`""`)을 주면 → **안 들어간다**
 *
 * "안 줌"과 "비움"을 가르는 것이 요점이다 — 다음 단계의 화면은 이 기본값을
 * 미리 채운 채 고칠 수 있는 칸으로 내놓고, 사람이 그 칸을 지우면 정말로
 * 비워야 한다. 넣은 뒤에는 여느 본문 줄과 똑같이 폭에 맞춰 나뉜다.
 *
 * ── 🔴 본문 내용 줄은 왼쪽 맞춤이다 — 서식을 **더해서** 바꾼다 ──────────
 * 양식의 본문 칸 서식은 `horizontal="center"` 다. 「종단 AMP 입력 보호 휴즈
 * 교환 : 8개」 같은 줄이 가운데 찍히면 보고서로 읽히지 않는다(발행본은 글상자에
 * 썼기 때문에 왼쪽 맞춤이었다).
 *
 * 🔴 **기존 `xf` 를 고치지 않는다.** 이 양식은 본문 **내용 칸과 라벨 칸이 같은
 * `xf` 번호**를 쓴다(실측: 수리 31행 472 · 가운뎃줄 363 · 마지막 줄 366,
 * 검사 31행 381 · 가운뎃줄 354 · 마지막 줄 357 — 검사와 수리가 서로 다르다).
 * 그 하나를 고치면 라벨까지 왼쪽으로 따라간다. 그래서 `addAlignedCellXfs` 로
 * **사본을 만들어 `cellXfs` 맨 뒤에 더하고**, 본문 **내용 칸만** 새 번호를
 * 가리키게 한다. 번호는 코드에 박지 않고 **그 양식의 칸이 실제로 쓰는 번호를
 * 읽어서** 복제한다 — 그래야 검사·수리 두 양식과 늘어난 줄에 함께 통한다.
 *
 * 바꾸지 않는 것: 맺음 표시(`～이　상～`)·라벨·머리 정보·체크칸·비고. 특히
 * 맺음 표시는 본문 **마지막 줄**에 앉는데 그 줄의 서식에 상자의 아래 테두리가
 * 걸려 있다 — 원본 번호를 그대로 두어야 테두리와 가운데 맞춤이 함께 산다.
 *
 * ── 🔴 한 줄이 칸의 가로폭을 넘지 않게 나눈다 ───────────────────────────
 * 본문 칸은 `H`~`AU` 병합이고 폭은 **양식의 `<cols>` 에서 읽는다**(40열 ×
 * 1.875 = 75칸). 값을 코드에 박지 않는다 — 사람이 양식의 열 너비를 고치는 날
 * 코드가 따라가야 한다. 나누는 규칙은 `domain/text-wrap.ts` 의 순수 함수다.
 *
 * ── 재계산은 Excel 에 맡긴다 ────────────────────────────────────────────
 * 값을 넣으면 `BC14`(=YEAR(AK14))·`BC24`(S/N 자릿수 판정) 같은 도우미 수식의
 * 캐시값이 낡는다. `calcChain.xml` 을 파트째 들어내고 `fullCalcOnLoad` 를 켠다.
 *
 * ── 손대지 않는 것 ──────────────────────────────────────────────────────
 * 직인 그림(`image3.png`·`image4.jpeg`)·인쇄 설정·발행처 정보(AF9·AF10)·
 * 담당/승인 서명칸·숨은 도우미 열은 그대로 나간다. `styles.xml` 도 **더하기만**
 * 한다 — 본문 왼쪽 맞춤용 `xf` 가 맨 뒤에 붙을 뿐, 원본의 `xf` 는 하나도
 * 바뀌지 않는다.
 * ============================================================================
 */

/** 값을 채우는 시트. 통합문서에는 `List`(숨김)·`Repair_Record`·`oh 참고` 도 있다. */
export const SERVICE_REPORT_SHEET_NAME = "Repair_Report (한글)";

export type ServiceReportKind = "INSPECTION" | "REPAIR";

/**
 * `C11` 제목. **공백은 전각(U+3000)** 이다 — 양식의 `BK10`·`BK11` 에 드롭다운
 * 원본으로 들어 있는 글자를 그대로 옮겼다. 보통 공백으로 적으면 자간이 달라져
 * 다른 문서처럼 보인다.
 */
export const SERVICE_REPORT_TITLES: Record<ServiceReportKind, string> = {
  INSPECTION: "검　사　보　고　서",
  REPAIR: "수　리　보　고　서",
};

/** 체크 표시. 양식의 드롭다운 원본(`AY30`)에 든 글자와 같은 U+25CB 다. */
export const SERVICE_REPORT_CHECK_MARK = "○";

/**
 * 본문 구역의 라벨 — **양식의 글상자에 있던 모양 그대로 두 줄짜리다.**
 *
 * 원본 `Text Box 9` 는 라벨을 세로로 흘려 적어 두었다. 「확인내용」은 **두 줄**
 * (`확　내` / `인　용`)이고 「조치」·「정리」는 한 줄이다. 「확인내용」을 한 줄로
 * 펴서 적으면 우리가 만든 문서만 다른 모양이 된다.
 *
 * 🔴 **공백이 라벨마다 다르다.** 원본에서 코드 포인트째 옮긴 것이다:
 *
 *   `확　내` = `D655 3000 B0B4`   ← 전각 공백(U+3000)
 *   `인　용` = `C778 3000 C6A9`   ← 전각 공백(U+3000)
 *   `조  치` = `C870 0020 0020 CE58`  ← 보통 공백(U+0020) **둘**
 *   `정  리` = `C815 0020 0020 B9AC`  ← 보통 공백(U+0020) **둘**
 *
 * 왜 다른지는 모른다. 통일하지 않는다 — 원본이 그렇다. 전각 공백은 코드에서
 * 눈에 안 보이므로 `　` 으로 적어 둔다(보통 공백과 섞이면 아무도 못 잡는다).
 */
export const SERVICE_REPORT_BODY_LABELS = {
  findings: ["확　내", "인　용"],
  actions: ["조  치"],
  summary: ["정  리"],
} as const;

/**
 * 본문 마지막 줄 다음에 오는 맺음 표시.
 *
 * 🔴 **양식의 글상자에 있던 글자를 코드 포인트째 옮긴 것**이다
 * (`U+FF5E U+C774 U+3000 U+C0C1 U+FF5E`) — 물결표는 반각 `~` 가 아니라 전각
 * `～` 이고 사이의 공백은 전각(U+3000)이다. 보통 글자로 적으면 자간이 달라져
 * 다른 문서처럼 보인다(제목의 전각 공백과 같은 이유).
 *
 * 자리는 **본문 마지막 줄의 바로 다음 줄**, 본문 내용 열이다. 양식의 글상자는
 * 이 글자를 상자 밑바닥에 두었지만 상자는 크기가 고정이라 본문이 길어지면
 * 어긋난다. 셀에 두면 본문이 몇 줄이든 늘 끝에 붙는다. 가운데 맞춤은 양식이
 * 이미 해 준다 — 본문 내용 칸의 서식이 `horizontal="center"` 다.
 */
export const SERVICE_REPORT_CLOSING_MARK = "～이　상～";

/**
 * 「확인내용」 첫 줄의 정형 문구 — **안 주면 이것이 들어간다.**
 *
 * 🔴 **양식의 글상자에 있던 글자를 코드 포인트째 옮긴 것**이다. 검사·수리 두
 * 양식에 글자 하나까지 똑같이 들어 있었고, 실제 발행본 PDF 에서도 확인내용 맨
 * 앞에 있다:
 *
 *   `C778 C218 D488 C5D0 0020 B300 D558 C5EC 0020 C774 D558 C758 0020`
 *   `D56D BAA9 C744 0020 D655 C778 D558 C600 C2B5 B2C8 B2E4 002E`
 *
 * 공백은 전부 **보통 공백(U+0020)** 이고 끝은 마침표(U+002E)다 — 라벨·제목과
 * 달리 전각 문자가 하나도 없다. 눈으로 베끼면 전각 공백이 섞여도 아무도 못
 * 잡으므로 시험이 코드 포인트로 못 박는다.
 *
 * 🔴 **이것은 기본값이지 고정값이 아니다.** 다른 고객사의 발행본에는 「인수품에
 * 대해 이하의 항목을 **실시**하였습니다.」 로 적힌 것이 있다. 바꾸는 방법은
 * `ServiceReportBody.findingsIntro` 를 보라.
 */
export const SERVICE_REPORT_FINDINGS_INTRO = "인수품에 대하여 이하의 항목을 확인하였습니다.";

/**
 * 본문이 차지할 수 있는 줄 수의 마지막 방어선.
 *
 * 상한이 아니라 **폭주 방지**다. 화면이나 API 가 실수로 수만 줄을 넘겼을 때
 * 수백 페이지짜리 파일을 만들다 서버가 멎는 대신 여기서 멈춘다. 사람이 손으로
 * 쓰는 보고서가 이 줄 수를 넘는 일은 없다.
 */
export const SERVICE_REPORT_MAX_BODY_ROWS = 300;

/**
 * 주소를 못 박은 칸들. 옆의 라벨 칸으로 확인한 뒤에만 쓴다(`assertLayout`).
 * 다음 단계(화면·DB)가 어느 칸에 무엇이 들어가는지 볼 수 있게 내보낸다.
 */
export const SERVICE_REPORT_CELLS = {
  /** 고객사명. 오른쪽 `U8` 의 「님」은 양식의 글자라 손대지 않는다. */
  customerName: "C8",
  issuedOn: "AO8",
  title: "C11",
  /** `No. {앞} - ` 통째로 쓴다. 양식에는 실제 고객사 코드가 박혀 있다. */
  reportNumberPrefix: "AF13",
  reportNumberMiddle: "AM13",
  reportNumberTail: "AQ13",
  customer: "H13",
  receivedOn: "AK14",
  occurrencePlace: "H17",
  occurrencePlaceDetail: "X17",
  occurredOn: "AK17",
  productName: "H19",
  productCategory: "H20",
  modelName: "V19",
  manufacturedYear: "AK19",
  manufacturedMonth: "AP19",
  /** 「상　황」 윗칸(H21:AE22). 양식이 세 문구짜리 드롭다운을 걸어 두었다. */
  situationRequest: "H21",
  /** 「상　황」 아랫칸(H23:AE26). 자유 기술. */
  situationDetail: "H23",
  lotNumber: "AO21",
  serialNumber: "AO23",
  usedYears: "AK25",
  usedMonths: "AP25",
  goodsReceivedOn: "AF27",
  goodsReceiptNumber: "AQ27",
  completedOn: "AF28",
  /** 조치 완료 줄의 번호칸(AO28:AU28). 양식의 숨은 도우미가 R번호로 쓴다. */
  repairNumber: "AO28",
} as const;

/** 조치 네 가지 — 라벨 칸과 그 **왼쪽** 체크칸. 위 '체크칸은 라벨의 왼쪽' 참조. */
const DISPOSITION_CELLS = {
  onSiteRepair: { label: "현지수리", labelCell: "J27", checkCell: "H27" },
  replacementDelivery: { label: "대품납입", labelCell: "J28", checkCell: "H28" },
  goodsReceipt: { label: "현품 인수", labelCell: "Z27", checkCell: "X27" },
  completion: { label: "조치 완료", labelCell: "Z28", checkCell: "X28" },
} as const;

export const SERVICE_REPORT_CAUSES = [
  "MANUFACTURING_DEFECT",
  "PART_DEFECT",
  "AGING",
  "TRANSPORT_DAMAGE",
  "STORAGE_DAMAGE",
  "SPEC_SHORTFALL",
  "INSPECTION_MISS",
  "MISHANDLING",
  "NOT_REPRODUCED",
  "OTHER",
] as const;

export type ServiceReportCause = (typeof SERVICE_REPORT_CAUSES)[number];

/** 원인 열 가지 — 29·30행에 다섯씩. 라벨은 `J·R·Z·AH·AP`, 체크는 그 왼쪽. */
const CAUSE_CELLS: Record<
  ServiceReportCause,
  { label: string; labelCell: string; checkCell: string }
> = {
  MANUFACTURING_DEFECT: { label: "제작불량", labelCell: "J29", checkCell: "H29" },
  PART_DEFECT: { label: "부품불량", labelCell: "R29", checkCell: "P29" },
  // 양식의 글자는 `노후화 `(뒤에 공백). 앞부분만 견준다 — assertLayout 참조.
  AGING: { label: "노후화", labelCell: "Z29", checkCell: "X29" },
  TRANSPORT_DAMAGE: { label: "운송불량", labelCell: "AH29", checkCell: "AF29" },
  STORAGE_DAMAGE: { label: "보관불량", labelCell: "AP29", checkCell: "AN29" },
  SPEC_SHORTFALL: { label: "사양미비", labelCell: "J30", checkCell: "H30" },
  INSPECTION_MISS: { label: "검사 미스", labelCell: "R30", checkCell: "P30" },
  MISHANDLING: { label: "취급불비", labelCell: "Z30", checkCell: "X30" },
  NOT_REPRODUCED: { label: "재현 안됨", labelCell: "AH30", checkCell: "AF30" },
  OTHER: { label: "기타", labelCell: "AP30", checkCell: "AN30" },
};

/**
 * 원인 열 가지의 한글 이름 — **화면이 체크박스에 쓰는 것도 이것 하나뿐이다.**
 *
 * 🔴 `CAUSE_CELLS` 에서 **뽑아낸다.** 베껴 적지 않는다. 위의 표는 문서에 찍히고
 * 양식 확인(`assertLayout`)에 쓰이는 글자이고, 화면 체크박스는 그것과 같은
 * 이름을 불러야 한다. 두 곳에 따로 적어 두면 양식의 라벨이 바뀐 날 채우개만
 * 고쳐지고, 그때 증상은 **화면과 문서가 서로 다른 이름을 부르는 것**이다 —
 * 아무 오류도 나지 않아서 아무도 모른다.
 *
 * ⚠️ 이 모듈은 브라우저 번들에 들어갈 수 없다(`zip-reader.ts` → `node:fs`).
 * 그래서 화면은 이것을 직접 가져오지 못하고 **서버 페이지가 읽어 props 로**
 * 넘긴다 — 정형 문구·줄 수 상한·드롭다운 목록이 이미 가는 길이다.
 */
export const SERVICE_REPORT_CAUSE_LABELS: Record<ServiceReportCause, string> =
  Object.fromEntries(
    SERVICE_REPORT_CAUSES.map((cause) => [cause, CAUSE_CELLS[cause].label])
  ) as Record<ServiceReportCause, string>;

/**
 * 「비　고」 라벨 칸. 이 칸의 병합 범위(`C60:G63`)가 비고가 몇 줄이고 내용이
 * 어느 열에서 시작하는지를 알려 준다(`findLabelledBlock`).
 */
const REMARK_LABEL_CELL = "C60";

/**
 * 쓰기 전에 확인하는 라벨들. 주소를 못 박은 근거가 이 표다 — 여기가 어긋나면
 * 양식이 바뀐 것이고, 그때는 엉뚱한 칸을 채운 보고서를 만드는 대신 던진다.
 *
 * ⚠️ **`startsWith` 로 견준다.** 이 양식의 공유문자열에는 일본어 후리가나가
 * `rPh` 로 딸려 있어서(`고　객` 뒤에 `キャクサキ`), 글자를 통째로 읽으면 화면에
 * 없는 글자가 뒤에 붙어 온다. 앞부분만 보면 그 구조를 건드리지 않고 확인할 수
 * 있다. 뒤에 공백이 붙은 라벨(`노후화 `)도 같은 이유로 여기서 걸러진다.
 */
const LAYOUT_GUARDS: readonly (readonly [ref: string, expected: string])[] = [
  ["AF8", "발　행"],
  ["C13", "고　객"],
  ["AF14", "접  수"],
  ["C21", "상　황"],
  ["AK21", "L/N"],
  ["AK23", "S/N"],
  ["C27", "조　치"],
  ["AO27", "No."],
  ["C29", "원  인"],
  [REMARK_LABEL_CELL, "비　고"],
];

/** 「현품 인수」 — 값이 있으면 체크된 것이다(없으면 체크칸이 빈다). */
export type ServiceReportGoodsReceipt = {
  /** `AF27`. 양식에는 접수일을 받아 오는 `=AK14` 수식이 들어 있었다. */
  on?: Date;
  /** `AQ27`. */
  number?: string;
};

/** 「조치 완료」 — 🔴 수리 보고서에만 있다. */
export type ServiceReportCompletion = {
  /** `AF28`. 양식에는 발행일을 받아 오는 `=AO8` 수식이 들어 있었다. */
  on?: Date;
};

export type ServiceReportDisposition = {
  onSiteRepair?: boolean;
  replacementDelivery?: boolean;
  goodsReceipt?: ServiceReportGoodsReceipt;
};

export type ServiceReportRepairDisposition = ServiceReportDisposition & {
  completion?: ServiceReportCompletion;
};

/**
 * 본문. **구역마다 라벨 하나 + 줄 목록**이고, 라벨은 그 구역이 시작하는
 * 줄에만 적힌다. 줄 사이를 띄우고 싶으면 빈 문자열을 한 줄 넣는다 — 우리가
 * 임의로 빈 줄을 끼워 넣지 않는다.
 *
 * 줄 수에 상한은 없다. 양식보다 길면 행을 끼워 넣는다. 한 줄이 칸의 가로폭을
 * 넘으면 **낱말을 자르지 않고** 다음 줄로 넘긴다 — 그래서 여기 준 줄 수와
 * 문서에 찍히는 줄 수가 다를 수 있다.
 */
export type ServiceReportBody = {
  /** 「확인내용」 */
  findings: readonly string[];
  /**
   * 「확인내용」 **첫 줄**의 정형 문구. 아래로 `findings` 가 이어진다.
   *
   *   · `undefined`(안 줌) → `SERVICE_REPORT_FINDINGS_INTRO`
   *   · 다른 문장 → 그 문장
   *   · `""`(명시적으로 비움) → 안 들어간다
   *
   * 🔴 "안 줌"과 "비움"은 다르다 — 화면이 이 값을 미리 채워 놓고 사람이 지울 수
   * 있어야 하기 때문이다. 넣은 줄은 여느 본문 줄과 같은 규칙으로 폭에 맞춰
   * 나뉘고, 같은 왼쪽 맞춤 서식을 받는다.
   *
   * ⚠️ `findings` 가 비어 있으면 「확인내용」 구역 자체가 없으므로 이 문구도 안
   * 들어간다 — 소개할 항목이 없는데 「이하의 항목을 확인하였습니다」 만 찍힌
   * 문서가 나가는 것을 막는다.
   */
  findingsIntro?: string;
  /** 「조치」 */
  actions: readonly string[];
};

export type ServiceReportRepairBody = ServiceReportBody & {
  /** 「정리」 — 🔴 수리 보고서에만. 없으면 빈 배열. */
  summary: readonly string[];
};

type ServiceReportCommon = {
  /** `C8`. 비어 있으면 던진다. */
  customerName: string;
  /** `AO8`. */
  issuedOn: Date;
  reportNumber: {
    /**
     * `AF13` 에 `No. {prefix} - ` 로 적힌다. 안 주면 `No. ` 만 남는다.
     * 🔴 안 주더라도 **양식에 박힌 값을 그대로 두지는 않는다** — 그 자리에는
     * 실제 고객사의 코드가 들어 있다.
     */
    prefix?: string;
    /** `AM13`. */
    middle: string;
    /** `AQ13`. */
    tail: string;
  };
  /** `H13`. */
  customer?: string;
  /** `AK14`. */
  receivedOn?: Date;
  /** `H17`. */
  occurrencePlace?: string;
  /** `X17`. 양식의 견본은 「공장」이었다. */
  occurrencePlaceDetail?: string;
  /**
   * `AK17`. 날짜를 모르는 건이 흔해서 양식이 `="―――"` 를 적어 두었다 —
   * 그래서 날짜 말고 글자도 받는다.
   */
  occurredOn?: Date | string;
  /** `H19`. 양식이 주파수·출력 목록(`13.56MHz 30kW` …) 드롭다운을 걸어 두었다. */
  productName?: string;
  /** `H20`. 품명 둘째 줄(견본은 「RF제네레이터」). */
  productCategory?: string;
  /** `V19`. */
  modelName?: string;
  /** `AK19` / `AP19`. */
  manufacturedYear?: number;
  manufacturedMonth?: number;
  /** `AO21` / `AO23`. ⚠️ 양식은 S/N 을 7자리로 본다(`BC24`) — 막지는 않는다. */
  lotNumber?: string;
  serialNumber?: string;
  /** `AK25` / `AP25`. */
  usedYears?: number;
  usedMonths?: number;
  /** `H21` / `H23`. 앞 공백이 글머리표라 **다듬지 않고 그대로** 적는다. */
  situation?: { request?: string; detail?: string };
  causes?: readonly ServiceReportCause[];
  /** `AO28`. 양식의 견본은 `---` 였다. */
  repairNumber?: string;
  /** `H60`~`H63`. 4줄이 상한이다. */
  remark?: readonly string[];
};

export type ServiceReportInput =
  | (ServiceReportCommon & {
      kind: "INSPECTION";
      disposition?: ServiceReportDisposition;
      body: ServiceReportBody;
    })
  | (ServiceReportCommon & {
      kind: "REPAIR";
      disposition?: ServiceReportRepairDisposition;
      body: ServiceReportRepairBody;
    });

/**
 * 값을 채운 통합문서를 **새 버퍼로** 돌려준다. 원본은 읽기만 한다.
 */
export function fillServiceReportWorkbook(
  templateXlsx: Buffer,
  input: ServiceReportInput
): Buffer {
  // 파일을 열기 전에 던진다 — 반쯤 채워진 문서가 만들어질 자리를 아예 없앤다.
  validateServiceReportInput(input);

  const archive = ZipArchive.fromBuffer(templateXlsx);
  const sheetPart = resolveSheetPart(archive, SERVICE_REPORT_SHEET_NAME);
  const drawingPart = resolveSheetDrawingPart(archive, sheetPart);
  const hasCalcChain = archive.has(CALC_CHAIN_PART);
  const workbookXml = archive.readText(WORKBOOK_PART);

  // 🔴 본문 왼쪽 맞춤은 서식을 하나 더해야 한다. 없는 양식이면 짐작하지 않고 던진다.
  const stylesXml = archive.readTextOrNull(STYLES_PART);
  if (stylesXml === null) {
    throw new Error(`양식에 ${STYLES_PART} 가 없습니다. 본문 서식을 정할 수 없습니다.`);
  }

  /**
   * 🔴 구역이 어느 행에서 시작하는지는 **그림 파트의 라벨 글상자**가 알고 있다
   * (머리말 '세 구역은 각자 정해진 자리에서'). 글자를 비우기 **전의** 그림을
   * 넘긴다 — 비운 뒤에는 문단이 사라져 자리를 물어볼 곳이 없다.
   */
  const filled = fillSheet(
    archive.readText(sheetPart),
    archive.readTextOrNull(SHARED_STRINGS_PART),
    stylesXml,
    drawingPart === null ? null : archive.readText(drawingPart),
    input,
    usesIsoDates(workbookXml)
  );

  const entries: ZipEntryInput[] = [];
  for (const name of archive.list()) {
    // 값이 바뀌었으니 계산 사슬은 낡았다. Excel 이 열 때 다시 만든다.
    if (name === CALC_CHAIN_PART) continue;

    const bytes = archive.readEntry(name);
    if (!bytes) throw new Error(`양식에서 파트를 읽지 못했습니다: "${name}"`);

    if (name === sheetPart) {
      entries.push({ name, data: toUtf8(filled.xml) });
    } else if (name === STYLES_PART) {
      // 🔴 **더하기만 한 것**이다 — 본문 왼쪽 맞춤 xf 가 맨 뒤에 붙었을 뿐,
      //    원본의 xf 는 하나도 안 바뀐다(addAlignedCellXfs 참조).
      entries.push({ name, data: toUtf8(filled.stylesXml) });
    } else if (name === WORKBOOK_PART) {
      // 🔴 인쇄 영역도 밀어야 한다. 안 밀면 비고와 도장이 인쇄에서 잘린다.
      entries.push({
        name,
        data: toUtf8(
          shiftPrintArea(
            enableFullCalcOnLoad(bytes.toString("utf8")),
            SERVICE_REPORT_SHEET_NAME,
            filled.rowShift
          )
        ),
      });
    } else if (drawingPart !== null && name === drawingPart) {
      entries.push({ name, data: toUtf8(rewriteDrawing(bytes.toString("utf8"), filled)) });
    } else if (hasCalcChain && name === CONTENT_TYPES_PART) {
      entries.push({ name, data: toUtf8(removeCalcChainOverride(bytes.toString("utf8"))) });
    } else if (hasCalcChain && name === WORKBOOK_RELS_PART) {
      entries.push({ name, data: toUtf8(removeCalcChainRelationship(bytes.toString("utf8"))) });
    } else {
      // 직인 그림·서식·인쇄 설정은 읽은 그대로 다시 담는다.
      entries.push({ name, data: bytes });
    }
  }

  return writeZip(entries);
}

/**
 * 그림 파트를 다시 쓴다 — **글상자의 글자를 비우고**, 늘어난 줄만큼 앵커를 민다.
 *
 * 순서가 중요하다. 비우기는 **원래 행 번호**로 어느 도형이 본문 위에 떠 있는지
 * 가리므로, 밀기보다 먼저 해야 한다.
 */
function rewriteDrawing(drawingXml: string, filled: FilledSheet): string {
  const cleared = clearDrawingTextInRows(
    drawingXml,
    filled.bodyFirstRow,
    filled.bodyLastRowBeforeShift
  );
  // 앵커의 행은 0부터 센다 — 1부터 세는 삽입 지점에서 하나 뺀다.
  return shiftDrawingAnchorRows(cleared, filled.insertRow - 1, filled.rowShift);
}

/**
 * 이 통합문서가 날짜를 ISO 8601(`t="d"`)로 담는가.
 *
 * `dateCompatibility="0"` 은 "1900 일련번호 체계를 쓰지 않는다"는 선언이다.
 * 그 선언이 있는 파일에 일련번호를 적으면 날짜가 아니라 숫자가 된다.
 */
export function usesIsoDates(workbookXml: string): boolean {
  return /<workbookPr[^>]*\sdateCompatibility="0"/.test(workbookXml);
}

export function validateServiceReportInput(input: ServiceReportInput): void {
  // 타입이 없는 곳에서도 불릴 수 있다 — 종류를 못 알아보면 여기서 멈춘다.
  const kind: string = input.kind;
  if (kind !== "INSPECTION" && kind !== "REPAIR") {
    throw new Error(`보고서 종류가 잘못됐습니다: ${kind}`);
  }
  if (input.customerName.trim() === "") throw new Error("고객사명이 비어 있습니다.");
  assertDate(input.issuedOn, "발행일");
  if (input.reportNumber.middle.trim() === "") throw new Error("보고서 번호(중간)가 비어 있습니다.");
  if (input.reportNumber.tail.trim() === "") throw new Error("보고서 번호(뒤)가 비어 있습니다.");

  if (input.receivedOn !== undefined) assertDate(input.receivedOn, "접수일");
  if (input.occurredOn !== undefined && typeof input.occurredOn !== "string") {
    assertDate(input.occurredOn, "발생 년월일");
  }
  assertWholeNumber(input.manufacturedYear, "제조 년");
  assertWholeNumber(input.manufacturedMonth, "제조 월");
  assertWholeNumber(input.usedYears, "사용 년수");
  assertWholeNumber(input.usedMonths, "사용 개월수");

  for (const cause of input.causes ?? []) {
    if (!(cause in CAUSE_CELLS)) throw new Error(`알 수 없는 원인 항목입니다: ${String(cause)}`);
  }

  const disposition: ServiceReportRepairDisposition = input.disposition ?? {};
  if (disposition.goodsReceipt?.on !== undefined) {
    assertDate(disposition.goodsReceipt.on, "현품 인수 날짜");
  }

  /**
   * 🔴 「조치 완료」와 「정리」는 수리 보고서의 것이다. 검사 보고서에 넘어오면
   * 조용히 버리지 않고 던진다 — 넘긴 쪽은 그것이 문서에 실린다고 믿고 있다.
   * (타입으로도 막히지만, 타입이 없는 곳에서 불릴 수 있다.)
   */
  const summary = (input.body as Partial<ServiceReportRepairBody>).summary;
  if (input.kind === "INSPECTION") {
    if (disposition.completion !== undefined) {
      throw new Error("검사 보고서에는 「조치 완료」를 적을 수 없습니다. 수리 보고서로 만들어야 합니다.");
    }
    if (summary !== undefined) {
      throw new Error("검사 보고서에는 「정리」 구역이 없습니다. 수리 보고서로 만들어야 합니다.");
    }
  } else {
    if (summary === undefined) throw new Error("수리 보고서에는 「정리」 줄 목록이 있어야 합니다(비어 있어도 됩니다).");
    if (disposition.completion?.on !== undefined) assertDate(disposition.completion.on, "조치 완료 날짜");
  }

  if (bodySections(input).every((section) => section.lines.length === 0)) {
    throw new Error("본문이 한 줄도 없습니다.");
  }
}

type BodySection = { labelLines: readonly string[]; lines: readonly string[] };

/**
 * 「확인내용」에 실제로 찍히는 줄 — 정형 문구가 첫 줄이다.
 *
 * 🔴 `findings` 가 비면 통째로 빈다. 그래야 "본문이 한 줄도 없습니다" 검사가
 * 정형 문구 때문에 통과해 버리는 일이 없고, 소개할 항목 없이 소개 문장만 찍힌
 * 문서도 안 나간다.
 */
function findingsLines(body: ServiceReportBody): readonly string[] {
  if (body.findings.length === 0) return [];
  // `?? 기본값` — 🔴 `||` 로 쓰면 빈 문자열이 기본값으로 되살아난다.
  const intro = body.findingsIntro ?? SERVICE_REPORT_FINDINGS_INTRO;
  return intro === "" ? body.findings : [intro, ...body.findings];
}

function bodySections(input: ServiceReportInput): BodySection[] {
  const sections: BodySection[] = [
    { labelLines: SERVICE_REPORT_BODY_LABELS.findings, lines: findingsLines(input.body) },
    { labelLines: SERVICE_REPORT_BODY_LABELS.actions, lines: input.body.actions },
  ];
  if (input.kind === "REPAIR") {
    sections.push({ labelLines: SERVICE_REPORT_BODY_LABELS.summary, lines: input.body.summary });
  }
  return sections;
}

/**
 * 그 구역이 차지하는 줄 수. 줄이 없는 구역은 통째로 건너뛰므로 0이다.
 *
 * 🔴 **라벨 줄 수가 내용 줄 수보다 많으면 라벨 쪽이 이긴다.** 「확인내용」의
 * 라벨은 두 줄(`확　내`/`인　용`)인데 확인 내용이 한 줄뿐인 건이 있을 수 있다.
 * 그때 다음 구역을 바로 다음 줄에서 시작하면 「조치」의 라벨이 `인　용` 자리에
 * 앉는다 — 라벨 열은 한 칸이라 둘 중 하나만 남고, 문서에는 「확인내용」이
 * 「확　내」 반쪽으로 찍힌다. 내용 칸 한 줄이 비는 것은 눈에 잘 안 띄지만
 * 반쪽 라벨은 바로 보인다. 그래서 **라벨이 온전한 쪽**을 고른다.
 */
function sectionRowCount(section: BodySection): number {
  if (section.lines.length === 0) return 0;
  return Math.max(section.lines.length, section.labelLines.length);
}

// ── 구역이 어느 행에서 시작하는가 ────────────────────────────────────────

/** OOXML 의 길이 단위. `1pt = 12700 EMU`. */
const EMU_PER_POINT = 12700;

/**
 * `<a:bodyPr>` 에 `tIns` 가 없을 때 쓰는 **규격 기본값**(0.05인치 = 45720 EMU).
 * 두 양식은 둘 다 적어 두었지만, 안 적힌 판이 와도 규격대로 셈한다.
 */
const DEFAULT_TEXT_TOP_INSET = 45720;

/** 한 구역이 실제로 앉는 자리. */
type SectionPlacement = { section: BodySection; startRow: number; rowCount: number };

/** 본문 배치 한 벌. `closingRow` 에 「～이　상～」 이 앉는다. */
type BodyLayout = { placements: SectionPlacement[]; closingRow: number };

/**
 * 🔴 본문 블록의 행 높이를 그 블록의 **최빈값**으로 통일한다.
 *
 * 수리 양식의 46행만 75.6pt 다(나머지 14.1pt, 검사 양식의 같은 행은 13.9pt).
 * 두 양식은 같은 통합문서이므로 이 한 행은 설계가 아니라 **그 발행본을 만든
 * 사람이 손으로 잡아 늘린 자국**이다. 그대로 두면 본문이 그 행에 닿는 순간
 * 문서 한가운데 손가락만 한 구멍이 뚫리고, 구역 자리 계산도 그 행에서 뒤틀린다
 * (실측: 「정리」가 51행이 아니라 47행이 된다).
 *
 * 🔴 **값을 코드에 박지 않는다.** 그 블록에서 가장 많이 쓰인 높이를 세어서
 * 고른다 — 사람이 양식의 본문 행 높이를 바꾸는 날 코드가 따라가야 한다.
 */
export function normalizeBodyRowHeights(
  sheetXml: string,
  block: { firstRow: number; lastRow: number }
): string {
  const rows = parseSheetRows(sheetXml);
  const inBody = (row: number): boolean => row >= block.firstRow && row <= block.lastRow;

  // 높이는 **글자 그대로** 센다 — 숫자로 바꾸면 `75.599999999999994` 같은 값이
  // 반올림되어 원본과 미묘하게 달라진다(sheet-rows.ts 의 같은 판단).
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!inBody(row.rowNumber)) continue;
    const height = readRowHeightAttribute(row);
    if (height === null) continue;
    counts.set(height, (counts.get(height) ?? 0) + 1);
  }
  if (counts.size === 0) {
    throw new Error(
      `양식의 본문(${block.firstRow}~${block.lastRow}행)에 행 높이가 적혀 있지 않습니다.`
    );
  }

  // 같은 수면 양식에서 먼저 나온 쪽. Map 은 넣은 순서를 지킨다.
  let mode = "";
  let most = -1;
  for (const [height, count] of counts) {
    if (count > most) {
      mode = height;
      most = count;
    }
  }

  return writeSheetRows(
    sheetXml,
    rows.map((row) => (inBody(row.rowNumber) ? setRowHeightAttribute(row, mode) : row))
  );
}

/**
 * 🔴 구역마다 **시작 행**을 라벨 글상자에서 계산한다 — 코드에 박지 않는다.
 *
 * 머리말 '세 구역은 각자 정해진 자리에서' 참조. 라벨 글상자의 N번째 문단이
 * 몇 행에 앉는지를 앵커(`<xdr:from>`)·안쪽여백(`tIns`)·줄간격(`lnSpc`)과 본문
 * 행 높이로 훑어 내려가 구한다. 라벨 글자가 든 문단만 구역의 시작이고 빈 문단은
 * 건너뛴다.
 *
 * ⚠️ **행 높이를 고르게 편 시트를 넘겨야 한다**(`normalizeBodyRowHeights`).
 * 75.6pt 짜리 손자국이 살아 있으면 그 아래 구역이 통째로 어긋난다.
 */
export function readSectionStartRows(
  drawingXml: string | null,
  sheetXml: string,
  block: { firstRow: number; lastRow: number },
  sections: readonly BodySection[]
): number[] {
  if (drawingXml === null) {
    throw new Error("양식에 그림 파트가 없어 본문 구역의 자리를 읽지 못했습니다.");
  }

  const shape = findBodyLabelShape(drawingXml);
  const anchor = readShapeAnchorTop(shape);
  const paragraphs = readParagraphTops(shape);
  const heightOf = createRowHeightReader(sheetXml);

  /** 앵커 행의 위쪽에서 `offset` EMU 만큼 내려간 자리가 어느 행인가. */
  const rowAt = (offset: number, label: string): number => {
    let row = anchor.row;
    let rest = offset;
    while (row <= block.lastRow) {
      const height = Math.round(heightOf(row) * EMU_PER_POINT);
      if (rest < height) return row;
      rest -= height;
      row += 1;
    }
    throw new Error(
      `양식의 라벨 「${label}」 이(가) 본문(${block.firstRow}~${block.lastRow}행) 밖을 가리킵니다.`
    );
  };

  const startRows: number[] = [];
  for (const section of sections) {
    const label = section.labelLines[0];
    const index = paragraphs.findIndex((paragraph) => paragraph.text.includes(label));
    if (index < 0) {
      throw new Error(
        `양식의 라벨 글상자에 「${label}」 이(가) 없습니다. 그 구역의 자리를 정할 수 없습니다.`
      );
    }

    const row = rowAt(anchor.rowOff + paragraphs[index].topEmu, label);
    if (row < block.firstRow) {
      throw new Error(`양식의 라벨 「${label}」 이(가) 본문 첫 줄(${block.firstRow}행) 위에 있습니다.`);
    }
    const previous = startRows[startRows.length - 1];
    if (previous !== undefined && row <= previous) {
      throw new Error(`양식의 구역 순서가 뒤집혀 있습니다: 「${label}」 이(가) ${row}행입니다.`);
    }
    startRows.push(row);
  }
  return startRows;
}

/**
 * 라벨 글상자. **이름으로 고르지 않는다** — 이름은 사람이 양식을 다시 저장할
 * 때마다 바뀔 수 있다. 라벨 글자가 든 도형이 대상이고, 하나가 아니면 던진다.
 */
function findBodyLabelShape(drawingXml: string): string {
  const labels = Object.values(SERVICE_REPORT_BODY_LABELS).map((lines) => lines[0]);

  const found: string[] = [];
  for (const anchor of drawingXml.matchAll(
    /<xdr:(twoCellAnchor|oneCellAnchor)[\s\S]*?<\/xdr:\1>/g
  )) {
    const xml = anchor[0];
    if (!xml.includes("<xdr:txBody>")) continue;
    const text = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]).join("\n");
    if (labels.some((label) => text.includes(label))) found.push(xml);
  }
  if (found.length !== 1) {
    throw new Error(
      `양식에서 본문 라벨 글상자를 ${found.length}개 찾았습니다. 하나여야 합니다.`
    );
  }
  return found[0];
}

/** 도형이 어느 행 어디쯤에서 시작하는가. 앵커의 행은 0부터 센다. */
function readShapeAnchorTop(shapeXml: string): { row: number; rowOff: number } {
  const from = /<xdr:from>([\s\S]*?)<\/xdr:from>/.exec(shapeXml)?.[1];
  const row = from === undefined ? undefined : /<xdr:row>(\d+)<\/xdr:row>/.exec(from)?.[1];
  const rowOff = from === undefined ? undefined : /<xdr:rowOff>(-?\d+)<\/xdr:rowOff>/.exec(from)?.[1];
  if (row === undefined || rowOff === undefined) {
    throw new Error("라벨 글상자의 앵커(<xdr:from> 의 row·rowOff)를 읽지 못했습니다.");
  }
  return { row: Number(row) + 1, rowOff: Number(rowOff) };
}

/**
 * 문단마다 **상자 위쪽에서 얼마나 내려온 자리인가**(EMU)와 그 글자.
 *
 * 🔴 줄간격은 **문단마다 따로** 읽는다. 검사 양식은 앞 14문단이 13pt 이고 수리
 * 양식은 11pt 라, 하나로 뭉뚱그리면 한쪽이 두 행 어긋난다.
 *
 * `<a:spcPts val="1100"/>` 는 **11.00pt** 다(100분의 1 포인트 단위). 비율
 * 줄간격(`<a:spcPct>`)은 글꼴 치수를 알아야 재므로 **짐작하지 않고 던진다** —
 * 엉뚱한 자리에 그린 문서를 내보내는 것보다 멈추는 편이 낫다.
 */
function readParagraphTops(shapeXml: string): { text: string; topEmu: number }[] {
  const txBody = /<xdr:txBody>[\s\S]*?<\/xdr:txBody>/.exec(shapeXml)?.[0];
  if (txBody === undefined) throw new Error("라벨 글상자의 글자(<xdr:txBody>)를 읽지 못했습니다.");

  const inset = /<a:bodyPr[^>]*\stIns="(-?\d+)"/.exec(txBody)?.[1];
  let top = inset === undefined ? DEFAULT_TEXT_TOP_INSET : Number(inset);

  const paragraphs = [...txBody.matchAll(/<a:p\s*\/>|<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g)];
  if (paragraphs.length === 0) throw new Error("라벨 글상자에 문단이 하나도 없습니다.");

  const tops: { text: string; topEmu: number }[] = [];
  for (const [index, match] of paragraphs.entries()) {
    const paragraph = match[0];
    const spacing = /<a:lnSpc>\s*<a:spcPts\s+val="(\d+)"\s*\/>\s*<\/a:lnSpc>/.exec(paragraph)?.[1];
    if (spacing === undefined) {
      throw new Error(
        `라벨 글상자의 ${index + 1}번째 문단에서 줄간격(<a:lnSpc><a:spcPts>)을 읽지 못했습니다.`
      );
    }

    const text = [...paragraph.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((run) => run[1])
      .join("");
    tops.push({ text, topEmu: top });
    top += Math.round((Number(spacing) / 100) * EMU_PER_POINT);
  }
  return tops;
}

/** 행 높이(pt)를 읽어 주는 함수. 안 적힌 행은 시트의 기본 높이를 쓴다. */
function createRowHeightReader(sheetXml: string): (row: number) => number {
  const heights = new Map<number, number>();
  for (const row of parseSheetRows(sheetXml)) {
    const height = Number(readRowHeightAttribute(row));
    if (Number.isFinite(height) && height > 0) heights.set(row.rowNumber, height);
  }

  const declared = Number(/<sheetFormatPr[^>]*\sdefaultRowHeight="([\d.]+)"/.exec(sheetXml)?.[1]);
  const fallback = Number.isFinite(declared) && declared > 0 ? declared : 15;
  return (row) => heights.get(row) ?? fallback;
}

/**
 * 🔴 「확인내용」 구역만 글상자가 가리키는 자리보다 **한 줄 아래**에서 시작한다.
 *
 * ⚠️ **이 한 줄은 양식에서 나오는 값이 아니다.** 양식의 두 글상자(본문 상자와
 * 라벨 상자)는 **둘 다 31행**을 가리킨다 — 실측으로 확인했다. 그런데 실제
 * 발행본의 「확인내용」은 32행에서 시작한다. **2026-09-02 사용자 결정**이다.
 *
 * 🔴 그래서 나중에 이 값을 보고 "글상자 계산이 31을 주는데 왜 32지? 버그인가?"
 * 하고 0 으로 되돌리지 말 것. `readSectionStartRows` 는 **옳은 값을 내놓고
 * 있고**, 그 위에 발행본의 관례가 한 줄 얹혀 있는 것이다.
 *
 * 「조치」·「정리」는 그대로 둔다 — 그쪽은 발행본과 글상자가 같은 자리다.
 */
export const SERVICE_REPORT_FINDINGS_ROW_OFFSET = 1;

/**
 * 위 규칙을 **시작 행 목록에만** 얹는다. 계산(`readSectionStartRows`)은 손대지
 * 않는다 — 왜곡하면 양식의 글상자를 따라간다는 성질이 통째로 죽는다.
 *
 * 구역은 라벨 글자로 가린다. 자리(index)로 가리면 「확인내용」이 없는 문서에서
 * 엉뚱한 구역이 밀린다.
 */
export function shiftFindingsSectionDown(
  sections: readonly { labelLines: readonly string[] }[],
  startRows: readonly number[]
): number[] {
  const findingsLabel = SERVICE_REPORT_BODY_LABELS.findings[0];
  return startRows.map((row, index) =>
    sections[index]?.labelLines[0] === findingsLabel
      ? row + SERVICE_REPORT_FINDINGS_ROW_OFFSET
      : row
  );
}

/**
 * 🔴 구역을 **각자 정해진 자리에서** 시작시킨다 — 이 작업의 본체.
 *
 *   · 한 구역이 차지하는 줄 수 = `max(배정된 줄 수, 실제 내용 줄 수)`.
 *     배정된 줄 수는 **다음 구역의 시작 행**에서 나온다. 내용이 짧아도 다음
 *     구역은 제자리에서 시작한다.
 *   · 내용이 배정된 자리보다 길면 그 구역이 늘어나고 **아래가 그만큼 밀린다.**
 *   · 🔴 **마지막으로 내용이 있는 구역은 늘리지 않는다.** 그 구역은 제 줄 수만
 *     쓰고 맺음 표시가 바로 다음 줄에 온다 — 안 그러면 두 줄짜리 보고서에서도
 *     블록이 꽉 차 맺음 표시가 블록 밖으로 밀린다.
 *   · 내용이 없는 구역은 라벨을 그리지 않되 **아래 구역의 자리는 그대로 둔다.**
 */
function planBodyLayout(
  sections: readonly BodySection[],
  startRows: readonly number[],
  block: { firstRow: number; lastRow: number }
): BodyLayout {
  let lastWithLines = -1;
  sections.forEach((section, index) => {
    if (section.lines.length > 0) lastWithLines = index;
  });
  // 입력 검사가 이미 막지만, 타입이 없는 곳에서 불릴 수 있다.
  if (lastWithLines < 0) throw new Error("본문이 한 줄도 없습니다.");

  const placements: SectionPlacement[] = [];
  let cursor = block.firstRow;

  for (const [index, section] of sections.entries()) {
    const startRow = Math.max(startRows[index], cursor);
    if (section.lines.length === 0) {
      // 🔴 마지막 내용 구역 **뒤의** 빈 구역은 자리도 차지하지 않는다 —
      //    차지하면 맺음 표시가 쓰이지도 않은 구역 아래로 밀려 내려간다.
      if (index < lastWithLines) cursor = startRow;
      continue;
    }

    const lines = sectionRowCount(section);
    const allotted =
      index + 1 < startRows.length
        ? startRows[index + 1] - startRows[index]
        : block.lastRow - startRows[index] + 1;

    const rowCount = index === lastWithLines ? lines : Math.max(allotted, lines);
    placements.push({ section, startRow, rowCount });
    cursor = startRow + rowCount;
  }

  return { placements, closingRow: cursor };
}

function assertDate(value: Date, what: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${what}이(가) 유효한 날짜가 아닙니다.`);
  }
}

function assertWholeNumber(value: number | undefined, what: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${what}은(는) 0 이상의 정수여야 합니다: ${String(value)}`);
  }
}

function toUtf8(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

// ── 시트 채우기 ──────────────────────────────────────────────────────────

/** 채운 시트와, **그 밖의 파트가 따라가야 하는 자리**들. */
type FilledSheet = {
  xml: string;
  /** 본문 왼쪽 맞춤 `xf` 가 뒤에 더해진 `styles.xml`. 원본의 `xf` 는 그대로다. */
  stylesXml: string;
  /** 끼워 넣은 줄 수. 0이면 이 파일은 예전과 똑같이 동작한다. */
  rowShift: number;
  /** 끼워 넣기 시작한 줄(1부터). 이 줄 이상이 `rowShift` 만큼 내려갔다. */
  insertRow: number;
  bodyFirstRow: number;
  /** 줄을 끼워 넣기 **전**의 본문 마지막 줄. 그림 앵커를 가릴 때 쓴다. */
  bodyLastRowBeforeShift: number;
};

function fillSheet(
  sheetXml: string,
  sharedStringsXml: string | null,
  stylesXml: string,
  drawingXml: string | null,
  input: ServiceReportInput,
  isoDates: boolean
): FilledSheet {
  const read = createCellTextReader(sheetXml, sharedStringsXml);
  assertLayout(read);

  const block = findBodyBlock(sheetXml);
  const remarkBlock = findLabelledBlock(sheetXml, REMARK_LABEL_CELL);

  /**
   * 🔴 **구역 자리를 셈하기 전에** 본문 행 높이를 고르게 편다. 수리 양식의
   * 46행에는 발행본을 만든 사람의 손자국(75.6pt)이 남아 있어서, 그대로 두면
   * 「정리」가 51행이 아니라 47행으로 나온다(머리말 '46행의 높이는 실수다').
   */
  const evened = normalizeBodyRowHeights(sheetXml, block);

  /**
   * 🔴 한 줄이 칸의 가로폭을 넘지 않게 먼저 나눈다. **줄 수를 셈하기 전에**
   * 해야 한다 — 나눈 뒤의 줄 수가 곧 필요한 행 수다.
   */
  const lineWidth = readColumnRangeWidth(evened, block.contentColumn, block.contentEndColumn);
  const sections = bodySections(input).map((section) => ({
    labelLines: section.labelLines,
    lines: section.lines.flatMap((line) => splitBodyLine(line, lineWidth)),
  }));

  const layout = planBodyLayout(
    sections,
    // 🔴 「확인내용」만 한 줄 아래에서 시작한다 — 발행본이 그렇다.
    //    계산은 그대로 두고 규칙만 얹는다(`SERVICE_REPORT_FINDINGS_ROW_OFFSET`).
    shiftFindingsSectionDown(sections, readSectionStartRows(drawingXml, evened, block, sections)),
    block
  );
  // 본문 마지막 줄 다음에 「～이　상～」 한 줄이 더 든다.
  const neededRows = layout.closingRow - block.firstRow + 1;
  if (neededRows > SERVICE_REPORT_MAX_BODY_ROWS) {
    throw new Error(
      `본문이 ${neededRows}줄입니다. 한 보고서에 ${SERVICE_REPORT_MAX_BODY_ROWS}줄까지만 담을 수 있습니다.`
    );
  }
  const capacity = block.lastRow - block.firstRow + 1;
  const rowShift = Math.max(0, neededRows - capacity);

  let xml = rowShift === 0 ? evened : growBodyBlock(evened, block, rowShift);

  const insertRow = block.lastRow;
  const shifted = (row: number): number => (row >= insertRow ? row + rowShift : row);
  const remark = {
    firstRow: shifted(remarkBlock.firstRow),
    lastRow: shifted(remarkBlock.lastRow),
    contentColumn: remarkBlock.contentColumn,
  };

  const writeDate = (xml: string, ref: string, value: Date | undefined): string =>
    value === undefined
      ? clearCell(xml, ref)
      : isoDates
        ? setIsoDate(xml, ref, value)
        : setDate(xml, ref, value);

  // ── 머리 ──────────────────────────────────────────────────────────
  xml = setInlineString(xml, SERVICE_REPORT_CELLS.customerName, input.customerName.trim());
  xml = writeDate(xml, SERVICE_REPORT_CELLS.issuedOn, input.issuedOn);
  xml = setInlineString(xml, SERVICE_REPORT_CELLS.title, SERVICE_REPORT_TITLES[input.kind]);

  const prefix = input.reportNumber.prefix?.trim() ?? "";
  xml = setInlineString(
    xml,
    SERVICE_REPORT_CELLS.reportNumberPrefix,
    prefix === "" ? "No. " : `No. ${prefix} - `
  );
  xml = setInlineString(xml, SERVICE_REPORT_CELLS.reportNumberMiddle, input.reportNumber.middle.trim());
  xml = setInlineString(xml, SERVICE_REPORT_CELLS.reportNumberTail, input.reportNumber.tail.trim());

  xml = writeText(xml, SERVICE_REPORT_CELLS.customer, input.customer?.trim());
  xml = writeDate(xml, SERVICE_REPORT_CELLS.receivedOn, input.receivedOn);
  xml = writeText(xml, SERVICE_REPORT_CELLS.occurrencePlace, input.occurrencePlace?.trim());
  xml = writeText(xml, SERVICE_REPORT_CELLS.occurrencePlaceDetail, input.occurrencePlaceDetail?.trim());

  xml =
    typeof input.occurredOn === "string"
      ? setInlineString(xml, SERVICE_REPORT_CELLS.occurredOn, input.occurredOn)
      : writeDate(xml, SERVICE_REPORT_CELLS.occurredOn, input.occurredOn);

  xml = writeText(xml, SERVICE_REPORT_CELLS.productName, input.productName?.trim());
  xml = writeText(xml, SERVICE_REPORT_CELLS.productCategory, input.productCategory?.trim());
  xml = writeText(xml, SERVICE_REPORT_CELLS.modelName, input.modelName?.trim());
  xml = writeNumber(xml, SERVICE_REPORT_CELLS.manufacturedYear, input.manufacturedYear);
  xml = writeNumber(xml, SERVICE_REPORT_CELLS.manufacturedMonth, input.manufacturedMonth);

  // 상황·본문·비고는 다듬지 않는다 — 양식의 글머리표가 앞 공백이다(` ・수리의뢰`).
  xml = writeText(xml, SERVICE_REPORT_CELLS.situationRequest, input.situation?.request);
  xml = writeText(xml, SERVICE_REPORT_CELLS.situationDetail, input.situation?.detail);

  xml = writeText(xml, SERVICE_REPORT_CELLS.lotNumber, input.lotNumber?.trim());
  xml = writeText(xml, SERVICE_REPORT_CELLS.serialNumber, input.serialNumber?.trim());
  xml = writeNumber(xml, SERVICE_REPORT_CELLS.usedYears, input.usedYears);
  xml = writeNumber(xml, SERVICE_REPORT_CELLS.usedMonths, input.usedMonths);
  xml = writeText(xml, SERVICE_REPORT_CELLS.repairNumber, input.repairNumber?.trim());

  // ── 조치 ──────────────────────────────────────────────────────────
  const disposition: ServiceReportRepairDisposition = input.disposition ?? {};
  xml = writeCheck(xml, DISPOSITION_CELLS.onSiteRepair.checkCell, disposition.onSiteRepair === true);
  xml = writeCheck(
    xml,
    DISPOSITION_CELLS.replacementDelivery.checkCell,
    disposition.replacementDelivery === true
  );

  const goodsReceipt = disposition.goodsReceipt;
  xml = writeCheck(xml, DISPOSITION_CELLS.goodsReceipt.checkCell, goodsReceipt !== undefined);
  xml = writeDate(xml, SERVICE_REPORT_CELLS.goodsReceivedOn, goodsReceipt?.on);
  xml = writeText(xml, SERVICE_REPORT_CELLS.goodsReceiptNumber, goodsReceipt?.number?.trim());

  // 🔴 검사 보고서면 여기가 반드시 빈다. 양식(수리 보고서 사본)에는 `○` 와
  //    `=AO8` 수식이 남아 있으므로, 안 지우면 검사 보고서에 조치 완료가 찍힌다.
  const completion = input.kind === "REPAIR" ? disposition.completion : undefined;
  xml = writeCheck(xml, DISPOSITION_CELLS.completion.checkCell, completion !== undefined);
  xml = writeDate(xml, SERVICE_REPORT_CELLS.completedOn, completion?.on);

  // ── 원인 ──────────────────────────────────────────────────────────
  const chosen = new Set(input.causes ?? []);
  for (const cause of SERVICE_REPORT_CAUSES) {
    xml = writeCheck(xml, CAUSE_CELLS[cause].checkCell, chosen.has(cause));
  }

  // ── 본문 ──────────────────────────────────────────────────────────
  xml = fillBody(xml, { ...block, lastRow: block.lastRow + rowShift }, layout);

  /**
   * 🔴 본문 **내용 줄만** 왼쪽으로. 맺음 표시가 앉는 줄 바로 위까지가 내용
   * 자리다(구역 사이의 빈 줄도 여기 든다 — 언제 글자가 들어와도 모양이 같아야
   * 한다). 맺음 표시는 원본 서식 그대로 둔다(가운데 맞춤이고, 마지막 줄이면
   * 상자의 아래 테두리가 그 서식에 걸려 있다).
   */
  const aligned = alignBodyContentLeft(xml, stylesXml, {
    column: block.contentColumn,
    firstRow: block.firstRow,
    lastRow: layout.closingRow - 1,
  });
  xml = aligned.sheetXml;

  // ── 비고 ──────────────────────────────────────────────────────────
  const remarkLines = input.remark ?? [];
  const remarkCapacity = remark.lastRow - remark.firstRow + 1;
  if (remarkLines.length > remarkCapacity) {
    throw new Error(
      `비고가 ${remarkLines.length}줄인데 양식에는 ${remarkCapacity}줄만 들어갑니다. 줄을 줄여 주세요.`
    );
  }
  for (let index = 0; index < remarkCapacity; index += 1) {
    const ref = `${remark.contentColumn}${remark.firstRow + index}`;
    xml = writeText(xml, ref, remarkLines[index]);
  }

  return {
    xml,
    stylesXml: aligned.stylesXml,
    rowShift,
    insertRow,
    bodyFirstRow: block.firstRow,
    bodyLastRowBeforeShift: block.lastRow,
  };
}

/**
 * 🔴 본문 **내용 칸**을 왼쪽 맞춤으로 바꾼다 — 서식을 **더해서**.
 *
 * 양식의 본문 칸은 `horizontal="center"` 다. 그 `xf` 를 고치면 **같은 번호를
 * 쓰는 라벨 칸까지** 왼쪽으로 따라가므로(이 양식은 실제로 그렇다), `xf` 를
 * 복제해 뒤에 붙이고 내용 칸만 새 번호를 가리키게 한다. 번호는 코드에 박지
 * 않고 **그 칸이 지금 쓰고 있는 번호를 읽어서** 뜬다 — 검사·수리 두 양식이
 * 다른 번호를 쓰고, 첫 줄·가운뎃줄·마지막 줄도 서로 다르기 때문이다.
 */
function alignBodyContentLeft(
  sheetXml: string,
  stylesXml: string,
  body: { column: string; firstRow: number; lastRow: number }
): { sheetXml: string; stylesXml: string } {
  if (body.lastRow < body.firstRow) return { sheetXml, stylesXml };

  const sourceByRef = new Map<string, number>();
  for (let row = body.firstRow; row <= body.lastRow; row += 1) {
    const ref = `${body.column}${row}`;
    // 서식이 아예 없는 칸은 0번(기본 서식)을 쓰는 것이다.
    const style = findCell(sheetXml, ref).style;
    const index = style === null ? 0 : Number(style);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`${ref} 의 서식 번호를 읽지 못했습니다: "${String(style)}"`);
    }
    sourceByRef.set(ref, index);
  }

  const aligned = addAlignedCellXfs(stylesXml, [...sourceByRef.values()], "left");

  let xml = sheetXml;
  for (const [ref, source] of sourceByRef) {
    const target = aligned.indexBySource.get(source);
    if (target === undefined) {
      throw new Error(`${ref} 의 왼쪽 맞춤 서식을 만들지 못했습니다(원본 ${source}번).`);
    }
    if (target !== source) xml = setCellStyle(xml, ref, target);
  }
  return { sheetXml: xml, stylesXml: aligned.xml };
}

/**
 * 한 줄을 칸의 가로폭에 맞춰 나눈다.
 *
 * 줄 안의 줄바꿈(`\n`)은 **먼저 갈라 놓는다.** 그것을 공백처럼 다루면 사람이
 * 나눠 쓴 두 줄이 한 줄로 붙어 버리고, 붙은 자리는 아무도 눈치채지 못한다.
 */
function splitBodyLine(line: string, width: number): string[] {
  return line.split(/\r\n?|\n/u).flatMap((piece) => wrapTextToWidth(piece, width));
}

function fillBody(sheetXml: string, block: BodyBlock, layout: BodyLayout): string {
  const capacity = block.lastRow - block.firstRow + 1;
  const used = layout.closingRow - block.firstRow;
  if (used + 1 > capacity) {
    /**
     * 🔴 여기까지 오면 줄을 늘리는 쪽(`growBodyBlock`)이 셈을 틀린 것이다.
     * 조용히 자르지 않는다 — 잘린 줄은 아무 표시 없이 사라지고, 그것이
     * 「조치」의 마지막 줄이면 우리가 한 일이 문서에서 사라진 채 나간다.
     */
    throw new Error(
      `본문이 ${used}줄인데 양식에는 ${capacity - 1}줄만 들어갑니다(${block.firstRow}~${block.lastRow}행).`
    );
  }

  let xml = sheetXml;
  // 양식이 발행본 사본이라 먼저 통째로 비운다. 위 '양식 파일이 빈 양식이 아니다'.
  for (let row = block.firstRow; row <= block.lastRow; row += 1) {
    xml = clearCell(xml, `${block.labelColumn}${row}`);
    xml = clearCell(xml, `${block.contentColumn}${row}`);
  }

  for (const placement of layout.placements) {
    /**
     * 라벨과 내용은 **다른 열**이라 서로 밀지 않는다. 둘 다 구역이 시작하는
     * 줄부터 각자 내려간다 — 「확인내용」의 라벨 둘째 줄(`인　용`)은 내용
     * 둘째 줄과 같은 행에 앉는다.
     */
    placement.section.labelLines.forEach((text, index) => {
      xml = setInlineString(xml, `${block.labelColumn}${placement.startRow + index}`, text);
    });
    placement.section.lines.forEach((line, index) => {
      xml = writeText(xml, `${block.contentColumn}${placement.startRow + index}`, line);
    });
  }

  // 🔴 맺음 표시는 **언제나 마지막 내용 줄의 다음 줄**이다.
  xml = setInlineString(
    xml,
    `${block.contentColumn}${layout.closingRow}`,
    SERVICE_REPORT_CLOSING_MARK
  );
  return xml;
}

function writeText(sheetXml: string, ref: string, value: string | undefined): string {
  // setInlineString 은 빈 문자열을 받으면 칸을 비운다(서식은 남긴다).
  return setInlineString(sheetXml, ref, value ?? "");
}

function writeNumber(sheetXml: string, ref: string, value: number | undefined): string {
  return value === undefined ? clearCell(sheetXml, ref) : setNumber(sheetXml, ref, value);
}

function writeCheck(sheetXml: string, ref: string, checked: boolean): string {
  return checked
    ? setInlineString(sheetXml, ref, SERVICE_REPORT_CHECK_MARK)
    : clearCell(sheetXml, ref);
}

// ── 줄을 끼워 넣는다 ─────────────────────────────────────────────────────

/**
 * 본문 구역에 `delta` 줄을 끼워 넣는다. 파일 머리말의 '함께 밀려야 하는 것이
 * 여섯' 을 전부 여기서 한다.
 *
 * 🔴 **끼워 넣는 자리는 본문 마지막 줄의 바로 위**다. 마지막 줄에는 상자의
 * 밑변이 붙어 있어서(`border` 의 `bottom="thin"`), 그 아래에 넣으면 테두리가
 * 문서 한가운데 남고 상자의 바닥이 열린 채로 나간다. 복제할 본도 같은 이유로
 * 마지막 줄이 아니라 **그 위의 줄**이다 — 그 줄이 가운뎃줄의 서식을 갖고 있다.
 */
function growBodyBlock(sheetXml: string, block: BodyBlock, delta: number): string {
  const insertRow = block.lastRow;
  const modelRow = Math.max(block.firstRow, block.lastRow - 1);
  const middleCount = block.lastRow - block.firstRow;

  assertControlsAreAboveBody(sheetXml, insertRow);

  const rows = parseSheetRows(sheetXml);
  const grown = resizeRowBlock(rows, {
    firstRow: block.firstRow,
    currentCount: middleCount,
    targetCount: middleCount + delta,
    modelRow,
  });

  let xml = writeSheetRows(sheetXml, grown.rows);
  xml = shiftMergeCellRows(xml, insertRow, delta);
  xml = shiftSqrefRows(xml, insertRow, delta);

  const newRows = Array.from({ length: delta }, (_value, index) => insertRow + index);
  xml = cloneRowMergeCells(xml, modelRow, newRows);
  xml = syncDimension(xml, grown.rows);
  return replaceSharedHelperFormulas(xml, block, delta);
}

/**
 * 🔴 **어긋난 공유 수식은 Excel 이 파일 열기를 거부하는 사유다.**
 *
 * 글자수 도우미는 `<f t="shared" ref="BC31:BC59" si="0">LEN(H31)</f>` 한 덩이와
 * 그 아래 `<f t="shared" si="0"/>` 스물여덟이다. 줄을 끼워 넣으면 마지막 딸림
 * 칸이 `ref` **밖으로** 밀려난다.
 *
 * `ref` 만 늘리는 길도 있지만 택하지 않았다. 복제한 줄에는 수식이 아예 없어서
 * (복제하면서 값을 비운다) "범위 안에 빈 칸이 섞인 공유 수식"이 되고, 그것을
 * Excel 판마다 똑같이 받아 주는지는 우리가 확인할 수 없다. **보통 수식은 판을
 * 안 탄다** — 견적서 채우개 셋이 같은 자리에서 내린 판단이다.
 *
 * 캐시값(`<v>`)은 남기지 않는다. `fullCalcOnLoad` 가 켜져 있어 Excel 이 연다.
 */
function replaceSharedHelperFormulas(
  sheetXml: string,
  block: BodyBlock,
  delta: number
): string {
  let xml = sheetXml;
  for (let row = block.firstRow; row <= block.lastRow + delta; row += 1) {
    const ref = `${block.helperColumn}${row}`;
    // 양식에 그 칸이 없을 수도 있다(도우미 열이 짧은 판). 없으면 건너뛴다.
    if (!new RegExp(`<c r="${ref}"[\\s/>]`).test(xml)) continue;
    xml = setFormula(xml, ref, `LEN(${block.contentColumn}${row})`);
  }
  return xml;
}

/**
 * ActiveX 단추가 삽입 지점보다 **위**에 있는지 확인한다.
 *
 * 이 양식의 단추 둘은 3~7행이라 밀 것이 없다. 그런데 단추의 자리는 시트의
 * `<controls>` 와 `vmlDrawing2.vml` **두 곳**에 따로 적혀 있어서, 언젠가
 * 단추가 본문 아래로 내려온 양식이 오면 한쪽만 밀어 둘이 어긋나게 된다.
 * 그 상태는 Excel 이 파일을 복구 모드로 여는 사유다. 짐작해서 미는 대신
 * **멈추고 알린다.**
 */
function assertControlsAreAboveBody(sheetXml: string, insertRow: number): void {
  const controls = /<controls[^>]*>([\s\S]*?)<\/controls>/.exec(sheetXml)?.[1];
  if (controls === undefined) return;

  for (const anchor of controls.matchAll(/<(?:\w+:)?row>(\d+)<\/(?:\w+:)?row>/g)) {
    // 앵커의 행은 0부터 센다.
    if (Number(anchor[1]) + 1 < insertRow) continue;
    throw new Error(
      `양식의 단추(ActiveX)가 본문 아래(${Number(anchor[1]) + 1}행)에 있습니다. ` +
        `줄을 늘리면 자리가 어긋나므로 이 양식으로는 본문을 늘릴 수 없습니다.`
    );
  }
}

// ── 글상자의 견본 글자를 비운다 ─────────────────────────────────────────

/**
 * `firstRow`~`lastRow` 위에 떠 있는 **글상자의 글자만** 비운다.
 *
 * 도형 자체(테두리·위치·크기)와 그림(직인)은 그대로 둔다 — 지우면 관계와
 * 그림 번호가 함께 흔들린다. 이름(`Text Box 7`)으로 고르지 않고 **자리로**
 * 고른다: 본문 줄과 겹치면서 글자를 담고 있는 도형이 대상이다. 이름은 사람이
 * 양식을 다시 저장할 때마다 바뀔 수 있지만 자리는 안 바뀐다.
 */
export function clearDrawingTextInRows(
  drawingXml: string,
  firstRow: number,
  lastRow: number
): string {
  return drawingXml.replace(
    /<xdr:(twoCellAnchor|oneCellAnchor)[\s\S]*?<\/xdr:\1>/g,
    (anchor) => {
      if (!anchor.includes("<xdr:txBody>")) return anchor;

      const rows = [...anchor.matchAll(/<xdr:row>(\d+)<\/xdr:row>/g)].map((m) => Number(m[1]) + 1);
      if (rows.length === 0) return anchor;
      const anchorFirst = rows[0];
      const anchorLast = rows[rows.length - 1];
      if (anchorLast < firstRow || anchorFirst > lastRow) return anchor;

      return anchor.replace(/<xdr:txBody>[\s\S]*?<\/xdr:txBody>/g, (txBody) => {
        // 글자 모양(bodyPr·lstStyle)은 남기고 문단만 없앤다.
        const bodyPr = /<a:bodyPr[^>]*\/>|<a:bodyPr[^>]*>[\s\S]*?<\/a:bodyPr>/.exec(txBody)?.[0];
        const lstStyle = /<a:lstStyle[^>]*\/>|<a:lstStyle[^>]*>[\s\S]*?<\/a:lstStyle>/.exec(
          txBody
        )?.[0];
        return `<xdr:txBody>${bodyPr ?? "<a:bodyPr/>"}${lstStyle ?? "<a:lstStyle/>"}<a:p/></xdr:txBody>`;
      });
    }
  );
}

// ── 양식에서 자리를 읽는다 ───────────────────────────────────────────────

function assertLayout(read: (ref: string) => string | null): void {
  const guards = [
    ...LAYOUT_GUARDS,
    ...Object.values(DISPOSITION_CELLS).map(
      (item) => [item.labelCell, item.label] as readonly [string, string]
    ),
    ...Object.values(CAUSE_CELLS).map(
      (item) => [item.labelCell, item.label] as readonly [string, string]
    ),
  ];

  for (const [ref, expected] of guards) {
    const actual = read(ref);
    // 위 '`startsWith` 로 견준다' 참조 — 후리가나가 뒤에 붙어 온다.
    if (actual === null || !actual.startsWith(expected)) {
      throw new Error(
        `양식이 바뀐 것 같습니다: ${ref} 에 "${expected}" 이(가) 있어야 하는데 ${
          actual === null ? "비어 있습니다" : `"${actual}" 입니다`
        }.`
      );
    }
  }
}

type BodyBlock = {
  firstRow: number;
  lastRow: number;
  labelColumn: string;
  contentColumn: string;
  /** 내용 칸 병합의 오른쪽 끝(`H31:AU31` 의 `AU`). 줄 폭을 셈할 때 쓴다. */
  contentEndColumn: string;
  /** 글자수 도우미가 든 열(`BC`). 줄이 늘면 이 열의 공유 수식을 갈아 끼운다. */
  helperColumn: string;
};

/**
 * 본문 줄의 범위를 **양식이 스스로 적어 둔 곳**에서 읽는다.
 *
 *   `<f t="shared" ref="BC31:BC59" si="0">LEN(H31)</f>`
 *
 * `ref` 가 줄 범위, `LEN(...)` 안의 열이 본문 내용 열이다. 사람이 Excel 에서
 * 본문 줄을 끼워 넣으면 Excel 이 이 `ref` 를 함께 늘려 주므로, 여기를 읽으면
 * 코드가 양식을 따라간다.
 */
export function findBodyBlock(sheetXml: string): BodyBlock {
  const found = [
    ...sheetXml.matchAll(
      /<f[^>]*\st="shared"[^>]*\sref="([A-Z]+)(\d+):([A-Z]+)(\d+)"[^>]*>LEN\(([A-Z]+)(\d+)\)<\/f>/g
    ),
  ];
  if (found.length !== 1) {
    throw new Error(
      `양식에서 본문 글자수 도우미(LEN 공유 수식)를 ${found.length}개 찾았습니다. 하나여야 합니다.`
    );
  }

  const [, startColumn, startRow, endColumn, endRow, contentColumn, contentRow] = found[0];
  if (startColumn !== endColumn) {
    throw new Error(`본문 도우미가 한 열이 아닙니다: ${startColumn}${startRow}:${endColumn}${endRow}`);
  }
  if (contentRow !== startRow) {
    throw new Error(
      `본문 도우미가 자기 줄을 세지 않습니다: ${startColumn}${startRow} 이 ${contentColumn}${contentRow} 을 봅니다.`
    );
  }

  const firstRow = Number(startRow);
  const lastRow = Number(endRow);
  if (lastRow < firstRow) throw new Error(`본문 줄 범위가 뒤집혀 있습니다: ${firstRow}~${lastRow}`);

  return {
    firstRow,
    lastRow,
    labelColumn: findLabelColumn(sheetXml, firstRow, contentColumn),
    contentColumn,
    contentEndColumn: findContentEndColumn(sheetXml, firstRow, contentColumn),
    helperColumn: startColumn,
  };
}

/**
 * 본문 라벨 열. 본문 첫 줄의 병합 칸 중 **내용 열 바로 왼쪽에서 끝나는 것**
 * (`C31:G31`)의 시작 열이다. 라벨 칸 너비가 바뀌어도 따라간다.
 */
function findLabelColumn(sheetXml: string, row: number, contentColumn: string): string {
  const wanted = columnIndex(contentColumn) - 1;
  for (const ref of readMergeRefs(sheetXml)) {
    const parsed = parseMergeRef(ref);
    if (!parsed) continue;
    if (parsed.firstRow !== row || parsed.lastRow !== row) continue;
    if (columnIndex(parsed.endColumn) === wanted) return parsed.startColumn;
  }
  throw new Error(`${row}행에서 본문 라벨 칸(${contentColumn} 왼쪽)을 찾지 못했습니다.`);
}

/**
 * 본문 내용 칸의 오른쪽 끝. 첫 줄의 병합(`H31:AU31`)이 알려 준다. 이 값이
 * 있어야 한 줄에 몇 칸이 들어가는지 셈할 수 있다.
 */
function findContentEndColumn(sheetXml: string, row: number, contentColumn: string): string {
  for (const ref of readMergeRefs(sheetXml)) {
    const parsed = parseMergeRef(ref);
    if (!parsed) continue;
    if (parsed.firstRow !== row || parsed.lastRow !== row) continue;
    if (parsed.startColumn === contentColumn) return parsed.endColumn;
  }
  throw new Error(`${row}행에서 본문 내용 칸(${contentColumn} 로 시작하는 병합)을 찾지 못했습니다.`);
}

/**
 * 🔴 `startColumn` ~ `endColumn` 이 몇 칸인가 — **양식의 `<cols>` 에서 읽는다.**
 *
 * 이 양식은 `<col min="8" max="47" width="1.875"/>` 라 `H`~`AU` 40열이 75칸이다.
 * 75 를 코드에 박으면 사람이 양식의 열 너비를 고치는 날 줄이 어긋나고, 그때
 * 증상은 "어떤 보고서만 글자가 칸 밖으로 흘러나온다" 라서 아무도 못 잡는다.
 */
export function readColumnRangeWidth(
  sheetXml: string,
  startColumn: string,
  endColumn: string
): number {
  const first = columnIndex(startColumn);
  const last = columnIndex(endColumn);
  if (last < first) throw new Error(`열 범위가 뒤집혀 있습니다: ${startColumn}:${endColumn}`);

  const fallback = Number(/<sheetFormatPr[^>]*\sdefaultColWidth="([\d.]+)"/.exec(sheetXml)?.[1]);
  const defaultWidth = Number.isFinite(fallback) && fallback > 0 ? fallback : 8.43;

  const cols = /<cols[^>]*>([\s\S]*?)<\/cols>/.exec(sheetXml)?.[1] ?? "";
  const ranges = [...cols.matchAll(/<col\s[^>]*\/>/g)].map((match) => ({
    min: Number(/\smin="(\d+)"/.exec(match[0])?.[1] ?? "0"),
    max: Number(/\smax="(\d+)"/.exec(match[0])?.[1] ?? "0"),
    width: Number(/\swidth="([\d.]+)"/.exec(match[0])?.[1] ?? "0"),
  }));

  let total = 0;
  for (let index = first; index <= last; index += 1) {
    const found = ranges.find((range) => index >= range.min && index <= range.max);
    total += found && Number.isFinite(found.width) && found.width > 0 ? found.width : defaultWidth;
  }
  if (!(total >= 2)) {
    throw new Error(`본문 칸의 폭을 읽지 못했습니다: ${startColumn}:${endColumn} → ${total}`);
  }
  return total;
}

type LabelledBlock = { firstRow: number; lastRow: number; contentColumn: string };

/**
 * 「비　고」처럼 **라벨이 여러 줄을 세로로 차지하는** 구역. 라벨 칸의 병합
 * 범위(`C60:G63`)가 줄 수와 내용 열(`G` 의 다음인 `H`)을 함께 알려 준다.
 */
export function findLabelledBlock(sheetXml: string, labelCell: string): LabelledBlock {
  const anchor = /^([A-Z]+)(\d+)$/.exec(labelCell);
  if (!anchor) throw new Error(`셀 주소가 아닙니다: ${labelCell}`);

  for (const ref of readMergeRefs(sheetXml)) {
    const parsed = parseMergeRef(ref);
    if (!parsed) continue;
    if (parsed.startColumn !== anchor[1] || parsed.firstRow !== Number(anchor[2])) continue;
    return {
      firstRow: parsed.firstRow,
      lastRow: parsed.lastRow,
      contentColumn: indexToColumn(columnIndex(parsed.endColumn) + 1),
    };
  }
  throw new Error(`양식에서 ${labelCell} 로 시작하는 병합 칸을 찾지 못했습니다.`);
}

function readMergeRefs(sheetXml: string): string[] {
  const block = /<mergeCells[^>]*>([\s\S]*?)<\/mergeCells>/.exec(sheetXml);
  if (!block) return [];
  return [...block[1].matchAll(/<mergeCell[^>]*\sref="([^"]+)"/g)].map((match) => match[1]);
}

function parseMergeRef(
  ref: string
): { startColumn: string; firstRow: number; endColumn: string; lastRow: number } | null {
  const found = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
  if (!found) return null;
  return {
    startColumn: found[1],
    firstRow: Number(found[2]),
    endColumn: found[3],
    lastRow: Number(found[4]),
  };
}

/** `A` → 1, `Z` → 26, `AA` → 27. */
function columnIndex(name: string): number {
  let index = 0;
  for (const letter of name) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index;
}

function indexToColumn(index: number): string {
  let rest = index;
  let name = "";
  while (rest > 0) {
    const remainder = (rest - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    rest = Math.floor((rest - 1) / 26);
  }
  return name;
}
