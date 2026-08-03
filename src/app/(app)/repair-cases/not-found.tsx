import RepairCaseNotFound from "@/components/repair-cases/detail/RepairCaseNotFound";

/**
 * src/app/(app)/repair-cases/[id]/layout.tsx가 notFound()를 호출하면, Next.js는
 * 같은 [id] 세그먼트의 not-found.tsx가 아니라 "부모 세그먼트"의 not-found
 * 경계를 사용한다(layout에서 호출된 notFound()의 공식 동작). 그래서 이
 * 경계는 [id]/ 바로 아래가 아니라 한 단계 위인 여기(repair-cases/)에 둔다.
 */
export default function RepairCasesNotFound() {
  return <RepairCaseNotFound />;
}
