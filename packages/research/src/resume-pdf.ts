import type { ResumeSource } from "@jd/core";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const PAGE = { width: 612, height: 792 };
const MARGIN = 54;
const ACCENT = rgb(0.01, 0.41, 0.63);

/** Helvetica can't encode every character; swap the common typographic ones. */
function ascii(s: string): string {
  return s
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•·]/g, "-")
    .replace(/[^\x20-\x7E]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of ascii(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Renders a resume as a single-column, text-based PDF: no tables or columns, so
 * applicant tracking systems can read it.
 */
export async function renderResumePdf(source: ResumeSource): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const width = PAGE.width - MARGIN * 2;

  let page: PDFPage = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  const space = (n: number) => {
    y -= n;
  };
  const ensure = (needed: number) => {
    if (y - needed < MARGIN) {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - MARGIN;
    }
  };
  const draw = (text: string, opts: { font?: PDFFont; size?: number; indent?: number; color?: ReturnType<typeof rgb> } = {}) => {
    const font = opts.font ?? body;
    const size = opts.size ?? 10;
    const indent = opts.indent ?? 0;
    for (const line of wrap(text, font, size, width - indent)) {
      ensure(size + 3);
      page.drawText(line, { x: MARGIN + indent, y, size, font, color: opts.color ?? rgb(0.1, 0.1, 0.12) });
      y -= size + 3;
    }
  };
  const rightText = (left: string, right: string, size = 10, font: PDFFont = body) => {
    ensure(size + 3);
    page.drawText(ascii(left), { x: MARGIN, y, size, font, color: rgb(0.1, 0.1, 0.12) });
    const w = body.widthOfTextAtSize(ascii(right), size);
    page.drawText(ascii(right), { x: PAGE.width - MARGIN - w, y, size, font: body, color: rgb(0.35, 0.37, 0.42) });
    y -= size + 3;
  };
  const heading = (text: string) => {
    space(8);
    ensure(24);
    draw(text.toUpperCase(), { font: bold, size: 10.5, color: ACCENT });
    page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: PAGE.width - MARGIN, y: y + 2 }, thickness: 0.6, color: ACCENT, opacity: 0.4 });
    space(5);
  };

  const c = source.contact;
  if (c.name) draw(c.name, { font: bold, size: 18 });
  const contactLine = [c.location, c.phone, c.email, ...c.links].filter(Boolean).join("  |  ");
  if (contactLine) draw(contactLine, { size: 9, color: rgb(0.35, 0.37, 0.42) });

  if (source.summary) {
    heading("Summary");
    draw(source.summary);
  }

  if (source.experience.length) {
    heading("Experience");
    for (const e of source.experience) {
      rightText(`${e.title}, ${e.company}`, [e.start, e.end].filter(Boolean).join(" - "), 10.5, bold);
      if (e.location) draw(e.location, { font: italic, size: 9, color: rgb(0.35, 0.37, 0.42) });
      for (const b of e.bullets) draw(`- ${b.text}`, { indent: 10 });
      space(4);
    }
  }

  if (source.skills.length) {
    heading("Skills");
    for (const k of source.skills) draw(k.category ? `${k.category}: ${k.items.join(", ")}` : k.items.join(", "));
  }

  if (source.projects.length) {
    heading("Projects");
    for (const p of source.projects) {
      draw(p.name, { font: bold });
      if (p.description) draw(p.description);
      for (const b of p.bullets) draw(`- ${b.text}`, { indent: 10 });
    }
  }

  if (source.education.length) {
    heading("Education");
    for (const e of source.education) {
      rightText([e.degree, e.field].filter(Boolean).join(", ") || e.school, e.end ?? "", 10, bold);
      draw(e.school, { size: 9.5 });
      for (const d of e.details ?? []) draw(`- ${d}`, { indent: 10, size: 9.5 });
    }
  }

  for (const a of source.additional ?? []) {
    heading(a.heading);
    for (const item of a.items) draw(`- ${item}`, { indent: 10 });
  }

  if (source.certifications.length) {
    heading("Certifications");
    for (const item of source.certifications) draw(`- ${item}`, { indent: 10 });
  }

  return pdf.save();
}

/** Plain-text rendering stored alongside the PDF (used for search and as a fallback). */
export function resumeToText(source: ResumeSource): string {
  const out: string[] = [];
  const c = source.contact;
  out.push([c.name, c.location, c.phone, c.email, ...c.links].filter(Boolean).join(" | "));
  if (source.summary) out.push(`\nSUMMARY\n${source.summary}`);
  if (source.experience.length) {
    out.push("\nEXPERIENCE");
    for (const e of source.experience) {
      out.push(`${e.title}, ${e.company}${e.location ? ` (${e.location})` : ""} ${[e.start, e.end].filter(Boolean).join(" - ")}`);
      for (const b of e.bullets) out.push(`- ${b.text}`);
    }
  }
  if (source.skills.length) out.push(`\nSKILLS\n${source.skills.map((k) => (k.category ? `${k.category}: ${k.items.join(", ")}` : k.items.join(", "))).join("\n")}`);
  if (source.education.length) {
    out.push("\nEDUCATION");
    for (const e of source.education) {
      out.push([e.degree, e.field, e.school, e.end].filter(Boolean).join(", "));
      for (const d of e.details ?? []) out.push(`- ${d}`);
    }
  }
  for (const a of source.additional ?? []) out.push(`\n${a.heading.toUpperCase()}\n${a.items.map((i) => `- ${i}`).join("\n")}`);
  if (source.certifications.length) out.push(`\nCERTIFICATIONS\n${source.certifications.join("\n")}`);
  return out.join("\n");
}
