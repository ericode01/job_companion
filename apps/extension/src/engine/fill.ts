import { pickOptions } from "@jd/apply/rules";
import type { Field } from "./collect";
import { cleanText, click, mouseDown, setFile, setNativeValue, sleep } from "./dom";

function comboboxControl(input: HTMLElement): HTMLElement {
  return (input.closest("[class*='select__control'], [class*='-control'], [class*='_control']") as HTMLElement | null) ?? input;
}

function listboxFor(input: HTMLElement): HTMLElement | null {
  const doc = input.ownerDocument;
  const controls = input.getAttribute("aria-controls") ?? input.getAttribute("aria-owns");
  if (controls) {
    const el = doc.getElementById(controls);
    if (el) return el;
  }
  if (input.id) {
    const rs = doc.getElementById(`react-select-${input.id}-listbox`);
    if (rs) return rs;
  }
  return input.closest("[class*='select'], [class*='_fieldEntry'], .field-wrapper")?.querySelector<HTMLElement>("[role='listbox']") ?? null;
}

const openListbox = (input: HTMLElement) => {
  const lb = listboxFor(input);
  return lb && lb.querySelector("[role='option']") ? lb : null;
};

async function waitForListbox(input: HTMLElement, ms: number): Promise<HTMLElement | null> {
  for (let waited = 0; waited <= ms; waited += 50) {
    const lb = openListbox(input);
    if (lb) return lb;
    await sleep(50);
  }
  return null;
}

/**
 * Opens a custom dropdown. Greenhouse's react-select focuses on mousedown and opens on the
 * following click, so send the full press sequence; toggling an already-open menu would close it.
 */
async function openCombobox(input: HTMLElement): Promise<HTMLElement | null> {
  const already = openListbox(input);
  if (already) return already;
  const control = comboboxControl(input);
  mouseDown(control);
  control.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  const lb = await waitForListbox(input, 500);
  if (lb) return lb;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true, cancelable: true }));
  return waitForListbox(input, 400);
}

async function closeCombobox(input: HTMLElement): Promise<void> {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
  await sleep(60);
  if (openListbox(input)) {
    const control = comboboxControl(input);
    mouseDown(control);
    control.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    await sleep(60);
  }
}

function optionEls(lb: HTMLElement): HTMLElement[] {
  return [...lb.querySelectorAll<HTMLElement>("[role='option']")];
}

/** Opens a custom dropdown just long enough to read its options. */
export async function readComboboxOptions(field: Field): Promise<string[]> {
  const input = field.elements[0]!;
  const lb = await openCombobox(input);
  const options = lb ? optionEls(lb).map((o) => cleanText(o.textContent)) : [];
  if (lb) await closeCombobox(input);
  return options;
}

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** "350 Fifth Ave, New York, NY" → { city: "New York", region: "New York" } */
export function parsePlace(location: string): { city: string; region: string | null } {
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  const state = US_STATES[last.toUpperCase()] ?? (Object.values(US_STATES).includes(last) ? last : null);
  const cityParts = state ? parts.slice(0, -1) : parts;
  // Drop a leading street address.
  const city = (cityParts.length > 1 && /\d/.test(cityParts[0]!) ? cityParts.slice(1) : cityParts)[0] ?? location;
  return { city, region: state };
}

async function searchOptions(input: HTMLInputElement, query: string): Promise<HTMLElement | null> {
  setNativeValue(input, query);
  input.focus();
  for (let i = 0; i < 25; i++) {
    await sleep(120);
    const lb = listboxFor(input);
    if (lb && optionEls(lb).length) return lb;
  }
  return null;
}

