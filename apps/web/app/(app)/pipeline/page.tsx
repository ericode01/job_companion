import type { Metadata } from "next";
import { PipelineBoard } from "@/components/PipelineBoard";

export const metadata: Metadata = { title: "Pipeline" };

/** Everything you've applied to, in one place. Filter by job search inside the board. */
export default function Pipeline() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pipeline</h1>
        <p className="text-sm text-muted">Every application you&apos;re tracking, from any of your searches.</p>
      </div>
      <PipelineBoard />
    </div>
  );
}
