import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Upload, FileSpreadsheet } from 'lucide-react';
import { parseParticipantCsv, type CsvParticipantRow } from '@/lib/csv';

interface BulkResultRow {
  row: number;
  email: string;
  status: 'registered' | 'duplicate' | 'error';
  message?: string;
  ticket_code?: string;
}

interface CompetitionOption { id: string; name: string }

interface BulkUploadDialogProps {
  competitions: CompetitionOption[];
  /** Pre-lock to one competition (Event OC) instead of letting the user pick. */
  fixedCompetitionId?: string;
}

export const BulkUploadDialog = ({ competitions, fixedCompetitionId }: BulkUploadDialogProps) => {
  const [open, setOpen] = useState(false);
  const [competitionId, setCompetitionId] = useState(fixedCompetitionId ?? '');
  const [rows, setRows] = useState<CsvParticipantRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [sendEmails, setSendEmails] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<{ registered: number; duplicates: number; failed: number; emailsSent: number; emailsFailed: number; emailsRequested: boolean; rows: BulkResultRow[] } | null>(null);

  const reset = () => { setRows([]); setFileName(''); setResults(null); };

  const onFile = async (file: File) => {
    const text = await file.text();
    const { rows: parsed, error } = parseParticipantCsv(text);
    if (error) return toast.error(error);
    if (parsed.length === 0) return toast.error('No participant rows found in this file');
    setRows(parsed);
    setFileName(file.name);
    setResults(null);
  };

  const submit = async () => {
    const targetCompetition = fixedCompetitionId ?? competitionId;
    if (!targetCompetition) return toast.error('Pick a competition');
    if (rows.length === 0) return toast.error('Choose a CSV file first');

    setUploading(true);
    const { data, error } = await supabase.functions.invoke('bulk-register-participants', {
      body: { competition_id: targetCompetition, rows, send_emails: sendEmails },
    });
    setUploading(false);

    const payload = data as { error?: string; registered?: number; duplicates?: number; failed?: number; emails_configured?: boolean; emails_sent?: number; emails_failed?: number; emails_requested?: boolean; results?: BulkResultRow[] } | null;
    if (error || payload?.error) return toast.error(payload?.error ?? 'Bulk upload failed');

    setResults({
      registered: payload!.registered ?? 0,
      duplicates: payload!.duplicates ?? 0,
      failed: payload!.failed ?? 0,
      emailsSent: payload!.emails_sent ?? 0,
      emailsFailed: payload!.emails_failed ?? 0,
      emailsRequested: payload!.emails_requested ?? sendEmails,
      rows: payload!.results ?? [],
    });
    toast.success(`Registered ${payload!.registered ?? 0} of ${rows.length}`);
    if (sendEmails && payload?.emails_configured === false) {
      toast.warning('Tickets created, but no emails were sent — email sending is not configured yet.');
    } else if (sendEmails && (payload?.emails_failed ?? 0) > 0) {
      toast.warning(`${payload!.emails_failed} ticket email${payload!.emails_failed === 1 ? '' : 's'} failed to send — see details below.`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-full text-xs font-semibold tracking-wider">
          <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> BULK CSV UPLOAD
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk register from CSV</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!fixedCompetitionId && (
            <div className="space-y-2">
              <Label>Competition</Label>
              <Select value={competitionId} onValueChange={setCompetitionId}>
                <SelectTrigger><SelectValue placeholder="Select competition" /></SelectTrigger>
                <SelectContent>{competitions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>CSV file</Label>
            <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground cursor-pointer hover:border-primary/50">
              {fileName ? `${fileName} (${rows.length} rows)` : <><Upload className="h-3.5 w-3.5" /> Choose a .csv file</>}
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onFile(file);
                  e.target.value = '';
                }}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Needs "name" and "email" columns (header row required); "phone" and "organization" are optional. Max 500 rows per upload.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="bulk-emails" checked={sendEmails} onCheckedChange={(v) => setSendEmails(v === true)} />
            <Label htmlFor="bulk-emails" className="font-normal text-sm">Send ticket emails to each participant</Label>
          </div>

          <Button onClick={submit} disabled={uploading || rows.length === 0} className="w-full rounded-full text-xs font-semibold tracking-wider">
            {uploading ? 'UPLOADING…' : `REGISTER ${rows.length || ''} PARTICIPANT${rows.length === 1 ? '' : 'S'}`}
          </Button>

          {results && (
            <div className="rounded-xl border border-border p-4 space-y-2">
              <p className="text-xs font-semibold tracking-wider">
                {results.registered} registered · {results.duplicates} already registered · {results.failed} failed
              </p>
              {results.emailsRequested && (
                <p className="text-xs text-muted-foreground">
                  {results.emailsSent} ticket email{results.emailsSent === 1 ? '' : 's'} sent
                  {results.emailsFailed > 0 && <span className="text-destructive"> · {results.emailsFailed} failed to send</span>}
                </p>
              )}
              {results.rows.some((r) => r.message && r.status !== 'duplicate') && (
                <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
                  {results.rows.filter((r) => r.message && r.status !== 'duplicate').map((r) => (
                    <li key={r.row} className={r.status === 'error' ? 'text-destructive' : 'text-amber-600'}>
                      Row {r.row} ({r.email || 'no email'}): {r.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
