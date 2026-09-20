import type { QuestionKind } from "@jd/core/shared";
import { cleanText, isVisible, labelOf } from "./dom";

export type ControlType = "input" | "textarea" | "select" | "radios" | "checkboxes" | "combobox" | "file" | "buttons" | "single-checkbox";

export interface Field {
  index: number;
  label: string;
  description: string | null;
  kind: QuestionKind;
  required: boolean;
  options: string[];
  control: ControlType;
  elements: HTMLElement[];
  /** name/id/autocomplete, used for classification. */
  hints: string;
  multi: boolean;
}

const SKIP_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "search", "password"]);

function containerOf(el: Element): Element {
  return (
    el.closest(
      [
        "li.application-question", // Lever
        ".application-additional",
        "[class*='_fieldEntry']", // Ashby
        ".field-wrapper", // Greenhouse
        ".select__container",
        "fieldset",
        ".question",
      ].join(","),
    ) ?? el.parentElement ?? el
  );
}

function questionLabel(el: Element): string {
  const container = containerOf(el);
  const forLabel = container.querySelector("label:not(:has(input))");
  if (forLabel && cleanText(forLabel.textContent)) {
    const text = cleanText(forLabel.textContent);
    if (!container.matches("li.application-question")) return text;
  }
  // Lever custom questions keep the question text in .application-label .text
  const lever = container.querySelector(".application-label .text, .application-label");
  if (lever) return cleanText(lever.textContent);
  const legend = container.querySelector("legend");
  if (legend) return cleanText(legend.textContent);
  const ashby = container.querySelector(":scope > label, [class*='_heading'], [class*='question-title']");
  if (ashby) return cleanText(ashby.textContent);
  return labelOf(el);
}

function isRequired(el: Element, label: string, container: Element): boolean {
  if ((el as HTMLInputElement).required || el.getAttribute("aria-required") === "true") return true;
  return /[*✱]/.test(container.querySelector("label, legend, .application-label")?.textContent ?? label);
}

function descriptionOf(container: Element, label: string): string | null {
  const d = container.querySelector("[class*='description'], .application-description, .help-text");
  const text = cleanText(d?.textContent);
  return text && text !== label ? text.slice(0, 1000) : null;
}

/** Finds the application form on the page, or null if this page has none. */
export function findFormRoot(doc: Document): Element | null {
  const byId = doc.querySelector("form#application-form, form#application_form, #application-form");
  if (byId) return byId;
  const forms = [...doc.querySelectorAll("form")].filter((f) => f.querySelectorAll("input, textarea, select").length >= 3);
  if (forms.length) return forms.sort((a, b) => b.querySelectorAll("input").length - a.querySelectorAll("input").length)[0]!;
  // Ashby renders its fields in several section containers without a <form>.
  const sections = [...doc.querySelectorAll("[class*='ashby-application-form-section-container'], [class*='_fieldEntry']")];
  if (sections.length === 0) return null;
  let common: Element | null = sections[0]!;
  while (common && !sections.every((s) => common!.contains(s))) common = common.parentElement;
  return common && common.querySelectorAll("input:not([type=hidden]), textarea").length >= 3 ? common : null;
}

function skip(el: HTMLElement): boolean {
  // intl-tel-input: skip its country search box, but keep the phone input itself (class iti__tel-input).
  if (el.closest(".iti__dropdown-content, .iti__country-container") || /iti__search-input/.test(el.className)) return true;
  if (/requiredInput/.test(el.className)) return true; // Greenhouse hidden validation proxies
  if (/recaptcha|captcha/i.test(`${el.getAttribute("name")} ${el.id}`)) return true;
  if (el.closest("[data-jd-panel]")) return true;
  return false;
}

