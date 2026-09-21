import fs from "node:fs";
import path from "node:path";
import { initDb } from "@jd/core/db";
import { importSeedCompanies, type SeedCompany } from "@jd/sources";

await initDb();

const file = path.join(import.meta.dirname, "../packages/sources/seed/companies.json");
const rows = JSON.parse(fs.readFileSync(file, "utf8")) as SeedCompany[];
console.log(`Imported ${await importSeedCompanies(rows)} new companies (${rows.length} in seed list).`);
