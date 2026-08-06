import type { StaffProfile } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { LogOut, User } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

interface NavbarProps {
  profile: StaffProfile;
  onSignOut: () => void | Promise<void>;
}

const NAV: Record<string, { label: string; path: string }[]> = {
  admin: [
    { label: 'DASHBOARD', path: '/admin' },
    { label: 'GATE SCAN', path: '/scan/gate' },
  ],
  disciplinary: [
    { label: 'LIVE GATE', path: '/gate' },
    { label: 'SCAN', path: '/scan/gate' },
  ],
  event_oc: [
    { label: 'MY COMPETITION', path: '/oc' },
    { label: 'SCAN', path: '/scan/venue' },
  ],
};

export const Navbar = ({ profile, onSignOut }: NavbarProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const navItems = NAV[profile.role ?? ''] ?? [];

  return (
    <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-4 sm:gap-6">
          <button onClick={() => navigate('/staff')} className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-foreground flex items-center justify-center">
              <span className="text-background text-xs font-bold">T</span>
            </div>
          </button>
          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`px-3 sm:px-4 py-1.5 text-[10px] sm:text-xs font-semibold tracking-wider rounded-full border transition-colors
                  ${location.pathname === item.path
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border hover:border-foreground text-foreground'}`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-border">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">{profile.full_name}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-semibold uppercase">
              {(profile.role ?? 'none').replace('_', ' ')}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onSignOut}
            className="rounded-full text-xs font-semibold tracking-wider border-border hover:border-foreground"
          >
            <LogOut className="h-3.5 w-3.5 mr-1" />
            SIGN OUT
          </Button>
        </div>
      </div>
    </header>
  );
};
