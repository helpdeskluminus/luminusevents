import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

const Index = () => {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/auth', { replace: true });
      return;
    }
    // If profile failed to load, go to pending (will show error or re-fetch)
    if (!profile) {
      navigate('/pending', { replace: true });
      return;
    }
    if (profile.approval_status !== 'approved') {
      navigate('/pending', { replace: true });
      return;
    }
    if (profile.role === 'admin') {
      navigate('/admin', { replace: true });
    } else {
      navigate('/coordinator', { replace: true });
    }
  }, [user, profile, loading, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground font-body">Loading...</p>
      </div>
    </div>
  );
};

export default Index;
