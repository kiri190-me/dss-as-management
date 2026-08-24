import { notFound } from "next/navigation";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import DetailTabs from "@/components/repair-cases/detail/DetailTabs";

// This segment resolves session-independent, read-source-dependent data
// (mock lookup or a live DB query) on every request — never statically
// cached.
export const dynamic = "force-dynamic";

export default async function RepairCaseDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Read-source-aware: resolves against mock-data.ts in mock mode, or
  // queries PostgreSQL in database mode (request-deduplicated via
  // resolveRepairCaseForServer's cache() — [id]/page.tsx and the other
  // tabs resolving the same id in this request reuse this same result
  // rather than re-querying). A genuine DB failure is not caught here —
  // it propagates to repair-cases/error.tsx, never becomes notFound().
  const resolved = await resolveRepairCaseForServer(id);

  if (!resolved) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <DetailTabs id={id} />
      {children}
    </div>
  );
}
