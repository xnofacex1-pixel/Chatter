import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import { LoadingScreen } from './components/LoadingScreen';
import { LogoMark } from './components/Logo';
import { AuthProvider, useAuth } from './lib/auth';
import { CallProvider } from './lib/call-context';
import CallOverlay from './components/CallOverlay';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import Home from './pages/Home';
import Members from './pages/Members';
import Friends from './pages/Friends';
import Messages from './pages/Messages';
import Profile from './pages/Profile';
import ProfileView from './pages/ProfileView';
import Settings from './pages/Settings';
import Servers from './pages/Servers';
import OwnerConsole from './pages/OwnerConsole';
import Notifications from './pages/Notifications';
import NotFound from './pages/NotFound';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the console diagnostic without ever rendering internal details to the user.
    console.error('Chatter UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-page">
        <div className="stack" style={{ alignItems: 'center', textAlign: 'center', maxWidth: 460 }}>
          <LogoMark size={60} />
          <h1 style={{ margin: 0, fontSize: 24 }}>Something broke on this screen</h1>
          <p className="muted" style={{ margin: 0 }}>
            Chatter hit an unexpected interface error. Reloading usually fixes it — your account and messages are safe.
          </p>
          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload Chatter
            </button>
            <a className="btn btn-ghost" href="/">
              Back to home
            </a>
          </div>
        </div>
      </div>
    );
  }
}

function ProtectedRoute({ children }: { children: ReactElement }) {
  const { loading, authenticated } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen label="Preparing Chatter" />;
  if (!authenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function GuestRoute({ children }: { children: ReactElement }) {
  const { loading, authenticated } = useAuth();
  if (loading) return <LoadingScreen label="Preparing Chatter" />;
  if (authenticated) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <CallProvider>
              <CallOverlay />
              <Routes>
              <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
              <Route path="/register" element={<GuestRoute><Register /></GuestRoute>} />
              <Route path="/forgot-password" element={<GuestRoute><ForgotPassword /></GuestRoute>} />
              <Route path="/reset-password" element={<GuestRoute><ResetPassword /></GuestRoute>} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
              <Route path="/members" element={<ProtectedRoute><Members /></ProtectedRoute>} />
              <Route path="/friends" element={<ProtectedRoute><Friends /></ProtectedRoute>} />
              <Route path="/messages" element={<ProtectedRoute><Messages /></ProtectedRoute>} />
              <Route path="/messages/:id" element={<ProtectedRoute><Messages /></ProtectedRoute>} />
              <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              <Route path="/servers" element={<ProtectedRoute><Servers /></ProtectedRoute>} />
              <Route path="/servers/:serverId" element={<ProtectedRoute><Servers /></ProtectedRoute>} />
              <Route path="/servers/:serverId/:channelId" element={<ProtectedRoute><Servers /></ProtectedRoute>} />
              <Route path="/owner" element={<ProtectedRoute><OwnerConsole /></ProtectedRoute>} />
              <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
              <Route path="/u/:username" element={<ProtectedRoute><ProfileView /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </CallProvider>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
