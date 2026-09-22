ALTER TABLE "application_event" ADD COLUMN "filled_applied_at" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "application_event" ADD COLUMN "filled_confirmed_at" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Cards that reached Applied or later without an applied date: moved there skipping Applied, or
-- created by an interview, offer or rejection email. The earlier of the move that got there and the
-- first email about it (a mailbox backfill records old emails' moves today), else when it was added.
UPDATE "application" AS a SET "applied_at" = coalesce(
  least(
    (SELECT min(e."created_at") FROM "application_event" e
      WHERE e."application_id" = a."id" AND e."reverted_at" IS NULL AND e."to_status" IN ('applied', 'interview', 'offer')),
    (SELECT min(m."received_at") FROM "email_message" m WHERE m."application_id" = a."id")),
  a."created_at")
WHERE a."applied_at" IS NULL
  AND (a."status" IN ('applied', 'interview', 'offer') OR (a."status" = 'rejected' AND a."source" = 'email'));
