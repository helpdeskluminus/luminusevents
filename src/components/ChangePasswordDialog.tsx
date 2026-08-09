import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { KeyRound } from 'lucide-react';

export const ChangePasswordDialog = () => {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const reset = () => { setCurrent(''); setNext(''); setConfirm(''); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 10) return toast.error('New password must be at least 10 characters');
    if (next !== confirm) return toast.error('New passwords do not match');

    setLoading(true);
    // Re-authenticate with the current password first, so someone who leaves
    // a session open can't be trivially locked out of by a passer-by, and so
    // the person confirms they actually know the current password rather
    // than relying purely on the (still-valid) session token.
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email;
    if (email) {
      const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: current });
      if (reauthError) {
        setLoading(false);
        return toast.error('Current password is incorrect');
      }
    }

    const { error } = await supabase.auth.updateUser({ password: next });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success('Password updated');
    reset();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full text-xs font-semibold tracking-wider border-border hover:border-foreground">
          <KeyRound className="h-3.5 w-3.5 mr-1" />
          PASSWORD
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cp-current">Current password</Label>
            <Input id="cp-current" type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cp-new">New password (min 10 characters)</Label>
            <Input id="cp-new" type="password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cp-confirm">Confirm new password</Label>
            <Input id="cp-confirm" type="password" required minLength={10} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <Button type="submit" disabled={loading} className="w-full rounded-full text-xs font-semibold tracking-wider">
            {loading ? 'UPDATING…' : 'UPDATE PASSWORD'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
