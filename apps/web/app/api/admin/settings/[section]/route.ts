import { getSettings, isSettingsSection, saveSettings } from "@jd/core";
import { json, notFound, readJson, withAdmin } from "@/lib/api";

type Ctx = { params: Promise<{ section: string }> };

/** System settings: sources, AI and budget, research, mail. */
export function GET(req: Request, { params }: Ctx) {
  return withAdmin(req, async () => {
    const { section } = await params;
    return isSettingsSection(section) ? json(await getSettings(section)) : notFound();
  });
}

export function PUT(req: Request, { params }: Ctx) {
  return withAdmin(req, async () => {
    const { section } = await params;
    if (!isSettingsSection(section)) return notFound();
    return json(await saveSettings(section, await readJson(req)));
  });
}
