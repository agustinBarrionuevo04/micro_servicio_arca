/**
 * Base mobile-first shell: sticky header + routed content + bottom nav, all respecting the
 * device's safe-area insets (notches / home indicator — see index.html's
 * `viewport-fit=cover` and the --safe-* tokens in src/styles/tokens.css).
 *
 * Wraps only the authenticated-looking routes (/facturas, /facturas/nueva) — see src/App.tsx.
 * Login/signup render without this chrome.
 */

import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import './AppLayout.css';

export function AppLayout() {
  const { usuario } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__brand">Facturador EPSA</span>
        {usuario && <span className="app-header__user">{usuario.razonSocial}</span>}
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <nav className="bottom-nav">
        <NavLink
          to="/facturas"
          className={({ isActive }) => `bottom-nav__link${isActive ? ' active' : ''}`}
          end
        >
          Historial
        </NavLink>
        <NavLink
          to="/facturas/nueva"
          className={({ isActive }) => `bottom-nav__link${isActive ? ' active' : ''}`}
        >
          Nueva factura
        </NavLink>
      </nav>
    </div>
  );
}
