import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import CompetitionDetail from "./pages/CompetitionDetail";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import AdminDashboard from "./pages/AdminDashboard";
import GateDashboard from "./pages/GateDashboard";
import OcDashboard from "./pages/OcDashboard";
import ScanGate from "./pages/ScanGate";
import ScanVenue from "./pages/ScanVenue";
import StaffHome from "./pages/StaffHome";
import NotFound from "./pages/NotFound";

const App = () => (
  <TooltipProvider>
    <Toaster />
    <Sonner />
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/c/:id" element={<CompetitionDetail />} />
      <Route path="/auth" element={<Auth />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/staff" element={<StaffHome />} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="/gate" element={<GateDashboard />} />
      <Route path="/oc" element={<OcDashboard />} />
      <Route path="/scan/gate" element={<ScanGate />} />
      <Route path="/scan/venue" element={<ScanVenue />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </TooltipProvider>
);

export default App;
