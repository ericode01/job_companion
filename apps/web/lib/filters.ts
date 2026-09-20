import type { SearchFilter } from "@jd/core/shared";

/** Plain-English summary of a filter, so you can check it without reading every field. */
export function describeFilter(f: SearchFilter): string {
  const level = f.levelKeywords.length ? `${f.levelKeywords.filter((l) => l.length > 2).join(" or ")} ` : "";
  const role = f.roleKeywords[0] ?? "roles";
  const where = f.remoteOnly
    ? "remote in the US"
    : f.locations.length
      ? `in ${f.locations.map((l) => l.label).join(" or ")}${f.includeRemoteUS ? ", plus remote in the US" : ""}`
      : "anywhere";
  const age = f.postedWithinDays ? `, posted in the last ${f.postedWithinDays} days` : "";
  return `${level}${role} ${where}${age}`;
}
