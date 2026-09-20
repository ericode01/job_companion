export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function cleanText(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/[*✱]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isVisible(el: Element): boolean {
  const h = el as HTMLElement;
  if (h.hidden) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(h);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  return true;
}

/**
 * Sets a value the way a user would, so React/Vue-controlled inputs register it:
 * use the prototype's native setter (bypassing the framework's patched one), then fire input/change.
 */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  el.focus();
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}

export function setFile(input: HTMLInputElement, file: File): boolean {
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return (input.files?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

export function base64ToFile(base64: string, name: string, type: string): File {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type });
}

export function mouseDown(el: Element): void {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
}

export function click(el: Element): void {
  (el as HTMLElement).click();
}

/** Visible text of the label for a control: label[for], wrapping label, aria-labelledby, aria-label. */
export function labelOf(el: Element): string {
  const doc = el.ownerDocument;
  const id = el.getAttribute("id");
  if (id) {
    const forLabel = doc.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (forLabel) return cleanText(forLabel.textContent);
    const suffixed = doc.getElementById(`${id}-label`);
    if (suffixed) return cleanText(suffixed.textContent);
  }
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((i) => doc.getElementById(i)?.textContent ?? "")
      .join(" ");
    if (cleanText(text)) return cleanText(text);
  }
  const wrapping = el.closest("label");
  if (wrapping) {
    const lever = wrapping.querySelector(".application-label");
    return cleanText((lever ?? wrapping).textContent);
  }
  return cleanText(el.getAttribute("aria-label") ?? el.getAttribute("placeholder"));
}
