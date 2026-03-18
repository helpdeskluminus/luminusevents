import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import type { EmailRecipient, SendEmailResult } from "./types";
import { PERSONALIZATION_VARIABLES } from "./utils";

type MailComposerCardProps = {
  verifiedRecipients: EmailRecipient[];
  selectedRecipientIds: string[];
  selectedRecipients: EmailRecipient[];
  mailSubject: string;
  mailBody: string;
  previewRecipient: EmailRecipient | null;
  previewSubject: string;
  previewBody: string;
  previewHtmlLength: number;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  fromName: string;
  fromEmail: string;
  sendingEmails: boolean;
  sendEmailResult: SendEmailResult | null;
  onToggleAllRecipients: (checked: boolean) => void;
  onToggleRecipient: (recipientId: string, checked: boolean) => void;
  onMailSubjectChange: (value: string) => void;
  onMailBodyChange: (value: string) => void;
  onSmtpHostChange: (value: string) => void;
  onSmtpPortChange: (value: string) => void;
  onSmtpUserChange: (value: string) => void;
  onSmtpPasswordChange: (value: string) => void;
  onFromNameChange: (value: string) => void;
  onFromEmailChange: (value: string) => void;
  onSendEmails: () => void;
};

export const MailComposerCard = ({
  verifiedRecipients,
  selectedRecipientIds,
  selectedRecipients,
  mailSubject,
  mailBody,
  previewRecipient,
  previewSubject,
  previewBody,
  previewHtmlLength,
  smtpHost,
  smtpPort,
  smtpUser,
  smtpPassword,
  fromName,
  fromEmail,
  sendingEmails,
  sendEmailResult,
  onToggleAllRecipients,
  onToggleRecipient,
  onMailSubjectChange,
  onMailBodyChange,
  onSmtpHostChange,
  onSmtpPortChange,
  onSmtpUserChange,
  onSmtpPasswordChange,
  onFromNameChange,
  onFromEmailChange,
  onSendEmails,
}: MailComposerCardProps) => {
  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-xl">3. Send Confirmation Emails</CardTitle>
        <CardDescription>
          Select recipients, personalize with variables, and send using SMTP.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
          Variables available in subject/body:{" "}
          {PERSONALIZATION_VARIABLES.map((variable, index) => (
            <span key={variable}>
              <span className="font-semibold text-foreground">{variable}</span>
              {index < PERSONALIZATION_VARIABLES.length - 1 ? ", " : ""}
            </span>
          ))}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">
              Verified Recipients ({selectedRecipientIds.length}/
              {verifiedRecipients.length})
            </p>

            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={
                  verifiedRecipients.length > 0 &&
                  selectedRecipientIds.length === verifiedRecipients.length
                }
                onCheckedChange={(checked) =>
                  onToggleAllRecipients(Boolean(checked))
                }
              />
              Select all verified
            </label>
          </div>

          <div className="max-h-64 overflow-y-auto rounded-lg border border-border/70 divide-y divide-border/50">
            {verifiedRecipients.length > 0 ? (
              verifiedRecipients.map((recipient) => {
                const isSelected = selectedRecipientIds.includes(recipient.id);

                return (
                  <label
                    key={recipient.id}
                    className="flex items-start gap-3 p-3 cursor-pointer hover:bg-secondary/25"
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) =>
                        onToggleRecipient(recipient.id, Boolean(checked))
                      }
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {recipient.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {recipient.email} • {recipient.studentId || "No ID"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {recipient.event}
                      </p>
                    </div>
                  </label>
                );
              })
            ) : (
              <p className="p-3 text-sm text-muted-foreground">
                No verified recipients with email found. Validate first.
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">Subject</p>
              <Input
                value={mailSubject}
                onChange={(event) => onMailSubjectChange(event.target.value)}
                placeholder="You're confirmed for {event}!"
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">
                Email Body
              </p>
              <Textarea
                value={mailBody}
                onChange={(event) => onMailBodyChange(event.target.value)}
                rows={9}
                placeholder="Use variables like {name}, {event}, {studentId}"
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">
              Personalized Preview
            </p>
            <div className="rounded-lg border border-border/70 bg-secondary/15 p-4 space-y-3 min-h-[220px]">
              {previewRecipient ? (
                <>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Previewing for {previewRecipient.name}
                  </p>
                  <p className="text-sm font-semibold text-foreground break-words">
                    {previewSubject || "(empty subject)"}
                  </p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                    {previewBody || "(empty body)"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    HTML ready ({previewHtmlLength} characters).
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Choose recipients to view personalized preview.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-semibold text-foreground">SMTP Settings</p>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1">SMTP Host</p>
              <Input
                value={smtpHost}
                onChange={(event) => onSmtpHostChange(event.target.value)}
                placeholder="smtp.gmail.com"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">SMTP Port</p>
              <Input
                value={smtpPort}
                onChange={(event) => onSmtpPortChange(event.target.value)}
                placeholder="587"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                Login Email (SMTP User)
              </p>
              <Input
                value={smtpUser}
                onChange={(event) => onSmtpUserChange(event.target.value)}
                placeholder="your-login@email.com"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                App Password / Email Password
              </p>
              <Input
                type="password"
                value={smtpPassword}
                onChange={(event) => onSmtpPasswordChange(event.target.value)}
                placeholder="••••••••••"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">From Name</p>
              <Input
                value={fromName}
                onChange={(event) => onFromNameChange(event.target.value)}
                placeholder="Team Luminus"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">From Address</p>
              <Input
                value={fromEmail}
                onChange={(event) => onFromEmailChange(event.target.value)}
                placeholder="team@luminusfest.in"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={onSendEmails}
            disabled={sendingEmails || selectedRecipients.length === 0}
            className="rounded-full h-11 px-7 text-sm font-semibold"
          >
            {sendingEmails ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {sendingEmails ? "SENDING EMAILS..." : "Send Emails"}
          </Button>
        </div>

        {sendEmailResult && (
          <div className="rounded-lg border border-border/70 bg-secondary/15 p-4 space-y-2 text-sm">
            <p className="font-semibold text-foreground">
              Send Result: {sendEmailResult.sent}/{sendEmailResult.attempted}{" "}
              delivered
            </p>
            <p className="text-muted-foreground">
              Failed: {sendEmailResult.failed}
            </p>
            {sendEmailResult.errors.length > 0 && (
              <div className="max-h-36 overflow-y-auto space-y-1 text-xs text-destructive">
                {sendEmailResult.errors.map((item, index) => (
                  <p key={`${item.email}-${index}`}>
                    {item.email}: {item.reason}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
