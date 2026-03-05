import type { UserProfile } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { config } from '@/lib/config';
import { LogOut } from 'lucide-react';

interface NavbarProps {
  profile: UserProfile;
  onSignOut: () => void | Promise<void>;
}

export const Navbar = ({ profile, onSignOut }: NavbarProps) => {
  return (
    <header className="border-b border-border bg-card px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold text-foreground tracking-tight">{config.appName}</h1>
        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium uppercase">
          {profile.role}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">{profile.full_name}</span>
        <Button variant="ghost" size="sm" onClick={onSignOut}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
};
