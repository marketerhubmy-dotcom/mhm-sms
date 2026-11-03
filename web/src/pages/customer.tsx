import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CatalogBrowser, type Country, type Service } from '../components/Catalog';
import { DashboardTabs } from '../components/layouts';
import { CopyButton, Empty, ErrorBox, Field, fmtDuration, Spinner, StatusBadge, useServerClock } from '../components/ui';
import { api, ApiError, dt, rm, type OrderView } from '../lib/api';
import { useSession } from '../lib/session';

// ---------------------------------------------------------------------------
// Beli Nombor
// ---------------------------------------------------------------------------
export function BuyNumber() {
  const { config, user } = useSession();
  const [sel, setSel] = useState<{ country: Country; service: Service } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [agree, setAgree] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  async function confirm() {
    if (!sel) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ order: OrderView; paymentUrl: string }>('/orders', {
        method: 'POST',
        body: { countryCode: sel.country.code, serviceSlug: sel.service.slug, expectedPriceSen: sel.service.priceSen },
      });
      window.location.assign(r.paymentUrl);
    } catch (e) {
      const ae = e instanceof ApiError ? e : new ApiError(0, 'ERROR', 'Pesanan gagal dibuat.');
      if (ae.code === 'PRICE_CHANGED' && typeof ae.data.priceSen === 'number') {
        setSel({ ...sel, service: { ...sel.service, priceSen: ae.data.priceSen as number } });
      }
      setErr(ae);
      setBusy(false);
    }
  }

  return (
    <>
      <DashboardTabs />
      <div className="row between" style={{ marginBottom: 6 }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>Hai, {user?.name.split(' ')[0]} 👋</h2>
          <p className="muted small" style={{ margin: 0 }}>Pilih negara dan servis untuk menerima SMS pengesahan.</p>
        </div>
      </div>
      {config && !config.salesOpen && <div className="alert alert-warn" style={{ margin: '14px 0' }}>Pembelian belum dibuka buat masa ini. Harga dipaparkan untuk rujukan.</div>}
      <div className="buy-grid">
        <div className="card">
          <CatalogBrowser
            selected={sel}
            onSelect={(country, service) => {
              setSel({ country, service });
              setErr(null);
              if (window.innerWidth < 900) setTimeout(() => summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
            }}
          />
        </div>
        <div className="card card-lg buy-summary" aria-live="polite" ref={summaryRef}>
          {!sel ? (
            <p className="muted" style={{ margin: 0 }}>Pilih satu servis daripada senarai di atas untuk meneruskan.</p>
          ) : (
            <div className="stack">
              <div className="row between">
                <div>
                  <div className="small muted">Pesanan anda</div>
                  <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{sel.service.name} · {sel.country.name}</div>
                </div>
                <div className="price" style={{ fontSize: '1.4rem' }}>{rm(sel.service.priceSen)}</div>
              </div>
              <ul className="small muted" style={{ paddingLeft: 18, margin: 0 }}>
                <li>Satu nombor sementara untuk menerima SMS daripada {sel.service.name} sahaja.</li>
                <li>Stok dan harga akan disahkan semula sebelum bayaran.</li>
                <li>Tidak semua platform menerima nombor maya; penghantaran SMS tidak dijamin.</li>
              </ul>
              <label className="check small">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>Saya faham dan bersetuju dengan <Link to="/polisi-refund" target="_blank">polisi refund</Link>.</span>
              </label>
              {err && (
                <div className={`alert ${err.code === 'PRICE_CHANGED' ? 'alert-warn' : 'alert-error'}`} role="alert">
                  {err.message}
                </div>
              )}
              <button className="btn btn-primary btn-block" disabled={!agree || busy || !config?.salesOpen} onClick={confirm}>
                {busy ? 'Menyediakan pembayaran…' : `Sahkan & Bayar ${rm(sel.service.priceSen)}`}
              </button>
              {(config?.mode === 'demo' || config?.paymentMode === 'test') && (
                <div className="small center muted">
                  <span className="demo-tag">{config.paymentMode === 'test' ? 'UJIAN' : 'DEMO'}</span>{' '}
                  {config.paymentMode === 'test' ? 'Halaman CHIP mod ujian: guna kad 4444 3333 2222 1111, CVC 123.' : 'Pembayaran akan disimulasikan.'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Senarai pesanan
// ---------------------------------------------------------------------------
function useOrders(scope: 'active' | 'history', pollMs?: number) {
  const [orders, setOrders] = useState<OrderView[] | null>(null);
  const [serverNow, setServerNow] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    api<{ orders: OrderView[]; serverNow: number }>(`/orders?scope=${scope}`)
      .then((r) => {
        setOrders(r.orders);
        setServerNow(r.serverNow);
        setError(null);
      })
      .catch(setError);
  }, [scope]);
  useEffect(() => {
    load();
    if (!pollMs) return;
    const t = setInterval(() => document.visibilityState === 'visible' && load(), pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);
  return { orders, serverNow, error, reload: load };
}

function OrderRow({ o, now }: { o: OrderView; now: number }) {
  const left = o.status === 'active' && o.numberExpiresAt ? o.numberExpiresAt - now : null;
  return (
    <Link to={`/akaun/pesanan/${o.id}`} className="svc-item" style={{ textDecoration: 'none' }}>
      <div style={{ minWidth: 0 }}>
        <div className="svc-name">
          {o.serviceName} · {o.countryName} {o.mode === 'demo' && <span className="demo-tag">DEMO</span>}
        </div>
        <div className="svc-meta mono">{o.phoneNumber ?? o.ref}</div>
        <div className="svc-meta">{dt(o.createdAt)}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <StatusBadge status={o.status} label={o.statusLabel} />
        <div className="small" style={{ marginTop: 4 }}>
          {left != null ? <span className="timer">{fmtDuration(left)}</span> : <span className="price">{rm(o.priceSen)}</span>}
        </div>
      </div>
    </Link>
  );
}

export function ActiveOrders() {
  const { orders, serverNow, error, reload } = useOrders('active', 8000);
  const now = useServerClock(serverNow);
  return (
    <>
      <DashboardTabs />
      <h2>Pesanan Aktif</h2>
      {error ? <ErrorBox error={error} onRetry={reload} /> : !orders ? <Spinner /> : !orders.length ? (
        <div className="card"><Empty icon="📱" title="Tiada pesanan aktif">
          <Link to="/akaun">Beli nombor baharu</Link>
        </Empty></div>
      ) : (
        <div className="svc-list">{orders.map((o) => <OrderRow key={o.id} o={o} now={now} />)}</div>
      )}
    </>
  );
}

export function OrderHistory() {
  const { orders, serverNow, error, reload } = useOrders('history');
  const now = useServerClock(serverNow);
  return (
    <>
      <DashboardTabs />
      <h2>Sejarah</h2>
      {error ? <ErrorBox error={error} onRetry={reload} /> : !orders ? <Spinner /> : !orders.length ? (
        <div className="card"><Empty icon="🗂️" title="Belum ada sejarah pesanan" /></div>
      ) : (
        <div className="svc-list">{orders.map((o) => <OrderRow key={o.id} o={o} now={now} />)}</div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Butiran pesanan
// ---------------------------------------------------------------------------
interface OrderDetailResp {
  order: OrderView;
  sms: { seq: number; body: string; receivedAt: number }[];
  smsPurged: boolean;
  paymentUrl: string | null;
  serverNow: number;
}

function extractCode(body: string): string | null {
  const m = body.match(/(?<!\d)(\d{3}[-\s]?\d{3}|\d{4,8})(?!\d)/);
  return m ? m[1].replace(/[-\s]/g, '') : null;
}

const POLLING_STATES = ['pending_payment', 'paid', 'purchasing', 'active'];

export function OrderDetail({ checkPayment = false }: { checkPayment?: boolean }) {
  const params = useParams();
  const [sp] = useSearchParams();
  const id = params.id ?? sp.get('order') ?? '';
  const { config } = useSession();
  const [data, setData] = useState<OrderDetailResp | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionErr, setActionErr] = useState<string>('');
  const [busy, setBusy] = useState('');
  const delay = useRef(3000);
  const firstCheck = useRef(checkPayment);

  const load = useCallback(async () => {
    try {
      const q = firstCheck.current ? '?check=1' : '';
      const r = await api<OrderDetailResp>(`/orders/${id}${q}`);
      setData(r);
      setError(null);
      if (r.order.status !== 'pending_payment') firstCheck.current = false;
      return r;
    } catch (e) {
      setError(e);
      return null;
    }
  }, [id]);

  // Polling berjarak dengan backoff; berhenti apabila pesanan tamat/selesai.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      const r = await load();
      if (stop) return;
      const st = r?.order.status;
      if (st && !POLLING_STATES.includes(st)) return;
      const prevCount = data?.order.smsCount ?? 0;
      if (r && r.order.smsCount > prevCount) delay.current = 3000;
      else delay.current = Math.min(15000, Math.round(delay.current * 1.3));
      timer = setTimeout(tick, document.visibilityState === 'visible' ? delay.current : 20000);
    }
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const now = useServerClock(data?.serverNow ?? null);

  async function action(path: string, label: string) {
    setBusy(label);
    setActionErr('');
    try {
      await api(`/orders/${id}/${path}`, { method: 'POST' });
      delay.current = 3000;
      await load();
    } catch (e) {
      setActionErr(e instanceof ApiError ? e.message : 'Tindakan gagal.');
    } finally {
      setBusy('');
    }
  }

  if (error && !data) {
    return (
      <div style={{ marginTop: 24 }}>
        <ErrorBox error={error} onRetry={load} />
        <p><Link to="/akaun/aktif">← Kembali ke pesanan</Link></p>
      </div>
    );
  }
  if (!data) return <Spinner label={checkPayment ? 'Menyemak status bayaran…' : 'Memuatkan pesanan…'} />;
  const o = data.order;
  const left = o.numberExpiresAt ? o.numberExpiresAt - now : 0;
  const guardLeft = o.guardUntil ? o.guardUntil - now : 0;
  const totalMs = o.numberExpiresAt && o.paidAt ? Math.max(1, o.numberExpiresAt - (o.paidAt ?? 0)) : 1;

  return (
    <div style={{ marginTop: 20 }}>
      <div className="row between" style={{ marginBottom: 14 }}>
        <Link to={POLLING_STATES.includes(o.status) ? '/akaun/aktif' : '/akaun/sejarah'} className="small">← Kembali</Link>
        <span className="small muted mono">Rujukan: {o.ref}</span>
      </div>

      <div className="card card-lg stack">
        <div className="row between">
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.2rem' }}>
              {o.serviceName} · {o.countryName} {o.mode === 'demo' && <span className="demo-tag">DEMO</span>}
            </div>
            <div className="small muted">{dt(o.createdAt)} · {rm(o.priceSen)}</div>
          </div>
          <StatusBadge status={o.status} label={o.statusLabel} />
        </div>

        {o.lateNotice && <div className="alert alert-info small">Bayaran anda diterima selepas tempoh bayaran tamat. Pesanan tetap diproses.</div>}
        {o.paymentIssue && <div className="alert alert-warn small">Terdapat ketidakpadanan pada bayaran ini. Pesanan sedang disemak oleh pasukan kami — anda tidak perlu membayar semula.</div>}

        {o.status === 'pending_payment' && (
          <div className="stack">
            <div className="alert alert-info">
              <strong>Menunggu pengesahan bayaran.</strong> Jika anda sudah membayar, status akan dikemas kini secara automatik dalam beberapa saat.
              <div className="small" style={{ marginTop: 6 }}>Tempoh bayaran tamat: {dt(o.paymentDueAt)}</div>
            </div>
            <div className="row">
              {data.paymentUrl && <a className="btn btn-primary" href={data.paymentUrl}>Teruskan Pembayaran</a>}
              <button className="btn btn-ghost" disabled={!!busy} onClick={() => action('cancel', 'cancel')}>Batal Pesanan</button>
            </div>
          </div>
        )}

        {(o.status === 'paid' || o.status === 'purchasing') && (
          <div className="alert alert-ok row"><span className="spinner" aria-hidden /> Bayaran diterima. Kami sedang menyediakan nombor anda…</div>
        )}

        {o.status === 'needs_reconciliation' && (
          <div className="alert alert-warn">
            <strong>Pesanan dalam semakan.</strong> Kami belum dapat mengesahkan status nombor daripada pembekal. Jangan buat pesanan berganda untuk servis yang sama — pasukan kami akan menyemak dan mengemas kini pesanan ini. Tiada caj tambahan.
          </div>
        )}

        {(o.status === 'payment_failed' || o.status === 'expired_unpaid' || o.status === 'cancelled_unpaid') && (
          <div className="alert alert-info">
            {o.status === 'payment_failed' ? 'Bayaran tidak berjaya.' : o.status === 'expired_unpaid' ? 'Tempoh bayaran telah tamat.' : 'Pesanan dibatalkan sebelum bayaran.'} Tiada nombor ditempah. <Link to="/akaun">Buat pesanan baharu</Link>.
          </div>
        )}

        {o.status === 'purchase_failed' && (
          <div className="alert alert-error">
            Nombor tidak dapat disediakan selepas bayaran (contohnya stok habis). Permohonan refund telah direkodkan dan akan disemak.
          </div>
        )}

        {o.phoneNumber && (
          <div className="number-box">
            <div className="row between">
              <div style={{ minWidth: 0 }}>
                <div className="label">Nombor anda</div>
                <div className="value">{o.phoneNumber}</div>
              </div>
              <CopyButton text={o.phoneNumber} label="Salin nombor" className="btn btn-primary btn-sm" />
            </div>
            {o.status === 'active' && (
              <div style={{ marginTop: 14 }}>
                <div className="row between small" style={{ color: '#c9d6ea' }}>
                  <span>Baki masa</span>
                  <span className="timer" style={{ color: left < 60_000 ? '#fcd34d' : '#fff' }}>{fmtDuration(left)}</span>
                </div>
                <div className="progress" style={{ marginTop: 6, background: '#1e3a64' }}>
                  <span style={{ width: `${Math.max(0, Math.min(100, (left / totalMs) * 100))}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

        {(o.status === 'active' || o.smsCount > 0) && (
          <div>
            <h3>SMS diterima ({o.smsCount})</h3>
            {data.sms.length ? (
              <div className="stack">
                {data.sms.map((s) => {
                  const code = extractCode(s.body);
                  return (
                    <div className="sms-card" key={s.seq}>
                      <div className="row between">
                        {code ? <span className="otp">{code}</span> : <span />}
                        <CopyButton text={code ?? s.body} label={code ? 'Salin kod' : 'Salin'} />
                      </div>
                      <div className="small" style={{ marginTop: 6 }}>{s.body}</div>
                      <div className="small muted" style={{ marginTop: 4 }}>{dt(s.receivedAt)}</div>
                    </div>
                  );
                })}
              </div>
            ) : data.smsPurged ? (
              <p className="muted small">Kandungan SMS telah dipadam selepas tempoh simpanan tamat.</p>
            ) : (
              <div className="sms-card row" style={{ color: 'var(--muted)', flexWrap: 'nowrap' }}>
                <span className="spinner" aria-hidden /> <span className="pulse">Menunggu SMS… Minta kod daripada aplikasi sekarang.</span>
              </div>
            )}
          </div>
        )}

        {o.status === 'expired' && <div className="alert alert-info">Nombor telah tamat tempoh tanpa SMS diterima.</div>}
        {o.status === 'cancelled' && <div className="alert alert-info">Pesanan dibatalkan tanpa SMS diterima.</div>}

        {o.refund && (
          <div className="alert alert-info small">
            Status refund: <strong>{({ requested: 'Dimohon — menunggu semakan', approved: 'Diluluskan — pemulangan sedang diproses', processed: 'Selesai dipulangkan', rejected: 'Ditolak' } as Record<string, string>)[o.refund.status] ?? o.refund.status}</strong>
          </div>
        )}

        {actionErr && <div className="alert alert-error" role="alert">{actionErr}</div>}

        <div className="row">
          {o.status === 'active' && o.smsCount > 0 && (
            <button className="btn btn-navy" disabled={!!busy} onClick={() => action('complete', 'complete')}>✓ Tandakan Selesai</button>
          )}
          {o.status === 'active' && o.smsCount === 0 && (
            <button className="btn btn-danger" disabled={!!busy || guardLeft > 0} onClick={() => action('cancel', 'cancel')}>
              {guardLeft > 0 ? `Batal (boleh dalam ${fmtDuration(guardLeft)})` : 'Batal — tiada SMS'}
            </button>
          )}
          {o.status === 'active' && config?.mode === 'demo' && o.mode === 'demo' && (
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => action('demo-sms', 'demo-sms')}>
              <span className="demo-tag">DEMO</span> Simulasi SMS masuk
            </button>
          )}
          {o.canRequestRefund && (
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => action('refund-request', 'refund')}>Mohon Refund</button>
          )}
        </div>
      </div>
    </div>
  );
}

export function PaymentReturn() {
  return <OrderDetail checkPayment />;
}

// ---------------------------------------------------------------------------
// DEMO: halaman bayaran simulasi
// ---------------------------------------------------------------------------
export function DemoPay() {
  const { billCode } = useParams();
  const nav = useNavigate();
  const [bill, setBill] = useState<{ orderId: string; ref: string; amountSen: number; status: string; serviceName: string; countryName: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api(`/demo/payments/${billCode}`).then(setBill).catch(setError);
  }, [billCode]);
  async function pay(outcome: 'paid' | 'failed') {
    setBusy(true);
    try {
      const r = await api<{ orderId: string }>(`/demo/payments/${billCode}`, { method: 'POST', body: { outcome } });
      nav(`/bayar/kembali?order=${r.orderId}`, { replace: true });
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <section className="section">
      <div className="container" style={{ maxWidth: 460 }}>
        <div className="card card-lg stack" style={{ borderColor: '#fcd34d' }}>
          <div className="row between">
            <span className="demo-tag">DEMO</span>
            <span className="small muted">Gerbang pembayaran simulasi</span>
          </div>
          <h1 style={{ fontSize: '1.4rem' }}>Pembayaran Simulasi</h1>
          <p className="small muted">Halaman ini hanya wujud dalam mod demo. Tiada wang sebenar dipindahkan.</p>
          {error ? <ErrorBox error={error} /> : !bill ? <Spinner /> : (
            <>
              <div className="sms-card">
                <div className="small muted">Pesanan {bill.ref}</div>
                <div style={{ fontWeight: 700 }}>{bill.serviceName} · {bill.countryName}</div>
                <div className="price" style={{ fontSize: '1.5rem', marginTop: 4 }}>{rm(bill.amountSen)}</div>
              </div>
              {bill.status === 'pending' ? (
                <div className="grid grid-2">
                  <button className="btn btn-primary" disabled={busy} onClick={() => pay('paid')}>Simulasi Berjaya</button>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => pay('failed')}>Simulasi Gagal</button>
                </div>
              ) : (
                <Link className="btn btn-navy" to={`/akaun/pesanan/${bill.orderId}`}>Lihat pesanan</Link>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export function AccountSettings() {
  const { user } = useSession();
  const [f, setF] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/auth/password/change', { method: 'POST', body: f });
      setMsg({ ok: true, t: 'Kata laluan dikemas kini. Sesi lain telah dilog keluar.' });
      setF({ currentPassword: '', newPassword: '' });
    } catch (e) {
      setMsg({ ok: false, t: e instanceof ApiError ? e.message : 'Gagal.' });
    }
  }
  return (
    <div style={{ maxWidth: 520, marginTop: 24 }}>
      <Link to="/akaun" className="small">← Kembali</Link>
      <div className="card card-lg" style={{ marginTop: 12 }}>
        <h2>Akaun</h2>
        <p className="muted small">{user?.name} · {user?.email}</p>
        <form onSubmit={submit}>
          <h3 style={{ marginTop: 10 }}>Tukar kata laluan</h3>
          <Field id="cur" label="Kata laluan semasa">
            <input id="cur" type="password" className="input" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />
          </Field>
          <Field id="new" label="Kata laluan baharu" hint="Sekurang-kurangnya 10 aksara.">
            <input id="new" type="password" className="input" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
          </Field>
          {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`} style={{ marginTop: 12 }}>{msg.t}</div>}
          <button className="btn btn-navy" style={{ marginTop: 16 }}>Simpan</button>
        </form>
      </div>
    </div>
  );
}
