import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';

interface CompetitionOption { id: string; name: string }

interface AddParticipantDialogProps {
  competitions: CompetitionOption[];
  /** Pre-lock to one competition (Event OC) instead of letting the user pick. */
  fixedCompetitionId?: string;
  onAdded?: () => void;
}

const EMPTY = { name: '', email: '', phone: '', organization: '' };

/** Staff-side single participant registration - same server path as the bulk CSV upload. */
export const AddParticipantDialog = ({ competitions, fixedCompetitionId, onAdded }: AddParticipantDialogProps) => {
  const [open, setOpen] = useState(false);
  const [competitionId, setCompetitionId] = useState(fixedCompetitionId ?? '');
  const [form, setForm] = useState(EMPTY);
  const [sendEmail, setSendEmail] = useState(true);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = fixedCompetitionId ?? competitionId;
    if (!target) return toast.error('Pick a competition');
    if (form.name.trim().length < 2) return toast.error('Enter the participant name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return toast.error('Enter a valid email');

    setSaving(true);
    const { data, error } = await supabase.functions.invoke('bulk-register-participants', {
      body: { competition_id: target, rows: [form], send_emails: sendEmail },
    });
    setSaving(false);

    const payload = data as {
      error?: string;
      emails_configured?: boolean;
      results?: { status: string; message?: string; ticket_code?: string }[];
    } | null;
    if (error || payload?.error) return toast.error(payload?.error ?? 'Could not add this participant');

    const row = payload?.results?.[0];
    if (row?.status === 'error') return toast.error(row.message ?? 'Could not add this participant');
    if (row?.status === 'duplicate') return toast.warning(`Already registered — ticket ${row.ticket_code}`);

    toast.success(
      sendEmail && payload?.emails_configured === false
        ? `Added — ticket ${row?.ticket_code}. Email not sent (email sending isn't configured yet).`
        : `Added — ticket ${row?.ticket_code}`,
    );
    setForm(EMPTY);
    setOpen(false);
    onAdded?.();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setForm(EMPTY); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-full text-xs font-semibold tracking-wider">
          <UserPlus className="h-3.5 w-3.5 mr-1.5" /> ADD PARTICIPANT
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add a participant</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {!fixedCompetitionId && (
            <div className="space-y-2">
              <Label>Competition</Label>
              <Select value={competitionId} onValueChange={setCompetitionId}>
                <SelectTrigger><SelectValue placeholder="Select competition" /></SelectTrigger>
                <SelectContent>{competitions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2"><Label>Full name</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="space-y-2"><Label>Email</Label><Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="space-y-2"><Label>College / org</Label><Input value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} /></div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="single-email" checked={sendEmail} onCheckedChange={(v) => setSendEmail(v === true)} />
            <Label htmlFor="single-email" className="font-normal text-sm">Send the QR ticket email</Label>
          </div>
          <Button type="submit" disabled={saving} className="w-full rounded-full text-xs font-semibold tracking-wider">
            {saving ? 'ADDING…' : 'ADD PARTICIPANT'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
