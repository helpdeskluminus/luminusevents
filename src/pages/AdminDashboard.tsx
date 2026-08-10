import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RequireRole } from '@/components/RequireRole';
import { useLiveTick } from '@/hooks/useLiveTick';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Helmet } from 'react-helmet-async';
import { formatDateTime } from '@/lib/format';
import { Trash2, Sparkles, Upload } from 'lucide-react';
import { BulkUploadDialog } from '@/components/BulkUploadDialog';
import { SESSION_TYPES, sessionTypeLabel } from '@/lib/sessionType';

interface EventRow { id: string; name: string; description: string | null; banner_url: string | null; start_date: string | null; end_date: string | null; max_gate_scans?: number }
interface CompetitionRow { id: string; event_id: string; name: string; description?: string | null; poster_url?: string | null; venue: string | null; start_time: string | null; end_time?: string | null; capacity: number | null; rules_url?: string | null; max_venue_scans?: number; session_type?: string; type_label?: string | null }
interface StaffRow { user_id: string; role: string; competition_id: string | null; profiles: { full_name: string; email: string | null; position: string | null } | null }
interface PendingRow { id: string; full_name: string; email: string | null; created_at: string }
interface Stats { gate: number; registrations: number; perCompetition: Record<string, number> }

const emptyEvent = { name: '', description: '', banner_url: '', start_date: '', end_date: '', max_gate_scans: '0' };
const emptyComp = { event_id: '', name: '', description: '', poster_url: '', venue: '', start_time: '', end_time: '', capacity: '', rules_url: '', max_venue_scans: '0', session_type: 'competition', type_label: '' };
const emptyStaff = { full_name: '', email: '', password: '', role: 'disciplinary', competition_id: '', position: '' };
const emptyBroadcast = { subject: '', body: '', audience_type: 'all_participants', competition_id: '', emails: '' };

interface BroadcastRow { id: string; subject: string; audience_type: string; competition_id: string | null; recipient_count: number; failed_count: number; status: string; created_at: string }

