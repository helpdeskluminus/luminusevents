export type UploadedKind = "billdesk" | "supabase";
export type LogFilter = "ALL" | "VERIFIED" | "FAILED";

export type UploadedSheet = {
  fileName: string;
  rowCount: number;
  headers: string[];
  rows: Record<string, unknown>[];
};

export type ParticipantDetail = {
  name: string;
  studentId: string;
  email: string;
  phoneNumber: string;
  participantNumber: string;
  event: string;
};

export type RegistrationRow = {
  registrationId: string;
  eventName: string;
  participants: ParticipantDetail[];
};

export type VerificationLog = {
  transactionId: string;
  studentId: string;
  billdeskEvent: string;
  billdeskName: string;
  billdeskEmail: string;
  verificationStatus: "VERIFIED" | "FAILED";
  reason: string;
  registrationsScanned: number;
  participantsScanned: number;
  matchesByStudent: number;
  matchesByStudentAndEvent: number;
  matchedRegistrationId: string;
  matchedEvent: string;
  matchedParticipants: ParticipantDetail[];
};

export type ValidationSummary = {
  totalTransactions: number;
  verifiedTransactions: number;
  failedTransactions: number;
  invalidSupabaseRows: number;
};

export type EmailRecipient = {
  id: string;
  name: string;
  email: string;
  studentId: string;
  event: string;
  transactionId: string;
};

export type SendEmailResult = {
  attempted: number;
  sent: number;
  failed: number;
  errors: Array<{ email: string; reason: string }>;
};
