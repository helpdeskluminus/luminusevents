import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Navbar } from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { ScanLine, Camera, ShieldCheck, ShieldX, AlertTriangle, Clock, User, Phone, Hash, Users, CheckCircle } from 'lucide-react';

interface ScanResult {
  type: 'success' | 'already' | 'invalid';
  message: string;
  name?: string;
  phone?: string;
  participantId?: string;
}

interface ScanHistoryItem {
  id: string;
  participant_name: string;
  scanned_at: string;
  status: 'success' | 'already' | 'invalid';
}

interface LiveStats {
  total: number;
  checkedIn: number;
  remaining: number;
}

const SCAN_COOLDOWN_MS = 2000;

const Scan = () => {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [pendingTeamScan, setPendingTeamScan] = useState<{ teamId: string, participantData: any, token: string, participantId: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [scanHistory, setScanHistory] = useState<ScanHistoryItem[]>([]);
  const [eventName, setEventName] = useState('');
  const [liveStats, setLiveStats] = useState<LiveStats>({ total: 0, checkedIn: 0, remaining: 0 });
  const scannerRef = useRef<any>(null);
  const lastScanTimeRef = useRef(0);
  const scannerContainerId = 'qr-scanner-viewport';

  // Auth guard
  useEffect(() => {
    if (!loading && !user) navigate('/auth', { replace: true });
    if (!loading && user && profile) {
      if (profile.approval_status !== 'approved') navigate('/pending', { replace: true });
      if (profile.role === 'coordinator' && !profile.assigned_event_id) {
        navigate('/coordinator', { replace: true });
      }
    }
  }, [user, profile, loading, navigate]);

  // Fetch event name & initial stats
  useEffect(() => {
    const fetchEventData = async () => {
      if (!profile) return;
      const eventId = profile.assigned_event_id;
      if (profile.role === 'coordinator' && eventId) {
        const { data } = await supabase.from('events').select('name').eq('id', eventId).single();
        if (data) setEventName(data.name);
      }

      // Fetch live stats
      const targetEventId = eventId;
      if (targetEventId) {
        const { data: participants } = await supabase
          .from('participants')
          .select('id, checked_in')
          .eq('event_id', targetEventId);
        if (participants) {
          const checkedIn = participants.filter(p => p.checked_in).length;
          setLiveStats({ total: participants.length, checkedIn, remaining: participants.length - checkedIn });
        }
      }
    };
    fetchEventData();
  }, [profile]);

  // Realtime stats subscription
  useEffect(() => {
    if (!profile?.assigned_event_id && profile?.role !== 'admin') return;
    const eventId = profile?.assigned_event_id;
    if (!eventId) return;

    const channel = supabase
      .channel('participant-changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'participants', filter: `event_id=eq.${eventId}` },
        () => {
          // Refetch stats on any participant change
          supabase
            .from('participants')
            .select('id, checked_in')
            .eq('event_id', eventId)
            .then(({ data }) => {
              if (data) {
                const checkedIn = data.filter(p => p.checked_in).length;
                setLiveStats({ total: data.length, checkedIn, remaining: data.length - checkedIn });
              }
            });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile]);

  const vibrate = () => {
    if (navigator.vibrate) navigator.vibrate(200);
  };

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
        { fps: 15, qrbox: { width: 250, height: 250 }, aspectRatio: 1, disableFlip: false },
        async (decodedText: string) => {
          const now = Date.now();
          if (now - lastScanTimeRef.current < SCAN_COOLDOWN_MS) return;
          if (isProcessing) return;
          lastScanTimeRef.current = now;
          await handleScan(decodedText, scanner);
        },
        () => {}
      );
    } catch (err) {
      toast({ title: 'Camera Error', description: err instanceof Error ? err.message : 'Could not access camera', variant: 'destructive' });
      setScanning(false);
    }
  };

  const checkInParticipant = async (id: string, name: string, participantId: string) => {
    setIsProcessing(true);
    const { error: updErr } = await supabase
      .from('participants')
      .update({ checked_in: true, checked_in_at: new Date().toISOString() })
      .eq('id', id);

    if (!updErr) {
      setScanResult({ type: 'success', message: 'Checked In Successfully', name, participantId });
      addToHistory(name, 'success');
      toast({ title: '✓ Checked In', description: name });
    } else {
      setScanResult({ type: 'invalid', message: 'Failed to update database' });
    }
    setPendingTeamScan(null);
    setIsProcessing(false);
  };

  const checkInFullTeam = async (teamId: string) => {
    setIsProcessing(true);
    const searchStr = `"team_id":"${teamId}"`;
    const { data: teamMembers } = await supabase
      .from('participants')
      .select('id, name')
      .like('qr_token', `%${searchStr}%`);

    if (teamMembers && teamMembers.length > 0) {
      const ids = teamMembers.map(m => m.id);
      const names = teamMembers.map(m => m.name).join(', ');
      
      const { error } = await supabase
        .from('participants')
        .update({ checked_in: true, checked_in_at: new Date().toISOString() })
        .in('id', ids);
        
      if (!error) {
        setScanResult({ type: 'success', message: `Team ${teamId} Checked In`, name: names, participantId: teamId });
        addToHistory(`Team ${teamId}`, 'success');
        toast({ title: '✓ Team Checked In', description: names });
      } else {
        setScanResult({ type: 'invalid', message: 'Failed to bulk-update database' });
      }
    }
    setPendingTeamScan(null);
    setIsProcessing(false);
  };

  const handleScan = async (decodedText: string, scanner: any) => {
    let payload: { pid?: string; eid?: string; token?: string; sig?: string; participant_id?: string; event_id?: string; qr_token?: string; team_id?: string; };
    try {
      payload = JSON.parse(decodedText);
    } catch {
      setScanResult({ type: 'invalid', message: 'Invalid QR Code' });
      vibrate();
      return;
    }

    setIsProcessing(true);
    try { await scanner.stop(); } catch (e) { console.warn('Failed to stop scanner', e); }
    scannerRef.current = null;
    setScanning(false);

    // 🔥 NEW DIRECT DB FAST-TRACK HANDLING FOR TEAMS
    if (payload.team_id && payload.participant_id && !payload.eid) {
       const { data: pData, error: pErr } = await supabase
         .from('participants')
         .select('*')
         .eq('qr_token', decodedText)
         .single();

       if (pErr || !pData) {
         setScanResult({ type: 'invalid', message: 'Participant not found in database' });
         addToHistory('Unknown', 'invalid');
       } else if (pData.checked_in) {
         setScanResult({ type: 'already', message: 'Already Checked In', name: pData.name, participantId: payload.participant_id });
         addToHistory(pData.name, 'already');
       } else {
         // Is Team Leader?
         if (payload.participant_id.endsWith('A')) {
           setPendingTeamScan({ teamId: payload.team_id, participantData: pData, token: decodedText, participantId: payload.participant_id });
         } else {
           await checkInParticipant(pData.id, pData.name, payload.participant_id);
         }
       }
       setIsProcessing(false);
       vibrate();
       return;
    }

    // LEGACY JSON VALIDATOR
    const pid = payload.pid || payload.participant_id;
    const eid = payload.eid || payload.event_id;
    const token = payload.token || payload.qr_token;
    const sig = payload.sig;

    if (!pid || !eid || !token) {
      setScanResult({ type: 'invalid', message: 'Invalid QR Code' });
      setIsProcessing(false);
      vibrate();
      return;
    }

    // Call edge function for secure validation
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;

    if (!accessToken) {
      setScanResult({ type: 'invalid', message: 'Session expired. Please sign in again.' });
      setIsProcessing(false);
      return;
    }

    const { data, error } = await supabase.functions.invoke('validate-qr', {
      body: { pid, eid, token, sig },
    });

    if (error) {
      setScanResult({ type: 'invalid', message: 'Validation failed' });
      addToHistory('Unknown', 'invalid');
      setIsProcessing(false);
      vibrate();
      return;
    }

    if (data.status === 'success') {
      vibrate();
      setScanResult({
        type: 'success',
        message: data.message,
        name: data.name,
        phone: data.phone || undefined,
        participantId: data.participantId,
      });
      toast({ title: '✓ Checked In', description: data.name });
      addToHistory(data.name, 'success');
    } else if (data.status === 'duplicate') {
      vibrate();
      setScanResult({
        type: 'already',
        message: data.message,
        name: data.name,
        phone: data.phone || undefined,
        participantId: data.participantId,
      });
      addToHistory(data.name || 'Unknown', 'already');
    } else {
      vibrate();
      setScanResult({ type: 'invalid', message: data.message || 'Invalid QR Code' });
      addToHistory('Unknown', 'invalid');
    }

    setIsProcessing(false);
  };

  const addToHistory = (name: string, status: 'success' | 'already' | 'invalid') => {
    setScanHistory(prev => [{
      id: crypto.randomUUID(),
      participant_name: name,
      scanned_at: new Date().toISOString(),
      status,
    }, ...prev].slice(0, 20));
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      scannerRef.current = null;
    }
    setScanning(false);
  };

  useEffect(() => {
    return () => { if (scannerRef.current) { try { scannerRef.current.stop(); } catch {} } };
  }, []);

  if (loading || (user && !profile)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!profile) return null;

  const resultIcon = scanResult?.type === 'success'
    ? <ShieldCheck className="h-8 w-8 text-success" />
    : scanResult?.type === 'already'
    ? <AlertTriangle className="h-8 w-8 text-amber-500" />
    : <ShieldX className="h-8 w-8 text-destructive" />;

  const resultBorderClass = scanResult?.type === 'success'
    ? 'border-success/40 bg-success/5'
    : scanResult?.type === 'already'
    ? 'border-amber-400/40 bg-amber-50'
    : 'border-destructive/40 bg-destructive/5';

  const checkedInPercent = liveStats.total > 0 ? Math.round((liveStats.checkedIn / liveStats.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-background">
      <Navbar profile={profile} onSignOut={signOut} />

      <div className="max-w-lg mx-auto px-4 py-6 sm:py-10">
        {/* Header */}
        <div className="text-center mb-4">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            <span className="bordered-text">QR</span>{' '}
            <span className="highlight-text">Scanner</span>
          </h1>
          {eventName && (
            <p className="text-xs text-muted-foreground font-body mt-2">{eventName}</p>
          )}
        </div>

        {/* Live Stats Bar */}
        {liveStats.total > 0 && (
          <div className="mb-6 p-4 rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <Users className="h-3.5 w-3.5" /> Live Stats
              </div>
              <span className="text-xs font-bold text-foreground">{checkedInPercent}%</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${checkedInPercent}%` }}
              />
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-lg font-bold text-foreground">{liveStats.total}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</p>
              </div>
              <div>
                <p className="text-lg font-bold text-success">{liveStats.checkedIn}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Checked In</p>
              </div>
              <div>
                <p className="text-lg font-bold text-destructive">{liveStats.remaining}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Remaining</p>
              </div>
            </div>
          </div>
        )}

        {/* Scanner Area */}
        <div className="flex flex-col items-center gap-4">
          {!scanning && !scanResult && (
            <Button
              onClick={startScanner}
              size="lg"
              className="rounded-full px-10 text-sm font-semibold tracking-wider gap-2 h-14 w-full max-w-xs"
            >
              <Camera className="h-5 w-5" /> OPEN SCANNER
            </Button>
          )}

          {scanning && (
            <Button
              onClick={stopScanner}
              variant="outline"
              size="lg"
              className="rounded-full px-8 text-sm font-semibold tracking-wider h-12"
            >
              STOP SCANNER
            </Button>
          )}

          <div
            id={scannerContainerId}
            className={`w-full max-w-sm rounded-xl overflow-hidden border border-border ${scanning ? '' : 'hidden'}`}
          />

          {isProcessing && !pendingTeamScan && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground font-body">
              <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              Validating...
            </div>
          )}

          {/* Pending Team Scan Dialog */}
          {pendingTeamScan && (
            <div className="p-6 rounded-xl w-full border-2 border-primary/40 bg-card shadow-lg flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
               <Users className="h-10 w-10 text-primary mb-3" />
               <h3 className="font-bold text-lg text-foreground mb-1">Team Leader Scanned!</h3>
               <p className="text-sm font-body text-muted-foreground mb-4">
                 You scanned <strong>{pendingTeamScan.participantData?.name}</strong>, the leader for team <strong className="font-mono text-primary">{pendingTeamScan.teamId}</strong>.
               </p>
               <div className="w-full flex-col sm:flex-row flex gap-3 mt-2">
                 <Button onClick={() => checkInParticipant(pendingTeamScan.participantData.id, pendingTeamScan.participantData.name, pendingTeamScan.participantId)} variant="outline" className="flex-1 font-semibold">
                   THIS PERSON
                 </Button>
                 <Button onClick={() => checkInFullTeam(pendingTeamScan.teamId)} className="flex-1 font-semibold shadow-md">
                   FULL TEAM
                 </Button>
               </div>
               <Button onClick={() => { setPendingTeamScan(null); startScanner(); }} variant="ghost" className="w-full mt-4 text-xs text-muted-foreground">Cancel</Button>
            </div>
          )}

          {/* Scan Result */}
          {scanResult && !pendingTeamScan && (
            <div className={`p-6 rounded-xl w-full border-2 ${resultBorderClass}`}>
              <div className="flex flex-col items-center gap-3">
                {resultIcon}
                <p className={`font-bold text-base text-center ${
                  scanResult.type === 'success' ? 'text-success' :
                  scanResult.type === 'already' ? 'text-amber-600' :
                  'text-destructive'
                }`}>
                  {scanResult.message}
                </p>
              </div>

              {(scanResult.name || scanResult.phone || scanResult.participantId) && (
                <div className="mt-5 space-y-3 bg-background/50 rounded-lg p-4">
                  {scanResult.name && (
                    <div className="flex items-center gap-3">
                      <User className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Registration Name</p>
                        <p className="text-sm font-bold text-foreground">{scanResult.name}</p>
                      </div>
                    </div>
                  )}
                  {scanResult.phone && (
                    <div className="flex items-center gap-3">
                      <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Phone Number</p>
                        <p className="text-sm font-body text-foreground">{scanResult.phone}</p>
                      </div>
                    </div>
                  )}
                  {scanResult.participantId && (
                    <div className="flex items-center gap-3">
                      <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Unique ID</p>
                        <p className="text-xs font-mono text-muted-foreground">{scanResult.participantId}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <Button
                onClick={() => { setScanResult(null); startScanner(); }}
                size="lg"
                className="w-full mt-5 rounded-full text-sm font-semibold tracking-wider gap-2 h-12"
              >
                <ScanLine className="h-4 w-4" /> SCAN AGAIN
              </Button>
            </div>
          )}
        </div>

        {/* Scan History */}
        {scanHistory.length > 0 && (
          <div className="mt-8">
            <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mb-3 flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" /> RECENT SCANS
            </h3>
            <div className="space-y-2">
              {scanHistory.map(item => (
                <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                  <div className="flex items-center gap-3">
                    <div className={`h-2 w-2 rounded-full ${
                      item.status === 'success' ? 'bg-success' :
                      item.status === 'already' ? 'bg-amber-400' :
                      'bg-destructive'
                    }`} />
                    <span className="text-xs font-medium text-foreground">{item.participant_name}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-body">
                    {new Date(item.scanned_at).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Scan;
