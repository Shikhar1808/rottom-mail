import { Navigate, Outlet, Route, Routes } from 'react-router';
import { useMe } from './api/hooks';
import { Header } from './components/Header';
import { Spinner } from './components/ui';
import { Compose } from './pages/Compose';
import { Dashboard } from './pages/Dashboard';
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
  return (
    <>
      <Header me={me.data} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </>
  );
}
