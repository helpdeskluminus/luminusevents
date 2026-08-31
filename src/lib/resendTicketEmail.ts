import { supabase } from '@/integrations/supabase/client';

export interface ResendResult {
  ok: boolean;
  /** Human-readable reason when ok is false, or when ok is true but delivery was skipped. */
  message?: string;
  /** True when the send genuinely went out (as opposed to being skipped because mail isn't configured). */
  sent: boolean;
}

/** Resends one participant's QR ticket email via the send-ticket-email edge function. */
export async function resendTicketEmail(registrationId: string): Promise<ResendResult> {
  const { data, error } = await supabase.functions.invoke('send-ticket-email', {
    body: { registration_id: registrationId },
  });

  const payload = data as { success?: boolean; skipped?: boolean; reason?: string; error?: string } | null;

  if (error || payload?.error) {
    return { ok: false, sent: false, message: payload?.error ?? 'Could not resend this ticket' };
  }
  if (payload?.skipped) {
    return { ok: false, sent: false, message: payload.reason ?? "Email sending isn't configured yet" };
  }
  return { ok: true, sent: true };
}
