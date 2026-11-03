import { useEffect } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { AdminLayout, AppLayout, PublicLayout, RequireAuth } from './components/layouts';
import { SessionProvider } from './lib/session';
import { AdminAudit, AdminCustomers, AdminOrderDetail, AdminOrders, AdminOverview, AdminPricing, AdminRefunds, AdminReports } from './pages/admin';
import { ForgotPassword, Login, Register, ResetPassword } from './pages/auth';
import { AccountSettings, ActiveOrders, BuyNumber, DemoPay, OrderDetail, OrderHistory, PaymentReturn } from './pages/customer';
import { Contact, Faq, Home, HowTo, Pricing, Privacy, RefundPolicy, Terms } from './pages/public';

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function NotFound() {
  return (
    <section className="section">
      <div className="container narrow center">
        <h1>Halaman tidak dijumpai</h1>
        <p className="muted">Pautan mungkin salah atau halaman telah dipindahkan.</p>
        <Link className="btn btn-navy" to="/">Ke laman utama</Link>
      </div>
    </section>
  );
}

export function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <ScrollTop />
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<Home />} />
            <Route path="harga" element={<Pricing />} />
            <Route path="cara-guna" element={<HowTo />} />
            <Route path="soalan-lazim" element={<Faq />} />
            <Route path="hubungi" element={<Contact />} />
            <Route path="terma" element={<Terms />} />
            <Route path="privasi" element={<Privacy />} />
            <Route path="polisi-refund" element={<RefundPolicy />} />
            <Route path="masuk" element={<Login />} />
            <Route path="daftar" element={<Register />} />
            <Route path="lupa-kata-laluan" element={<ForgotPassword />} />
            <Route path="reset-kata-laluan" element={<ResetPassword />} />
            <Route element={<RequireAuth />}>
              <Route path="demo-bayar/:billCode" element={<DemoPay />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route path="akaun" element={<BuyNumber />} />
              <Route path="akaun/aktif" element={<ActiveOrders />} />
              <Route path="akaun/sejarah" element={<OrderHistory />} />
              <Route path="akaun/pesanan/:id" element={<OrderDetail />} />
              <Route path="akaun/tetapan" element={<AccountSettings />} />
              <Route path="bayar/kembali" element={<PaymentReturn />} />
            </Route>
          </Route>
          <Route element={<RequireAuth admin />}>
            <Route element={<AdminLayout />}>
              <Route path="admin" element={<AdminOverview />} />
              <Route path="admin/pesanan" element={<AdminOrders />} />
              <Route path="admin/pesanan/:id" element={<AdminOrderDetail />} />
              <Route path="admin/pelanggan" element={<AdminCustomers />} />
              <Route path="admin/harga" element={<AdminPricing />} />
              <Route path="admin/refund" element={<AdminRefunds />} />
              <Route path="admin/laporan" element={<AdminReports />} />
              <Route path="admin/audit" element={<AdminAudit />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
