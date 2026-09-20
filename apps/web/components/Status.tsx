import { ExternalLink } from "lucide-react";

export { Spinner } from "./ui";

export function fitTone(score: number) {
  return score >= 85
    ? { cls: "bg-good-soft text-good", label: "Strong" }
    : score >= 70
      ? { cls: "bg-accent-soft text-accent", label: "Good" }
      : score >= 50
        ? { cls: "bg-warn-soft text-warn", label: "Stretch" }
        : { cls: "bg-surface-2 text-muted", label: "Weak" };
}

/** Score plus a word, so the meaning never relies on color alone. */
export function FitBadge({ score, size = "sm" }: { score: number | null | undefined; size?: "sm" | "lg" }) {
  if (score === null || score === undefined) return null;
  const { cls, label } = fitTone(score);
  if (size === "lg") {
    return (
      <span className={`inline-flex size-14 shrink-0 flex-col items-center justify-center rounded-xl ${cls}`} aria-label={`Fit score ${score}, ${label}`}>
        <span className="text-xl leading-none font-bold tabular-nums">{score}</span>
        <span className="mt-0.5 text-[10px] font-semibold tracking-wide uppercase">{label}</span>
      </span>
    );
  }
  return (
    <span className={`chip tabular-nums ${cls}`} title={`Fit score: ${label}`}>
      Fit {score}
    </span>
  );
}

export function SourceLink({ url }: { url: string | null | undefined }) {
  if (!url) return null;
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* show raw */
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="ml-1 inline-flex items-center gap-0.5 align-baseline text-xs text-accent hover:underline"
      title={url}
    >
      {host}
      <ExternalLink aria-hidden className="size-3" />
      <span className="sr-only">(source, opens in new tab)</span>
    </a>
  );
}
