import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { config } from '@/lib/config';
import { Clock, XCircle } from 'lucide-react';

const PendingApproval = () => {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate('/auth', { replace: true });
    if (!loading && profile?.approval_status === 'approved') navigate('/', { replace: true });
  }, [user, profile, loading, navigate]);

  const isRejected = profile?.approval_status === 'rejected';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center space-y-8 max-w-md">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-full border-2 border-border mx-auto">
          {isRejected ? (
            <XCircle className="h-8 w-8 text-destructive" />
          ) : (
            <Clock className="h-8 w-8 text-primary" />
          )}
        </div>

        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-foreground tracking-tight">
            {isRejected ? (
              <>
                <span className="bordered-text">Access</span>{' '}
                <span className="bg-destructive text-destructive-foreground rounded-full px-6 py-2 inline-block">denied</span>
              </>
            ) : (
              <>
                <span className="bordered-text">Pending</span>{' '}
                <span className="highlight-text">approval</span>
              </>
            )}
          </h1>
          <p className="text-sm text-muted-foreground font-body mt-4">
            {isRejected
              ? 'Your account has been rejected. Please contact the administrator.'
              : 'An administrator will review your account shortly.'}
          </p>
        </div>

        <Button
          variant="outline"
          onClick={signOut}
          className="rounded-full px-8 text-xs font-semibold tracking-wider"
        >
          SIGN OUT
        </Button>
      </div>
    </div>
  );
};

export default PendingApproval;
