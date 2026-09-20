import type { QuestionAnswer } from "@jd/core/shared";
import { fillField, scrollToField } from "./fill";
import type { Item, ItemStatus } from "./runner";

export interface PanelActions {
  refill(): void;
  saveAnswer(item: Item, answer: string, scope: "global" | "job"): Promise<void>;
}

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; width: min(380px, calc(100vw - 32px)); max-height: min(72vh, 680px);
  display: flex; flex-direction: column; font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #0f172a; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; box-shadow: 0 12px 32px rgba(15,23,42,.18); overflow: hidden; }
@media (prefers-color-scheme: dark) { .panel { color: #e2e8f0; background: #111a2b; border-color: #22304a; } .muted { color: #94a3b8 !important; } .item { border-color: #22304a !important; } input, select, textarea { background: #0b1220 !important; color: #e2e8f0 !important; border-color: #33445f !important; } .btn { background: #17223a !important; color: #e2e8f0 !important; border-color: #33445f !important; } }
.head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid rgba(148,163,184,.3); }
.logo { width: 24px; height: 24px; border-radius: 7px; background: #0369a1; color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 12px; flex: none; }
.title { font-weight: 650; font-size: 13px; line-height: 1.2; min-width: 0; }
.title small { display: block; font-weight: 500; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-btn { margin-left: auto; border: 0; background: transparent; color: inherit; cursor: pointer; width: 32px; height: 32px; border-radius: 8px; font-size: 16px; }
.icon-btn:hover { background: rgba(148,163,184,.18); }
.summary { display: flex; gap: 6px; flex-wrap: wrap; padding: 10px 14px; }
.chip { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; }
.s-filled { background: #dcfce7; color: #15803d; } .s-review { background: #e0f2fe; color: #0369a1; } .s-needs_user { background: #fef3c7; color: #92400e; } .s-failed { background: #fee2e2; color: #b91c1c; }
.list { overflow-y: auto; padding: 0 8px 8px; }
.item { border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 10px; margin: 6px 0; }
.row { display: flex; gap: 8px; align-items: flex-start; }
.dot { flex: none; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; margin-top: 1px; }
.label { background: none; border: 0; padding: 0; color: inherit; font: inherit; font-weight: 600; text-align: left; cursor: pointer; }
.label:hover { text-decoration: underline; }
.muted { color: #475569; font-size: 12px; }
.value { font-size: 12px; margin-top: 2px; overflow-wrap: anywhere; }
.edit { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
input[type=text], select, textarea { width: 100%; font: inherit; font-size: 13px; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #0f172a; }
textarea { min-height: 64px; resize: vertical; }
.check { display: flex; gap: 6px; align-items: center; font-size: 12px; cursor: pointer; }
.btn { font: inherit; font-size: 13px; font-weight: 600; padding: 6px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; color: #0f172a; cursor: pointer; min-height: 32px; }
.btn.primary { background: #0369a1; border-color: #0369a1; color: #fff !important; }
.btn:focus-visible, .label:focus-visible, .icon-btn:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid #0284c7; outline-offset: 2px; }
.foot { padding: 10px 14px; border-top: 1px solid rgba(148,163,184,.3); display: flex; gap: 8px; align-items: center; }
.foot p { margin: 0; font-size: 12px; }
.banner { margin: 8px 14px 0; padding: 8px 10px; border-radius: 8px; font-size: 12px; }
.pill { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; font: 600 13px/1 ui-sans-serif, system-ui, sans-serif; padding: 10px 14px; border-radius: 999px; border: 0; background: #0369a1; color: #fff; cursor: pointer; box-shadow: 0 8px 24px rgba(15,23,42,.25); }
@media (prefers-reduced-motion: no-preference) { .panel { animation: rise .18s ease-out; } @keyframes rise { from { transform: translateY(8px); opacity: 0 } to { transform: none; opacity: 1 } } }
`;

const ICON: Record<ItemStatus, string> = { filled: "✓", review: "!", needs_user: "?", failed: "×", skipped: "" };
const WORD: Record<ItemStatus, string> = { filled: "Filled", review: "Check", needs_user: "Needs you", failed: "Couldn't fill", skipped: "Skipped" };

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c !== null) el.append(c);
  return el;
}

export class Panel {
  private host: HTMLElement;
  private root: ShadowRoot;
  private minimized = false;

  constructor() {
    this.host = h("div", { "data-jd-panel": "" });
    this.root = this.host.attachShadow({ mode: "open" });
    this.root.append(h("style", {}, STYLE));
    document.documentElement.append(this.host);
  }

  destroy() {
    this.host.remove();
  }

  showPill(label: string, onClick: () => void) {
    this.clear();
    const b = h("button", { class: "pill", type: "button" }, label);
    b.addEventListener("click", onClick);
    this.root.append(b);
  }

  showMessage(title: string, message: string, tone: "info" | "error" = "info") {
    this.clear();
    const panel = h("section", { class: "panel", role: "region", "aria-label": "Job Companion" });
    panel.append(this.header(title, null));
    const color = tone === "error" ? "background:#fee2e2;color:#b91c1c" : "background:#e0f2fe;color:#0369a1";
    panel.append(h("div", { class: "banner", style: color, role: tone === "error" ? "alert" : "status" }, message));
    panel.append(h("div", { style: "height:12px" }));
    this.root.append(panel);
  }

  render(title: string, subtitle: string, items: Item[], actions: PanelActions, banner?: { text: string; tone: "info" | "success" | "warn" }) {
    this.clear();
    const shown = items.filter((i) => i.status !== "skipped");
    const panel = h("section", { class: "panel", role: "region", "aria-label": "Job Companion application helper" });
    panel.append(this.header(title, subtitle));
    if (this.minimized) {
      this.root.append(panel);
      return;
    }
    if (banner) {
      const style = banner.tone === "success" ? "background:#dcfce7;color:#15803d" : banner.tone === "warn" ? "background:#fef3c7;color:#92400e" : "background:#e0f2fe;color:#0369a1";
      panel.append(h("div", { class: "banner", style, role: "status" }, banner.text));
    }
    const counts = (s: ItemStatus) => shown.filter((i) => i.status === s).length;
    const summary = h("div", { class: "summary", "aria-live": "polite" });
    for (const s of ["filled", "review", "needs_user", "failed"] as ItemStatus[]) {
      if (counts(s)) summary.append(h("span", { class: `chip s-${s}` }, `${counts(s)} ${WORD[s].toLowerCase()}`));
    }
    panel.append(summary);

    const list = h("div", { class: "list" });
    const order: ItemStatus[] = ["needs_user", "failed", "review", "filled"];
    for (const status of order) for (const item of shown.filter((i) => i.status === status)) list.append(this.itemEl(item, actions));
    panel.append(list);

    const refill = h("button", { class: "btn", type: "button" }, "Fill again");
    refill.addEventListener("click", () => actions.refill());
    panel.append(h("div", { class: "foot" }, h("p", { class: "muted" }, "Review every field, then press the site's Submit button yourself."), refill));
    this.root.append(panel);
  }

  private header(title: string, subtitle: string | null) {
    const min = h("button", { class: "icon-btn", type: "button", "aria-label": this.minimized ? "Expand" : "Minimize", title: this.minimized ? "Expand" : "Minimize" }, this.minimized ? "▴" : "▾");
    min.addEventListener("click", () => {
      this.minimized = !this.minimized;
      this.host.dispatchEvent(new CustomEvent("jd-rerender"));
    });
    return h("div", { class: "head" }, h("span", { class: "logo", "aria-hidden": "true" }, "JD"), h("div", { class: "title" }, title, subtitle ? h("small", {}, subtitle) : null), min);
  }

  onRerender(fn: () => void) {
    this.host.addEventListener("jd-rerender", fn);
  }

  private itemEl(item: Item, actions: PanelActions) {
    const box = h("div", { class: "item" });
    const labelBtn = h("button", { class: "label", type: "button", title: "Scroll to this field" }, item.field.label || "(unlabeled field)");
    labelBtn.addEventListener("click", () => scrollToField(item.field));
    const dot = h("span", { class: `dot s-${item.status}`, "aria-label": WORD[item.status] }, ICON[item.status]);
    const body = h("div", { style: "min-width:0;flex:1" }, labelBtn);
    if (item.shown) body.append(h("div", { class: "value" }, item.shown.length > 160 ? `${item.shown.slice(0, 160)}…` : item.shown));
    if (item.note) body.append(h("div", { class: "muted" }, item.note));
    box.append(h("div", { class: "row" }, dot, body));

    const editable = (item.status === "needs_user" || item.status === "review" || item.status === "failed") && item.field.kind !== "file" && item.field.control !== "single-checkbox";
    if (editable) box.append(this.editor(item, actions));
    return box;
  }

  private editor(item: Item, actions: PanelActions) {
    const wrap = h("div", { class: "edit" });
    const f = item.field;
    let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (f.options.length) {
      input = h("select", { "aria-label": `Answer for ${f.label}` });
      input.append(h("option", { value: "" }, "Choose…"));
      for (const o of f.options) input.append(h("option", { value: o }, o));
      if (item.shown && f.options.includes(item.shown)) input.value = item.shown;
    } else if (f.kind === "textarea") {
      input = h("textarea", { "aria-label": `Answer for ${f.label}` });
      input.value = item.shown;
    } else {
      input = h("input", { type: "text", "aria-label": `Answer for ${f.label}` });
      input.value = item.shown;
    }
    const saveable = item.answer ? item.answer.saveable : f.kind !== "textarea";
    const remember = h("input", { type: "checkbox" }) as HTMLInputElement;
    remember.checked = saveable && item.status === "needs_user";
    const apply = h("button", { class: "btn primary", type: "button" }, "Use this answer");
    apply.addEventListener("click", async () => {
      const value = input.value.trim();
      if (!value) return;
      apply.setAttribute("disabled", "");
      const r = await fillField(f, value);
      item.status = r.ok ? "filled" : "failed";
      item.shown = r.shown || value;
      item.source = "user";
      item.note = r.ok ? null : "Still couldn't set it. Please set it on the form.";
      if (r.ok && saveable && remember.checked) {
        try {
          await actions.saveAnswer(item, value, "global");
          item.note = "Saved to your answers for next time.";
        } catch (err) {
          item.note = `Filled, but couldn't save: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      this.host.dispatchEvent(new CustomEvent("jd-rerender"));
    });
    wrap.append(input);
    if (saveable) wrap.append(h("label", { class: "check" }, remember, "Save for future applications"));
    wrap.append(apply);
    return wrap;
  }

  private clear() {
    for (const el of [...this.root.children]) if (el.tagName !== "STYLE") el.remove();
  }
}

export type { QuestionAnswer };
