import { FileText, NotebookPen, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { AboutForm } from "@/components/AboutForm";
import { ResumeManager } from "@/components/ResumeManager";
import { SectionForm } from "@/components/SettingsForm";
import { requirePageUser } from "@/lib/session";

export const metadata: Metadata = { title: "Profile" };

const CONTACT = {
  key: "contact",
  endpoint: "/api/profile",
  title: "Contact details",
  description: "Filled into every application form.",
  fields: [
    { path: "name", label: "Full name", type: "text" as const },
    { path: "email", label: "Email", type: "text" as const },
    { path: "phone", label: "Phone", type: "text" as const },
    { path: "location", label: "Location", type: "text" as const, hint: "New York, NY" },
    { path: "links.linkedin", label: "LinkedIn URL", type: "text" as const },
    { path: "links.github", label: "GitHub URL", type: "text" as const },
    { path: "links.site", label: "Personal site", type: "text" as const },
  ],
};

const sections = [
  { id: "resume", label: "Resume", icon: FileText },
  { id: "contact", label: "Contact details", icon: UserRound },
  { id: "about", label: "About you", icon: NotebookPen },
];

/** Everything about you that isn't tied to one job search. */
export default async function ProfilePage() {
  await requirePageUser();
  return (
    <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label="Profile sections" className="hidden text-sm lg:block">
        <ul className="sticky top-24 space-y-0.5">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="flex min-h-10 items-center gap-2 rounded-lg px-2.5 font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text">
                <s.icon aria-hidden className="size-4" /> {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your profile</h1>
          <p className="text-sm text-muted">Shared by all your job searches: it scores fit, writes cover letters and fills applications.</p>
        </div>

        <section id="resume" aria-labelledby="resume-title" className="scroll-mt-24 space-y-3">
          <div>
            <h2 id="resume-title" className="section-title">
              Resume
            </h2>
            <p className="text-sm text-muted">Your master resume. Fit scores use it, and tailored versions are built from it.</p>
          </div>
          <ResumeManager />
        </section>

        <SectionForm section={CONTACT} />

        <section id="about" aria-labelledby="about-title" className="card scroll-mt-24 space-y-4 p-5 sm:p-6">
          <div>
            <h2 id="about-title" className="section-title">
              About you
            </h2>
            <p className="text-sm text-muted">What your resume doesn&apos;t say. Makes cover letters sound like you and answers more specific.</p>
          </div>
          <AboutForm />
        </section>
      </div>
    </div>
  );
}
