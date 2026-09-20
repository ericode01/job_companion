import type { Metadata } from "next";
import { SectionForm } from "@/components/SettingsForm";
import { SOURCES } from "@/lib/admin-sections";

export const metadata: Metadata = { title: "Job boards" };

export default function AdminSources() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Job boards</h1>
        <p className="text-sm text-muted">Where jobs come from. Refresh everything now from Companies.</p>
      </div>
      <SectionForm section={SOURCES} />
    </div>
  );
}
