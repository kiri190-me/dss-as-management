import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
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

  const user = await resolveActingUserForSession(session);

  return (
    <AppShell
      user={user ? { name: user.name, roleLabel: roleLabels[user.role] } : undefined}
    >
      {children}
    </AppShell>
  );
}