async function selectComboboxOption(input: HTMLElement, wanted: string, typeToSearch: boolean): Promise<boolean> {
  let lb = await openCombobox(input);
  let place: { city: string; region: string | null } | null = null;
  if (typeToSearch && input instanceof HTMLInputElement) {
    // Location pickers search as you type; full addresses return nothing, so search "City, State".
    place = parsePlace(wanted);
    lb = null;
    for (const query of place.region ? [`${place.city}, ${place.region}`, place.city] : [place.city]) {
      lb = await searchOptions(input, query);
      if (lb) break;
    }
  }
  if (!lb) return false;
  const opts = optionEls(lb);
  const texts = opts.map((o) => cleanText(o.textContent));
  let picked = texts.indexOf(wanted);
  if (picked < 0 && place) {
    const city = place.city.toLowerCase();
    const region = place.region?.toLowerCase();
    picked = texts.findIndex((t) => t.toLowerCase().startsWith(city) && (!region || t.toLowerCase().includes(region)));
  }
  if (picked < 0) {
    const match = pickOptions(wanted, texts)[0];
    picked = match === undefined ? -1 : texts.indexOf(match);
  }
  if (picked < 0) {
    await closeCombobox(input);
    return false;
  }
  const el = opts[picked]!;
  const text = texts[picked]!;
  const before = cleanText(comboboxControl(input).textContent);
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  click(el);
  await sleep(150);
  // Confirm the control shows the choice. Some render a short form ("United States +1" shows "+1"),
  // so a visible change counts too.
  const after = cleanText(comboboxControl(input).textContent);
  if (openListbox(input)) await closeCombobox(input);
  return after.includes(text) || (after !== before && after.length > 0) || text.includes(after) && after.length > 0;
}

export interface FillResult {
  ok: boolean;
  /** What actually ended up in the form, for the review panel. */
  shown: string;
}

/** Fills one field. Never submits; callers decide what is safe to fill. */
export async function fillField(field: Field, value: string | string[] | File, opts: { searchable?: boolean } = {}): Promise<FillResult> {
  const el = field.elements[0]!;
  try {
    if (value instanceof File) {
      return { ok: setFile(el as HTMLInputElement, value), shown: value.name };
    }
    const values = Array.isArray(value) ? value : [value];
    switch (field.control) {
      case "input":
      case "textarea": {
        const v = values.join(", ");
        setNativeValue(el as HTMLInputElement, v);
        await sleep(10);
        return { ok: (el as HTMLInputElement).value === v, shown: v };
      }
      case "select": {
        const sel = el as HTMLSelectElement;
        const texts = [...sel.options].map((o) => cleanText(o.textContent));
        const picked = values.flatMap((v) => (texts.includes(v) ? [v] : pickOptions(v, texts)));
        if (!picked.length) return { ok: false, shown: "" };
        for (const o of sel.options) o.selected = picked.includes(cleanText(o.textContent));
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, shown: picked.join(", ") };
      }
      case "radios":
      case "checkboxes": {
        const inputs = field.elements as HTMLInputElement[];
        const picked: string[] = [];
        inputs.forEach((input, i) => {
          const text = field.options[i] ?? "";
          const want = values.includes(text) || values.some((v) => pickOptions(v, [text]).length > 0);
          if (want && !input.checked) click(input);
          if (field.control === "checkboxes" && !want && input.checked) click(input);
          if (want) picked.push(text);
        });
        return { ok: picked.length > 0, shown: picked.join(", ") };
      }
      case "single-checkbox": {
        const input = el as HTMLInputElement;
        const want = /^(yes|true|checked)$/i.test(values[0] ?? "");
        if (input.checked !== want) click(input);
        return { ok: input.checked === want, shown: want ? "Checked" : "Unchecked" };
      }
      case "buttons": {
        const btn = (field.elements as HTMLButtonElement[]).find((b) => cleanText(b.textContent).toLowerCase() === (values[0] ?? "").toLowerCase());
        if (!btn) return { ok: false, shown: "" };
        click(btn);
        return { ok: true, shown: cleanText(btn.textContent) };
      }
      case "combobox": {
        let any = false;
        for (const v of values) any = (await selectComboboxOption(el, v, Boolean(opts.searchable))) || any;
        return { ok: any, shown: values.join(", ") };
      }
      case "file":
        return { ok: false, shown: "" };
    }
  } catch {
    return { ok: false, shown: "" };
  }
}

export function scrollToField(field: Field): void {
  const el = field.elements[0]!;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => el.focus({ preventScroll: true }), 300);
}
