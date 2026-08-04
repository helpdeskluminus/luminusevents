import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import PendingApproval from "./pages/PendingApproval";
import AdminDashboard from "./pages/AdminDashboard";
import AdminReconciliation from "./pages/AdminReconciliation";
import CoordinatorDashboard from "./pages/CoordinatorDashboard";
import Scan from "./pages/Scan";
import NotFound from "./pages/NotFound";

const App = () => (
  <TooltipProvider>
    <Toaster />
    <Sonner />
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/auth" element={<Auth />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/pending" element={<PendingApproval />} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="/admin/reconciliation" element={<AdminReconciliation />} />
      <Route path="/coordinator" element={<CoordinatorDashboard />} />
      <Route path="/scan" element={<Scan />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </TooltipProvider>
);

export default App;
