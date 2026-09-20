import { Brand } from "@/components/Brand";
import { SignOutButton } from "@/components/Onboarding";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function WelcomeLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser({ allowOnboarding: true });
  return (
    <>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Brand href="/welcome" />
          <SignOutButton />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-8 focus:outline-none">
        {children}
      </main>
    </>
  );
}
