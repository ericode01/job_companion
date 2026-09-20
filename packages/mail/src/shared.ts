/* Browser-safe: provider presets for the Mailbox page and the connect API. */

export interface ImapPreset {
  id: string;
  label: string;
  host: string;
  port: number;
  /** Address domains that pick this preset automatically. */
  domains: string[];
  /** How to make an app password, in one or two steps. */
  help: string;
  helpUrl?: string;
}

export const IMAP_PRESETS: ImapPreset[] = [
  {
    id: "icloud",
    label: "iCloud Mail",
    host: "imap.mail.me.com",
    port: 993,
    domains: ["icloud.com", "me.com", "mac.com"],
    help: "At account.apple.com, open Sign-In and Security → App-Specific Passwords, and generate one named “Job Companion”.",
    helpUrl: "https://support.apple.com/en-us/102654",
  },
  {
    id: "fastmail",
    label: "Fastmail",
    host: "imap.fastmail.com",
    port: 993,
    domains: ["fastmail.com", "fastmail.fm"],
    help: "In Settings → Privacy & Security → Manage app passwords, create one with access to Mail (IMAP/POP/SMTP).",
  },
  {
    id: "yahoo",
    label: "Yahoo Mail",
    host: "imap.mail.yahoo.com",
    port: 993,
    domains: ["yahoo.com", "ymail.com", "rocketmail.com"],
    help: "In Account Info → Account Security, choose Generate app password.",
  },
  {
    id: "gmail-imap",
    label: "Gmail (app password)",
    host: "imap.gmail.com",
    port: 993,
    domains: ["gmail.com", "googlemail.com"],
    help: "Needs 2-Step Verification. At myaccount.google.com/apppasswords, create an app password named “Job Companion”.",
  },
  {
    id: "other",
    label: "Another provider",
    host: "",
    port: 993,
    domains: [],
    help: "Use your provider's IMAP server and an app password if it offers one. Look for “IMAP settings” in its help pages.",
  },
];

export const GMAIL_DOMAINS = ["gmail.com", "googlemail.com"];

/** Microsoft turned off app passwords for IMAP on these, so they need a Microsoft sign-in we don't have yet. */
export const UNSUPPORTED_DOMAINS = ["outlook.com", "hotmail.com", "live.com", "msn.com"];

export function domainOf(address: string): string {
  return address.split("@")[1]?.trim().toLowerCase() ?? "";
}

export function presetFor(address: string): ImapPreset | null {
  const d = domainOf(address);
  return IMAP_PRESETS.find((p) => p.domains.includes(d)) ?? null;
}

export const LOOKBACK_CHOICES = [30, 60, 90, 180] as const;
