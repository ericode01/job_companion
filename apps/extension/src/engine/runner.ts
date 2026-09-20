import type { ApplyPacket } from "@jd/apply/packet-types";
import { isConsentField } from "@jd/apply/rules";
import type { FormQuestion, QuestionAnswer } from "@jd/core/shared";
import { classifyField, standardValue, type StandardKey } from "./classify";
import { collectFields, type Field } from "./collect";
import { base64ToFile } from "./dom";
import { fillField, readComboboxOptions } from "./fill";

export interface EngineApi {
  packet(applicationId: number): Promise<ApplyPacket>;
  answers(applicationId: number, questions: FormQuestion[]): Promise<{ answers: QuestionAnswer[]; inboxAdded: number }>;
}

export type ItemStatus = "filled" | "review" | "needs_user" | "failed" | "skipped";

export interface Item {
  field: Field;
  key: StandardKey | null;
  status: ItemStatus;
  shown: string;
  note: string | null;
  source: string;
  answer: QuestionAnswer | null;
}

export interface RunResult {
  packet: ApplyPacket;
  items: Item[];
  inboxAdded: number;
}

const SKIP_KEYS = new Set<StandardKey>(["autofillResume", "preferredName"]);

/**
 * Fills an application form: profile fields and files locally, custom questions via the app.
 * Nothing is ever submitted, and single consent checkboxes are always left for the user.
 */
export async function runFill(root: Element, applicationId: number, api: EngineApi, onProgress?: (items: Item[]) => void): Promise<RunResult> {
  const packet = await api.packet(applicationId);
  const fields = collectFields(root);
  const items: Item[] = [];
  const custom: { item: Item; question: FormQuestion }[] = [];
  const add = (item: Item) => {
    items.push(item);
    onProgress?.(items);
  };
  const base = (field: Field, key: StandardKey | null): Item => ({ field, key, status: "skipped", shown: "", note: null, source: "profile", answer: null });

  for (const field of fields) {
    const key = classifyField(field);
    const item = base(field, key);

    if (key && SKIP_KEYS.has(key)) {
      add({ ...item, status: "skipped", note: key === "autofillResume" ? "Skipped the site's resume autofill; fields are filled directly." : null });
      continue;
    }
    if (key === "resume" || key === "coverLetterFile") {
      const doc = key === "resume" ? packet.resume : packet.coverLetter;
      if (doc) {
        const r = await fillField(field, base64ToFile(doc.base64, doc.fileName, doc.mimeType));
        add({ ...item, status: r.ok ? "filled" : "failed", shown: r.shown, note: r.ok ? null : "Couldn't attach the file. Attach it manually." });
      } else if (key === "coverLetterFile" && packet.coverLetterChoice !== "yes") {
        add({ ...item, status: field.required ? "needs_user" : "skipped", note: field.required ? "This form requires a cover letter. Generate one in the app." : null });
      } else {
        add({ ...item, status: field.required ? "needs_user" : "skipped", note: key === "resume" ? "Upload your resume in the app first." : "Cover letter isn't ready yet." });
      }
      continue;
    }
    if (key) {
      const value = standardValue(key, packet);
      if (!value) {
        add({ ...item, status: field.required ? "needs_user" : "skipped", note: field.required ? "Not in your profile." : null });
        continue;
      }
      const r = await fillField(field, value, { searchable: key === "location" });
      add({ ...item, status: r.ok ? "filled" : "failed", shown: r.shown, note: r.ok ? null : "Couldn't fill this automatically." });
      continue;
    }
    if (field.kind === "file") {
      add({ ...item, status: field.required ? "needs_user" : "skipped", note: field.required ? "Attach this file manually." : null, source: "none" });
      continue;
    }
    if (field.control === "single-checkbox" || isConsentField(field.label, field.options)) {
      add({ ...item, status: "needs_user", note: "Checkboxes like consents and acknowledgements are left for you.", source: "rule" });
      continue;
    }
    custom.push({ item, question: { index: field.index, label: field.label, kind: field.kind, required: field.required, options: field.options, description: field.description } });
  }

  // Custom dropdowns only reveal their options when opened.
  for (const c of custom) {
    if (c.item.field.control === "combobox" && c.question.options.length === 0) {
      const opts = await readComboboxOptions(c.item.field);
      c.item.field.options = opts;
      c.question.options = opts;
    }
  }

  let inboxAdded = 0;
  if (custom.length) {
    let answers: QuestionAnswer[] = [];
    try {
      const res = await api.answers(applicationId, custom.map((c) => c.question));
      answers = res.answers;
      inboxAdded = res.inboxAdded;
    } catch (err) {
      for (const c of custom) add({ ...c.item, status: "needs_user", note: `Couldn't get answers: ${err instanceof Error ? err.message : String(err)}`, source: "none" });
      return { packet, items: sortItems(items), inboxAdded };
    }
    for (const c of custom) {
      const a = answers.find((x) => x.index === c.question.index) ?? null;
      if (!a || a.value === null) {
        add({ ...c.item, answer: a, status: c.question.required || a?.status === "needs_user" ? "needs_user" : "skipped", note: a?.note ?? null, source: a?.source ?? "none" });
        continue;
      }
      // Dropdowns that exposed no options are type-to-search (Ashby/Greenhouse location pickers).
      const r = await fillField(c.item.field, a.value, { searchable: c.item.field.control === "combobox" && c.item.field.options.length === 0 });
      add({
        ...c.item,
        answer: a,
        status: r.ok ? (a.status === "filled" ? "filled" : "review") : "failed",
        shown: r.shown,
        note: r.ok ? a.note : "Couldn't select this answer. Please set it manually.",
        source: a.source,
      });
    }
  }
  return { packet, items: sortItems(items), inboxAdded };
}

function sortItems(items: Item[]): Item[] {
  return [...items].sort((a, b) => a.field.index - b.field.index);
}

/** Snapshot of what was answered, stored with the application when it's submitted. */
export function finalAnswers(items: Item[]) {
  return items
    .filter((i) => i.status === "filled" || i.status === "review")
    .map((i) => ({ label: i.field.label, value: i.shown || null, source: i.source }));
}
