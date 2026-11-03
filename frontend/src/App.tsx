import { Navigate, Outlet, Route, Routes } from 'react-router';
import { useMe } from './api/hooks';
import { Spinner } from './components/ui';
import { Compose } from './pages/Compose';
import { Dashboard } from './pages/Dashboard';
import { EmailView } from './pages/EmailView';
import { Login } from './pages/Login';
import { Privacy } from './pages/Privacy';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route element={<SignedIn />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/compose" element={<Compose />} />
        <Route path="/emails/:id" element={<EmailView />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

/** Pages behind login. The session lives in an HttpOnly cookie, so /api/me is the only way to know who's signed in. */
function SignedIn() {
  const me = useMe();
  if (me.isPending) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Loading" />
      </div>
    );
  }
  if (!me.data) return <Navigate to="/login" replace />;
  return <Outlet />; // each page brings its own layout, as in the Figma
}
