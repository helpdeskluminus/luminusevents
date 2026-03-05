import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

export interface UserProfile {
  id: string;
  full_name: string;
  role: 'admin' | 'coordinator';
  assigned_event_id: string | null;
  approval_status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (authUser: User): Promise<UserProfile | null> => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      const typed = data as unknown as UserProfile;
      setProfile(typed);
      return typed;
    }

    const fullName = (authUser.user_metadata?.full_name as string | undefined)?.trim() || authUser.email?.split('@')[0] || 'New User';
    await supabase.from('users').insert({
      id: authUser.id,
      full_name: fullName,
      role: 'coordinator',
      approval_status: 'pending',
    });

    const { data: created } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();

    const typed = (created as unknown as UserProfile) || null;
    setProfile(typed);
    return typed;
  }, []);

  useEffect(() => {
    let mounted = true;

    const syncAuthState = async (sessionUser: User | null) => {
      if (!mounted) return;
      setLoading(true);

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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncAuthState(session?.user ?? null);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      void syncAuthState(session?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return {
    user,
    profile,
    loading,
    signOut,
    isAdmin: profile?.role === 'admin',
    isApproved: profile?.approval_status === 'approved',
    refreshProfile: () => user ? fetchProfile(user) : null,
  };
}

