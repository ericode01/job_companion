import { appOrigin } from "@jd/core";
import type { Metadata } from "next";
import { ExtensionSetup } from "@/components/ExtensionSetup";
import { extensionBuild } from "@/lib/extension-file";
import { requirePageUser } from "@/lib/session";

export const metadata: Metadata = { title: "Chrome extension" };

export default async function ExtensionPage() {
  const user = await requirePageUser();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Set up near one-click applying</h1>
        <p className="text-sm text-muted">
          A Chrome extension fills application forms from your profile and answers. It takes about two minutes, once.
        </p>
      </div>
      <ExtensionSetup build={extensionBuild()} origin={appOrigin()} isAdmin={user.role === "admin"} />
    </div>
  );
}
