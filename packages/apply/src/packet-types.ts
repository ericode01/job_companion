/** Browser-safe: shared with the Chrome extension. */
export interface ApplyPacket {
  applicationId: number;
  job: { id: number; title: string; company: string; url: string; applyUrl: string; atsType: string };
  profile: {
    fullName: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    location: string | null;
    linkedin: string | null;
    github: string | null;
    website: string | null;
    currentCompany: string | null;
    currentTitle: string | null;
  };
  resume: { fileName: string; mimeType: "application/pdf"; base64: string } | null;
  coverLetter: { text: string; fileName: string; mimeType: "application/pdf"; base64: string } | null;
  coverLetterChoice: "yes" | "no" | null;
}

