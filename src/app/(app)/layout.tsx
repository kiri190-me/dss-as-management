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

  // Resolve the live account before trusting anything else about this
  // session. A structurally valid (correctly signed, unexpired) token can
  // still point at an account that no longer exists or is no longer usable
  // (deleted/deactivated/locked, or AUTH_SOURCE changed since the cookie
  // was issued) — that must be treated as "not authenticated", not as a
  // session that silently renders the app shell with no user info and no
  // way to log out or switch accounts.
  const user = await resolveActingUserForSession(session);
  if (!user) {
    redirect("/login");
  }

  // approvalStatus is read from the live resolved user, not the session
  // token's embedded (possibly stale) field — an account demoted from
  // APPROVED to PENDING after the token was issued must lose access
  // immediately, not just once the 8-hour token expires.
  if (user.approvalStatus !== "APPROVED") {
    redirect("/pending-approval");
  }

  return (
    <AppShell user={{ name: user.name, roleLabel: roleLabels[user.role] }}>
      {children}
    </AppShell>
  );
}
