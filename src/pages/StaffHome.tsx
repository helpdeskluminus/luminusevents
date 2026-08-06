import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

const DEST: Record<string, string> = {
  admin: '/admin',
  disciplinary: '/gate',
  event_oc: '/oc',
};

const StaffHome = () => {
  const { user, profile, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
  if (profile?.role) return <Navigate to={DEST[profile.role]} replace />;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <h1 className="font-heading text-2xl font-bold">No role assigned</h1>
      <p className="text-sm text-muted-foreground max-w-sm">
        Your account has no staff role yet. Ask an admin to assign one, then sign in again.
      </p>
      <button onClick={signOut} className="text-xs font-semibold tracking-wider underline">SIGN OUT</button>
    </div>
  );
};

export default StaffHome;
