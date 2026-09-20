import type { AtsType, NormalizedJob } from "@jd/core";

export interface ListOptions {
  /** Stop after this many postings. Boards with tens of thousands of jobs would otherwise crawl for minutes. */
  maxJobs?: number;
}

export interface AtsAdapter {
  type: AtsType;
  /** Extracts the board slug from a careers/job URL, or null if the URL isn't this ATS. */
  detect(url: string): { slug: string } | null;
  /** Fetches all open postings for a board. Throws HttpError(404) if the board doesn't exist. */
  listJobs(slug: string, opts?: ListOptions): Promise<{ companyName: string | null; jobs: NormalizedJob[] }>;
  /**
   * Fills in a posting's description (and, on Workday, its real locations) with one extra
   * request. Only defined for boards whose list endpoint omits them — see NormalizedJob.needsDetail.
   */
  hydrate?(slug: string, job: NormalizedJob): Promise<NormalizedJob>;
}
