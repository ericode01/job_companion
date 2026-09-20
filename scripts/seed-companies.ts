import fs from "node:fs";
import path from "node:path";
import { importSeedCompanies, type SeedCompany } from "@jd/sources";

const file = path.join(import.meta.dirname, "../packages/sources/seed/companies.json");
const rows = JSON.parse(fs.readFileSync(file, "utf8")) as SeedCompany[];
console.log(`Imported ${importSeedCompanies(rows)} new companies (${rows.length} in seed list).`);
