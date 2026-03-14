import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Navbar } from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScanLine, Users, BarChart3, Check } from 'lucide-react';

interface Html5Qrcode {
  start(config: unknown, videoConstraints: unknown, onScan: (text: string) => void, onError: () => void): Promise<void>;
  stop(): Promise<void>;
}

interface Event {
  id: string;
  name: string;
  date: string;
  location: string;
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
}

const CoordinatorDashboard = () => {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [event, setEvent] = useState<Event | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{
    success: boolean;
    message: string;
    name?: string;
    phone?: string;
    participantId?: string;
    alreadyCheckedIn?: boolean;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = 'qr-reader';

  useEffect(() => {
    if (!loading && !user) navigate('/auth', { replace: true });
    if (!loading && user && profile && profile.role !== 'coordinator') navigate('/', { replace: true });
    if (!loading && user && profile && profile.approval_status !== 'approved') navigate('/pending', { replace: true });
  }, [user, profile, loading, navigate]);

  const fetchEvent = useCallback(async () => {
    if (!profile?.assigned_event_id) return;
    const { data } = await supabase.from('events').select('*').eq('id', profile.assigned_event_id).single();
    if (data) setEvent(data as unknown as Event);
  }, [profile?.assigned_event_id]);

  const fetchParticipants = useCallback(async () => {
    if (!profile?.assigned_event_id) return;
    const { data } = await supabase.from('participants').select('*').eq('event_id', profile.assigned_event_id).order('name');
    if (data) setParticipants(data as unknown as Participant[]);
  }, [profile?.assigned_event_id]);

  useEffect(() => {
    if (profile?.assigned_event_id) { fetchEvent(); fetchParticipants(); }
  }, [profile?.assigned_event_id, fetchEvent, fetchParticipants]);

  useEffect(() => {
    if (!profile?.assigned_event_id) return;
    const channel = supabase
      .channel('coordinator-participants')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `event_id=eq.${profile.assigned_event_id}` }, () => fetchParticipants())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.assigned_event_id, fetchParticipants]);

  const startScanner = async () => {
    setScanning(true);
    setScanResult(null);
    const { Html5Qrcode } = await import('html5-qrcode');
    await new Promise(resolve => setTimeout(resolve, 100));
    const scanner = new Html5Qrcode(scannerContainerId);
    scannerRef.current = scanner;
    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          if (isProcessing) return;
          try {
            let payload: { participant_id?: string; event_id?: string; qr_token?: string };
            try {
              payload = JSON.parse(decodedText);
            } catch {
              setScanResult({ success: false, message: 'Invalid Registration QR' });
              return;
            }
            if (!payload.participant_id || !payload.event_id || !payload.qr_token) {
              setScanResult({ success: false, message: 'Invalid Registration QR' });
              return;
            }

            setIsProcessing(true);
            await scanner.stop();
            scannerRef.current = null;
            setScanning(false);

            // Step 1: Validate against Supabase directly
            const { data: participant, error: fetchErr } = await supabase
              .from('participants')
              .select('id, event_id, qr_token, name, phone, checked_in')
              .eq('id', payload.participant_id)
              .eq('event_id', payload.event_id)
              .eq('qr_token', payload.qr_token)
              .single();

            if (fetchErr || !participant) {
              setScanResult({ success: false, message: 'Invalid Registration QR' });
              setIsProcessing(false);
              return;
            }

            // Step 2: Already checked in?
            if (participant.checked_in) {
              setScanResult({
                success: false,
                message: 'Participant Already Checked In',
                name: participant.name,
                phone: participant.phone || undefined,
                participantId: participant.id,
                alreadyCheckedIn: true,
              });
              setIsProcessing(false);
              return;
            }

            // Step 3: Check in via RPC (atomic update)
            const { data, error } = await supabase.rpc('checkin_participant', {
              _participant_id: payload.participant_id,
              _event_id: payload.event_id,
              _qr_token: payload.qr_token,
            });

            if (error) {
              setScanResult({ success: false, message: error.message });
            } else {
              const result = data as { success: boolean; error?: string; name?: string };
              if (result.success) {
                setScanResult({
                  success: true,
                  message: 'Check-in Successful!',
                  name: participant.name,
                  phone: participant.phone || undefined,
                  participantId: participant.id,
                });
                toast({ title: '✓ Checked In', description: participant.name });
              } else {
                setScanResult({ success: false, message: result.error || 'Check-in failed' });
              }
            }
            fetchParticipants();
            setIsProcessing(false);
          } catch {
            setScanResult({ success: false, message: 'Invalid Registration QR' });
            setIsProcessing(false);
          }
        },
        () => {}
      );
    } catch (err) {
      toast({ title: 'Camera Error', description: err instanceof Error ? err.message : 'Could not access camera', variant: 'destructive' });
      setScanning(false);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) { try { await scannerRef.current.stop(); } catch {} scannerRef.current = null; }
    setScanning(false);
  };

  useEffect(() => { return () => { if (scannerRef.current) { try { scannerRef.current.stop(); } catch {} } }; }, []);

  const checkedIn = participants.filter(p => p.checked_in).length;
  const total = participants.length;

  if (loading || (user && !profile)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground font-body">Loading...</p>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  if (!profile.assigned_event_id) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar profile={profile} onSignOut={signOut} />
        <div className="flex items-center justify-center mt-32">
          <div className="text-center space-y-4">
            <h2 className="text-3xl font-bold text-foreground">
              <span className="bordered-text">No event</span>{' '}
              <span className="highlight-text">assigned</span>
            </h2>
            <p className="text-sm text-muted-foreground font-body">Please contact your administrator.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar profile={profile} onSignOut={signOut} />
      <div className="max-w-4xl mx-auto px-6 py-8">
        {event && (
          <div className="mb-8 p-6 rounded-xl border border-border bg-card">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                <ScanLine className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-foreground">{event.name}</h2>
                <p className="text-xs text-muted-foreground font-body">{new Date(event.date).toLocaleString()} · {event.location}</p>
              </div>
            </div>
          </div>
        )}

        <Tabs defaultValue="scanner" className="space-y-6">
          <TabsList className="bg-secondary rounded-full p-1 h-auto">
            <TabsTrigger value="scanner" className="rounded-full text-xs font-semibold tracking-wider data-[state=active]:bg-foreground data-[state=active]:text-background px-4 py-2">
              <ScanLine className="h-3.5 w-3.5 mr-1.5" />SCANNER
            </TabsTrigger>
            <TabsTrigger value="participants" className="rounded-full text-xs font-semibold tracking-wider data-[state=active]:bg-foreground data-[state=active]:text-background px-4 py-2">
              <Users className="h-3.5 w-3.5 mr-1.5" />PARTICIPANTS
            </TabsTrigger>
            <TabsTrigger value="stats" className="rounded-full text-xs font-semibold tracking-wider data-[state=active]:bg-foreground data-[state=active]:text-background px-4 py-2">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />STATS
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scanner" className="space-y-4">
            <div className="flex flex-col items-center gap-6">
              {!scanning ? (
                <Button onClick={startScanner} size="lg" className="rounded-full px-8 text-sm font-semibold tracking-wider gap-2 h-14">
                  <ScanLine className="h-5 w-5" /> START SCANNER
                </Button>
              ) : (
                <Button onClick={stopScanner} variant="outline" size="lg" className="rounded-full px-8 text-sm font-semibold tracking-wider h-14">
                  STOP SCANNER
                </Button>
              )}
              <div id={scannerContainerId} className="w-full max-w-sm rounded-xl overflow-hidden border border-border" />
              {scanResult && (
                <div className={`p-6 rounded-xl w-full max-w-sm border ${scanResult.success ? 'bg-success/5 border-success/30' : scanResult.alreadyCheckedIn ? 'bg-accent/50 border-accent' : 'bg-destructive/5 border-destructive/30'}`}>
                  <p className={`font-semibold text-sm text-center ${scanResult.success ? 'text-success' : scanResult.alreadyCheckedIn ? 'text-accent-foreground' : 'text-destructive'}`}>
                    {scanResult.success ? '✓ ' : scanResult.alreadyCheckedIn ? '⚠ ' : '✗ '}{scanResult.message}
                  </p>
                  {(scanResult.name || scanResult.phone || scanResult.participantId) && (
                    <div className="mt-4 space-y-2 text-left">
                      {scanResult.name && (
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Name</span>
                          <span className="text-sm font-bold text-foreground">{scanResult.name}</span>
                        </div>
                      )}
                      {scanResult.phone && (
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Phone</span>
                          <span className="text-sm font-body text-foreground">{scanResult.phone}</span>
                        </div>
                      )}
                      {scanResult.participantId && (
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Unique ID</span>
                          <span className="text-xs font-mono text-muted-foreground">{scanResult.participantId.slice(0, 8)}...</span>
                        </div>
                      )}
                    </div>
                  )}
                  {!scanning && (
                    <Button onClick={() => { setScanResult(null); startScanner(); }} size="sm" variant="outline" className="w-full mt-4 rounded-full text-xs font-semibold tracking-wider">
                      <ScanLine className="h-3.5 w-3.5 mr-1.5" /> SCAN AGAIN
                    </Button>
                  )}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="participants">
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-secondary">
                    <th className="text-left py-3 px-4 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Name</th>
                    <th className="text-left py-3 px-4 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Email</th>
                    <th className="text-left py-3 px-4 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Status</th>
                    <th className="text-left py-3 px-4 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {participants.map(p => (
                    <tr key={p.id} className="border-t border-border hover:bg-secondary/50 transition-colors">
                      <td className="py-3 px-4 text-foreground font-medium font-body text-xs">{p.name}</td>
                      <td className="py-3 px-4 text-muted-foreground font-body text-xs">{p.email || '—'}</td>
                      <td className="py-3 px-4">
                        {p.checked_in ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-success/10 text-success font-semibold">
                            <Check className="h-3 w-3" /> CHECKED IN
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground font-semibold">PENDING</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground font-body text-xs">
                        {p.checked_in_at ? new Date(p.checked_in_at).toLocaleTimeString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {participants.length === 0 && <p className="text-muted-foreground text-sm font-body py-8 text-center">No participants.</p>}
            </div>
          </TabsContent>

          <TabsContent value="stats">
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
                <p className="text-5xl font-bold text-primary">{total > 0 ? Math.round((checkedIn / total) * 100) : 0}%</p>
                <p className="text-xs text-muted-foreground font-body mt-2 uppercase tracking-wider">Rate</p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default CoordinatorDashboard;