const AdminPanel = () => {
  const tick = useLiveTick(['checkins', 'registrations']);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [pendingRole, setPendingRole] = useState<Record<string, string>>({});
  const [pendingComp, setPendingComp] = useState<Record<string, string>>({});
  const [pendingPos, setPendingPos] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<Stats>({ gate: 0, registrations: 0, perCompetition: {} });
  const [eventForm, setEventForm] = useState(emptyEvent);
  const [compForm, setCompForm] = useState(emptyComp);
  const [staffForm, setStaffForm] = useState(emptyStaff);
  const [broadcastForm, setBroadcastForm] = useState(emptyBroadcast);
  const [broadcasts, setBroadcasts] = useState<BroadcastRow[]>([]);
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventRow | null>(null);
  const [editEventForm, setEditEventForm] = useState(emptyEvent);
  const [editingComp, setEditingComp] = useState<CompetitionRow | null>(null);
  const [editCompForm, setEditCompForm] = useState(emptyComp);

  const [eventExtracting, setEventExtracting] = useState(false);
  const [compExtracting, setCompExtracting] = useState(false);

  const uploadPosterAndExtract = async (
    file: File,
    onUrl: (url: string) => void,
    applyExtracted: (fields: Record<string, string>) => void,
    setExtracting: (b: boolean) => void
  ) => {
    if (!file.type.startsWith('image/')) return toast.error('Please choose an image file');
    setExtracting(true);
    try {
      const path = `posters/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
      const { error: upErr } = await supabase.storage.from('event-images').upload(path, file);
      if (upErr) return toast.error(upErr.message);

      const { data: pub } = supabase.storage.from('event-images').getPublicUrl(path);
      onUrl(pub.publicUrl);
      toast.success('Poster uploaded — reading details…');

      const { data, error } = await supabase.functions.invoke('extract-poster-details', { body: { image_url: pub.publicUrl } });
      const payload = data as { error?: string; extracted?: Record<string, string> } | null;
      if (error || payload?.error) {
        toast.error(payload?.error ?? 'Poster uploaded, but auto-fill failed — enter details manually');
        return;
      }
      applyExtracted(payload!.extracted!);
      const confidence = payload!.extracted!.confidence ?? 'unknown';
      toast.success(`Auto-filled from poster (${confidence} confidence) — please double-check before saving`);
    } finally {
      setExtracting(false);
    }
  };

  const loadPending = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('create-staff-user', { body: { action: 'pending' } });
    if (!error) setPending(((data as { pending?: PendingRow[] } | null)?.pending) ?? []);
  }, []);

  const loadBroadcasts = useCallback(async () => {
    const { data } = await supabase.from('email_broadcasts').select('id, subject, audience_type, competition_id, recipient_count, failed_count, status, created_at').order('created_at', { ascending: false }).limit(20);
    setBroadcasts((data as BroadcastRow[]) ?? []);
  }, []);

  const loadStructure = useCallback(async () => {
    const [{ data: ev }, { data: comps }, { data: roles }, { data: profs }] = await Promise.all([
      supabase.from('events').select('*').order('created_at', { ascending: false }),
      supabase.from('competitions').select('*').order('start_time'),
      supabase.from('user_roles').select('user_id, role, competition_id'),
      supabase.from('profiles').select('id, full_name, email, position'),
    ]);
    setEvents((ev as EventRow[]) ?? []);
    setCompetitions((comps as CompetitionRow[]) ?? []);
    const profileById = new Map((profs ?? []).map((p) => [(p as { id: string }).id, p]));
    setStaff(((roles ?? []).map((r) => {
      const row = r as { user_id: string; role: string; competition_id: string | null };
      const p = profileById.get(row.user_id) as { full_name: string; email: string | null; position: string | null } | undefined;
      return { ...row, profiles: p ? { full_name: p.full_name, email: p.email, position: p.position } : null };
    }) as unknown as StaffRow[]) ?? []);

    void loadPending();
    void loadBroadcasts();
  }, [loadPending, loadBroadcasts]);

  const loadStats = useCallback(async () => {
    const [{ count: gate }, { count: regs }, { data: venueRows }] = await Promise.all([
      supabase.from('checkins').select('*', { count: 'exact', head: true }).eq('checkin_type', 'main_gate').eq('is_duplicate', false),
      supabase.from('registrations').select('*', { count: 'exact', head: true }),
      supabase.from('checkins').select('competition_id').eq('checkin_type', 'venue').eq('is_duplicate', false),
    ]);
    const perCompetition: Record<string, number> = {};
    (venueRows ?? []).forEach((r) => {
      const cid = (r as { competition_id: string | null }).competition_id;
      if (cid) perCompetition[cid] = (perCompetition[cid] ?? 0) + 1;
    });
    setStats({ gate: gate ?? 0, registrations: regs ?? 0, perCompetition });
  }, []);

  useEffect(() => { void loadStructure(); }, [loadStructure]);
  useEffect(() => { void loadStats(); }, [loadStats, tick]);

  const [regCounts, setRegCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    supabase.from('registrations').select('competition_id').then(({ data }) => {
      const counts: Record<string, number> = {};
      (data ?? []).forEach((r) => {
        const cid = (r as { competition_id: string }).competition_id;
        counts[cid] = (counts[cid] ?? 0) + 1;
      });
      setRegCounts(counts);
    });
  }, [tick]);

  const createEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from('events').insert({
      name: eventForm.name.trim(),
      description: eventForm.description.trim() || null,
      banner_url: eventForm.banner_url.trim() || null,
      start_date: eventForm.start_date || null,
      end_date: eventForm.end_date || null,
      max_gate_scans: Math.max(0, Number(eventForm.max_gate_scans) || 0),
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Event created');
    setEventForm(emptyEvent);
    void loadStructure();
  };

  const createCompetition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!compForm.event_id) return toast.error('Pick an event first');
    setSaving(true);
    const { error } = await supabase.from('competitions').insert({
      event_id: compForm.event_id,
      name: compForm.name.trim(),
      description: compForm.description.trim() || null,
      poster_url: compForm.poster_url.trim() || null,
      venue: compForm.venue.trim() || null,
      start_time: compForm.start_time || null,
      end_time: compForm.end_time || null,
      capacity: compForm.capacity ? Number(compForm.capacity) : null,
      rules_url: compForm.rules_url.trim() || null,
      max_venue_scans: Math.max(0, Number(compForm.max_venue_scans) || 0),
      session_type: compForm.session_type,
      type_label: compForm.session_type === 'other' ? (compForm.type_label.trim() || null) : null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Competition created');
    setCompForm({ ...emptyComp, event_id: compForm.event_id });
    void loadStructure();
  };

  const openEditEvent = (ev: EventRow) => {
    setEditingEvent(ev);
    setEditEventForm({
      name: ev.name,
      description: ev.description ?? '',
      banner_url: ev.banner_url ?? '',
      start_date: ev.start_date ? ev.start_date.slice(0, 10) : '',
      end_date: ev.end_date ? ev.end_date.slice(0, 10) : '',
      max_gate_scans: String(ev.max_gate_scans ?? 0),
    });
  };

  const saveEditEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEvent) return;
    setSaving(true);
    const { error } = await supabase.from('events').update({
      name: editEventForm.name.trim(),
      description: editEventForm.description.trim() || null,
      banner_url: editEventForm.banner_url.trim() || null,
      start_date: editEventForm.start_date || null,
      end_date: editEventForm.end_date || null,
      max_gate_scans: Math.max(0, Number(editEventForm.max_gate_scans) || 0),
    }).eq('id', editingEvent.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Event updated');
    setEditingEvent(null);
    void loadStructure();
  };

  const toDatetimeLocal = (v: string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 16) : '');

  const openEditComp = (c: CompetitionRow) => {
    setEditingComp(c);
    setEditCompForm({
      event_id: c.event_id,
      name: c.name,
      description: c.description ?? '',
      poster_url: c.poster_url ?? '',
      venue: c.venue ?? '',
      start_time: toDatetimeLocal(c.start_time),
      end_time: toDatetimeLocal(c.end_time),
      capacity: c.capacity ? String(c.capacity) : '',
      rules_url: c.rules_url ?? '',
      max_venue_scans: String(c.max_venue_scans ?? 0),
      session_type: c.session_type ?? 'competition',
      type_label: c.type_label ?? '',
    });
  };

  const saveEditComp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingComp) return;
    setSaving(true);
    const { error } = await supabase.from('competitions').update({
      event_id: editCompForm.event_id,
      name: editCompForm.name.trim(),
      description: editCompForm.description.trim() || null,
      poster_url: editCompForm.poster_url.trim() || null,
      venue: editCompForm.venue.trim() || null,
      start_time: editCompForm.start_time || null,
      end_time: editCompForm.end_time || null,
      capacity: editCompForm.capacity ? Number(editCompForm.capacity) : null,
      rules_url: editCompForm.rules_url.trim() || null,
      max_venue_scans: Math.max(0, Number(editCompForm.max_venue_scans) || 0),
      session_type: editCompForm.session_type,
      type_label: editCompForm.session_type === 'other' ? (editCompForm.type_label.trim() || null) : null,
    }).eq('id', editingComp.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Competition updated');
    setEditingComp(null);
    void loadStructure();
  };

  const createStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('create-staff-user', {
      body: {
        action: 'create',
        full_name: staffForm.full_name,
        email: staffForm.email,
        password: staffForm.password,
        role: staffForm.role,
        competition_id: staffForm.role === 'event_oc' ? staffForm.competition_id : null,
        position: staffForm.position.trim() || null,
      },
    });
    setSaving(false);
    const payload = data as { error?: string } | null;
    if (error || payload?.error) return toast.error(payload?.error ?? 'Could not create staff account');
    toast.success('Staff account created');
    setStaffForm(emptyStaff);
    void loadStructure();
  };

  const deleteStaff = async (userId: string) => {
    const { data, error } = await supabase.functions.invoke('create-staff-user', { body: { action: 'delete', user_id: userId } });
    const payload = data as { error?: string } | null;
    if (error || payload?.error) return toast.error(payload?.error ?? 'Could not delete account');
    toast.success('Account removed');
    void loadStructure();
  };

  const approvePending = async (userId: string) => {
    const role = pendingRole[userId] ?? 'disciplinary';
    const competitionId = pendingComp[userId] ?? '';
    if (role === 'event_oc' && !competitionId) return toast.error('Pick a competition for this Event OC account');
    const { data, error } = await supabase.functions.invoke('create-staff-user', {
      body: { action: 'approve', user_id: userId, role, competition_id: role === 'event_oc' ? competitionId : null, position: pendingPos[userId] ?? '' },
    });
    const payload = data as { error?: string } | null;
    if (error || payload?.error) return toast.error(payload?.error ?? 'Could not approve account');
    toast.success('Account approved');
    void loadStructure();
  };

  const rejectPending = async (userId: string) => {
    const { data, error } = await supabase.functions.invoke('create-staff-user', { body: { action: 'reject', user_id: userId } });
    const payload = data as { error?: string } | null;
    if (error || payload?.error) return toast.error(payload?.error ?? 'Could not reject account');
    toast.success('Account rejected');
    void loadStructure();
  };

  const sendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastForm.subject.trim()) return toast.error('Subject is required');
    if (!broadcastForm.body.trim()) return toast.error('Message body is required');
    if (broadcastForm.audience_type === 'competition_participants' && !broadcastForm.competition_id) {
      return toast.error('Pick a competition');
    }

    let emails: string[] | undefined;
    if (broadcastForm.audience_type === 'custom') {
      emails = broadcastForm.emails.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      if (emails.length === 0) return toast.error('Add at least one email');
    }

    const audienceLabel =
      broadcastForm.audience_type === 'all_participants' ? 'ALL participants' :
      broadcastForm.audience_type === 'competition_participants' ? `participants of ${competitions.find((c) => c.id === broadcastForm.competition_id)?.name ?? 'this competition'}` :
      broadcastForm.audience_type === 'all_staff' ? 'ALL approved staff' :
      `${emails?.length ?? 0} custom email(s)`;

    if (!window.confirm(`Send this email to ${audienceLabel}? This can't be undone.`)) return;

    setSendingBroadcast(true);
    const { data, error } = await supabase.functions.invoke('send-broadcast-email', {
      body: {
        subject: broadcastForm.subject.trim(),
        body: broadcastForm.body.trim(),
        audience_type: broadcastForm.audience_type,
        competition_id: broadcastForm.audience_type === 'competition_participants' ? broadcastForm.competition_id : null,
        emails,
      },
    });
    setSendingBroadcast(false);
    const payload = data as { error?: string; sent?: number; failed?: number; total?: number } | null;
    if (error || payload?.error) return toast.error(payload?.error ?? 'Could not send broadcast');
    toast.success(`Sent to ${payload?.sent ?? 0} of ${payload?.total ?? 0} recipients${payload?.failed ? ` (${payload.failed} failed)` : ''}`);
    setBroadcastForm(emptyBroadcast);
    void loadBroadcasts();
  };

  return (
    <main className="max-w-6xl mx-auto px-6 py-10">
      <Helmet>
        <title>Admin Dashboard | Techfest Check-in</title>
        <meta name="description" content="Live techfest overview: gate entries, per-competition check-ins, events, competitions and staff accounts." />
      </Helmet>

      <h1 className="font-heading text-3xl font-bold tracking-tight">Admin control</h1>
      <p className="mt-2 text-sm text-muted-foreground">Live figures update automatically as scans happen.</p>

      <div className="grid sm:grid-cols-3 gap-4 mt-8">
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">MAIN GATE ENTRIES</p>
          <p className="font-heading text-4xl font-bold mt-2">{stats.gate}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">REGISTRATIONS</p>
          <p className="font-heading text-4xl font-bold mt-2">{stats.registrations}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">COMPETITIONS</p>
          <p className="font-heading text-4xl font-bold mt-2">{competitions.length}</p>
        </div>
      </div>

      <Tabs defaultValue="live" className="mt-10">
        <TabsList>
          <TabsTrigger value="live">Live</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="competitions">Competitions</TabsTrigger>
          <TabsTrigger value="broadcast">Broadcast</TabsTrigger>
          <TabsTrigger value="staff">
            Staff{pending.length > 0 && <span className="ml-1.5 rounded-full bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5">{pending.length}</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="live" className="mt-6">
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left text-[10px] tracking-[0.15em] text-muted-foreground">
                  <th className="p-4 font-semibold">COMPETITION</th>
                  <th className="p-4 font-semibold">VENUE</th>
                  <th className="p-4 font-semibold text-right">REGISTERED</th>
                  <th className="p-4 font-semibold text-right">CHECKED IN</th>
                </tr>
              </thead>
              <tbody>
                {competitions.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="p-4 font-medium">{c.name}</td>
                    <td className="p-4 text-muted-foreground">{c.venue ?? '—'}</td>
                    <td className="p-4 text-right">{regCounts[c.id] ?? 0}</td>
                    <td className="p-4 text-right font-semibold text-primary">{stats.perCompetition[c.id] ?? 0}</td>
                  </tr>
                ))}
                {competitions.length === 0 && (
                  <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No competitions yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="events" className="mt-6 grid lg:grid-cols-2 gap-6">
          <form onSubmit={createEvent} className="rounded-2xl border border-border bg-card p-6 space-y-4">
            <h2 className="font-heading text-lg font-semibold">New event</h2>
            <div className="space-y-2"><Label>Name</Label><Input required value={eventForm.name} onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })} /></div>
            <div className="space-y-2"><Label>Description</Label><Textarea value={eventForm.description} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })} /></div>
            <div className="space-y-2"><Label>Banner image URL</Label><Input value={eventForm.banner_url} onChange={(e) => setEventForm({ ...eventForm, banner_url: e.target.value })} /></div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-primary" /> Or upload a poster to auto-fill</Label>
              <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground cursor-pointer hover:border-primary/50">
                {eventExtracting ? 'Reading poster…' : <><Upload className="h-3.5 w-3.5" /> Choose an image</>}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={eventExtracting}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void uploadPosterAndExtract(
                      file,
                      (url) => setEventForm((f) => ({ ...f, banner_url: url })),
                      (ex) => setEventForm((f) => ({
                        ...f,
                        name: f.name || ex.name || f.name,
                        description: f.description || ex.description || f.description,
                        start_date: f.start_date || ex.date || f.start_date,
                        end_date: f.end_date || ex.end_date || f.end_date,
                      })),
                      setEventExtracting
                    );
                    e.target.value = '';
                  }}
                />
              </label>
              <p className="text-xs text-muted-foreground">Reads the name, dates and description off the image. Only fills blank fields — review before saving.</p>
            </div>
            <div className="space-y-2">
              <Label>Max main-gate scans per ticket</Label>
              <Input type="number" min={0} value={eventForm.max_gate_scans} onChange={(e) => setEventForm({ ...eventForm, max_gate_scans: e.target.value })} />
              <p className="text-xs text-muted-foreground">0 = unlimited re-entries. Set to 1 for single-entry gate passes.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Start</Label><Input type="date" value={eventForm.start_date} onChange={(e) => setEventForm({ ...eventForm, start_date: e.target.value })} /></div>
              <div className="space-y-2"><Label>End</Label><Input type="date" value={eventForm.end_date} onChange={(e) => setEventForm({ ...eventForm, end_date: e.target.value })} /></div>
            </div>
            <Button type="submit" disabled={saving} className="rounded-full text-xs font-semibold tracking-wider">CREATE EVENT</Button>
          </form>

          <div className="space-y-3">
            {events.map((ev) => (
              <div key={ev.id} className="rounded-2xl border border-border bg-card p-5 flex items-start justify-between gap-3">
                <div>
                  <p className="font-heading font-semibold">{ev.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{ev.start_date ?? 'No dates set'}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => openEditEvent(ev)} className="rounded-full text-[10px] font-semibold tracking-wider shrink-0">EDIT</Button>
              </div>
            ))}
          </div>

          <Dialog open={!!editingEvent} onOpenChange={(v) => { if (!v) setEditingEvent(null); }}>
            <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Edit event</DialogTitle></DialogHeader>
              <form onSubmit={saveEditEvent} className="space-y-4">
                <div className="space-y-2"><Label>Name</Label><Input required value={editEventForm.name} onChange={(e) => setEditEventForm({ ...editEventForm, name: e.target.value })} /></div>
                <div className="space-y-2"><Label>Description</Label><Textarea value={editEventForm.description} onChange={(e) => setEditEventForm({ ...editEventForm, description: e.target.value })} /></div>
                <div className="space-y-2"><Label>Banner image URL</Label><Input value={editEventForm.banner_url} onChange={(e) => setEditEventForm({ ...editEventForm, banner_url: e.target.value })} /></div>
                <div className="space-y-2">
                  <Label>Max main-gate scans per ticket</Label>
                  <Input type="number" min={0} value={editEventForm.max_gate_scans} onChange={(e) => setEditEventForm({ ...editEventForm, max_gate_scans: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Start</Label><Input type="date" value={editEventForm.start_date} onChange={(e) => setEditEventForm({ ...editEventForm, start_date: e.target.value })} /></div>
                  <div className="space-y-2"><Label>End</Label><Input type="date" value={editEventForm.end_date} onChange={(e) => setEditEventForm({ ...editEventForm, end_date: e.target.value })} /></div>
                </div>
                <Button type="submit" disabled={saving} className="w-full rounded-full text-xs font-semibold tracking-wider">SAVE CHANGES</Button>
              </form>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="competitions" className="mt-6 grid lg:grid-cols-2 gap-6">
          <form onSubmit={createCompetition} className="rounded-2xl border border-border bg-card p-6 space-y-4">
            <h2 className="font-heading text-lg font-semibold">New competition</h2>
            <div className="space-y-2">
              <Label>Event</Label>
              <Select value={compForm.event_id} onValueChange={(v) => setCompForm({ ...compForm, event_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select event" /></SelectTrigger>
                <SelectContent>{events.map((ev) => <SelectItem key={ev.id} value={ev.id}>{ev.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Name</Label><Input required value={compForm.name} onChange={(e) => setCompForm({ ...compForm, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={compForm.session_type} onValueChange={(v) => setCompForm({ ...compForm, session_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SESSION_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {compForm.session_type === 'other' && (
                <div className="space-y-2">
                  <Label>Custom label</Label>
                  <Input placeholder="e.g. Panel Discussion" value={compForm.type_label} onChange={(e) => setCompForm({ ...compForm, type_label: e.target.value })} />
                </div>
              )}
            </div>
            <div className="space-y-2"><Label>Description</Label><Textarea value={compForm.description} onChange={(e) => setCompForm({ ...compForm, description: e.target.value })} /></div>
            <div className="space-y-2"><Label>Poster image URL</Label><Input value={compForm.poster_url} onChange={(e) => setCompForm({ ...compForm, poster_url: e.target.value })} /></div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-primary" /> Or upload a poster to auto-fill</Label>
              <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground cursor-pointer hover:border-primary/50">
                {compExtracting ? 'Reading poster…' : <><Upload className="h-3.5 w-3.5" /> Choose an image</>}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={compExtracting}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void uploadPosterAndExtract(
                      file,
                      (url) => setCompForm((f) => ({ ...f, poster_url: url })),
                      (ex) => setCompForm((f) => ({
                        ...f,
                        name: f.name || ex.name || f.name,
                        description: f.description || ex.description || f.description,
                        venue: f.venue || ex.venue || f.venue,
                        start_time: f.start_time || (ex.date && ex.start_time ? `${ex.date}T${ex.start_time}` : f.start_time),
                        end_time: f.end_time || (ex.end_date && ex.end_time ? `${ex.end_date}T${ex.end_time}` : ex.date && ex.end_time ? `${ex.date}T${ex.end_time}` : f.end_time),
                      })),
                      setCompExtracting
                    );
                    e.target.value = '';
                  }}
                />
              </label>
              <p className="text-xs text-muted-foreground">Reads the name, venue, times and description off the image. Only fills blank fields — review before saving.</p>
            </div>
            <div className="space-y-2"><Label>Venue</Label><Input value={compForm.venue} onChange={(e) => setCompForm({ ...compForm, venue: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Start</Label><Input type="datetime-local" value={compForm.start_time} onChange={(e) => setCompForm({ ...compForm, start_time: e.target.value })} /></div>
              <div className="space-y-2"><Label>End</Label><Input type="datetime-local" value={compForm.end_time} onChange={(e) => setCompForm({ ...compForm, end_time: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Capacity</Label><Input type="number" min={1} value={compForm.capacity} onChange={(e) => setCompForm({ ...compForm, capacity: e.target.value })} /></div>
              <div className="space-y-2"><Label>Resource link (rules / agenda / slides)</Label><Input value={compForm.rules_url} onChange={(e) => setCompForm({ ...compForm, rules_url: e.target.value })} /></div>
            </div>
            <div className="space-y-2">
              <Label>Max venue scans per ticket</Label>
              <Input type="number" min={0} value={compForm.max_venue_scans} onChange={(e) => setCompForm({ ...compForm, max_venue_scans: e.target.value })} />
              <p className="text-xs text-muted-foreground">0 = unlimited re-entries. Set a number for multi-round events with a re-entry cap.</p>
            </div>
            <Button type="submit" disabled={saving} className="rounded-full text-xs font-semibold tracking-wider">CREATE COMPETITION</Button>
          </form>

          <div className="space-y-3">
            <div className="flex justify-end">
              <BulkUploadDialog competitions={competitions.map((c) => ({ id: c.id, name: c.name }))} />
            </div>
            {competitions.map((c) => (
              <div key={c.id} className="rounded-2xl border border-border bg-card p-5 flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-heading font-semibold">{c.name}</p>
                    <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {sessionTypeLabel(c.session_type, c.type_label)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{c.venue ?? 'Venue TBA'} · {formatDateTime(c.start_time)}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => openEditComp(c)} className="rounded-full text-[10px] font-semibold tracking-wider shrink-0">EDIT</Button>
              </div>
            ))}
          </div>

          <Dialog open={!!editingComp} onOpenChange={(v) => { if (!v) setEditingComp(null); }}>
            <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Edit competition</DialogTitle></DialogHeader>
              <form onSubmit={saveEditComp} className="space-y-4">
                <div className="space-y-2">
                  <Label>Event</Label>
                  <Select value={editCompForm.event_id} onValueChange={(v) => setEditCompForm({ ...editCompForm, event_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select event" /></SelectTrigger>
                    <SelectContent>{events.map((ev) => <SelectItem key={ev.id} value={ev.id}>{ev.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Name</Label><Input required value={editCompForm.name} onChange={(e) => setEditCompForm({ ...editCompForm, name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={editCompForm.session_type} onValueChange={(v) => setEditCompForm({ ...editCompForm, session_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{SESSION_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {editCompForm.session_type === 'other' && (
                    <div className="space-y-2">
                      <Label>Custom label</Label>
                      <Input placeholder="e.g. Panel Discussion" value={editCompForm.type_label} onChange={(e) => setEditCompForm({ ...editCompForm, type_label: e.target.value })} />
                    </div>
                  )}
                </div>
                <div className="space-y-2"><Label>Description</Label><Textarea value={editCompForm.description} onChange={(e) => setEditCompForm({ ...editCompForm, description: e.target.value })} /></div>
                <div className="space-y-2"><Label>Poster image URL</Label><Input value={editCompForm.poster_url} onChange={(e) => setEditCompForm({ ...editCompForm, poster_url: e.target.value })} /></div>
                <div className="space-y-2"><Label>Venue</Label><Input value={editCompForm.venue} onChange={(e) => setEditCompForm({ ...editCompForm, venue: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Start</Label><Input type="datetime-local" value={editCompForm.start_time} onChange={(e) => setEditCompForm({ ...editCompForm, start_time: e.target.value })} /></div>
                  <div className="space-y-2"><Label>End</Label><Input type="datetime-local" value={editCompForm.end_time} onChange={(e) => setEditCompForm({ ...editCompForm, end_time: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Capacity</Label><Input type="number" min={1} value={editCompForm.capacity} onChange={(e) => setEditCompForm({ ...editCompForm, capacity: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Resource link (rules / agenda / slides)</Label><Input value={editCompForm.rules_url} onChange={(e) => setEditCompForm({ ...editCompForm, rules_url: e.target.value })} /></div>
                </div>
                <div className="space-y-2">
                  <Label>Max venue scans per ticket</Label>
                  <Input type="number" min={0} value={editCompForm.max_venue_scans} onChange={(e) => setEditCompForm({ ...editCompForm, max_venue_scans: e.target.value })} />
                </div>
                <Button type="submit" disabled={saving} className="w-full rounded-full text-xs font-semibold tracking-wider">SAVE CHANGES</Button>
              </form>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="broadcast" className="mt-6 grid lg:grid-cols-2 gap-6">
          <form onSubmit={sendBroadcast} className="rounded-2xl border border-border bg-card p-6 space-y-4">
            <h2 className="font-heading text-lg font-semibold">Send an email</h2>
            <p className="text-xs text-muted-foreground -mt-2">
              Sent from the same no-reply address as ticket emails. Not for replies — it's a
              one-way announcement (instructions, schedule changes, reminders, etc).
            </p>
            <div className="space-y-2">
              <Label>Audience</Label>
              <Select value={broadcastForm.audience_type} onValueChange={(v) => setBroadcastForm({ ...broadcastForm, audience_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_participants">All participants</SelectItem>
                  <SelectItem value="competition_participants">Participants of one competition</SelectItem>
                  <SelectItem value="all_staff">All approved staff</SelectItem>
                  <SelectItem value="custom">Custom email list</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {broadcastForm.audience_type === 'competition_participants' && (
              <div className="space-y-2">
                <Label>Competition</Label>
                <Select value={broadcastForm.competition_id} onValueChange={(v) => setBroadcastForm({ ...broadcastForm, competition_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select competition" /></SelectTrigger>
                  <SelectContent>{competitions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {broadcastForm.audience_type === 'custom' && (
              <div className="space-y-2">
                <Label>Emails (comma or newline separated)</Label>
                <Textarea rows={3} value={broadcastForm.emails} onChange={(e) => setBroadcastForm({ ...broadcastForm, emails: e.target.value })} />
              </div>
            )}
            <div className="space-y-2"><Label>Subject</Label><Input required value={broadcastForm.subject} onChange={(e) => setBroadcastForm({ ...broadcastForm, subject: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea required rows={8} value={broadcastForm.body} onChange={(e) => setBroadcastForm({ ...broadcastForm, body: e.target.value })} placeholder="Blank lines start a new paragraph." />
            </div>
            <Button type="submit" disabled={sendingBroadcast} className="rounded-full text-xs font-semibold tracking-wider">
              {sendingBroadcast ? 'SENDING…' : 'SEND EMAIL'}
            </Button>
          </form>

          <div className="space-y-3">
            <h2 className="font-heading text-lg font-semibold">Recent broadcasts</h2>
            {broadcasts.length === 0 && <p className="text-sm text-muted-foreground">Nothing sent yet.</p>}
            {broadcasts.map((b) => (
              <div key={b.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-sm">{b.subject}</p>
                  <span className={`text-[10px] font-semibold tracking-wider uppercase shrink-0 ${b.status === 'sent' ? 'text-primary' : b.status === 'partial' ? 'text-amber-500' : 'text-destructive'}`}>
                    {b.status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {b.audience_type.replace('_', ' ')} · {b.recipient_count} sent{b.failed_count > 0 && `, ${b.failed_count} failed`} · {formatDateTime(b.created_at)}
                </p>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="staff" className="mt-6 space-y-8">
          {pending.length > 0 && (
            <div className="rounded-2xl border border-primary/40 bg-primary/5 p-5">
              <p className="text-[10px] font-semibold tracking-[0.2em] text-primary mb-4">
                PENDING APPROVAL · {pending.length}
              </p>
              <div className="space-y-3">
                {pending.map((p) => {
                  const role = pendingRole[p.id] ?? 'disciplinary';
                  return (
                    <div key={p.id} className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{p.full_name}</p>
                        <p className="text-xs text-muted-foreground truncate">{p.email}</p>
                      </div>
                      <Input
                        placeholder="Position (optional)"
                        className="w-full sm:w-40"
                        value={pendingPos[p.id] ?? ''}
                        onChange={(e) => setPendingPos({ ...pendingPos, [p.id]: e.target.value })}
                      />
                      <Select value={role} onValueChange={(v) => setPendingRole({ ...pendingRole, [p.id]: v })}>
                        <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="gate_staff">Gate Staff (main gate only)</SelectItem>
                          <SelectItem value="disciplinary">Disciplinary (main gate)</SelectItem>
                          <SelectItem value="event_oc">Event OC (one competition)</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                      {role === 'event_oc' && (
                        <Select value={pendingComp[p.id] ?? ''} onValueChange={(v) => setPendingComp({ ...pendingComp, [p.id]: v })}>
                          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Competition" /></SelectTrigger>
                          <SelectContent>{competitions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" onClick={() => approvePending(p.id)} className="rounded-full text-xs font-semibold tracking-wider">APPROVE</Button>
                        <Button size="sm" variant="outline" onClick={() => rejectPending(p.id)} className="rounded-full text-xs font-semibold tracking-wider">REJECT</Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-6">
          <form onSubmit={createStaff} className="rounded-2xl border border-border bg-card p-6 space-y-4">
            <h2 className="font-heading text-lg font-semibold">New staff account</h2>
            <div className="space-y-2"><Label>Full name</Label><Input required value={staffForm.full_name} onChange={(e) => setStaffForm({ ...staffForm, full_name: e.target.value })} /></div>
            <div className="space-y-2"><Label>Email</Label><Input type="email" required value={staffForm.email} onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })} /></div>
            <div className="space-y-2"><Label>Temporary password (min 10 chars)</Label><Input type="text" required minLength={10} value={staffForm.password} onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>Position of Responsibility <span className="text-muted-foreground font-normal">(optional, display only)</span></Label>
              <Input placeholder="e.g. Head of Logistics" value={staffForm.position} onChange={(e) => setStaffForm({ ...staffForm, position: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={staffForm.role} onValueChange={(v) => setStaffForm({ ...staffForm, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gate_staff">Gate Staff (main gate only)</SelectItem>
                  <SelectItem value="disciplinary">Disciplinary (main gate)</SelectItem>
                  <SelectItem value="event_oc">Event OC (one competition)</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {staffForm.role === 'event_oc' && (
              <div className="space-y-2">
                <Label>Assigned competition</Label>
                <Select value={staffForm.competition_id} onValueChange={(v) => setStaffForm({ ...staffForm, competition_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select competition" /></SelectTrigger>
                  <SelectContent>{competitions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <Button type="submit" disabled={saving} className="rounded-full text-xs font-semibold tracking-wider">CREATE ACCOUNT</Button>
          </form>

          <div className="space-y-3">
            {staff.map((s) => (
              <div key={s.user_id} className="rounded-2xl border border-border bg-card p-5 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{s.profiles?.full_name ?? 'Unnamed'}</p>
                  {s.profiles?.position && <p className="text-xs text-muted-foreground">{s.profiles.position}</p>}
                  <p className="text-xs text-muted-foreground">{s.profiles?.email}</p>
                  <p className="text-[10px] font-semibold tracking-wider uppercase text-primary mt-1">
                    {s.role.replace('_', ' ')}
                    {s.competition_id && ` · ${competitions.find((c) => c.id === s.competition_id)?.name ?? ''}`}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => deleteStaff(s.user_id)} aria-label="Remove account">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
};

const AdminDashboard = () => (
  <RequireRole roles={['admin']}>
    <AdminPanel />
  </RequireRole>
);

export default AdminDashboard;
