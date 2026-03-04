import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { config } from '@/lib/config';

const NotFound = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center space-y-4">
        <h1 className="text-6xl font-bold text-foreground">404</h1>
        <p className="text-muted-foreground">Page not found</p>
        <Button onClick={() => navigate('/')}>{config.appName} Home</Button>
      </div>
    </div>
  );
};

export default NotFound;
