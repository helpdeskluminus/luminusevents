import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Loader2,
  ShieldAlert,
  UploadCloud,
  XCircle,
} from "lucide-react";

import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

import { MailComposerCard } from "./mailSend/MailComposerCard";
import type {
  EmailRecipient,
  LogFilter,
  SendEmailResult,
  UploadedKind,
  UploadedSheet,
  ValidationSummary,
  VerificationLog,
} from "./mailSend/types";
import {
  applyMailVariables,
  buildTemplateHtml,
  loadSheetFromUrl,
  parseSpreadsheet,
  textValue,
  verifyTransactionSheets,
} from "./mailSend/utils";
import { VerificationLogCard } from "./mailSend/VerificationLogCard";

const ALLOWED_ROLES = new Set(["admin", "coordinator"]);
const MAILER_API_BASE =
  import.meta.env.VITE_MAILER_API_URL?.replace(/\/$/, "") || "/api";

const MailSend = () => {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [billdeskSheet, setBilldeskSheet] = useState<UploadedSheet | null>(
    null,
  );
  const [supabaseSheet, setSupabaseSheet] = useState<UploadedSheet | null>(
    null,
  );
  const [validationLogs, setValidationLogs] = useState<VerificationLog[]>([]);
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  const [filter, setFilter] = useState<LogFilter>("ALL");
  const [validating, setValidating] = useState(false);
  const [selectedLog, setSelectedLog] = useState<VerificationLog | null>(null);

  const [smtpHost, setSmtpHost] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [fromName, setFromName] = useState("Team Luminus");
  const [fromEmail, setFromEmail] = useState("");
  const [mailSubject, setMailSubject] = useState(
    "You're confirmed for {event}!",
  );
  const [mailBody, setMailBody] = useState(
    "Dear {name},\n\nYour registration is confirmed for {event}.\nStudent ID: {studentId}\nTransaction ID: {transactionId}\n\nSee you at Luminus Tech Fest!\n\nTeam Luminus",
  );
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>(
    [],
  );
  const [sendingEmails, setSendingEmails] = useState(false);
  const [sendEmailResult, setSendEmailResult] =
    useState<SendEmailResult | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate("/auth", { replace: true });

    if (!loading && user && profile) {
      if (profile.approval_status !== "approved") {
        navigate("/pending", { replace: true });
      } else if (!ALLOWED_ROLES.has(profile.role)) {
        navigate("/", { replace: true });
      }
    }
  }, [loading, user, profile, navigate]);

  const canValidate = useMemo(
    () => Boolean(billdeskSheet && supabaseSheet),
    [billdeskSheet, supabaseSheet],
  );

  const filteredLogs = useMemo(() => {
    if (filter === "ALL") return validationLogs;
    return validationLogs.filter((log) => log.verificationStatus === filter);
  }, [filter, validationLogs]);

  const verifiedRecipients = useMemo<EmailRecipient[]>(() => {
    return validationLogs
      .map((log, index) => {
        if (log.verificationStatus !== "VERIFIED") return null;

        const primary = log.matchedParticipants[0];
        const email = textValue(log.billdeskEmail || primary?.email);

        if (!email) return null;

        return {
          id: `${log.transactionId || "txn"}-${log.studentId || "sid"}-${index}`,
          name: textValue(log.billdeskName || primary?.name) || "Participant",
          email,
          studentId: textValue(log.studentId || primary?.studentId),
          event:
            textValue(
              log.billdeskEvent || primary?.event || log.matchedEvent,
            ) || "Luminus Tech Fest",
          transactionId: textValue(log.transactionId),
        };
      })
      .filter((recipient): recipient is EmailRecipient => Boolean(recipient));
  }, [validationLogs]);

  useEffect(() => {
    setSelectedRecipientIds(
      verifiedRecipients.map((recipient) => recipient.id),
    );
  }, [verifiedRecipients]);

  const selectedRecipients = useMemo(
    () =>
      verifiedRecipients.filter((recipient) =>
        selectedRecipientIds.includes(recipient.id),
      ),
    [verifiedRecipients, selectedRecipientIds],
  );

  const previewRecipient =
    selectedRecipients[0] || verifiedRecipients[0] || null;

  const previewSubject = useMemo(() => {
    if (!previewRecipient) return mailSubject;

    return applyMailVariables(mailSubject, {
      name: previewRecipient.name,
      studentid: previewRecipient.studentId,
      email: previewRecipient.email,
      event: previewRecipient.event,
      transactionid: previewRecipient.transactionId,
    });
  }, [mailSubject, previewRecipient]);

  const previewBody = useMemo(() => {
    if (!previewRecipient) return mailBody;

    return applyMailVariables(mailBody, {
      name: previewRecipient.name,
      studentid: previewRecipient.studentId,
      email: previewRecipient.email,
      event: previewRecipient.event,
      transactionid: previewRecipient.transactionId,
    });
  }, [mailBody, previewRecipient]);

  const previewHtmlLength = useMemo(() => {
    if (!previewRecipient) return 0;
    return buildTemplateHtml(previewSubject, previewBody, previewRecipient.name)
      .length;
  }, [previewBody, previewRecipient, previewSubject]);

  const handleUpload = async (
    kind: UploadedKind,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = await parseSpreadsheet(file, kind === "billdesk");

      if (kind === "billdesk") {
        setBilldeskSheet(parsed);
      } else {
        setSupabaseSheet(parsed);
      }

      setValidationLogs([]);
      setSummary(null);
      setFilter("ALL");

      toast({
        title: `${kind === "billdesk" ? "BillDesk" : "Supabase"} file loaded`,
        description: `${parsed.rowCount} rows detected in ${parsed.fileName}`,
      });
    } catch (error) {
      toast({
        title: "Upload failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not read spreadsheet file.",
        variant: "destructive",
      });
    } finally {
      event.target.value = "";
    }
  };

  const runValidation = () => {
    if (!billdeskSheet || !supabaseSheet) return;

    setValidating(true);

    try {
      const { logs, invalidRows } = verifyTransactionSheets(
        billdeskSheet,
        supabaseSheet,
      );
      const verifiedTransactions = logs.filter(
        (log) => log.verificationStatus === "VERIFIED",
      ).length;

      const validationSummary: ValidationSummary = {
        totalTransactions: logs.length,
        verifiedTransactions,
        failedTransactions: logs.length - verifiedTransactions,
        invalidSupabaseRows: invalidRows,
      };

      setValidationLogs(logs);
      setSummary(validationSummary);
      setFilter("ALL");

      toast({
        title: "Validation completed",
        description: `Verified ${verifiedTransactions}/${logs.length} transaction(s).`,
      });
    } catch {
      toast({
        title: "Validation failed",
        description: "Unexpected error while running verification.",
        variant: "destructive",
      });
    } finally {
      setValidating(false);
    }
  };

  const toggleRecipientSelection = (recipientId: string, checked: boolean) => {
    setSelectedRecipientIds((current) => {
      if (checked) {
        if (current.includes(recipientId)) return current;
        return [...current, recipientId];
      }

      return current.filter((id) => id !== recipientId);
    });
  };

  const toggleAllRecipients = (checked: boolean) => {
    if (checked) {
      setSelectedRecipientIds(
        verifiedRecipients.map((recipient) => recipient.id),
      );
      return;
    }

    setSelectedRecipientIds([]);
  };

  const handleSendEmails = async () => {
    if (!selectedRecipients.length) {
      toast({
        title: "No recipients selected",
        description: "Select at least one verified participant to send emails.",
        variant: "destructive",
      });
      return;
    }

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPassword || !fromEmail) {
      toast({
        title: "SMTP settings incomplete",
        description:
          "Host, port, login email, password and from address are required.",
        variant: "destructive",
      });
      return;
    }

    setSendingEmails(true);
    setSendEmailResult(null);

    try {
      const response = await fetch(`${MAILER_API_BASE}/send-mails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          smtp: {
            host: smtpHost,
            port: Number(smtpPort),
            secure: Number(smtpPort) === 465,
            user: smtpUser,
            pass: smtpPassword,
            fromEmail,
            fromName,
          },
          message: {
            subjectTemplate: mailSubject,
            bodyTemplate: mailBody,
          },
          recipients: selectedRecipients,
        }),
      });

      const payload = (await response.json()) as
        | {
            attempted: number;
            sent: number;
            failed: number;
            errors: Array<{ email: string; reason: string }>;
            error?: string;
          }
        | undefined;

      if (!response.ok || !payload) {
        throw new Error(payload?.error || "Failed to send emails.");
      }

      setSendEmailResult({
        attempted: payload.attempted,
        sent: payload.sent,
        failed: payload.failed,
        errors: payload.errors || [],
      });

      toast({
        title: "Mail process completed",
        description: `Sent ${payload.sent}/${payload.attempted} emails successfully.`,
      });
    } catch (error) {
      toast({
        title: "Email sending failed",
        description:
          error instanceof Error
            ? error.message
            : "Unexpected error while sending emails.",
        variant: "destructive",
      });
    } finally {
      setSendingEmails(false);
    }
  };

  if (loading || (user && !profile)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground font-body">Loading...</p>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="min-h-screen bg-background">
      <Navbar profile={profile} onSignOut={signOut} />

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            <span className="bordered-text">Mail</span>{" "}
            <span className="highlight-text">Send</span>
          </h1>
          <p className="text-sm text-muted-foreground font-body max-w-3xl">
            Transaction-by-transaction verification using BillDesk student ID
            and Supabase participants JSON parsing.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
                BillDesk Data
              </CardTitle>
              <CardDescription>
                Upload BillDesk CSV/XLSX. Matching uses student ID and event
                name.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(event) => handleUpload("billdesk", event)}
                className="cursor-pointer"
              />

              {billdeskSheet ? (
                <div className="rounded-lg border border-border bg-secondary/40 p-3 text-sm">
                  <p className="font-semibold text-foreground">
                    {billdeskSheet.fileName}
                  </p>
                  <p className="text-muted-foreground mt-1">
                    {billdeskSheet.rowCount} rows -{" "}
                    {billdeskSheet.headers.length} columns
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No Supabase file selected yet. Upload a CSV/XLSX file.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                Supabase Data
              </CardTitle>
              <CardDescription>
                Upload Supabase CSV/XLSX. Field participants is parsed as JSON.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(event) => handleUpload("supabase", event)}
                className="cursor-pointer"
              />

              {supabaseSheet ? (
                <div className="rounded-lg border border-border bg-secondary/40 p-3 text-sm">
                  <p className="font-semibold text-foreground">
                    {supabaseSheet.fileName}
                  </p>
                  <p className="text-muted-foreground mt-1">
                    {supabaseSheet.rowCount} rows -{" "}
                    {supabaseSheet.headers.length} columns
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No Supabase file selected yet. Upload a CSV/XLSX file.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={runValidation}
            disabled={!canValidate || validating}
            className="rounded-full h-12 px-8 text-sm font-semibold tracking-wider"
          >
            <UploadCloud className="h-4 w-4 mr-2" />
            {validating ? "VALIDATING..." : "VALIDATE TRANSACTIONS"}
          </Button>
          <p className="text-xs text-muted-foreground font-body">
            For each transaction: student ID match, then event match.
          </p>
        </div>

        {summary && (
          <Card
            className={
              summary.failedTransactions === 0
                ? "border-success/30 bg-success/5"
                : "border-warning/40 bg-warning/10"
            }
          >
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                {summary.failedTransactions === 0 ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : (
                  <ShieldAlert className="h-5 w-5 text-warning" />
                )}
                Verification Summary
              </CardTitle>
              <CardDescription>
                Includes all transactions with explicit reason.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-lg border border-border bg-background/70 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Total Transactions
                </p>
                <p className="text-sm font-semibold text-foreground mt-1">
                  {summary.totalTransactions}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background/70 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Verified
                </p>
                <p className="text-sm font-semibold text-success mt-1">
                  {summary.verifiedTransactions}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background/70 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Failed
                </p>
                <p className="text-sm font-semibold text-destructive mt-1">
                  {summary.failedTransactions}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background/70 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Invalid Supabase Rows
                </p>
                <p className="text-sm font-semibold text-warning mt-1">
                  {summary.invalidSupabaseRows}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {validationLogs.length > 0 && (
          <VerificationLogCard
            filteredLogs={filteredLogs}
            filter={filter}
            onFilterChange={setFilter}
            onViewDetails={setSelectedLog}
          />
        )}

        {validationLogs.length > 0 && (
          <MailComposerCard
            verifiedRecipients={verifiedRecipients}
            selectedRecipientIds={selectedRecipientIds}
            selectedRecipients={selectedRecipients}
            mailSubject={mailSubject}
            mailBody={mailBody}
            previewRecipient={previewRecipient}
            previewSubject={previewSubject}
            previewBody={previewBody}
            previewHtmlLength={previewHtmlLength}
            smtpHost={smtpHost}
            smtpPort={smtpPort}
            smtpUser={smtpUser}
            smtpPassword={smtpPassword}
            fromName={fromName}
            fromEmail={fromEmail}
            sendingEmails={sendingEmails}
            sendEmailResult={sendEmailResult}
            onToggleAllRecipients={toggleAllRecipients}
            onToggleRecipient={toggleRecipientSelection}
            onMailSubjectChange={setMailSubject}
            onMailBodyChange={setMailBody}
            onSmtpHostChange={setSmtpHost}
            onSmtpPortChange={setSmtpPort}
            onSmtpUserChange={setSmtpUser}
            onSmtpPasswordChange={setSmtpPassword}
            onFromNameChange={setFromName}
            onFromEmailChange={setFromEmail}
            onSendEmails={handleSendEmails}
          />
        )}

        <Dialog
          open={Boolean(selectedLog)}
          onOpenChange={(open) => {
            if (!open) setSelectedLog(null);
          }}
        >
          <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
            {selectedLog && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    {selectedLog.verificationStatus === "VERIFIED" ? (
                      <CheckCircle2 className="h-5 w-5 text-success" />
                    ) : (
                      <XCircle className="h-5 w-5 text-destructive" />
                    )}
                    Transaction Details
                  </DialogTitle>
                  <DialogDescription>
                    Full verification context for transaction{" "}
                    {selectedLog.transactionId || "-"}.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3 sm:grid-cols-2 mt-2">
                  <div className="rounded-md border border-border/70 bg-secondary/20 p-3">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Status
                    </p>
                    <p className="text-sm font-semibold mt-1">
                      {selectedLog.verificationStatus}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-secondary/20 p-3">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Transaction ID
                    </p>
                    <p className="text-sm font-semibold mt-1 break-all">
                      {selectedLog.transactionId || "-"}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-secondary/20 p-3">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Student ID
                    </p>
                    <p className="text-sm font-semibold mt-1">
                      {selectedLog.studentId || "-"}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-secondary/20 p-3">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      BillDesk Event
                    </p>
                    <p className="text-sm font-semibold mt-1 break-words">
                      {selectedLog.billdeskEvent || "-"}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-secondary/20 p-3 sm:col-span-2">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Reason
                    </p>
                    <p className="text-sm mt-1 break-words">
                      {selectedLog.reason}
                    </p>
                  </div>
                </div>

                <div className="rounded-md border border-border/70 p-3 mt-1">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Scan Stats
                  </p>
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                    <div>Registrations: {selectedLog.registrationsScanned}</div>
                    <div>Participants: {selectedLog.participantsScanned}</div>
                    <div>Student Matches: {selectedLog.matchesByStudent}</div>
                    <div>
                      Student+Event: {selectedLog.matchesByStudentAndEvent}
                    </div>
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default MailSend;
