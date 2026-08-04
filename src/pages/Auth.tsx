import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { config } from '@/lib/config';
import { ArrowRight } from 'lucide-react';

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
    <div className="min-h-screen flex flex-col bg-background">
      {/* Nav */}
      <header className="px-6 py-4 flex items-center gap-6">
        <div className="h-8 w-8 rounded-full bg-foreground flex items-center justify-center">
          <span className="text-background text-xs font-bold">L</span>
        </div>
        <nav className="flex gap-1">
          <button
            onClick={() => setMode('login')}
            className={`px-4 py-1.5 text-xs font-semibold tracking-wider rounded-full border transition-colors
              ${mode === 'login' ? 'border-foreground bg-foreground text-background' : 'border-border hover:border-foreground text-foreground'}`}
          >
            SIGN IN
          </button>
          <button
            onClick={() => setMode('signup')}
            className={`px-4 py-1.5 text-xs font-semibold tracking-wider rounded-full border transition-colors
              ${mode === 'signup' ? 'border-foreground bg-foreground text-background' : 'border-border hover:border-foreground text-foreground'}`}
          >
            CREATE ACCOUNT
          </button>
        </nav>
      </header>

      {/* Hero */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-md space-y-10">
          <div className="text-center space-y-4">
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-foreground leading-none">
              {mode === 'login' && (
                <>
                  <span className="bordered-text">Welcome</span>{' '}
                  <span className="highlight-text">back</span>
                </>
              )}
              {mode === 'signup' && (
                <>
                  <span className="bordered-text">Join</span>{' '}
                  <span className="highlight-text">{config.appName}</span>
                </>
              )}
              {mode === 'forgot' && (
                <>
                  <span className="bordered-text">Reset</span>{' '}
                  <span className="highlight-text">password</span>
                </>
              )}
            </h1>
            <p className="text-sm text-muted-foreground font-body max-w-xs mx-auto">
              {mode === 'login' && 'Sign in to manage events and check-ins.'}
              {mode === 'signup' && 'Create your coordinator account to get started.'}
              {mode === 'forgot' && 'Enter your email to receive a reset link.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'signup' && (
              <Input
                placeholder="Full Name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="h-12 rounded-full px-5 bg-secondary border-border text-foreground font-body"
              />
            )}
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-12 rounded-full px-5 bg-secondary border-border text-foreground font-body"
            />
            {mode !== 'forgot' && (
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="h-12 rounded-full px-5 bg-secondary border-border text-foreground font-body"
              />
            )}
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-full text-sm font-semibold tracking-wider gap-2"
            >
              {loading ? 'Please wait...' : mode === 'login' ? 'SIGN IN' : mode === 'signup' ? 'CREATE ACCOUNT' : 'SEND RESET LINK'}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <div className="flex flex-col items-center gap-3 text-xs font-body">
            {mode === 'login' && (
              <>
                <button onClick={() => setMode('forgot')} className="text-muted-foreground hover:text-foreground transition-colors">
                  Forgot password?
                </button>
                <button onClick={() => setMode('signup')} className="text-muted-foreground hover:text-foreground transition-colors">
                  Don't have an account? <span className="text-primary font-semibold">Sign up</span>
                </button>
              </>
            )}
            {mode !== 'login' && (
              <button onClick={() => setMode('login')} className="text-muted-foreground hover:text-foreground transition-colors">
                ← Back to sign in
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
