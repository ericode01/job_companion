/** An email reduced to what classification needs. Nothing here is stored except headers and a snippet. */
export interface RawEmail {
  /** Gmail message id, or "<folder>:<uidValidity>:<uid>" for IMAP. */
  providerId: string;
  rfcMessageId: string | null;
  threadId: string | null;
  fromName: string | null;
  fromAddress: string | null;
  subject: string;
  receivedAt: Date;
  /** Plain-text body, quoted replies trimmed. */
  text: string;
  /** Links found in the body (job-board URLs help find the job). */
  links: string[];
}

/** Headers only: what the prefilter decides on before a body is downloaded. */
export interface EmailHeaders {
  providerId: string;
  threadId: string | null;
  fromName: string | null;
  fromAddress: string | null;
  subject: string;
  receivedAt: Date;
  listId?: string | null;
  /** Gmail's short preview of the body, when the provider gives one for free. */
  snippet?: string | null;
  /** Set on Job Companion's own digests. */
  fromJobCompanion?: boolean;
}

export interface MailSource {
  /** Candidate headers since the cursor, or within the look-back window on the first run. */
  listHeaders(): Promise<EmailHeaders[]>;
  /** Full message for one candidate. */
  fetchEmail(h: EmailHeaders): Promise<RawEmail | null>;
  /** Advances the stored cursor after every listed email has been handled. */
  commit(): Promise<void>;
  close(): Promise<void>;
}

export class ReauthRequiredError extends Error {}
