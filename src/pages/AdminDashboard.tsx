import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RequireRole } from '@/components/RequireRole';
import { useLiveTick } from '@/hooks/useLiveTick';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Helmet } from 'react-helmet-async';
import { formatDateTime } from '@/lib/format';
import { Trash2 } from 'lucide-react';

interface EventRow { id: string; name: string; description: string | null; banner_url: string | null; start_date: string | null; end_date: string | null }
interface CompetitionRow { id: string; event_id: string; name: string; venue: string | null; start_time: string | null; capacity: number | null }
interface StaffRow { user_id: string; role: string; competition_id: string | null; profiles: { full_name: string; email: string | null; position: string | null } | null }
interface Stats { gate: number; registrations: number; perCompetition: Record<string, number> }

const emptyEvent = { name: '', description: '', banner_url: '', start_date: '', end_date: '' };
const emptyComp = { event_id: '', name: '', description: '', poster_url: '', venue: '', start_time: '', end_time: '', capacity: '', rules_url: '' };
const emptyStaff = { full_name: '', email: '', password: '', role: 'disciplinary', competition_id: '', position: '' };

const AdminPanel = () => {
  const tick = useLiveTick(['checkins', 'registrations']);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [stats, setStats] = useState<Stats>({ gate: 0, registrations: 0, perCompetition: {} });
  const [eventForm, setEventForm] = useState(emptyEvent);
  const [compForm, setCompForm] = useState(emptyComp);
  const [staffForm, setStaffForm] = useState(emptyStaff);
  const [saving, setSaving] = useState(false);

  const loadStructure = useCallback(async () => {
    const [{ data: ev }, { data: comps }, { data: roles }] = await Promise.all([
      supabase.from('events').select('*').order('created_at', { ascending: false }),
      supabase.from('competitions').select('id, event_id, name, venue, start_time, capacity').order('start_time'),
      supabase.from('user_roles').select('user_id, role, competition_id, profiles(full_name, email, position)'),
    ]);
    setEvents((ev as EventRow[]) ?? []);
    setCompetitions((comps as CompetitionRow[]) ?? []);
    setStaff((roles as unknown as StaffRow[]) ?? []);
  }, []);

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
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Competition created');
    setCompForm({ ...emptyComp, event_id: compForm.event_id });
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
          <TabsTrigger value="staff">Staff</TabsTrigger>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Start</Label><Input type="date" value={eventForm.start_date} onChange={(e) => setEventForm({ ...eventForm, start_date: e.target.value })} /></div>
              <div className="space-y-2"><Label>End</Label><Input type="date" value={eventForm.end_date} onChange={(e) => setEventForm({ ...eventForm, end_date: e.target.value })} /></div>
            </div>
            <Button type="submit" disabled={saving} className="rounded-full text-xs font-semibold tracking-wider">CREATE EVENT</Button>
          </form>

          <div className="space-y-3">
            {events.map((ev) => (
              <div key={ev.id} className="rounded-2xl border border-border bg-card p-5">
                <p className="font-heading font-semibold">{ev.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{ev.start_date ?? 'No dates set'}</p>
              </div>
            ))}
          </div>
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
            <div className="space-y-2"><Label>Description</Label><Textarea value={compForm.description} onChange={(e) => setCompForm({ ...compForm, description: e.target.value })} /></div>
            <div className="space-y-2"><Label>Poster image URL</Label><Input value={compForm.poster_url} onChange={(e) => setCompForm({ ...compForm, poster_url: e.target.value })} /></div>
            <div className="space-y-2"><Label>Venue</Label><Input value={compForm.venue} onChange={(e) => setCompForm({ ...compForm, venue: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Start</Label><Input type="datetime-local" value={compForm.start_time} onChange={(e) => setCompForm({ ...compForm, start_time: e.target.value })} /></div>
              <div className="space-y-2"><Label>End</Label><Input type="datetime-local" value={compForm.end_time} onChange={(e) => setCompForm({ ...compForm, end_time: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Capacity</Label><Input type="number" min={1} value={compForm.capacity} onChange={(e) => setCompForm({ ...compForm, capacity: e.target.value })} /></div>
              <div className="space-y-2"><Label>Rules URL</Label><Input value={compForm.rules_url} onChange={(e) => setCompForm({ ...compForm, rules_url: e.target.value })} /></div>
            </div>
            <Button type="submit" disabled={saving} className="rounded-full text-xs font-semibold tracking-wider">CREATE COMPETITION</Button>
          </form>

          <div className="space-y-3">
            {competitions.map((c) => (
              <div key={c.id} className="rounded-2xl border border-border bg-card p-5">
                <p className="font-heading font-semibold">{c.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{c.venue ?? 'Venue TBA'} · {formatDateTime(c.start_time)}</p>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="staff" className="mt-6 grid lg:grid-cols-2 gap-6">
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
