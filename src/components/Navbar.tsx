import type { UserProfile } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { config } from "@/lib/config";
import { LogOut, User } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";

interface NavbarProps {
  profile: UserProfile;
  onSignOut: () => void | Promise<void>;
}

export const Navbar = ({ profile, onSignOut }: NavbarProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  const navItems =
    profile.role === "admin"
      ? [
          { label: "DASHBOARD", path: "/admin" },
          { label: "SCAN QR", path: "/scan" },
          { label: "MAIL SEND", path: "/mail" },
        ]
      : [
          { label: "SCANNER", path: "/coordinator" },
          { label: "SCAN QR", path: "/scan" },
          { label: "MAIL SEND", path: "/mail" },
        ];

  return (
    <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2"
          >
            <div className="h-8 w-8 rounded-full bg-foreground flex items-center justify-center">
              <span className="text-background text-xs font-bold">L</span>
            </div>
          </button>

          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`px-4 py-1.5 text-xs font-semibold tracking-wider rounded-full border transition-colors
                  ${
                    location.pathname === item.path
                      ? "border-foreground bg-foreground text-background"
                      : "border-border hover:border-foreground text-foreground"
                  }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-border">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">
              {profile.full_name}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-semibold uppercase">
              {profile.role}
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
