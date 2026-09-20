import { Brand } from "@/components/Brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="flex min-h-dvh flex-col items-center justify-center px-4 py-10 focus:outline-none">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <Brand href="/login" />
        </div>
        {children}
      </div>
    </main>
  );
}
