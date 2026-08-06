import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

const Auth = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');

  // sign in
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // create account
  const [name, setName] = useState('');
  const [suEmail, setSuEmail] = useState('');
  const [suPassword, setSuPassword] = useState('');
  const [suPassword2, setSuPassword2] = useState('');
  const [suLoading, setSuLoading] = useState(false);
  const [suDone, setSuDone] = useState(false);

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

  const createAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(suEmail.trim())) return toast.error('Enter a valid email');
    if (suPassword.length < 10) return toast.error('Password must be at least 10 characters');
    if (suPassword !== suPassword2) return toast.error('Passwords do not match');

    setSuLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: suEmail.trim(),
      password: suPassword,
      options: { data: { full_name: name.trim() || suEmail.trim() } },
    });
    setSuLoading(false);

    if (error) return toast.error(error.message);
    if (!data.user) return toast.error('Could not create account');

    setSuDone(true);
    // If email confirmation is off, Supabase returns an active session immediately.
    // Either way the account has no role yet, so /staff will correctly show the
    // "awaiting approval" screen rather than a dashboard.
  };

  if (suDone) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
        <Helmet><title>Account created | Techfest Check-in</title></Helmet>
        <div className="w-full max-w-sm text-center">
          <CheckCircle2 className="h-10 w-10 text-primary mx-auto" />
          <h1 className="font-heading text-2xl font-bold tracking-tight mt-4">Account created</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            An admin needs to review your account and assign a role (Admin, Event OC, or
            Disciplinary Committee) before you can sign in to a dashboard. You'll be able to
            sign in below once that's done — if email confirmation is required, check your inbox
            first.
          </p>
          <Button onClick={() => { setSuDone(false); setTab('signin'); }} className="mt-6 rounded-full text-xs font-semibold tracking-wider">
            BACK TO SIGN IN
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
      <Helmet>
        <title>Staff Sign In | Techfest Check-in</title>
        <meta name="description" content="Sign in or request a staff account for Admin, Event OC, and Disciplinary Committee access. New accounts are reviewed and role-assigned by the fest admin." />
      </Helmet>

      <div className="w-full max-w-sm">
        <button onClick={() => navigate('/')} className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-3.5 w-3.5" /> BACK TO SITE
        </button>

        <h1 className="font-heading text-3xl font-bold tracking-tight">Staff access</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          For Admin, Event OC, and Disciplinary Committee members. New accounts are reviewed
          and assigned a role by the fest admin before they can access a dashboard.
        </p>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'signin' | 'signup')} className="mt-8">
          <TabsList className="w-full">
            <TabsTrigger value="signin" className="flex-1">SIGN IN</TabsTrigger>
            <TabsTrigger value="signup" className="flex-1">CREATE ACCOUNT</TabsTrigger>
          </TabsList>

          <TabsContent value="signin" className="mt-6">
            <form onSubmit={signIn} className="space-y-4">
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
          </TabsContent>

          <TabsContent value="signup" className="mt-6">
            <form onSubmit={createAccount} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="su-name">Full name</Label>
                <Input id="su-name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="su-email">Email</Label>
                <Input id="su-email" type="email" required value={suEmail} onChange={(e) => setSuEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="su-password">Password (min 10 characters)</Label>
                <Input id="su-password" type="password" required minLength={10} value={suPassword} onChange={(e) => setSuPassword(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="su-password2">Confirm password</Label>
                <Input id="su-password2" type="password" required minLength={10} value={suPassword2} onChange={(e) => setSuPassword2(e.target.value)} />
              </div>
              <Button type="submit" disabled={suLoading} className="w-full rounded-full text-xs font-semibold tracking-wider">
                {suLoading ? 'CREATING…' : 'CREATE ACCOUNT'}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Your account won't have access to anything until an admin approves it and
                picks your role.
              </p>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Auth;
