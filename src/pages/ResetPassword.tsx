import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { config } from '@/lib/config';
import { ArrowRight } from 'lucide-react';

const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('type=recovery')) setIsRecovery(true);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast({ title: 'Password updated', description: 'You can now sign in with your new password.' });
      navigate('/auth');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      toast({ title: 'Error', description: errorMessage, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (!isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center space-y-6">
          <h1 className="text-4xl font-bold text-foreground">
            <span className="bordered-text">Invalid</span>{' '}
            <span className="highlight-text">link</span>
          </h1>
          <p className="text-sm text-muted-foreground font-body">Invalid or expired reset link.</p>
          <Button onClick={() => navigate('/auth')} className="rounded-full px-8 text-xs font-semibold tracking-wider gap-2">
            BACK TO SIGN IN <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-10">
        <div className="text-center space-y-4">
          <h1 className="text-5xl font-bold tracking-tight text-foreground">
            <span className="bordered-text">New</span>{' '}
            <span className="highlight-text">password</span>
          </h1>
          <p className="text-sm text-muted-foreground font-body">Enter your new password below.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            type="password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="h-12 rounded-full px-5 bg-secondary border-border text-foreground font-body"
          />
          <Button type="submit" disabled={loading} className="w-full h-12 rounded-full text-sm font-semibold tracking-wider gap-2">
            {loading ? 'Updating...' : 'UPDATE PASSWORD'}
            {!loading && <ArrowRight className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;
