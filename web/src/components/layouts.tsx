import { useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { DemoRibbon, Spinner } from './ui';

function Brand({ dark = true }: { dark?: boolean }) {
  return (
    <Link to="/" className="brand" style={dark ? undefined : { color: 'var(--navy-800)' }} aria-label="MHM SMS — laman utama">
      <span className="logo">MHM</span>
      <span>
        MHM SMS<small>oleh MHM CENTER</small>
      </span>
    </Link>
  );
}

export function PublicLayout() {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const links = [
    ['/harga', 'Harga & Stok'],
    ['/cara-guna', 'Cara Guna'],
    ['/soalan-lazim', 'Soalan Lazim'],
    ['/hubungi', 'Hubungi'],
  ];
  return (
    <>
      <DemoRibbon />
      <header className="site-header">
        <div className="container inner">
          <Brand />
          <nav className="nav" aria-label="Navigasi utama">
            {links.map(([to, l]) => (
              <NavLink key={to} to={to}>
                {l}
              </NavLink>
            ))}
            {user ? (
              <Link to="/akaun" className="btn btn-primary btn-sm">
                Akaun Saya
              </Link>
            ) : (
              <>
                <NavLink to="/masuk">Log Masuk</NavLink>
                <Link to="/daftar" className="btn btn-primary btn-sm">
                  Daftar
                </Link>
              </>
            )}
          </nav>
          <button className="menu-btn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
            ☰
          </button>
        </div>
        {open && (
          <div className="mobile-nav" onClick={() => setOpen(false)}>
            {links.map(([to, l]) => (
              <Link key={to} to={to}>
                {l}
              </Link>
            ))}
            {user ? <Link to="/akaun">Akaun Saya</Link> : <><Link to="/masuk">Log Masuk</Link><Link to="/daftar">Daftar Akaun</Link></>}
          </div>
        )}
      </header>
      <main key={loc.pathname}>
        <Outlet />
      </main>
      <Footer />
    </>
  );
}

function Footer() {
  const { config } = useSession();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="cols">
          <div>
            <div style={{ color: '#fff', fontWeight: 800, marginBottom: 6 }}>MHM SMS</div>
            <p className="small">Servis nombor maya sementara untuk menerima SMS pengesahan. Dikendalikan oleh MHM CENTER. Nombor dibekalkan oleh pembekal pihak ketiga.</p>
          </div>
          <div className="stack small">
            <div><Link to="/terma">Terma Penggunaan</Link></div>
            <div><Link to="/privasi">Dasar Privasi</Link></div>
            <div><Link to="/polisi-refund">Polisi Refund</Link></div>
          </div>
          <div className="stack small">
            <div><Link to="/soalan-lazim">Soalan Lazim</Link></div>
            <div><Link to="/hubungi">Hubungi Support</Link></div>
            {config?.supportEmail && <div>{config.supportEmail}</div>}
          </div>
        </div>
        <div className="small" style={{ marginTop: 28, color: '#6f82a1' }}>© {new Date().getFullYear()} MHM CENTER. Hak cipta terpelihara.</div>
      </div>
    </footer>
  );
}

export function RequireAuth({ admin = false }: { admin?: boolean }) {
  const { user, loading } = useSession();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to={`/masuk?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/akaun" replace />;
  return <Outlet />;
}

export function AppLayout() {
  const { user, logout } = useSession();
  const nav = useNavigate();
  return (
    <>
      <DemoRibbon />
      <header className="app-header">
        <div className="container inner">
          <Brand dark={false} />
          <div className="row" style={{ gap: 8 }}>
            {user?.role === 'admin' && (
              <Link to="/admin" className="btn btn-ghost btn-sm">
                Admin
              </Link>
            )}
            <Link to="/akaun/tetapan" className="btn btn-ghost btn-sm" title={user?.email}>
              Akaun
            </Link>
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                await logout();
                nav('/');
              }}
            >
              Log Keluar
            </button>
          </div>
        </div>
      </header>
      <main className="container" style={{ paddingBottom: 60 }}>
        <Outlet />
      </main>
    </>
  );
}

export function DashboardTabs() {
  return (
    <div className="tabs" role="tablist">
      <NavLink to="/akaun" end>
        Beli Nombor
      </NavLink>
      <NavLink to="/akaun/aktif">Pesanan Aktif</NavLink>
      <NavLink to="/akaun/sejarah">Sejarah</NavLink>
    </div>
  );
}

export function AdminLayout() {
  const links: [string, string, boolean?][] = [
    ['/admin', 'Ringkasan', true],
    ['/admin/pesanan', 'Pesanan'],
    ['/admin/pelanggan', 'Pelanggan'],
    ['/admin/harga', 'Harga & Katalog'],
    ['/admin/refund', 'Refund'],
    ['/admin/laporan', 'Laporan'],
    ['/admin/audit', 'Audit Log'],
  ];
  return (
    <>
      <DemoRibbon />
      <div className="admin-layout">
        <aside className="admin-side">
          <div style={{ marginBottom: 12 }}>
            <Brand />
          </div>
          <nav aria-label="Navigasi admin">
            {links.map(([to, l, end]) => (
              <NavLink key={to} to={to} end={end}>
                {l}
              </NavLink>
            ))}
            <Link to="/akaun">← Ke papan pelanggan</Link>
          </nav>
        </aside>
        <div className="admin-main">
          <Outlet />
        </div>
      </div>
    </>
  );
}
