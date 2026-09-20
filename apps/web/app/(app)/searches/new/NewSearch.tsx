"use client";

import { useRouter } from "next/navigation";
import { NewSearchForm } from "@/components/NewSearchForm";

export function NewSearch({ defaultRemote }: { defaultRemote: boolean }) {
  const router = useRouter();
  return (
    <NewSearchForm
      defaultRemote={defaultRemote}
      onCreated={(id) => {
        router.push(`/d/${id}`);
        router.refresh();
      }}
    />
  );
}
