import type { Metadata } from "next";
import { EmailAdmin } from "@/components/EmailAdmin";
import { SectionForm } from "@/components/SettingsForm";
import { MAIL } from "@/lib/admin-sections";
import { requirePageAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Email delivery" };

export default async function AdminEmail() {
  const me = await requirePageAdmin();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Email delivery</h1>
        <p className="text-sm text-muted">Each person chooses their own address and send time under Account; this is how the mail goes out.</p>
      </div>
      <SectionForm section={MAIL} />
      <EmailAdmin adminEmail={me.email} />
    </div>
  );
}
