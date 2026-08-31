import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Mail, MailCheck, MailX, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '@/lib/format';
import { resendTicketEmail } from '@/lib/resendTicketEmail';

interface EmailStatusCellProps {
  registrationId: string;
  emailSentAt: string | null;
  participantName: string;
  /** Called after a resend attempt so the caller can refresh its list (updates email_sent_at). */
  onResent?: () => void;
}

/**
 * Shows whether a participant's QR ticket email went out, with a one-tap
 * resend. This is the piece that was missing before: staff had no way to see
 * per-participant delivery status or fix a failed send without re-running an
 * entire bulk upload.
 */
export const EmailStatusCell = ({ registrationId, emailSentAt, participantName, onResent }: EmailStatusCellProps) => {
  const [busy, setBusy] = useState(false);

  const handleResend = async () => {
    setBusy(true);
    const result = await resendTicketEmail(registrationId);
    setBusy(false);
    if (!result.ok) {
      toast.error(`${participantName}: ${result.message ?? 'Could not resend the ticket email'}`);
      return;
    }
    toast.success(`Ticket email resent to ${participantName}`);
    onResent?.();
  };

  return (
    <div className="flex items-center gap-2 shrink-0">
      {emailSentAt ? (
        <span className="flex items-center gap-1.5 text-xs text-primary" title={formatDateTime(emailSentAt)}>
          <MailCheck className="h-3.5 w-3.5" /> Sent {formatDateTime(emailSentAt)}
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-xs text-amber-600">
          <MailX className="h-3.5 w-3.5" /> Not sent
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={handleResend}
        className="h-7 px-2 text-xs font-semibold tracking-wide"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
        <span className="ml-1 hidden sm:inline">{emailSentAt ? 'Resend' : 'Send'}</span>
      </Button>
    </div>
  );
};
