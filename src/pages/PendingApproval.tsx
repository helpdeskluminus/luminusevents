import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { config } from '@/lib/config';

const PendingApproval = () => {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate('/auth', { replace: true });
    if (!loading && profile?.approval_status === 'approved') navigate('/', { replace: true });
  }, [user, profile, loading, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center space-y-6 max-w-md">
        <h1 className="text-3xl font-bold text-foreground">{config.appName}</h1>
        {profile?.approval_status === 'rejected' ? (
          <>
            <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-destructive font-medium">Your account has been rejected.</p>
              <p className="text-muted-foreground text-sm mt-1">Please contact the administrator.</p>
            </div>
          </>
        ) : (
          <>
            <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
              <p className="text-primary font-medium">Your account is pending approval.</p>
              <p className="text-muted-foreground text-sm mt-1">An administrator will review your account shortly.</p>
            </div>
          </>
        )}
        <Button variant="outline" onClick={signOut}>Sign Out</Button>
      </div>
    </div>
  );
};

export default PendingApproval;
