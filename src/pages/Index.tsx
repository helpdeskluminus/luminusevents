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
    if (!profile) return;
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
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
};

export default Index;
