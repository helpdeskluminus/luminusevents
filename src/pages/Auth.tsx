import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft } from 'lucide-react';

const Auth = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate('/staff', { replace: true });
    });
  }, [navigate]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate('/staff', { replace: true });
  };

  const resetPassword = async () => {
    if (!email.trim()) return toast.error('Enter your email first');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error(error.message);
    else toast.success('Password reset link sent.');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
      <Helmet>
        <title>Staff Login | Techfest Check-in</title>
        <meta name="description" content="Secure sign-in for techfest admin, disciplinary and event OC staff accounts." />
      </Helmet>

      <div className="w-full max-w-sm">
        <button onClick={() => navigate('/')} className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-3.5 w-3.5" /> BACK TO SITE
        </button>

        <h1 className="font-heading text-3xl font-bold tracking-tight">Staff login</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Accounts are created by the admin. There is no public sign-up.
        </p>

        <form onSubmit={signIn} className="mt-8 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" disabled={loading} className="w-full rounded-full text-xs font-semibold tracking-wider">
            {loading ? 'SIGNING IN…' : 'SIGN IN'}
          </Button>
          <button type="button" onClick={resetPassword} className="w-full text-xs text-muted-foreground hover:text-foreground">
            Forgot password?
          </button>
        </form>
      </div>
    </div>
  );
};

export default Auth;
