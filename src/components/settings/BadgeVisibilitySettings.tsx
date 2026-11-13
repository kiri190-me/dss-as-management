"use client";

import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import BadgeVisibilityPanel, { type BadgeVisibilitySaveResult } from "./BadgeVisibilityPanel";
import { saveBadgeVisibilityAction } from "@/lib/server/actions/badge-visibility-settings";
import type { BadgeVisibilityPlacementInput } from "@/lib/db/mutations/badge-visibility-settings";
import type { BadgeVisibilityBadgeView } from "@/lib/db/queries/badge-visibility-settings";

/**
 * [배지 표시] 탭의 **바깥 한 겹** — 서버 액션과 화면을 잇는다.
 *
 * 🔴 여기에만 서버 액션 import 가 있다. 그 사슬이 `server-only` 를 물어 이 파일은
 * 시험에서 그려 볼 수 없고, 그래서 체크상자·보기 배지 같은 **그려 봐야 아는 것**은
 * 전부 안쪽(BadgeVisibilityPanel)에 있다. 이 파일이 하는 일은 셋뿐이다:
 *  ① 액션 호출 ② 성공했을 때 화면 다시 읽기(router.refresh) ③ 저장 팝업.
 *
 * 🔴 **성공했을 때만** 팝업을 띄운다. 저장 팝업은 0.5초 뒤 저절로 닫히는 성공
 * 전용이라(common/SavePopup.tsx), 실패를 실으면 읽기 전에 사라진다. 실패 문장은
 * 안쪽이 화면에 남긴다.
 *
 * 🔴 **router.refresh 가 먼저다.** 팝업보다 뒤에 두면 0.5초 동안 옛 값으로 그려진
 * 체크상자를 사람이 다시 누를 수 있고, 그때 보내는 "바뀐 쌍"은 방금 저장한 것을
 * 되돌리는 요청이 된다(옆 카드 CustomerStatusOptionSettings 와 같은 차례).
 */
export default function BadgeVisibilitySettings({
  badges,
  canManage,
}: {
  badges: BadgeVisibilityBadgeView[];
  canManage: boolean;
}) {
  const router = useRouter();

  async function handleSave(
    placements: BadgeVisibilityPlacementInput[]
  ): Promise<BadgeVisibilitySaveResult> {
    const result = await saveBadgeVisibilityAction({ placements });
    if (!result.ok) return result;
    router.refresh();
    showSavePopup({ message: result.message, redirectTo: null });
    return result;
  }

  return <BadgeVisibilityPanel badges={badges} canManage={canManage} onSave={handleSave} />;
}
