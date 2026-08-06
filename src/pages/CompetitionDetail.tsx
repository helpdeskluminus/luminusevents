import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { CalendarDays, MapPin, ArrowLeft, CheckCircle2, FileText, Users } from 'lucide-react';
import { formatDateTime } from '@/lib/format';

interface Competition {
  id: string;
  name: string;
  description: string | null;
  poster_url: string | null;
  venue: string | null;
  start_time: string | null;
  end_time: string | null;
  capacity: number | null;
  rules_url: string | null;
  events: { name: string; banner_url: string | null } | null;
}

const CompetitionDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [ticketCode, setTicketCode] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', organization: '' });

  useEffect(() => {
    if (!id) return;
    supabase
      .from('competitions')
      .select('id, name, description, poster_url, venue, start_time, end_time, capacity, rules_url, events(name, banner_url)')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        setCompetition(data as unknown as Competition);
        setLoading(false);
      });
  }, [id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    if (form.name.trim().length < 2) return toast.error('Please enter your full name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return toast.error('Please enter a valid email');

    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke('register-participant', {
      body: { competition_id: id, ...form },
    });
    setSubmitting(false);

    if (error) {
      const details = 'context' in error ? await (error as { context: Response }).context.text() : error.message;
      let message = 'Registration failed. Please try again.';
      try { message = JSON.parse(details).error ?? message; } catch { /* keep default */ }
      toast.error(message);
      return;
    }
    setTicketCode((data as { ticket_code: string }).ticket_code);
    toast.success('Registered! Your QR ticket is on its way by email.');
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>;
  }

  if (!competition) {
    return <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <p className="text-muted-foreground">This competition could not be found.</p>
      <Link to="/"><Button variant="outline" className="rounded-full">Back to competitions</Button></Link>
    </div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>{`${competition.name} — Register | Techfest`}</title>
        <meta name="description" content={(competition.description ?? `Register for ${competition.name} and get your QR entry ticket by email.`).slice(0, 155)} />
      </Helmet>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <Link to="/" className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-3.5 w-3.5" /> ALL COMPETITIONS
        </Link>

        <div className="grid lg:grid-cols-2 gap-10">
          <div>
            <div className="rounded-2xl overflow-hidden border border-border bg-muted aspect-[16/10]">
              {competition.poster_url ? (
                <img src={competition.poster_url} alt={`${competition.name} poster`} className="w-full h-full object-cover" />
              ) : null}
            </div>
            {competition.events?.name && (
              <p className="mt-6 text-[11px] font-semibold tracking-[0.2em] uppercase text-primary">{competition.events.name}</p>
            )}
            <h1 className="font-heading text-3xl sm:text-4xl font-bold tracking-tight mt-2">{competition.name}</h1>
            {competition.description && (
              <p className="mt-4 text-muted-foreground leading-relaxed whitespace-pre-line">{competition.description}</p>
            )}
            <div className="mt-6 space-y-2 text-sm">
              <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" />{competition.venue || 'Venue TBA'}</div>
              <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" />{formatDateTime(competition.start_time)}{competition.end_time ? ` — ${formatDateTime(competition.end_time)}` : ''}</div>
              {competition.capacity && <div className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" />{competition.capacity} seats</div>}
              {competition.rules_url && (
                <a href={competition.rules_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary hover:underline">
                  <FileText className="h-4 w-4" /> Rules &amp; guidelines
                </a>
              )}
            </div>
          </div>

          <div>
            {ticketCode ? (
              <div className="rounded-2xl border border-border bg-card p-8 text-center">
                <CheckCircle2 className="h-10 w-10 mx-auto text-primary mb-4" />
                <h2 className="font-heading text-xl font-semibold">You're registered</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Your QR ticket has been emailed to <strong>{form.email}</strong>. Show it at the main gate and at the venue.
                </p>
                <p className="mt-6 text-[11px] tracking-[0.2em] uppercase text-muted-foreground">Ticket code</p>
                <p className="font-heading text-2xl font-bold tracking-widest">{ticketCode}</p>
              </div>
            ) : (
              <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-6 sm:p-8 space-y-4">
                <h2 className="font-heading text-xl font-semibold">Register</h2>
                <div className="space-y-2">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" value={form.name} maxLength={120} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={form.email} maxLength={255} required onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={form.phone} maxLength={30} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="organization">College / organisation</Label>
                  <Input id="organization" value={form.organization} maxLength={160} onChange={(e) => setForm({ ...form, organization: e.target.value })} />
                </div>
                <Button type="submit" disabled={submitting} className="w-full rounded-full text-xs font-semibold tracking-wider">
                  {submitting ? 'REGISTERING…' : 'GET MY QR TICKET'}
                </Button>
                <p className="text-[11px] text-muted-foreground text-center">
                  Your ticket QR is unique and signed — don't share it with anyone.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompetitionDetail;
