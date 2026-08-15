/**
 * Route shell only. Screens themselves are placeholders (src/pages/PageStub.tsx) built out by
 * feature/pwa-onboarding-auth-screens and feature/pwa-factura-flows.
 *
 * No auth guard yet on purpose: this branch just needs the routes to exist so those branches
 * have somewhere to render into. Redirecting unauthenticated users away from /facturas* (and
 * authenticated users away from /login, /signup) is real product behavior that belongs with the
 * screens that actually implement login state.
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { AppLayout } from './layout/AppLayout';
import { FacturaNuevaPage } from './pages/FacturaNuevaPage';
import { FacturasHistorialPage } from './pages/FacturasHistorialPage';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          <Route element={<AppLayout />}>
            <Route path="/facturas" element={<FacturasHistorialPage />} />
            <Route path="/facturas/nueva" element={<FacturaNuevaPage />} />
          </Route>

          {/* /facturas (historial) is the default authenticated route. */}
          <Route path="/" element={<Navigate to="/facturas" replace />} />
          <Route path="*" element={<Navigate to="/facturas" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
