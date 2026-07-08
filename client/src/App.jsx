import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage    from './pages/LoginPage';
import Dashboard    from './pages/Dashboard';
import Intelligence from './pages/Intelligence';
import Alerts       from './pages/Alerts';
import Simulator    from './pages/Simulator';
import BlockList    from './pages/BlockList';

const ProtectedRoute = ({ children }) => {
  const { isAuth } = useAuth();
  return isAuth ? children : <Navigate to="/login" replace />;
};

function AppRoutes() {
  const { isAuth } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={isAuth ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route path="/dashboard"    element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/intelligence" element={<ProtectedRoute><Intelligence /></ProtectedRoute>} />
      <Route path="/alerts"       element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
      <Route path="/simulator"    element={<ProtectedRoute><Simulator /></ProtectedRoute>} />
      <Route path="/blocklist"    element={<ProtectedRoute><BlockList /></ProtectedRoute>} />
      <Route path="*"             element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
        <Toaster />
      </BrowserRouter>
    </AuthProvider>
  );
}