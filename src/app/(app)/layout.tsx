import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { readSession } from "@/lib/auth/session";
import { mockUsers } from "@/lib/domain/mock-data";
import { roleLabels } from "@/lib/domain/types";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }
  if (session.approvalStatus !== "APPROVED") {
    redirect("/pending-approval");
  }

  const user = mockUsers.find((candidate) => candidate.id === session.userId);

  return (
    <AppShell
      user={user ? { name: user.name, roleLabel: roleLabels[user.role] } : undefined}
    >
      {children}
    </AppShell>
  );
}
