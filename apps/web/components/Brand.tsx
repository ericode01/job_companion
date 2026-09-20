import { Sparkles } from "lucide-react";
import Link from "next/link";

/** Logo mark + name. The mark stays; the name hides on small screens. */
export function Brand({ href = "/", suffix, compact = false }: { href?: string; suffix?: string; compact?: boolean }) {
  return (
    <Link href={href} className="inline-flex shrink-0 items-center gap-2 rounded-lg font-bold tracking-tight">
      <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-accent text-on-accent">
        <Sparkles className="size-4" />
      </span>
      <span className={compact ? "sr-only md:not-sr-only" : ""}>
        Job Companion{suffix && <span className="ml-1.5 font-semibold text-muted">{suffix}</span>}
      </span>
    </Link>
  );
}
