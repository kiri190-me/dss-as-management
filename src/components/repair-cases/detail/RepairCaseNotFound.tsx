import Link from "next/link";

export default function RepairCaseNotFound() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        접수 건을 찾을 수 없습니다
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        요청하신 인수번호를 확인할 수 없습니다. 삭제되었거나 잘못된 주소일 수
        있습니다.
      </p>
      <Link
        href="/repair-cases"
        className="mt-4 inline-block text-sm text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
      >
        ← 전체 A/S 현황으로 돌아가기
      </Link>
    </div>
  );
}
