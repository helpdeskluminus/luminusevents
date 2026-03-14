import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Navbar } from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { ScanLine, Camera, ShieldCheck, ShieldX, AlertTriangle, Clock, User, Phone, Hash } from 'lucide-react';

interface Html5Qrcode {
  start(config: unknown, videoConstraints: unknown, onScan: (text: string) => void, onError: () => void): Promise<void>;
  stop(): Promise<void>;
}

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

const Scan = () => {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [scanHistory, setScanHistory] = useState<ScanHistoryItem[]>([]);
  const [eventName, setEventName] = useState<string>('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = 'qr-scanner-viewport';

  useEffect(() => {
    if (!loading && !user) navigate('/auth', { replace: true });
    if (!loading && user && profile) {
      if (profile.approval_status !== 'approved') navigate('/pending', { replace: true });
      // Both admin and coordinator can access scan page
      if (profile.role === 'coordinator' && !profile.assigned_event_id) {
        navigate('/coordinator', { replace: true });
      }
    }
  }, [user, profile, loading, navigate]);

  // Fetch event name
  useEffect(() => {
    const fetchEvent = async () => {
      if (!profile?.assigned_event_id && profile?.role !== 'admin') return;
      if (profile?.role === 'coordinator' && profile.assigned_event_id) {
        const { data } = await supabase.from('events').select('name').eq('id', profile.assigned_event_id).single();
        if (data) setEventName(data.name);
      }
    };
    fetchEvent();
  }, [profile]);

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
          await handleScan(decodedText, scanner);
        },
        () => {}
      );
    } catch (err) {
      toast({ title: 'Camera Error', description: err instanceof Error ? err.message : 'Could not access camera', variant: 'destructive' });
      setScanning(false);
    }
  };

  const handleScan = async (decodedText: string, scanner: Html5Qrcode) => {
    let payload: { participant_id?: string; event_id?: string; qr_token?: string };
    try {
      payload = JSON.parse(decodedText);
    } catch {
      setScanResult({ type: 'invalid', message: 'Invalid QR Code' });
      return;
    }

    if (!payload.participant_id || !payload.event_id || !payload.qr_token) {
      setScanResult({ type: 'invalid', message: 'Invalid QR Code' });
      return;
    }

    setIsProcessing(true);
    try {
      await scanner.stop();
    } catch {}
    scannerRef.current = null;
    setScanning(false);

    // Validate against Supabase
    const { data: participant, error: fetchErr } = await supabase
      .from('participants')
      .select('id, event_id, qr_token, name, phone, checked_in')
      .eq('id', payload.participant_id)
      .eq('event_id', payload.event_id)
      .eq('qr_token', payload.qr_token)
      .single();

    if (fetchErr || !participant) {
      setScanResult({ type: 'invalid', message: 'Invalid QR Code' });
      addToHistory('Unknown', 'invalid');
      setIsProcessing(false);
      return;
    }

    if (participant.checked_in) {
      setScanResult({
        type: 'already',
        message: 'Participant Already Checked In',
        name: participant.name,
        phone: participant.phone || undefined,
        participantId: participant.id,
      });
      addToHistory(participant.name, 'already');
      setIsProcessing(false);
      return;
    }

    // Atomic check-in via RPC
    const { data, error } = await supabase.rpc('checkin_participant', {
      _participant_id: payload.participant_id,
      _event_id: payload.event_id,
      _qr_token: payload.qr_token,
    });

    if (error) {
      setScanResult({ type: 'invalid', message: error.message });
      setIsProcessing(false);
      return;
    }

    const result = data as { success: boolean; error?: string };
    if (result.success) {
      setScanResult({
        type: 'success',
        message: 'Check-in Successful!',
        name: participant.name,
        phone: participant.phone || undefined,
        participantId: participant.id,
      });
      toast({ title: '✓ Checked In', description: participant.name });
      addToHistory(participant.name, 'success');

      // Log to checkins table
      if (user) {
        await supabase.from('checkins').insert({
          participant_id: participant.id,
          event_id: participant.event_id,
          scanned_by: user.id,
        });
      }
    } else {
      setScanResult({ type: 'invalid', message: result.error || 'Check-in failed' });
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

  return (
    <div className="min-h-screen bg-background">
      <Navbar profile={profile} onSignOut={signOut} />

      <div className="max-w-lg mx-auto px-4 py-6 sm:py-10">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            <span className="bordered-text">QR</span>{' '}
            <span className="highlight-text">Scanner</span>
          </h1>
          {eventName && (
            <p className="text-xs text-muted-foreground font-body mt-2">{eventName}</p>
          )}
        </div>

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

          {/* Camera viewport */}
          <div
            id={scannerContainerId}
            className={`w-full max-w-sm rounded-xl overflow-hidden border border-border ${scanning ? '' : 'hidden'}`}
          />

          {/* Processing indicator */}
          {isProcessing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground font-body">
              <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              Validating...
            </div>
          )}

          {/* Scan Result */}
          {scanResult && (
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
