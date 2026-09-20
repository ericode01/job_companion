/** Confirmation screens after the user submits (URL or visible text). */
export function isConfirmationPage(doc: Document): boolean {
  const url = doc.location?.href ?? "";
  if (/\/confirmation(\b|$)|\/thanks(\b|$)|application[_-]?submitted|\/thank-you/i.test(url)) return true;
  const text = (doc.body?.innerText ?? "").slice(0, 5000);
  return /thank you for (applying|your application)|application (has been|was) (successfully )?(submitted|received)|we('ve| have) received your application|your application (has been|was) submitted/i.test(text);
}

export function atsOf(host: string): "greenhouse" | "lever" | "ashby" | null {
  if (/greenhouse\.io$/.test(host)) return "greenhouse";
  if (host === "jobs.lever.co") return "lever";
  if (host === "jobs.ashbyhq.com") return "ashby";
  return null;
}
