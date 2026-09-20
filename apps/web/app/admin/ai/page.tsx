import type { Metadata } from "next";
import { SectionForm } from "@/components/SettingsForm";
import { AI, RESEARCH } from "@/lib/admin-sections";

export const metadata: Metadata = { title: "AI and budget" };

export default function AdminAi() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI and budget</h1>
        <p className="text-sm text-muted">One Claude API key pays for everyone on this server. Spend by person is on the Overview.</p>
      </div>
      <SectionForm section={AI} />
      <SectionForm section={RESEARCH} />
    </div>
  );
}
