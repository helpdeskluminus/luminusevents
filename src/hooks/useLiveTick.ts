import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/** Subscribes to checkins/registrations inserts and bumps a counter the caller can watch. */
export function useLiveTick(tables: string[] = ['checkins']) {
  const [tick, setTick] = useState(0);
  const key = tables.join(',');

  useEffect(() => {
    const channel = supabase.channel(`live-${key}-${Math.random().toString(36).slice(2)}`);
    key.split(',').forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => setTick((t) => t + 1));
    });
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [key]);

  return tick;
}
