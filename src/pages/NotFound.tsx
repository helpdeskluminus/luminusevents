import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

const NotFound = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center space-y-6">
        <h1 className="text-7xl font-bold text-foreground">
          <span className="bordered-text">4</span>
          <span className="highlight-text">0</span>
          <span className="bordered-text">4</span>
        </h1>
        <p className="text-sm text-muted-foreground font-body">Page not found</p>
        <Button onClick={() => navigate('/')} className="rounded-full px-8 text-xs font-semibold tracking-wider gap-2">
          GO HOME <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
