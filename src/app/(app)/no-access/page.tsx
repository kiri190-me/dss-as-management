import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { findPermissionArea } from "@/lib/auth/permission-areas";
import { listAccessibleAreaKeys } from "@/lib/auth/permission-resolver";
import { navItems } from "@/lib/navigation";
import { roleLabels } from "@/lib/domain/types";

export const metadata: Metadata = {
  title: "접근 권한 없음 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * 권한이 없어 막혔을 때 오는 화면.
 *
 * 대시보드로 조용히 돌려보내지 않는 이유: 이유를 모르면 사용자는 고장으로
 * 여기고, 관리자에게 물을 때도 "안 돼요"밖에 말할 수 없다. 어느 메뉴가
 * 막혔는지, 누구에게 무엇을 요청해야 하는지, 지금 갈 수 있는 곳은 어디인지를
 * 적어 준다.
 */
export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string }>;
}) {
  const { area } = await searchParams;

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  const blockedArea = area ? findPermissionArea(area) : undefined;
  const accessibleKeys = new Set(await listAccessibleAreaKeys(actingUser.role));
  const accessibleItems = navItems.filter((item) => accessibleKeys.has(item.key));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">접근 권한이 없습니다</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {blockedArea ? (
            <>
              <strong>{blockedArea.label}</strong> 메뉴는 현재 역할(
              {roleLabels[actingUser.role]})에 열려 있지 않습니다.
            </>
          ) : (
            <>요청하신 화면은 현재 역할({roleLabels[actingUser.role]})에 열려 있지 않습니다.</>
          )}
        </p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          필요하시면 관리자에게 <strong>사용자 관리 &gt; 역할별 접근 권한</strong>에서 이 메뉴를 열어 달라고
          요청해 주세요.
        </p>
      </div>

      {accessibleItems.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">지금 이용할 수 있는 메뉴</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {accessibleItems.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="text-sm text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
