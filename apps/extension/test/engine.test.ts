// @vitest-environment happy-dom
import type { FormQuestion, QuestionAnswer } from "@jd/core/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { classifyField } from "../src/engine/classify";
import { collectFields, findFormRoot } from "../src/engine/collect";
import { isConfirmationPage } from "../src/engine/detect";
import { runFill, type EngineApi } from "../src/engine/runner";
import type { ApplyPacket } from "@jd/apply/packet-types";

const PDF = btoa("%PDF-1.4 fake");

const packet: ApplyPacket = {
  applicationId: 7,
  job: { id: 1, title: "Staff Engineer", company: "Acme", url: "https://x", applyUrl: "https://x/apply", atsType: "lever" },
  profile: {
    fullName: "Sam Rivera",
    firstName: "Sam",
    lastName: "Rivera",
    email: "sam@example.com",
    phone: "555-0100",
    location: "Brooklyn, NY",
    linkedin: "https://linkedin.com/in/sam",
    github: "https://github.com/sam",
    website: null,
    currentCompany: "Initech",
    currentTitle: "Senior Engineer",
  },
  resume: { fileName: "Sam Rivera Resume.pdf", mimeType: "application/pdf", base64: PDF },
  coverLetter: { text: "Dear Hiring Team, ...", fileName: "Cover.pdf", mimeType: "application/pdf", base64: PDF },
  coverLetterChoice: "yes",
};

/** Answers every question by label, the way the server would. */
function fakeApi(byLabel: Record<string, Partial<QuestionAnswer>>, seen: FormQuestion[][] = []): EngineApi {
  return {
    packet: async () => packet,
    answers: async (_id, questions) => {
      seen.push(questions);
      return {
        inboxAdded: 0,
        answers: questions.map((q) => ({
          index: q.index,
          value: null,
          source: "none",
          status: "needs_user",
          category: "custom",
          note: null,
          bankId: null,
          saveable: true,
          ...(byLabel[q.label] ?? {}),
        })) as QuestionAnswer[],
      };
    },
  };
}

// Mirrors the structure of a real Lever application form (jobs.lever.co/{company}/{id}/apply).
const LEVER = `
<form id="application-form">
  <ul>
    <li class="application-question resume"><label><div class="application-label">Resume/CV <span class="required">✱</span></div>
      <div class="application-field"><input class="application-file-input" id="resume-upload-input" name="resume" type="file"></div></label></li>
    <li class="application-question"><label><div class="application-label">Full name<span class="required">✱</span></div>
      <div class="application-field"><input type="text" name="name" required></div></label></li>
    <li class="application-question"><label><div class="application-label">Email<span class="required">✱</span></div>
      <div class="application-field"><input name="email" type="email" required></div></label></li>
    <li class="application-question"><label><div class="application-label">Phone </div><div class="application-field"><input type="text" name="phone"></div></label></li>
    <li class="application-question"><label><div class="application-label">Current company </div><div class="application-field"><input type="text" name="org"></div></label></li>
    <li class="application-question"><label><div class="application-label">LinkedIn URL</div><div class="application-field"><input type="text" name="urls[LinkedIn]"></div></label></li>
  </ul>
  <ul>
    <li class="application-question custom-question"><div><div class="application-label full-width multiple-choice"><div class="text">Will you now or in the future require sponsorship?<span class="required">✱</span></div></div>
      <div class="application-field"><ul>
        <li><label><input type="radio" name="cards[a][field0]" value="Yes" required><span class="application-answer-alternative">Yes</span></label></li>
        <li><label><input type="radio" name="cards[a][field0]" value="No" required><span class="application-answer-alternative">No</span></label></li>
      </ul></div></div></li>
    <li class="application-question custom-question"><div><div class="application-label full-width multiple-select"><div class="text">Language Skill(s) (Check all that apply)<span class="required">✱</span></div></div>
      <div class="application-field"><ul>
        <li><label><input type="checkbox" name="cards[b][field0]" value="English"><span class="application-answer-alternative">English</span></label></li>
        <li><label><input type="checkbox" name="cards[b][field0]" value="Mandarin"><span class="application-answer-alternative">Mandarin</span></label></li>
      </ul></div></div></li>
    <li class="application-question custom-question"><div><div class="application-label full-width"><div class="text">Why do you want to work at Acme?</div></div>
      <div class="application-field"><textarea name="cards[c][field0]"></textarea></div></div></li>
    <li class="application-question custom-question"><div><div class="application-label"><div class="text">Gender</div></div>
      <div class="application-field"><select name="eeo[gender]"><option value="">Select</option><option>Male</option><option>Female</option><option>Decline to self-identify</option></select></div></div></li>
  </ul>
  <div class="application-additional"><label for="additional-information"><h4>Additional information</h4></label>
    <textarea placeholder="Add a cover letter or anything else you want to share." name="comments" id="additional-information"></textarea></div>
  <ul><li><label><span><div>Acme has my consent to contact me about future job opportunities.</div></span>
    <input type="checkbox" name="consent[marketing]" value="1"></label></li></ul>
  <input type="hidden" name="h-captcha-response">
  <button id="btn-submit" type="button">Submit application</button>
</form>`;

