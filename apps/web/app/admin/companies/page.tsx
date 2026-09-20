import type { Metadata } from "next";
import { CompaniesAdmin } from "@/components/CompaniesAdmin";

export const metadata: Metadata = { title: "Companies" };

export default function AdminCompanies() {
  return <CompaniesAdmin />;
}
