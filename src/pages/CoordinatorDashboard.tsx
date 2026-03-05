import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Navbar } from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScanLine, Users, BarChart3 } from 'lucide-react';

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
  const [scanResult, setScanResult] = useState<{ success: boolean; message: string; name?: string } | null>(null);
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
    if (profile?.assigned_event_id) {
      fetchEvent();
      fetchParticipants();
    }
  }, [profile?.assigned_event_id, fetchEvent, fetchParticipants]);

  // Realtime
  useEffect(() => {
    if (!profile?.assigned_event_id) return;
    const channel = supabase
      .channel('coordinator-participants')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `event_id=eq.${profile.assigned_event_id}` }, () => {
        fetchParticipants();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.assigned_event_id, fetchParticipants]);

  const startScanner = async () => {
    setScanning(true);
    setScanResult(null);
    // Dynamic import to avoid SSR issues
    const { Html5Qrcode } = await import('html5-qrcode');
    
    // Wait for DOM element
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const scanner = new Html5Qrcode(scannerContainerId);
    scannerRef.current = scanner;

    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          try {
            const payload = JSON.parse(decodedText);
            if (!payload.participant_id || !payload.event_id || !payload.qr_token) {
              setScanResult({ success: false, message: 'Invalid QR code format' });
              return;
            }

            // Stop scanner before processing
            await scanner.stop();
            scannerRef.current = null;
            setScanning(false);

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
                setScanResult({ success: true, message: 'Check-in successful!', name: result.name });
                toast({ title: '✓ Checked In', description: result.name });
              } else {
                setScanResult({ success: false, message: result.error });
              }
            }
            fetchParticipants();
          } catch {
            setScanResult({ success: false, message: 'Invalid QR code' });
          }
        },
        () => {
          // ignore scan errors
        }
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Could not access camera';
      toast({ title: 'Camera Error', description: errMsg, variant: 'destructive' });
      setScanning(false);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        // ignore stop errors
      }
      scannerRef.current = null;
    }
    setScanning(false);
  };

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        try {
          scannerRef.current.stop();
        } catch {
          // ignore cleanup errors
        }
      }
    };
  }, []);

  const checkedIn = participants.filter(p => p.checked_in).length;
  const total = participants.length;

  if (loading || (user && !profile)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
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
            <p className="text-muted-foreground">No event has been assigned to you yet.</p>
            <p className="text-sm text-muted-foreground">Please contact your administrator.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar profile={profile} onSignOut={signOut} />
      <div className="max-w-4xl mx-auto p-6">
        {event && (
          <div className="mb-6 p-4 rounded-lg bg-card border border-border">
            <h2 className="text-xl font-bold text-foreground">{event.name}</h2>
            <p className="text-sm text-muted-foreground">{new Date(event.date).toLocaleString()} · {event.location}</p>
          </div>
        )}

        <Tabs defaultValue="scanner" className="space-y-6">
          <TabsList className="bg-secondary">
            <TabsTrigger value="scanner"><ScanLine className="h-4 w-4 mr-1" />Scanner</TabsTrigger>
            <TabsTrigger value="participants"><Users className="h-4 w-4 mr-1" />Participants</TabsTrigger>
            <TabsTrigger value="stats"><BarChart3 className="h-4 w-4 mr-1" />Stats</TabsTrigger>
          </TabsList>

          <TabsContent value="scanner" className="space-y-4">
            <div className="flex flex-col items-center gap-4">
              {!scanning ? (
                <Button onClick={startScanner} size="lg" className="gap-2">
                  <ScanLine className="h-5 w-5" />
                  Start Scanner
                </Button>
              ) : (
                <Button onClick={stopScanner} variant="outline" size="lg">Stop Scanner</Button>
              )}
              <div id={scannerContainerId} className="w-full max-w-sm rounded-lg overflow-hidden" />
              {scanResult && (
                <div className={`p-4 rounded-lg w-full max-w-sm text-center ${scanResult.success ? 'bg-success/10 border border-success/30' : 'bg-destructive/10 border border-destructive/30'}`}>
                  <p className={`font-medium ${scanResult.success ? 'text-success' : 'text-destructive'}`}>
                    {scanResult.message}
                  </p>
                  {scanResult.name && <p className="text-foreground mt-1">{scanResult.name}</p>}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="participants">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-3 px-3">Name</th>
                    <th className="text-left py-3 px-3">Email</th>
                    <th className="text-left py-3 px-3">Status</th>
                    <th className="text-left py-3 px-3">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {participants.map(p => (
                    <tr key={p.id} className="border-b border-border/50">
                      <td className="py-3 px-3 text-foreground">{p.name}</td>
                      <td className="py-3 px-3 text-muted-foreground">{p.email || '—'}</td>
                      <td className="py-3 px-3">
                        {p.checked_in ? (
                          <span className="text-success text-xs font-medium">✓ Checked In</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">Pending</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-muted-foreground text-xs">
                        {p.checked_in_at ? new Date(p.checked_in_at).toLocaleTimeString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {participants.length === 0 && <p className="text-muted-foreground text-sm py-4">No participants.</p>}
            </div>
          </TabsContent>

          <TabsContent value="stats">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-6 rounded-lg bg-card border border-border text-center">
                <p className="text-4xl font-bold text-foreground">{total}</p>
                <p className="text-sm text-muted-foreground mt-1">Total</p>
              </div>
              <div className="p-6 rounded-lg bg-card border border-border text-center">
                <p className="text-4xl font-bold text-success">{checkedIn}</p>
                <p className="text-sm text-muted-foreground mt-1">Checked In</p>
              </div>
              <div className="p-6 rounded-lg bg-card border border-border text-center">
                <p className="text-4xl font-bold text-primary">{total > 0 ? Math.round((checkedIn / total) * 100) : 0}%</p>
                <p className="text-sm text-muted-foreground mt-1">Rate</p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default CoordinatorDashboard;
