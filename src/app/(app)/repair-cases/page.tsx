import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { listRepairCases } from "@/lib/db/queries/repair-cases";
import RepairCaseListPage from "@/components/repair-cases/RepairCaseListPage";

export const metadata: Metadata = {
  title: "전체 A/S 현황 | DSS A/S 관리 시스템",
};

// DB-backed rows must never be statically cached — this route always
// re-queries at request time in database mode (and does no I/O at all in
// mock mode, so this has no cost there).
export const dynamic = "force-dynamic";

export default async function RepairCasesPage() {
  // (app)/layout.tsx already gates session + approval status for every
  // route in this group; this repeats the no-session check at the point of
  // the DB query itself (same defensive pattern [id]/page.tsx already
  // uses) so the query can never run without a validated session.
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  const readSource = getRepairCaseReadSource();

  if (readSource === "mock") {
    return (
      <Suspense>
        <RepairCaseListPage />
      </Suspense>
    );
  }

  const serverBaseCases = await listRepairCases();

  return (
    <Suspense>
      <RepairCaseListPage serverBaseCases={serverBaseCases} />
    </Suspense>
  );
}
