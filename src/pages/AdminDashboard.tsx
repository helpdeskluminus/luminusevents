import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Navbar } from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CalendarDays, Users, UserCheck, BarChart3, Upload, Download, QrCode } from 'lucide-react';
import QRCode from 'qrcode';

interface Event {
  id: string;
  name: string;
  date: string;
  location: string;
  created_at: string;
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
  qr_token: string;
  checked_in: boolean;
  checked_in_at: string | null;
  created_at: string;
}

const AdminDashboard = () => {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [events, setEvents] = useState<Event[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');

  // Event form
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventLocation, setEventLocation] = useState('');

  useEffect(() => {
    if (!loading && (!user || !profile)) navigate('/auth', { replace: true });
    if (!loading && profile && profile.role !== 'admin') navigate('/', { replace: true });
    if (!loading && profile && profile.approval_status !== 'approved') navigate('/pending', { replace: true });
  }, [user, profile, loading, navigate]);

  const fetchEvents = useCallback(async () => {
    const { data } = await supabase.from('events').select('*').order('date', { ascending: false });
    if (data) setEvents(data as unknown as Event[]);
  }, []);

  const fetchUsers = useCallback(async () => {
    const { data } = await supabase.from('users').select('*').order('created_at', { ascending: false });
    if (data) setUsers(data as unknown as AppUser[]);
  }, []);

  const fetchParticipants = useCallback(async (eventId: string) => {
    const { data } = await supabase.from('participants').select('*').eq('event_id', eventId).order('name');
    if (data) setParticipants(data as unknown as Participant[]);
  }, []);

  useEffect(() => {
    if (profile?.role === 'admin') {
      fetchEvents();
      fetchUsers();
    }
  }, [profile, fetchEvents, fetchUsers]);

  useEffect(() => {
    if (selectedEventId) fetchParticipants(selectedEventId);
  }, [selectedEventId, fetchParticipants]);

  // Realtime subscriptions
  useEffect(() => {
    const channel = supabase
      .channel('admin-participants')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, () => {
        if (selectedEventId) fetchParticipants(selectedEventId);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedEventId, fetchParticipants]);

  const createEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('events').insert({
      name: eventName, date: eventDate, location: eventLocation,
    } as any);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Event created' });
    setEventName(''); setEventDate(''); setEventLocation('');
    fetchEvents();
  };

  const deleteEvent = async (id: string) => {
    const { error } = await supabase.from('events').delete().eq('id', id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    fetchEvents();
    if (selectedEventId === id) { setSelectedEventId(''); setParticipants([]); }
  };

  const updateUserApproval = async (userId: string, status: string) => {
    const { error } = await supabase.from('users').update({ approval_status: status } as any).eq('id', userId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    fetchUsers();
  };

  const assignEvent = async (userId: string, eventId: string | null) => {
    const { error } = await supabase.from('users').update({ assigned_event_id: eventId } as any).eq('id', userId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    fetchUsers();
  };

  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedEventId) return;
    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) { toast({ title: 'Error', description: 'CSV must have a header and at least one row', variant: 'destructive' }); return; }

    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const nameIdx = header.indexOf('name');
    const emailIdx = header.indexOf('email');
    const phoneIdx = header.indexOf('phone');
    if (nameIdx === -1) { toast({ title: 'Error', description: 'CSV must have a "name" column', variant: 'destructive' }); return; }

    const rows = lines.slice(1).map(line => {
      const cols = line.split(',').map(c => c.trim());
      return {
        name: cols[nameIdx] || '',
        email: emailIdx >= 0 ? cols[emailIdx] || null : null,
        phone: phoneIdx >= 0 ? cols[phoneIdx] || null : null,
        event_id: selectedEventId,
        qr_token: crypto.randomUUID(),
      };
    }).filter(r => r.name);

    // Batch insert in chunks of 500
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase.from('participants').insert(chunk as any);
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    }
    toast({ title: 'Success', description: `${rows.length} participants imported` });
    fetchParticipants(selectedEventId);
    e.target.value = '';
  };

  const exportParticipants = () => {
    if (!participants.length) return;
    const csv = ['Name,Email,Phone,QR Token,Checked In,Checked In At']
      .concat(participants.map(p =>
        `"${p.name}","${p.email || ''}","${p.phone || ''}","${p.qr_token}",${p.checked_in},"${p.checked_in_at || ''}"`
      )).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'participants.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadQR = async (participant: Participant) => {
    const payload = JSON.stringify({
      participant_id: participant.id,
      event_id: participant.event_id,
      qr_token: participant.qr_token,
    });
    const url = await QRCode.toDataURL(payload, { width: 400, margin: 2 });
    const a = document.createElement('a');
    a.href = url; a.download = `qr-${participant.name.replace(/\s+/g, '-')}.png`; a.click();
  };

  const checkedIn = participants.filter(p => p.checked_in).length;
  const total = participants.length;

  if (loading || !profile) return null;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-7xl mx-auto p-6">
        <Tabs defaultValue="events" className="space-y-6">
          <TabsList className="bg-secondary">
            <TabsTrigger value="events"><CalendarDays className="h-4 w-4 mr-1" />Events</TabsTrigger>
            <TabsTrigger value="users"><Users className="h-4 w-4 mr-1" />Users</TabsTrigger>
            <TabsTrigger value="participants"><UserCheck className="h-4 w-4 mr-1" />Participants</TabsTrigger>
            <TabsTrigger value="stats"><BarChart3 className="h-4 w-4 mr-1" />Live Stats</TabsTrigger>
          </TabsList>

          {/* EVENTS TAB */}
          <TabsContent value="events" className="space-y-6">
            <form onSubmit={createEvent} className="flex gap-3 flex-wrap items-end">
              <Input placeholder="Event name" value={eventName} onChange={e => setEventName(e.target.value)} required className="w-60 bg-secondary" />
              <Input type="datetime-local" value={eventDate} onChange={e => setEventDate(e.target.value)} required className="w-60 bg-secondary" />
              <Input placeholder="Location" value={eventLocation} onChange={e => setEventLocation(e.target.value)} required className="w-60 bg-secondary" />
              <Button type="submit">Create Event</Button>
            </form>
            <div className="grid gap-3">
              {events.map(event => (
                <div key={event.id} className="flex items-center justify-between p-4 rounded-lg bg-card border border-border">
                  <div>
                    <p className="font-medium text-foreground">{event.name}</p>
                    <p className="text-sm text-muted-foreground">{new Date(event.date).toLocaleString()} · {event.location}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setSelectedEventId(event.id)}>
                      Select
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => deleteEvent(event.id)}>Delete</Button>
                  </div>
                </div>
              ))}
              {events.length === 0 && <p className="text-muted-foreground text-sm">No events yet.</p>}
            </div>
          </TabsContent>

          {/* USERS TAB */}
          <TabsContent value="users" className="space-y-4">
            {users.map(u => (
              <div key={u.id} className="flex items-center justify-between p-4 rounded-lg bg-card border border-border flex-wrap gap-3">
                <div>
                  <p className="font-medium text-foreground">{u.full_name}</p>
                  <p className="text-sm text-muted-foreground">
                    Role: {u.role} · Status: <span className={u.approval_status === 'approved' ? 'text-success' : u.approval_status === 'rejected' ? 'text-destructive' : 'text-primary'}>
                      {u.approval_status}
                    </span>
                  </p>
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                  <select
                    className="bg-secondary text-foreground text-sm px-3 py-1.5 rounded border border-border"
                    value={u.assigned_event_id || ''}
                    onChange={e => assignEvent(u.id, e.target.value || null)}
                  >
                    <option value="">No event assigned</option>
                    {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                  </select>
                  {u.approval_status === 'pending' && (
                    <>
                      <Button size="sm" onClick={() => updateUserApproval(u.id, 'approved')}>Approve</Button>
                      <Button size="sm" variant="destructive" onClick={() => updateUserApproval(u.id, 'rejected')}>Reject</Button>
                    </>
                  )}
                  {u.approval_status === 'rejected' && (
                    <Button size="sm" onClick={() => updateUserApproval(u.id, 'approved')}>Approve</Button>
                  )}
                  {u.approval_status === 'approved' && (
                    <Button size="sm" variant="outline" onClick={() => updateUserApproval(u.id, 'rejected')}>Revoke</Button>
                  )}
                </div>
              </div>
            ))}
            {users.length === 0 && <p className="text-muted-foreground text-sm">No users.</p>}
          </TabsContent>

          {/* PARTICIPANTS TAB */}
          <TabsContent value="participants" className="space-y-4">
            <div className="flex gap-3 items-center flex-wrap">
              <select
                className="bg-secondary text-foreground text-sm px-3 py-2 rounded border border-border"
                value={selectedEventId}
                onChange={e => setSelectedEventId(e.target.value)}
              >
                <option value="">Select event</option>
                {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select>
              {selectedEventId && (
                <>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Import CSV</span>
                    <input type="file" accept=".csv" className="hidden" onChange={handleCSVImport} />
                  </label>
                  <Button size="sm" variant="outline" onClick={exportParticipants}>
                    <Download className="h-4 w-4 mr-1" />Export
                  </Button>
                </>
              )}
            </div>
            {selectedEventId && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-3 px-3">Name</th>
                      <th className="text-left py-3 px-3">Email</th>
                      <th className="text-left py-3 px-3">Phone</th>
                      <th className="text-left py-3 px-3">Status</th>
                      <th className="text-left py-3 px-3">QR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {participants.map(p => (
                      <tr key={p.id} className="border-b border-border/50">
                        <td className="py-3 px-3 text-foreground">{p.name}</td>
                        <td className="py-3 px-3 text-muted-foreground">{p.email || '—'}</td>
                        <td className="py-3 px-3 text-muted-foreground">{p.phone || '—'}</td>
                        <td className="py-3 px-3">
                          {p.checked_in ? (
                            <span className="text-success text-xs font-medium">Checked In</span>
                          ) : (
                            <span className="text-muted-foreground text-xs">Not yet</span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <button onClick={() => downloadQR(p)} className="text-primary hover:text-primary/80">
                            <QrCode className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {participants.length === 0 && <p className="text-muted-foreground text-sm py-4">No participants for this event.</p>}
              </div>
            )}
          </TabsContent>

          {/* STATS TAB */}
          <TabsContent value="stats" className="space-y-6">
            <div className="flex gap-3 items-center">
              <select
                className="bg-secondary text-foreground text-sm px-3 py-2 rounded border border-border"
                value={selectedEventId}
                onChange={e => setSelectedEventId(e.target.value)}
              >
                <option value="">Select event</option>
                {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select>
            </div>
            {selectedEventId && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-6 rounded-lg bg-card border border-border text-center">
                  <p className="text-4xl font-bold text-foreground">{total}</p>
                  <p className="text-sm text-muted-foreground mt-1">Total Participants</p>
                </div>
                <div className="p-6 rounded-lg bg-card border border-border text-center">
                  <p className="text-4xl font-bold text-success">{checkedIn}</p>
                  <p className="text-sm text-muted-foreground mt-1">Checked In</p>
                </div>
                <div className="p-6 rounded-lg bg-card border border-border text-center">
                  <p className="text-4xl font-bold text-primary">{total > 0 ? Math.round((checkedIn / total) * 100) : 0}%</p>
                  <p className="text-sm text-muted-foreground mt-1">Attendance Rate</p>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AdminDashboard;
