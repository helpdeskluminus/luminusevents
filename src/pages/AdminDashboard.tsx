import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Navbar } from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CalendarDays, Users, UserCheck, BarChart3, Upload, Download, QrCode,
  Plus, Trash2, Check, X, ArrowRight, Shield, ShieldAlert
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import QRCode from 'qrcode';
import * as XLSX from 'xlsx';

interface Event {
  id: string;
  name: string;
  date: string;
  location: string;
  registration_fee: number;
  created_at: string;
}

interface Track {
  id: string;
  name: string;
  event_id: string;
}

interface AppUser {
  id: string;
  full_name: string;
  role: string;
  assigned_event_id: string | null;
  approval_status: string;
  created_at: string;
}

interface Participant {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  event_id: string;
  track_id: string | null;
  usn: string | null;
  college: string | null;
  amount_paid: number;
  payment_status: string;
  qr_token: string;
  checked_in: boolean;
  checked_in_at: string | null;
  created_at: string;
}

const AdminDashboard = () => {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [events, setEvents] = useState<Event[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [globalStats, setGlobalStats] = useState({ total: 0, checkedIn: 0, pending: 0, revenue: 0 });
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventFee, setEventFee] = useState('');
  const [trackName, setTrackName] = useState('');

  useEffect(() => {
    if (!loading && !user) navigate('/auth', { replace: true });
    if (!loading && user && profile && profile.role !== 'admin') navigate('/', { replace: true });
    if (!loading && user && profile && profile.approval_status !== 'approved') navigate('/pending', { replace: true });
  }, [user, profile, loading, navigate]);

  const fetchEvents = useCallback(async () => {
    const { data } = await supabase.from('events').select('*').order('date', { ascending: false });
    if (data) setEvents(data as unknown as Event[]);
  }, []);

  const fetchUsers = useCallback(async () => {
    const { data } = await supabase.from('users').select('*').order('created_at', { ascending: false });
    if (data) setUsers(data as unknown as AppUser[]);
  }, []);

  const fetchGlobalStats = useCallback(async () => {
    const { data } = await supabase.from('participants').select('checked_in, amount_paid, payment_status');
    if (data) {
      const total = data.length;
      const checkedIn = data.filter(p => p.checked_in).length;
      const pending = data.filter(p => p.payment_status === 'PENDING' || p.payment_status === 'NOT PAID').length;
      const revenue = data.reduce((sum, p) => sum + (Number(p.amount_paid) || 0), 0);
      setGlobalStats({ total, checkedIn, pending, revenue });
    }
  }, []);

  const fetchParticipants = useCallback(async (eventId: string) => {
    const { data } = await supabase.from('participants').select('*').eq('event_id', eventId).order('name');
    if (data) setParticipants(data as unknown as Participant[]);
  }, []);

  const fetchTracks = useCallback(async (eventId: string) => {
    const { data } = await supabase.from('tracks').select('*').eq('event_id', eventId).order('created_at');
    if (data) setTracks(data as unknown as Track[]);
  }, []);

  useEffect(() => {
    if (profile?.role === 'admin') {
      fetchEvents();
      fetchUsers();
      fetchGlobalStats();
    }
  }, [profile, fetchEvents, fetchUsers, fetchGlobalStats]);

  useEffect(() => {
    if (selectedEventId) {
      fetchParticipants(selectedEventId);
      fetchTracks(selectedEventId);
    }
  }, [selectedEventId, fetchParticipants, fetchTracks]);

  useEffect(() => {
    const channel = supabase
      .channel('admin-participants')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, () => {
        if (selectedEventId) fetchParticipants(selectedEventId);
        fetchGlobalStats();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedEventId, fetchParticipants, fetchGlobalStats]);

  const createEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    const fee = parseFloat(eventFee) || 0;
    const { error } = await supabase.from('events').insert({ name: eventName, date: eventDate, location: eventLocation, registration_fee: fee });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Event created' });
    setEventName(''); setEventDate(''); setEventLocation(''); setEventFee('');
    fetchEvents();
  };

  const deleteEvent = async (id: string) => {
    const { error } = await supabase.from('events').delete().eq('id', id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    fetchEvents();
    if (selectedEventId === id) { setSelectedEventId(''); setParticipants([]); setTracks([]); }
  };

  const createTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId) return;
    const { error } = await supabase.from('tracks').insert({ name: trackName, event_id: selectedEventId });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Track created' });
    setTrackName('');
    fetchTracks(selectedEventId);
  };

  const deleteTrack = async (id: string) => {
    const { error } = await supabase.from('tracks').delete().eq('id', id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    fetchTracks(selectedEventId);
  };

  const updateUserApproval = async (userId: string, status: string) => {
    const { error } = await supabase.from('users').update({ approval_status: status }).eq('id', userId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    fetchUsers();
  };

  const assignEvent = async (userId: string, eventId: string | null) => {
    const { error } = await supabase.from('users').update({ assigned_event_id: eventId }).eq('id', userId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    fetchUsers();
  };

  const changeUserRole = async (targetUserId: string, newRole: string) => {
    if (targetUserId === user?.id) {
      toast({ title: 'Error', description: 'You cannot change your own role.', variant: 'destructive' });
      return;
    }
    const targetUser = users.find(u => u.id === targetUserId);
    if (targetUser?.role === 'admin' && newRole !== 'admin') {
      const adminCount = users.filter(u => u.role === 'admin').length;
      if (adminCount <= 1) {
        toast({ title: 'Error', description: 'Cannot remove the last admin.', variant: 'destructive' });
        return;
      }
    }
    const { error } = await supabase.from('users').update({ role: newRole }).eq('id', targetUserId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Role updated successfully' });
    fetchUsers();
  };

  const buildParticipantKey = (name: string, email?: string | null, phone?: string | null) =>
    `${name.trim().toLowerCase()}|${(email || '').trim().toLowerCase()}|${(phone || '').trim().toLowerCase()}`;

  const handleParticipantImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedEventId) return;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error('Could not read file');
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' });
      if (!rows.length) throw new Error('File must have a header and at least one row');

      const headerMap = new Map<string, string>();
      Object.keys(rows[0]).forEach((key) => headerMap.set(key.trim().toLowerCase(), key));
      const nameH = headerMap.get('name');
      const emailH = headerMap.get('email');
      const phoneH = headerMap.get('phone');
      if (!nameH) throw new Error('File must include a "name" column');

      const parsed = rows
        .map((row) => ({
          name: String(row[nameH] ?? '').trim(),
          email: emailH ? String(row[emailH] ?? '').trim() || null : null,
          phone: phoneH ? String(row[phoneH] ?? '').trim() || null : null,
        }))
        .filter((r) => r.name.length > 0);

      const seen = new Set<string>();
      const unique = parsed.filter((r) => {
        const k = buildParticipantKey(r.name, r.email, r.phone);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      const { data: existing } = await supabase.from('participants').select('name,email,phone').eq('event_id', selectedEventId);
      const existKeys = new Set((existing || []).map((p) => buildParticipantKey(p.name, p.email, p.phone)));
      const toInsert = unique
        .filter((r) => !existKeys.has(buildParticipantKey(r.name, r.email, r.phone)))
        .map((r) => ({ ...r, event_id: selectedEventId, qr_token: crypto.randomUUID() }));

      if (!toInsert.length) { toast({ title: 'No new participants', description: 'All rows were duplicates.' }); return; }

      for (let i = 0; i < toInsert.length; i += 500) {
        const { error } = await supabase.from('participants').insert(toInsert.slice(i, i + 500));
        if (error) throw error;
      }

      const skipped = parsed.length - toInsert.length;
      toast({ title: 'Import complete', description: `${toInsert.length} imported${skipped > 0 ? `, ${skipped} skipped` : ''}` });
      fetchParticipants(selectedEventId);
    } catch (error) {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Import failed', variant: 'destructive' });
    } finally {
      e.target.value = '';
    }
  };

  const exportParticipants = () => {
    if (!participants.length) return;
    const csv = ['Name,Email,Phone,USN,College,Track,Payment Status,Amount Paid,QR Token,Checked In,Checked In At']
      .concat(participants.map(p =>
        `"${p.name}","${p.email || ''}","${p.phone || ''}","${p.usn || ''}","${p.college || ''}","${tracks.find(t => t.id === p.track_id)?.name || ''}","${p.payment_status}",${p.amount_paid || 0},"${p.qr_token}",${p.checked_in},"${p.checked_in_at || ''}"`
      )).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'participants.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadQR = async (participant: Participant) => {
    const payload = JSON.stringify({ participant_id: participant.id, event_id: participant.event_id, qr_token: participant.qr_token });
    const url = await QRCode.toDataURL(payload, { width: 400, margin: 2 });
    const a = document.createElement('a');
    a.href = url; a.download = `qr-${participant.name.replace(/\s+/g, '-')}.png`; a.click();
  };

  const downloadAllQRs = async () => {
    if (!participants.length) return;
    toast({ title: 'Generating QR Codes...', description: 'This may take a moment.' });
    for (const p of participants) {
      await downloadQR(p);
      await new Promise(r => setTimeout(r, 100)); // avoid rate limits / browser block
    }
    toast({ title: 'QR codes downloaded', description: `${participants.length} QR codes generated.` });
  };

  const checkedIn = participants.filter(p => p.checked_in).length;
  const total = participants.length;
  const pendingUsers = users.filter(u => u.approval_status === 'pending').length;
  const totalRevenue = participants.reduce((sum, p) => sum + (Number(p.amount_paid) || 0), 0);

  if (loading || (user && !profile)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground font-body">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="min-h-screen bg-background">
      <Navbar profile={profile} onSignOut={signOut} />

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            <span className="bordered-text">Admin</span>{' '}
            <span className="highlight-text">Dashboard</span>
          </h1>
          <p className="text-sm text-muted-foreground font-body mt-3">
            Manage events, coordinators, and participants.
          </p>
        </div>

        {/* Quick Stats (Global) */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="p-4 rounded-xl border border-border bg-card">
            <p className="text-3xl font-bold text-foreground">{globalStats.total}</p>
            <p className="text-xs text-muted-foreground font-body mt-1">Total Participants</p>
          </div>
          <div className="p-4 rounded-xl border border-border bg-card">
            <p className="text-3xl font-bold text-success">{globalStats.checkedIn}</p>
            <p className="text-xs text-muted-foreground font-body mt-1">Total Checked-In</p>
          </div>
          <div className="p-4 rounded-xl border border-border bg-card">
            <p className="text-3xl font-bold text-amber-500">{globalStats.pending}</p>
            <p className="text-xs text-muted-foreground font-body mt-1">Pending Payments</p>
          </div>
          <div className="p-4 rounded-xl border border-border bg-card">
            <p className="text-3xl font-bold text-primary">₹{globalStats.revenue}</p>
            <p className="text-xs text-muted-foreground font-body mt-1">Global Revenue</p>
          </div>
          <div className="p-4 rounded-xl border border-border bg-card">
            <p className="text-3xl font-bold text-foreground">{events.length}</p>
            <p className="text-xs text-muted-foreground font-body mt-1">Total Events</p>
          </div>
        </div>

        <Tabs defaultValue="events" className="space-y-6">
          <TabsList className="bg-secondary rounded-full p-1 h-auto">
            <TabsTrigger value="events" className="rounded-full text-xs font-semibold tracking-wider data-[state=active]:bg-foreground data-[state=active]:text-background px-4 py-2">
              <CalendarDays className="h-3.5 w-3.5 mr-1.5" />EVENTS
            </TabsTrigger>
            <TabsTrigger value="users" className="rounded-full text-xs font-semibold tracking-wider data-[state=active]:bg-foreground data-[state=active]:text-background px-4 py-2">
              <Users className="h-3.5 w-3.5 mr-1.5" />USERS
            </TabsTrigger>
            <TabsTrigger value="participants" className="rounded-full text-xs font-semibold tracking-wider data-[state=active]:bg-foreground data-[state=active]:text-background px-4 py-2">
              <UserCheck className="h-3.5 w-3.5 mr-1.5" />PARTICIPANTS
            </TabsTrigger>
            <TabsTrigger value="stats" className="rounded-full text-xs font-semibold tracking-wider data-[state=active]:bg-foreground data-[state=active]:text-background px-4 py-2">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />STATS
            </TabsTrigger>
          </TabsList>

          {/* EVENTS TAB */}
          <TabsContent value="events" className="space-y-6">
            <form onSubmit={createEvent} className="p-6 rounded-xl border border-border bg-card space-y-4">
              <h3 className="text-sm font-semibold tracking-wider text-foreground uppercase">Create Event</h3>
              <div className="flex gap-3 flex-wrap items-end">
                <Input placeholder="Event name" value={eventName} onChange={e => setEventName(e.target.value)} required className="h-10 rounded-full px-4 bg-secondary flex-1 min-w-[200px] font-body" />
                <Input type="datetime-local" value={eventDate} onChange={e => setEventDate(e.target.value)} required className="h-10 rounded-full px-4 bg-secondary w-auto font-body" />
                <Input placeholder="Location" value={eventLocation} onChange={e => setEventLocation(e.target.value)} required className="h-10 rounded-full px-4 bg-secondary flex-1 min-w-[150px] font-body" />
                <Input type="number" placeholder="Fee (e.g. 500)" value={eventFee} onChange={e => setEventFee(e.target.value)} className="h-10 rounded-full px-4 bg-secondary flex-1 min-w-[120px] font-body" />
                <Button type="submit" className="rounded-full h-10 px-6 text-xs font-semibold tracking-wider gap-1">
                  <Plus className="h-4 w-4" /> CREATE
                </Button>
              </div>
            </form>

            <div className="grid gap-3">
              {events.map(event => (
                <div key={event.id} className="flex items-center justify-between p-5 rounded-xl border border-border bg-card hover:border-primary/30 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <CalendarDays className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{event.name}</p>
                      <p className="text-xs text-muted-foreground font-body">{new Date(event.date).toLocaleString()} · {event.location} · ₹{event.registration_fee || 0}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={selectedEventId === event.id ? 'default' : 'outline'}
                      onClick={() => setSelectedEventId(event.id)}
                      className="rounded-full text-xs font-semibold tracking-wider"
                    >
                      {selectedEventId === event.id ? 'SELECTED' : 'SELECT'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => deleteEvent(event.id)} className="rounded-full text-destructive hover:bg-destructive hover:text-destructive-foreground">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              {events.length === 0 && (
                <div className="text-center py-12 text-muted-foreground font-body text-sm">
                  No events yet. Create your first event above.
                </div>
              )}
            </div>

            {selectedEventId && (
              <div className="mt-8 p-6 rounded-xl border border-border bg-card space-y-4">
                <h3 className="text-sm font-semibold tracking-wider text-foreground uppercase">Create Track for Selected Event</h3>
                <form onSubmit={createTrack} className="flex gap-3 flex-wrap items-end">
                  <Input placeholder="Track name (e.g. AI Agents)" value={trackName} onChange={e => setTrackName(e.target.value)} required className="h-10 rounded-full px-4 bg-secondary flex-1 font-body" />
                  <Button type="submit" className="rounded-full h-10 px-6 text-xs font-semibold tracking-wider gap-1">
                    <Plus className="h-4 w-4" /> ADD TRACK
                  </Button>
                </form>
                <div className="grid gap-2 mt-4">
                  {tracks.map(t => (
                    <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                      <span className="font-body text-sm font-medium">{t.name}</span>
                      <Button size="sm" variant="ghost" onClick={() => deleteTrack(t.id)} className="text-destructive hover:bg-destructive hover:text-destructive-foreground h-8 w-8 p-0 rounded-full">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  {tracks.length === 0 && <p className="text-xs text-muted-foreground font-body">No tracks created.</p>}
                </div>
              </div>
            )}
          </TabsContent>

          {/* USERS TAB */}
          <TabsContent value="users" className="space-y-3">
            {users.map(u => (
              <div key={u.id} className="flex items-center justify-between p-5 rounded-xl border border-border bg-card flex-wrap gap-3 hover:border-primary/30 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center">
                    <span className="text-sm font-bold text-foreground">{u.full_name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{u.full_name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary font-semibold uppercase tracking-wider text-secondary-foreground">
                        {u.role}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider
                        ${u.approval_status === 'approved' ? 'bg-success/10 text-success' :
                          u.approval_status === 'rejected' ? 'bg-destructive/10 text-destructive' :
                          'bg-primary/10 text-primary'}`}>
                        {u.approval_status}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                  <select
                    className="bg-secondary text-foreground text-xs px-3 py-2 rounded-full border border-border font-body"
                    value={u.assigned_event_id || ''}
                    onChange={e => assignEvent(u.id, e.target.value || null)}
                  >
                    <option value="">No event assigned</option>
                    {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                  </select>
                  {u.approval_status === 'pending' && (
                    <>
                      <Button size="sm" onClick={() => updateUserApproval(u.id, 'approved')} className="rounded-full text-xs font-semibold tracking-wider gap-1">
                        <Check className="h-3.5 w-3.5" /> APPROVE
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => updateUserApproval(u.id, 'rejected')} className="rounded-full text-xs font-semibold tracking-wider text-destructive hover:bg-destructive hover:text-destructive-foreground gap-1">
                        <X className="h-3.5 w-3.5" /> REJECT
                      </Button>
                    </>
                  )}
                  {u.approval_status === 'rejected' && (
                    <Button size="sm" onClick={() => updateUserApproval(u.id, 'approved')} className="rounded-full text-xs font-semibold tracking-wider gap-1">
                      <Check className="h-3.5 w-3.5" /> APPROVE
                    </Button>
                  )}
                  {u.approval_status === 'approved' && (
                    <Button size="sm" variant="outline" onClick={() => updateUserApproval(u.id, 'rejected')} className="rounded-full text-xs font-semibold tracking-wider">
                      REVOKE
                    </Button>
                  )}
                  {u.id !== user?.id && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" className="rounded-full text-xs font-semibold tracking-wider gap-1">
                          <Shield className="h-3.5 w-3.5" /> ROLE
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={u.role === 'admin'}
                          onClick={() => changeUserRole(u.id, 'admin')}
                          className="text-xs font-semibold gap-2"
                        >
                          <ShieldAlert className="h-3.5 w-3.5" /> Make Admin
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={u.role === 'coordinator'}
                          onClick={() => changeUserRole(u.id, 'coordinator')}
                          className="text-xs font-semibold gap-2"
                        >
                          <Shield className="h-3.5 w-3.5" /> Make Coordinator
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            ))}
            {users.length === 0 && <p className="text-muted-foreground text-sm font-body text-center py-12">No users.</p>}
          </TabsContent>

          {/* PARTICIPANTS TAB */}
          <TabsContent value="participants" className="space-y-4">
            <div className="flex gap-3 items-center flex-wrap">
              <select
                className="bg-secondary text-foreground text-xs px-4 py-2.5 rounded-full border border-border font-body"
                value={selectedEventId}
                onChange={e => setSelectedEventId(e.target.value)}
              >
                <option value="">Select event</option>
                {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select>
              {selectedEventId && (
                <>
                  <label className="flex items-center gap-2 cursor-pointer px-4 py-2.5 rounded-full border border-border hover:border-primary/50 transition-colors">
                    <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold tracking-wider text-foreground">IMPORT</span>
                    <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleParticipantImport} />
                  </label>
                  <Button size="sm" variant="outline" onClick={exportParticipants} className="rounded-full text-xs font-semibold tracking-wider gap-1">
                    <Download className="h-3.5 w-3.5" /> EXPORT
                  </Button>
                  <Button size="sm" variant="outline" onClick={downloadAllQRs} className="rounded-full text-xs font-semibold tracking-wider gap-1">
                    <QrCode className="h-3.5 w-3.5" /> BULK QR
                  </Button>
                </>
              )}
            </div>
            {selectedEventId && (
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-secondary">
                      <th className="text-left py-3 px-4 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Name</th>
                      <th className="text-left py-3 px-4 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Email</th>
                      <th className="text-left py-3 px-4 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Phone</th>
                      <th className="text-left py-3 px-4 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Track</th>
                      <th className="text-left py-3 px-4 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Payment</th>
                      <th className="text-left py-3 px-4 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Status</th>
                      <th className="text-left py-3 px-4 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">QR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {participants.map(p => (
                      <tr key={p.id} className="border-t border-border hover:bg-secondary/50 transition-colors">
                        <td className="py-3 px-4 text-foreground font-medium font-body text-xs">{p.name}</td>
                        <td className="py-3 px-4 text-muted-foreground font-body text-xs">{p.email || '—'}</td>
                        <td className="py-3 px-4 text-muted-foreground font-body text-xs">{p.phone || '—'}</td>
                        <td className="py-3 px-4 text-muted-foreground font-body text-xs">{tracks.find(t => t.id === p.track_id)?.name || '—'}</td>
                        <td className="py-3 px-4 text-muted-foreground font-body text-xs">
                          {p.payment_status === 'PAID' ? <span className="text-success font-semibold">PAID</span> : <span className="text-amber-500 font-semibold">{p.payment_status}</span>}
                          {p.amount_paid > 0 && ` (₹${p.amount_paid})`}
                        </td>
                        <td className="py-3 px-4">
                          {p.checked_in ? (
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-success/10 text-success font-semibold">
                              <Check className="h-3 w-3" /> CHECKED IN
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground font-semibold">PENDING</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <button onClick={() => downloadQR(p)} className="text-primary hover:text-primary/70 transition-colors">
                            <QrCode className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {participants.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground font-body text-sm">
                    No participants. Import from Excel/CSV above.
                  </div>
                )}
              </div>
            )}
            {!selectedEventId && (
              <div className="text-center py-12 text-muted-foreground font-body text-sm">
                Select an event to view participants.
              </div>
            )}
          </TabsContent>

          {/* STATS TAB */}
          <TabsContent value="stats" className="space-y-6">
            <div className="flex gap-3 items-center">
              <select
                className="bg-secondary text-foreground text-xs px-4 py-2.5 rounded-full border border-border font-body"
                value={selectedEventId}
                onChange={e => setSelectedEventId(e.target.value)}
              >
                <option value="">Select event</option>
                {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select>
            </div>
            {selectedEventId && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-8 rounded-xl border border-border bg-card text-center">
                  <p className="text-5xl font-bold text-foreground">{total}</p>
                  <p className="text-xs text-muted-foreground font-body mt-2 uppercase tracking-wider">Total</p>
                </div>
                <div className="p-8 rounded-xl border border-border bg-card text-center">
                  <p className="text-5xl font-bold text-success">{checkedIn}</p>
                  <p className="text-xs text-muted-foreground font-body mt-2 uppercase tracking-wider">Checked In</p>
                </div>
                <div className="p-8 rounded-xl border border-border bg-card text-center">
                  <p className="text-5xl font-bold text-primary">₹{totalRevenue}</p>
                  <p className="text-xs text-muted-foreground font-body mt-2 uppercase tracking-wider">Revenue</p>
                </div>
              </div>
            )}
            {!selectedEventId && (
              <div className="text-center py-12 text-muted-foreground font-body text-sm">
                Select an event to view statistics.
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AdminDashboard;
