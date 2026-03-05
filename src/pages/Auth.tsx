import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { config } from '@/lib/config';

type Mode = 'login' | 'signup' | 'forgot';

const Auth = () => {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) navigate('/');
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate('/');
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleLogin = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const handleSignup = async () => {
    if (!fullName.trim()) throw new Error('Full name is required');

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: fullName.trim() },
      },
    });

    if (error) throw error;

    // Trigger auto-creates user record; fallback manual insert
    if (data.user) {
      await supabase.from('users').insert({
        id: data.user.id,
        full_name: fullName.trim(),
        role: 'coordinator',
        approval_status: 'pending',
      }).then(() => {});
    }

    toast({ title: 'Account created', description: 'Please check your email to verify, then wait for admin approval.' });
  };

  const handleForgotPassword = async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
    toast({ title: 'Email sent', description: 'Check your inbox for the password reset link.' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'login') await handleLogin();
      else if (mode === 'signup') await handleSignup();
      else await handleForgotPassword();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      toast({ title: 'Error', description: errorMessage, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground tracking-tight">{config.appName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === 'login' && 'Sign in to your account'}
            {mode === 'signup' && 'Create a new account'}
            {mode === 'forgot' && 'Reset your password'}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <Input
              placeholder="Full Name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="bg-secondary border-border text-foreground"
            />
          )}
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="bg-secondary border-border text-foreground"
          />
          {mode !== 'forgot' && (
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="bg-secondary border-border text-foreground"
            />
          )}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Link'}
          </Button>
        </form>
        <div className="flex flex-col items-center gap-2 text-sm">
          {mode === 'login' && (
            <>
              <button onClick={() => setMode('forgot')} className="text-muted-foreground hover:text-foreground transition-colors">
                Forgot password?
              </button>
              <button onClick={() => setMode('signup')} className="text-muted-foreground hover:text-foreground transition-colors">
                Don't have an account? Sign up
              </button>
            </>
          )}
          {mode !== 'login' && (
            <button onClick={() => setMode('login')} className="text-muted-foreground hover:text-foreground transition-colors">
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Auth;