/** Walks the form and returns one Field per question (radio/checkbox groups are merged). */
export function collectFields(root: Element): Field[] {
  const fields: Field[] = [];
  const seenGroups = new Set<string>();
  const seenContainers = new Set<Element>();
  const push = (f: Omit<Field, "index">) => fields.push({ ...f, index: fields.length });

  const elements = root.querySelectorAll<HTMLElement>("input, textarea, select, [role='combobox']");
  for (const el of elements) {
    if (skip(el)) continue;
    const tag = el.tagName;
    const type = (el as HTMLInputElement).type?.toLowerCase() ?? "";
    const hints = `${el.getAttribute("name") ?? ""} ${el.id} ${el.getAttribute("autocomplete") ?? ""}`.toLowerCase();

    if (tag === "INPUT" && (type === "radio" || type === "checkbox")) {
      const name = el.getAttribute("name") ?? "";
      const container = containerOf(el);
      const groupKey = name || `container-${fields.length}`;
      if (seenGroups.has(groupKey)) continue;
      seenGroups.add(groupKey);
      const inputs = [...(name ? root.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(name)}"]`) : container.querySelectorAll<HTMLInputElement>(`input[type=${type}]`))];
      const options = inputs.map((i) => cleanText(i.closest("label")?.textContent || labelOf(i) || i.value));
      if (type === "checkbox" && inputs.length === 1) {
        const label = cleanText(inputs[0]!.closest("label")?.textContent) || questionLabel(el);
        push({ label, description: null, kind: "boolean", required: isRequired(el, label, container), options: ["Yes", "No"], control: "single-checkbox", elements: inputs, hints, multi: false });
        continue;
      }
      const label = questionLabel(el);
      push({
        label,
        description: descriptionOf(container, label),
        kind: type === "radio" ? "radio" : "checkbox",
        required: inputs.some((i) => i.required) || isRequired(el, label, container),
        options,
        control: type === "radio" ? "radios" : "checkboxes",
        elements: inputs,
        hints,
        multi: type === "checkbox",
      });
      continue;
    }

    if (tag === "INPUT" && SKIP_INPUT_TYPES.has(type)) continue;
    if (!isVisible(el) && type !== "file" && el.getAttribute("role") !== "combobox") continue;

    const container = containerOf(el);
    const placeholder = cleanText(el.getAttribute("placeholder"));
    let label = labelOf(el);
    if (!label || label === placeholder) label = questionLabel(el) || label;
    // File inputs are often labeled by their button ("Attach", "Upload").
    if (type === "file" && /^(attach|upload|choose file|browse|select file)?$/i.test(label)) {
      label = /resume|cv/i.test(hints) ? "Resume/CV" : /cover/i.test(hints) ? "Cover letter" : questionLabel(el) || label;
    }
    if (!label) continue;
    const required = isRequired(el, label, container);
    const description = descriptionOf(container, label);

    if (type === "file") {
      push({ label, description, kind: "file", required, options: [], control: "file", elements: [el], hints, multi: false });
    } else if (el.getAttribute("role") === "combobox") {
      const multi = Boolean(el.closest("[class*='multi']")) || /select all|all that apply/i.test(label);
      push({ label, description, kind: multi ? "multiselect" : "select", required, options: [], control: "combobox", elements: [el], hints, multi });
    } else if (tag === "SELECT") {
      const sel = el as HTMLSelectElement;
      const options = [...sel.options].filter((o) => o.value !== "").map((o) => cleanText(o.textContent));
      push({ label, description, kind: sel.multiple ? "multiselect" : "select", required, options, control: "select", elements: [el], hints, multi: sel.multiple });
    } else if (tag === "TEXTAREA") {
      push({ label, description, kind: "textarea", required, options: [], control: "textarea", elements: [el], hints, multi: false });
    } else {
      const kind = type === "number" ? "number" : type === "date" ? "date" : "text";
      push({ label, description, kind, required, options: [], control: "input", elements: [el], hints: `${hints} type:${type}`, multi: false });
    }
    seenContainers.add(container);
  }

  // Ashby yes/no questions are plain buttons with no input.
  for (const container of root.querySelectorAll("[class*='_fieldEntry']")) {
    if (container.querySelector("input:not([type=hidden]), textarea, select, [role=combobox]")) continue;
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")].filter((b) => /^(yes|no)$/i.test(cleanText(b.textContent)));
    if (buttons.length !== 2) continue;
    const label = cleanText(container.querySelector("label, [class*='_heading']")?.textContent);
    if (!label) continue;
    push({ label, description: null, kind: "boolean", required: /[*✱]/.test(container.textContent ?? ""), options: buttons.map((b) => cleanText(b.textContent)), control: "buttons", elements: buttons, hints: "", multi: false });
  }
  return fields;
}