// Mirrors Ashby: id'd inputs with label[for], fieldEntry containers, and Yes/No buttons.
const ASHBY = `
<form>
  <div class="_fieldEntry_x"><label for="_systemfield_name">Legal Name*</label><input id="_systemfield_name" name="_systemfield_name" type="text" required></div>
  <div class="_fieldEntry_x"><label for="_systemfield_email">Email*</label><input id="_systemfield_email" name="_systemfield_email" type="email" required></div>
  <div class="_fieldEntry_x"><label for="p1">Phone</label><input id="p1" name="p1" type="tel"></div>
  <div class="_fieldEntry_x"><label for="_systemfield_resume">Resume*</label><input id="_systemfield_resume" type="file" required></div>
  <div class="_fieldEntry_x"><label>Are you willing to work onsite 3 days a week in NYC?*</label><div><button type="button">Yes</button><button type="button">No</button></div></div>
  <div class="_fieldEntry_x"><label>Phone</label>
    <label><input type="radio" name="communicationConsent" value="y">Yes - I consent to receiving text messages</label>
    <label><input type="radio" name="communicationConsent" value="n">No - I do not consent to receiving text messages</label></div>
  <div class="_fieldEntry_x"><label for="loc">Where do you plan on working from?</label><input id="loc" role="combobox" placeholder="Start typing..."></div>
</form>`;

describe("collect + classify (Lever)", () => {
  beforeEach(() => {
    document.body.innerHTML = LEVER;
  });

  it("finds questions with labels, options, and required flags", () => {
    const fields = collectFields(findFormRoot(document)!);
    const byLabel = Object.fromEntries(fields.map((f) => [f.label, f]));
    expect(byLabel["Resume/CV"]).toMatchObject({ kind: "file", required: true });
    expect(byLabel["Full name"]).toMatchObject({ kind: "text", required: true });
    expect(byLabel["Will you now or in the future require sponsorship?"]).toMatchObject({ kind: "radio", options: ["Yes", "No"], required: true });
    expect(byLabel["Language Skill(s) (Check all that apply)"]).toMatchObject({ kind: "checkbox", options: ["English", "Mandarin"] });
    expect(byLabel["Gender"]).toMatchObject({ kind: "select", options: ["Male", "Female", "Decline to self-identify"] });
    expect(fields.find((f) => /consent/.test(f.label))).toMatchObject({ kind: "boolean", control: "single-checkbox" });
    expect(fields.some((f) => /captcha/i.test(f.hints))).toBe(false);
  });

  it("classifies profile fields and leaves questions for the server", () => {
    const fields = collectFields(findFormRoot(document)!);
    const keys = Object.fromEntries(fields.map((f) => [f.label, classifyField(f)]));
    expect(keys).toMatchObject({
      "Resume/CV": "resume",
      "Full name": "fullName",
      Email: "email",
      Phone: "phone",
      "Current company": "currentCompany",
      "LinkedIn URL": "linkedin",
      "Additional information": "coverLetterText",
      "Why do you want to work at Acme?": null,
      Gender: null,
    });
  });
});

