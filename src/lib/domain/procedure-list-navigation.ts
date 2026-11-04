import type { ProcedureTemplateCategory } from "./procedure-template-types";

/**
 * ============================================================================
 * [절차 상세]에서 목록으로 빠져나오는 길 (2026-11-04)
 * ============================================================================
 * 사용자가 말한 것: "[절차 상세]에서 목록으로 빠져나올 수 있는 버튼도 만들어줘."
 *
 * 그 전까지 이 화면에는 **나가는 길이 하나도 없었다.** 검증 이슈에서 들어왔을
 * 때만 "← 오류 상세로 돌아가기"가 뜨고(그것도 목록이 아니라 이슈로 간다),
 * 평범하게 목록에서 눌러 들어온 사람에게는 브라우저 뒤로 말고는 길이 없었다.
 * 편집 화면에는 "← …상세로"가 있는데 상세에는 그 짝이 없었다.
 *
 * ── 🔴 지금 절차 목록은 **한 곳뿐이다** ─────────────────────────────────
 * 라우트를 세어 보고 적는다(2026-11-04 실측):
 *
 *   · `/procedures/technical` — 기술 작업 절차 목록. 조회가
 *     `category = 'TECHNICAL_TASK'` 로 **거른다**(listTechnicalProcedureTemplates).
 *   · `/procedures` — 목록이 아니다. `redirect("/procedures/technical")` 한 줄짜리
 *     파일이다. 분류 전체를 보여 주던 옛 목록은 IA 정리(Checkpoint 1) 때
 *     사용자 입구에서 내려갔고, 화면 조각(ProcedureTemplateListScreen)만 남아
 *     있다.
 *
 * 그래서 FULL_SERVICE·REFERENCE 절차는 **어느 목록에도 뜨지 않는다.** 상세는
 * 분류를 가리지 않고 열리는데(/procedures/[id]) 목록은 하나뿐이라, 그 둘을
 * 열었을 때 "제 목록으로" 보낼 곳이 없다. 없는 주소를 지어내는 대신 **있는
 * 목록으로 보내고, 단추에 그 목록의 이름을 적는다** — 가는 곳을 글자로 밝히면
 * 엉뚱한 곳에 떨어졌다고 읽히지 않는다.
 *
 * 🔴 **그래도 분류로 가른다.** 지금 답이 셋 다 같더라도, 갈림목을 여기 하나
 * 두어야 FULL_SERVICE 목록이 생기는 날 고칠 자리가 한 곳이다. 화면이 주소를
 * 직접 적으면 그날 고칠 자리를 찾아 돌아다니게 된다. 분류가 늘거나 목록이
 * 늘면 procedure-list-navigation.test.ts 의 "목록은 지금 하나뿐이다"가 먼저
 * 깨져서 알려 준다.
 *
 * 🔵 **어디서 왔는지에 기대지 않는다.** 브라우저 뒤로(router.back)나 referrer 로
 * 정하면, 주소를 직접 치고 들어왔거나 다른 화면의 링크로 들어온 사람에게는
 * 갈 곳이 없거나 엉뚱한 곳으로 간다. 분류는 그 행이 늘 가지고 있는 사실이다.
 * ============================================================================
 */

export type ProcedureListLink = {
  href: string;
  /** 단추에 적히는 **가는 곳의 이름**. 어디로 떨어지는지를 누르기 전에 알린다. */
  label: string;
};

/** 기술 작업 절차 목록 — 지금 이 앱에 실재하는 단 하나의 절차 목록 라우트. */
const TECHNICAL_LIST: ProcedureListLink = {
  href: "/procedures/technical",
  label: "기술 작업 절차 목록",
};

export function resolveProcedureListLink(category: ProcedureTemplateCategory): ProcedureListLink {
  switch (category) {
    case "TECHNICAL_TASK":
      return TECHNICAL_LIST;
    // 🔴 이 둘은 **제 목록이 없다**(머리말). 있는 목록으로 보내되, 글자가
    //    가는 곳을 밝히므로 사람이 속지 않는다. 전용 목록이 생기면 여기에
    //    갈래를 더한다 — 화면은 한 글자도 안 바뀐다.
    case "FULL_SERVICE":
    case "REFERENCE":
      return TECHNICAL_LIST;
  }
}
