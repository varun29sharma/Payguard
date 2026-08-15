import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import HomePage    from './pages/HomePage';
import LoginPage   from './pages/LoginPage';
import Dashboard   from './pages/Dashboard';
import Intelligence from './pages/Intelligence';
import Alerts       from './pages/Alerts';
import Simulator    from './pages/Simulator';
import BlockList    from './pages/BlockList';
import Rules        from './pages/Rules';
import Backtest     from './pages/Backtest';
import Disputes     from './pages/Disputes';
import Mules        from './pages/Mules';

const ProtectedRoute = ({ children }) => {
  const { isAuth } = useAuth();
  return isAuth ? children : <Navigate to="/login" replace />;
};

function AppRoutes() {
  const { isAuth } = useAuth();
  return (
    <Routes>
      <Route path="/"         element={<HomePage />} />
      <Route path="/login"    element={isAuth ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route path="/dashboard"    element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/intelligence" element={<ProtectedRoute><Intelligence /></ProtectedRoute>} />
      <Route path="/alerts"       element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
      <Route path="/simulator"    element={<ProtectedRoute><Simulator /></ProtectedRoute>} />
      <Route path="/blocklist"    element={<ProtectedRoute><BlockList /></ProtectedRoute>} />
      <Route path="/rules"        element={<ProtectedRoute><Rules /></ProtectedRoute>} />
      <Route path="/backtest"     element={<ProtectedRoute><Backtest /></ProtectedRoute>} />
      <Route path="/disputes"     element={<ProtectedRoute><Disputes /></ProtectedRoute>} />
      <Route path="/mules"        element={<ProtectedRoute><Mules /></ProtectedRoute>} />
      <Route path="*"             element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
          <Toaster />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
