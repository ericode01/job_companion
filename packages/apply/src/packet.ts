import fs from "node:fs";
import { getProfile } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import { getResume } from "@jd/research";
import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getApplication } from "./application";
import type { ApplyPacket } from "./packet-types";

export type { ApplyPacket };

export async function coverLetterPdf(text: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const size = 11;
  const margin = 72;
  const lineHeight = size * 1.45;
  let page = pdf.addPage([612, 792]);
  const maxWidth = page.getWidth() - margin * 2;
  let y = page.getHeight() - margin;
  // Helvetica (WinAnsi) can't encode every character; swap common typographic ones.
  const clean = text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, "");
  for (const para of clean.split(/\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    const flush = () => {
      if (y < margin) {
        page = pdf.addPage([612, 792]);
        y = page.getHeight() - margin;
      }
      page.drawText(line, { x: margin, y, size, font });
      y -= lineHeight;
      line = "";
    };
    if (words.length === 0) {
      y -= lineHeight * 0.6;
      continue;
    }
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        flush();
        line = w;
      } else line = next;
    }
    if (line) flush();
  }
  return pdf.save();
}

function safeFileName(s: string): string {
  return s.replace(/[^\w .-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "file";
}

/** Everything the extension needs to fill one application. */
export async function buildPacket(userId: number, applicationId: number): Promise<ApplyPacket | null> {
  const db = getDb();
  const app = getApplication(userId, applicationId);
  if (!app || app.jobId === null) return null;
  const row = db
    .select({ job: schema.job, company: schema.company })
    .from(schema.job)
    .innerJoin(schema.company, eq(schema.company.id, schema.job.companyId))
    .where(eq(schema.job.id, app.jobId))
    .get();
  if (!row) return null;
  const profile = getProfile(userId);
  const resume = app.resumeId ? getResume(app.resumeId) : null;
  const src = resume?.source;
  const fullName = profile?.name ?? src?.contact.name ?? null;
  // "JANE Q PUBLIC" → "Jane Q Public"; forms rarely want all caps.
  const pretty = fullName && fullName === fullName.toUpperCase() ? fullName.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : fullName;
  const parts = pretty?.trim().split(/\s+/) ?? [];
  const current = src?.experience.find((e) => !e.end || /present|current|now/i.test(e.end)) ?? src?.experience[0];

  let resumeFile: ApplyPacket["resume"] = null;
  if (resume && fs.existsSync(resume.filePath)) {
    resumeFile = { fileName: safeFileName(`${pretty ?? "Resume"} Resume`) + ".pdf", mimeType: "application/pdf", base64: fs.readFileSync(resume.filePath).toString("base64") };
  }
  let coverLetter: ApplyPacket["coverLetter"] = null;
  if (app.coverLetterChoice === "yes" && app.coverLetter) {
    coverLetter = {
      text: app.coverLetter,
      fileName: safeFileName(`${pretty ?? "Cover Letter"} Cover Letter ${row.company.name}`) + ".pdf",
      mimeType: "application/pdf",
      base64: Buffer.from(await coverLetterPdf(app.coverLetter)).toString("base64"),
    };
  }
  const links = profile?.links ?? {};
  return {
    applicationId: app.id,
    job: { id: row.job.id, title: row.job.title, company: row.company.name, url: row.job.url, applyUrl: row.job.applyUrl, atsType: row.job.atsType },
    profile: {
      fullName: pretty,
      firstName: parts[0] ?? null,
      lastName: parts.length > 1 ? parts[parts.length - 1]! : null,
      email: profile?.email ?? src?.contact.email ?? null,
      phone: profile?.phone ?? src?.contact.phone ?? null,
      location: profile?.location ?? src?.contact.location ?? null,
      linkedin: links.linkedin ?? null,
      github: links.github ?? null,
      website: links.site ?? null,
      currentCompany: current?.company ?? null,
      currentTitle: current?.title ?? null,
    },
    resume: resumeFile,
    coverLetter,
    coverLetterChoice: app.coverLetterChoice,
  };
}
