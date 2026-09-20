import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav } from "@/components/AdminNav";
import { Brand } from "@/components/Brand";
import { UserMenu } from "@/components/UserMenu";
import { requirePageAdmin } from "@/lib/session";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin · Job Companion" } };
export const dynamic = "force-dynamic";

/** System settings for everyone on this server. Visually separate from the job-seeker app. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageAdmin();
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Brand href="/admin" suffix="Admin" compact />
          <span className="chip hidden bg-warn-soft text-warn sm:inline-flex">System settings affect everyone</span>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/" className="btn">
              <ArrowLeft aria-hidden className="size-4" /> <span className="hidden sm:inline">Back to my jobs</span>
              <span className="sm:hidden">App</span>
            </Link>
            <UserMenu name={user.name} email={user.email} isAdmin />
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[210px_minmax(0,1fr)]">
        <AdminNav />
        <main id="main" tabIndex={-1} className="min-w-0 focus:outline-none">
          {children}
        </main>
      </div>
    </>
  );
}
