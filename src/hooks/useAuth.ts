import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

export type AppRole = 'admin' | 'disciplinary' | 'event_oc' | 'gate_staff';

export interface StaffProfile {
  id: string;
  full_name: string;
  email: string | null;
  position: string | null;
  role: AppRole | null;
  competition_id: string | null;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (authUser: User): Promise<StaffProfile | null> => {
    const [{ data: prof }, { data: roles }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, position').eq('id', authUser.id).maybeSingle(),
      supabase.from('user_roles').select('role, competition_id').eq('user_id', authUser.id),
    ]);

    const primary = (roles ?? [])[0] ?? null;
    const next: StaffProfile = {
      id: authUser.id,
      full_name: prof?.full_name ?? (authUser.user_metadata?.full_name as string) ?? authUser.email ?? 'Staff',
      email: prof?.email ?? authUser.email ?? null,
      position: prof?.position ?? null,
      role: (primary?.role as AppRole) ?? null,
      competition_id: primary?.competition_id ?? null,
    };
    setProfile(next);
    return next;
  }, []);

  useEffect(() => {
    let mounted = true;

    const sync = async (sessionUser: User | null) => {
      if (!mounted) return;
      if (!sessionUser) {
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }
      setUser(sessionUser);
      try {
        await fetchProfile(sessionUser);
      } catch {
        setProfile(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      void sync(session?.user ?? null);
    });
    supabase.auth.getSession().then(({ data: { session } }) => void sync(session?.user ?? null));

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  return {
    user,
    profile,
    loading,
    signOut: async () => { await supabase.auth.signOut(); },
    isAdmin: profile?.role === 'admin',
    isDisciplinary: profile?.role === 'disciplinary',
    isEventOC: profile?.role === 'event_oc',
    isGateStaff: profile?.role === 'gate_staff',
    refreshProfile: () => (user ? fetchProfile(user) : null),
  };
}
