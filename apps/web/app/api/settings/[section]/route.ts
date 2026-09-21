import { getUserSettings, isUserSettingsSection, saveUserSettings } from "@jd/core";
import { json, notFound, readJson, withUser } from "@/lib/api";

type Ctx = { params: Promise<{ section: string }> };

/** Your own settings (search defaults, email digest). System settings live under /api/admin/settings. */
export function GET(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const { section } = await params;
    return isUserSettingsSection(section) ? json(await getUserSettings(user.id, section)) : notFound();
  });
}

export function PUT(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const { section } = await params;
    if (!isUserSettingsSection(section)) return notFound();
    return json(await saveUserSettings(user.id, section, await readJson(req)));
  });
}