describe("runFill", () => {
  it("fills Lever end to end, never touching consent or submitting", async () => {
    document.body.innerHTML = LEVER;
    let submitted = false;
    document.querySelector("form")!.addEventListener("submit", () => (submitted = true));
    const seen: FormQuestion[][] = [];
    const api = fakeApi(
      {
        "Will you now or in the future require sponsorship?": { value: "No", source: "bank", status: "filled", category: "sponsorship" },
        "Language Skill(s) (Check all that apply)": { value: ["English", "Mandarin"], source: "ai_derived", status: "review" },
        "Why do you want to work at Acme?": { value: "I like building ledgers.", source: "ai_draft", status: "review", saveable: false },
        Gender: { value: "Decline to self-identify", source: "bank", status: "filled", category: "eeo" },
      },
      seen,
    );
    const { items } = await runFill(findFormRoot(document)!, 7, api);
    const q = <T extends Element>(sel: string) => document.querySelector(sel) as unknown as T;

    expect(q<HTMLInputElement>("input[name=name]").value).toBe("Sam Rivera");
    expect(q<HTMLInputElement>("input[name=email]").value).toBe("sam@example.com");
    expect(q<HTMLInputElement>("input[name=org]").value).toBe("Initech");
    expect(q<HTMLInputElement>("input[name='urls[LinkedIn]']").value).toBe("https://linkedin.com/in/sam");
    expect(q<HTMLInputElement>("#resume-upload-input").files?.[0]?.name).toBe("Sam Rivera Resume.pdf");
    expect(q<HTMLTextAreaElement>("#additional-information").value).toBe("Dear Hiring Team, ...");
    expect(q<HTMLInputElement>("input[name='cards[a][field0]'][value=No]").checked).toBe(true);
    expect([...document.querySelectorAll<HTMLInputElement>("input[name='cards[b][field0]']")].every((i) => i.checked)).toBe(true);
    expect(q<HTMLTextAreaElement>("textarea[name='cards[c][field0]']").value).toBe("I like building ledgers.");
    expect(q<HTMLSelectElement>("select").value).toBe("Decline to self-identify");
    expect(q<HTMLInputElement>("input[name='consent[marketing]']").checked).toBe(false);
    expect(submitted).toBe(false);

    // Only custom questions go to the server; consent checkboxes aren't even sent.
    expect(seen[0]!.map((x) => x.label)).toEqual([
      "Will you now or in the future require sponsorship?",
      "Language Skill(s) (Check all that apply)",
      "Why do you want to work at Acme?",
      "Gender",
    ]);
    const status = Object.fromEntries(items.map((i) => [i.field.label, i.status]));
    expect(status["Why do you want to work at Acme?"]).toBe("review");
    expect(status["Will you now or in the future require sponsorship?"]).toBe("filled");
    expect(items.find((i) => /consent/.test(i.field.label))?.status).toBe("needs_user");
  });

  it("fills Ashby fields including Yes/No buttons", async () => {
    document.body.innerHTML = ASHBY;
    const clicked: string[] = [];
    document.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => clicked.push(b.textContent!)));
    const { items } = await runFill(findFormRoot(document)!, 7, fakeApi({ "Are you willing to work onsite 3 days a week in NYC?": { value: "Yes", source: "bank", status: "filled" } }));
    expect((document.getElementById("_systemfield_name") as HTMLInputElement).value).toBe("Sam Rivera");
    expect((document.getElementById("p1") as HTMLInputElement).value).toBe("555-0100");
    expect((document.getElementById("_systemfield_resume") as HTMLInputElement).files?.length).toBe(1);
    expect(clicked).toEqual(["Yes"]);
    const consent = items.find((i) => i.field.control === "radios")!;
    expect(consent.status).toBe("needs_user");
    expect([...document.querySelectorAll<HTMLInputElement>("input[name=communicationConsent]")].some((i) => i.checked)).toBe(false);
    expect(items.some((i) => i.field.label === "Where do you plan on working from?")).toBe(true);
  });

  it("reports needs_user when the server has no answer", async () => {
    document.body.innerHTML = LEVER;
    const { items } = await runFill(findFormRoot(document)!, 7, fakeApi({}));
    expect(items.find((i) => i.field.label === "Will you now or in the future require sponsorship?")?.status).toBe("needs_user");
  });
});

describe("confirmation detection", () => {
  it("recognizes common confirmation text", () => {
    document.body.innerHTML = "<h1>Thank you for applying!</h1>";
    expect(isConfirmationPage(document)).toBe(true);
    document.body.innerHTML = LEVER;
    expect(isConfirmationPage(document)).toBe(false);
  });
});

describe("parsePlace", () => {
  it("extracts city and state from addresses", async () => {
    const { parsePlace } = await import("../src/engine/fill");
    expect(parsePlace("350 Fifth Ave, New York, NY")).toEqual({ city: "New York", region: "New York" });
    expect(parsePlace("Brooklyn, NY")).toEqual({ city: "Brooklyn", region: "New York" });
    expect(parsePlace("London")).toEqual({ city: "London", region: null });
  });
});

describe("findFormRoot without a <form>", () => {
  it("uses the common ancestor of Ashby sections", () => {
    document.body.innerHTML = `<main><div id="app">
      <div class="_section_x ashby-application-form-section-container">${ASHBY.replace(/<\/?form>/g, "")}</div>
      <div class="_section_x ashby-application-form-section-container"><div class="_fieldEntry_x"><label for="q">Why?</label><textarea id="q"></textarea></div></div>
    </div></main>`;
    expect(findFormRoot(document)?.id).toBe("app");
  });
});
