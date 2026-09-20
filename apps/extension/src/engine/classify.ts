import type { ApplyPacket } from "@jd/apply/packet-types";
import type { Field } from "./collect";

export type StandardKey =
  | "firstName"
  | "lastName"
  | "fullName"
  | "preferredName"
  | "email"
  | "phone"
  | "location"
  | "linkedin"
  | "github"
  | "website"
  | "currentCompany"
  | "currentTitle"
  | "resume"
  | "coverLetterFile"
  | "coverLetterText"
  | "autofillResume";

/** Maps profile/resume-backed fields. Returns null for questions the server should answer. */
export function classifyField(f: Field): StandardKey | null {
  const label = f.label.toLowerCase();
  const text = `${label} ${f.hints}`;

  if (f.kind === "file") {
    if (/autofill|auto-fill|parse your resume/i.test(label)) return "autofillResume";
    if (/cover/.test(text)) return "coverLetterFile";
    if (/resume|cv\b|curriculum/.test(text)) return "resume";
    return null;
  }
  if (f.control === "textarea") {
    if (/cover letter/.test(text) || /\bcomments\b/.test(f.hints)) return "coverLetterText";
    return null;
  }
  // Choice questions (e.g. Ashby's "Phone" contact-consent radios) are never profile fields.
  if (f.control !== "input" && f.control !== "combobox") return null;

  if (/preferred/.test(text)) return "preferredName";
  if (/first.?name|given.?name|\bfname\b/.test(text)) return "firstName";
  if (/last.?name|family.?name|surname|\blname\b/.test(text)) return "lastName";
  if (/e-?mail|type:email/.test(text)) return "email";
  if (/phone|mobile|\btel\b|type:tel/.test(text)) return "phone";
  if (/linkedin/.test(text)) return "linkedin";
  if (/github/.test(text)) return "github";
  if (/website|portfolio|personal (site|url)|^url$/.test(label) || /urls\[portfolio\]|urls\[other\]/.test(f.hints)) return "website";
  if (/current (company|employer)|\borg\b/.test(text)) return "currentCompany";
  if (/current (job )?title/.test(text)) return "currentTitle";
  if (/^(current )?location|location \(city\)|candidate-location|^city\b/.test(label) || /\blocation\b/.test(f.hints)) return "location";
  const bareName = f.hints.trim().split(/\s+/)[0];
  if (/^(full |legal |your )?name$/.test(label) || bareName === "name" || /_systemfield_name/.test(f.hints)) return "fullName";
  return null;
}

export function standardValue(key: StandardKey, packet: ApplyPacket): string | null {
  const p = packet.profile;
  switch (key) {
    case "firstName":
      return p.firstName;
    case "lastName":
      return p.lastName;
    case "fullName":
      return p.fullName;
    case "email":
      return p.email;
    case "phone":
      return p.phone;
    case "location":
      return p.location;
    case "linkedin":
      return p.linkedin;
    case "github":
      return p.github;
    case "website":
      return p.website;
    case "currentCompany":
      return p.currentCompany;
    case "currentTitle":
      return p.currentTitle;
    case "coverLetterText":
      return packet.coverLetter?.text ?? null;
    default:
      return null;
  }
}
