import type { Metadata } from "next";
import { UsersAdmin } from "@/components/UsersAdmin";
import { requirePageAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "People" };

export default async function AdminUsers() {
  const me = await requirePageAdmin();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">People and invites</h1>
        <p className="text-sm text-muted">Everyone&apos;s data is private to them; you see only what&apos;s here — counts, spend and account status.</p>
      </div>
      <UsersAdmin meId={me.id} />
    </div>
  );
}
