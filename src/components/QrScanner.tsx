import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Camera, CameraOff } from 'lucide-react';

interface QrScannerProps {
  onScan: (text: string) => void;
  paused?: boolean;
}

const REGION_ID = 'qr-reader-region';

export const QrScanner = ({ onScan, paused }: QrScannerProps) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanRef = useRef(onScan);
  const pausedRef = useRef(paused);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  onScanRef.current = onScan;
  pausedRef.current = paused;

  const start = async () => {
    setError(null);
    try {
      const scanner = new Html5Qrcode(REGION_ID, { verbose: false });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1 },
        (decoded) => {
          if (!pausedRef.current) onScanRef.current(decoded);
        },
        () => { /* ignore per-frame decode misses */ },
      );
      setActive(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Camera could not be started');
      setActive(false);
    }
  };

  const stop = async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    setActive(false);
    if (scanner) {
      try { await scanner.stop(); } catch { /* already stopped */ }
      try { scanner.clear(); } catch { /* noop */ }
    }
  };

  useEffect(() => () => { void stop(); }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border overflow-hidden bg-muted">
        <div id={REGION_ID} className="w-full aspect-square [&_video]:w-full [&_video]:h-full [&_video]:object-cover" />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Button
        onClick={() => (active ? void stop() : void start())}
        variant={active ? 'outline' : 'default'}
        className="w-full rounded-full text-xs font-semibold tracking-wider"
      >
        {active ? <><CameraOff className="h-4 w-4 mr-1" /> STOP CAMERA</> : <><Camera className="h-4 w-4 mr-1" /> START CAMERA</>}
      </Button>

      <form
        onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { onScanRef.current(manual.trim()); setManual(''); } }}
        className="flex gap-2"
      >
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Or enter ticket code, e.g. TF-XXXXXXXX"
          className="text-xs"
        />
        <Button type="submit" variant="outline" className="rounded-full text-xs font-semibold shrink-0">CHECK</Button>
      </form>
    </div>
  );
};
