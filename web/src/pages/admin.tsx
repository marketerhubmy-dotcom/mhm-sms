import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Empty, ErrorBox, Spinner, StatusBadge } from '../components/ui';
import { api, ApiError, dt, rm } from '../lib/api';

function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(() => {
    if (!path) return;
    setError(null);
    api<T>(path).then(setData).catch(setError);
  }, [path]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload, setData };
}

function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <>
      <div className="row between" style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>{title}</h1>
        {actions}
      </div>
      {children}
    </>
  );
}

const STATUS_MS: Record<string, string> = {
  pending_payment: 'Menunggu bayaran',
  payment_failed: 'Bayaran gagal',
  expired_unpaid: 'Bayaran tidak diterima',
  cancelled_unpaid: 'Dibatalkan (belum bayar)',
  paid: 'Dibayar',
  purchasing: 'Menempah nombor',
  needs_reconciliation: 'Perlu rekonsiliasi',
  purchase_failed: 'Pembelian gagal',
  active: 'Aktif',
  completed: 'Selesai',
  expired: 'Tamat tempoh',
  cancelled: 'Dibatalkan',
};

// ---------------------------------------------------------------------------
export function AdminOverview() {
  const { data, error, reload } = useLoad<any>('/admin/overview');
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const c = data.orderCounts as Record<string, number>;
  return (
    <Section title="Ringkasan">
      <div className="grid grid-4">
        <div className="kpi"><div className="k">Mod</div><div className="v">{data.mode === 'demo' ? 'DEMO' : 'LIVE'}</div><div className="small muted">{data.appEnv}</div></div>
        <div className="kpi"><div className="k">{data.mode === 'demo' ? 'Pembelian (SIMULASI)' : 'Pembelian nombor sebenar'}</div><div className="v">{data.purchasesEnabled ? 'ON' : 'OFF'}</div><div className="small muted">{data.smsProvider}</div></div>
        <div className="kpi"><div className="k">{data.mode === 'demo' ? 'Bayaran (SIMULASI)' : 'Bayaran sebenar'}</div><div className="v">{data.paymentsEnabled ? 'ON' : 'OFF'}</div><div className="small muted">{data.paymentProvider}</div></div>
        <div className="kpi"><div className="k">Pengguna</div><div className="v">{data.users}</div></div>
      </div>
      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Baki pembekal {data.mode === 'demo' ? <span className="demo-tag">SIMULASI</span> : '(OnlineSIM)'}</h3>
          {data.balance ? (
            <>
              <div className="price" style={{ fontSize: '1.6rem' }}>{data.balance.balance} {data.providerCurrency}</div>
              <div className="small muted">Dibekukan: {data.balance.frozen} · Disemak: {dt(data.balance.checkedAt)}</div>
              {data.balance.low && <div className="alert alert-warn small" style={{ marginTop: 10 }}>Baki rendah — pesanan baharu mungkin disekat. Tambah baki di akaun pembekal.</div>}
            </>
          ) : <p className="muted">Belum disemak.</p>}
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} disabled={busy} onClick={async () => { setBusy(true); try { await api('/admin/provider/balance/refresh', { method: 'POST' }); } catch { /* papar melalui reload */ } setBusy(false); reload(); }}>
            Semak sekarang
          </button>
        </div>
        <div className="card">
          <h3>Perlu tindakan</h3>
          <div className="stack small">
            <div className="row between"><span>Perlu rekonsiliasi</span><Link to="/admin/pesanan?status=needs_reconciliation" className="badge badge-warn">{c.needs_reconciliation ?? 0}</Link></div>
            <div className="row between"><span>Refund belum selesai</span><Link to="/admin/refund" className="badge badge-warn">{data.openRefunds}</Link></div>
            <div className="row between"><span>Pesanan aktif</span><span className="badge badge-ok">{c.active ?? 0}</span></div>
            <div className="row between"><span>Menunggu bayaran</span><span className="badge badge-wait">{c.pending_payment ?? 0}</span></div>
          </div>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
export function AdminOrders() {
  const initial = new URLSearchParams(location.search).get('status') ?? '';
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(initial);
  const [page, setPage] = useState(1);
  const [path, setPath] = useState(`/admin/orders?status=${initial}&page=1`);
  const { data, error, reload } = useLoad<any>(path);
  useEffect(() => {
    setPath(`/admin/orders?q=${encodeURIComponent(q)}&status=${status}&page=${page}`);
  }, [status, page]); // eslint-disable-line
  return (
    <Section title="Pesanan">
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setPage(1); setPath(`/admin/orders?q=${encodeURIComponent(q)}&status=${status}&page=1`); }}>
        <input className="input" placeholder="Cari rujukan, emel, nombor, servis…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Semua status</option>
          {Object.entries(STATUS_MS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn btn-navy btn-sm">Cari</button>
      </form>
      {error ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Spinner /> : !data.orders.length ? <div className="card"><Empty title="Tiada pesanan" /></div> : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Rujukan</th><th>Pelanggan</th><th>Servis</th><th>Status</th><th className="num">Harga</th><th className="num">Kos (anggaran)</th><th>Tarikh</th></tr></thead>
              <tbody>
                {data.orders.map((o: any) => (
                  <tr key={o.id}>
                    <td><Link to={`/admin/pesanan/${o.id}`} className="mono">{o.ref}</Link> {o.mode === 'demo' && <span className="demo-tag">DEMO</span>}</td>
                    <td className="small">{o.email}</td>
                    <td className="small">{o.service_name} · {o.country_name}</td>
                    <td><StatusBadge status={o.status} label={STATUS_MS[o.status] ?? o.status} />{o.last_error_code && <div className="small muted mono">{o.last_error_code}</div>}</td>
                    <td className="num">{rm(o.price_sen)}</td>
                    <td className="num muted">{rm(o.cost_sen)}</td>
                    <td className="small">{dt(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} hasMore={data.hasMore} setPage={setPage} />
        </>
      )}
    </Section>
  );
}

function Pager({ page, hasMore, setPage }: { page: number; hasMore: boolean; setPage: (p: number) => void }) {
  return (
    <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
      <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Sebelum</button>
      <span className="small muted">Halaman {page}</span>
      <button className="btn btn-ghost btn-sm" disabled={!hasMore} onClick={() => setPage(page + 1)}>Seterusnya →</button>
    </div>
  );
}

export function AdminOrderDetail() {
  const { id } = useParams();
  const { data, error, reload } = useLoad<any>(`/admin/orders/${id}`);
  const [tzid, setTzid] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [ops, setOps] = useState<any[] | null>(null);
  async function reconcile(outcome: 'issued' | 'not_issued') {
    setMsg(null);
    if (outcome === 'not_issued' && !confirm('Sahkan bahawa pembekal TIDAK mengeluarkan nombor untuk pesanan ini? Permohonan refund akan dicipta.')) return;
    try {
      await api(`/admin/orders/${id}/reconcile`, { method: 'POST', body: { outcome, tzid, note } });
      setMsg({ ok: true, t: 'Rekonsiliasi disimpan.' });
      reload();
    } catch (e) {
      setMsg({ ok: false, t: e instanceof ApiError ? e.message : 'Gagal.' });
    }
  }
  async function loadOps() {
    try {
      setOps((await api<any>('/admin/provider/operations')).operations);
    } catch (e) {
      setMsg({ ok: false, t: e instanceof ApiError ? e.message : 'Gagal memuatkan operasi.' });
    }
  }
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const o = data.order;
  return (
    <Section title={`Pesanan ${o.ref}`} actions={<Link to="/admin/pesanan" className="small">← Senarai</Link>}>
      <div className="grid grid-2">
        <div className="card stack small">
          <div className="row between"><strong>Status</strong><StatusBadge status={o.status} label={STATUS_MS[o.status] ?? o.status} /></div>
          <div className="row between"><span>Mod</span><span>{o.mode.toUpperCase()}</span></div>
          <div className="row between"><span>Pelanggan</span><span>{data.user?.email}</span></div>
          <div className="row between"><span>Servis</span><span>{o.service_name} · {o.country_name} (+{o.country_code})</span></div>
          <div className="row between"><span>Nombor</span><span className="mono">{o.phone_number ?? '-'}</span></div>
          <div className="row between"><span>ID operasi pembekal</span><span className="mono">{o.provider_tzid ?? '-'}</span></div>
          <div className="row between"><span>Bilangan SMS</span><span>{o.sms_count} <span className="muted">(kandungan tidak dipaparkan)</span></span></div>
          <div className="row between"><span>Ralat terakhir</span><span className="mono">{o.last_error_code ?? '-'}</span></div>
        </div>
        <div className="card stack small">
          <strong>Snapshot harga</strong>
          <div className="row between"><span>Kos pembekal</span><span className="mono">{(o.cost_micros / 1e6).toFixed(6)} {o.cost_currency}</span></div>
          <div className="row between"><span>Kadar tukaran</span><span className="mono">1 {o.cost_currency} = RM{(o.fx_rate_micros / 1e6).toFixed(4)}</span></div>
          <div className="row between"><span>Markup</span><span>{(o.markup_bps / 100).toFixed(2)}% + {rm(o.fixed_fee_sen)}</span></div>
          <div className="row between"><span>Harga minimum / bundar</span><span>{rm(o.min_price_sen)} / {o.rounding_sen} sen</span></div>
          <div className="row between"><span>Override</span><span>{o.override_applied ? 'Ya' : 'Tidak'}</span></div>
          <div className="row between"><span>Kos (RM, anggaran)</span><span>{rm(o.cost_sen)}</span></div>
          <div className="row between"><strong>Harga jual</strong><strong>{rm(o.price_sen)}</strong></div>
          <hr style={{ border: 0, borderTop: '1px solid var(--border)', width: '100%' }} />
          <strong>Bayaran</strong>
          {data.payment ? (
            <>
              <div className="row between"><span>Penyedia</span><span>{data.payment.provider}</span></div>
              <div className="row between"><span>Status</span><span>{data.payment.status}</span></div>
              <div className="row between"><span>Bill code</span><span className="mono">{data.payment.bill_code ?? '-'}</span></div>
              <div className="row between"><span>Rujukan pembekal</span><span className="mono">{data.payment.provider_ref ?? '-'}</span></div>
              <div className="row between"><span>Amaun disahkan</span><span>{rm(data.payment.verified_amount_sen)}</span></div>
            </>
          ) : <span className="muted">Tiada</span>}
        </div>
      </div>

      {o.status === 'needs_reconciliation' && (
        <div className="card stack" style={{ marginTop: 16, borderColor: '#fde68a' }}>
          <h3>Rekonsiliasi</h3>
          <p className="small muted">Status pembelian di pembekal tidak diketahui (cth. timeout). Semak di papan pemuka OnlineSIM atau senarai operasi aktif di bawah. Jangan buat pembelian semula atau refund sebelum disahkan.</p>
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={loadOps}>Muat operasi aktif pembekal</button>
          </div>
          {ops && (ops.length ? (
            <div className="table-wrap"><table><thead><tr><th>tzid</th><th>Nombor</th><th>Servis</th><th>Negara</th><th>Status</th><th>Dipadankan</th></tr></thead>
              <tbody>{ops.map((op) => <tr key={op.tzid}><td className="mono">{op.tzid}</td><td className="mono">{op.number}</td><td>{op.service}</td><td>{op.country}</td><td>{op.status}</td><td>{op.matchedOrderRef ?? <button className="btn btn-ghost btn-sm" onClick={() => setTzid(op.tzid)}>Guna</button>}</td></tr>)}</tbody></table></div>
          ) : <p className="small muted">Tiada operasi aktif di pembekal.</p>)}
          <div className="grid grid-2">
            <div><label htmlFor="tz">ID operasi (tzid) — jika nombor dikeluarkan</label><input id="tz" className="input mono" value={tzid} onChange={(e) => setTzid(e.target.value)} /></div>
            <div><label htmlFor="nt">Nota semakan (wajib)</label><input id="nt" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          </div>
          {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`}>{msg.t}</div>}
          <div className="row">
            <button className="btn btn-navy btn-sm" disabled={!tzid} onClick={() => reconcile('issued')}>Nombor dikeluarkan → aktifkan</button>
            <button className="btn btn-danger btn-sm" onClick={() => reconcile('not_issued')}>Disahkan tiada nombor → gagal + refund</button>
          </div>
        </div>
      )}

      {data.refund && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Refund</h3>
          <div className="small">Status: <strong>{data.refund.status}</strong> · {rm(data.refund.amount_sen)} · {data.refund.reason}</div>
          <Link to="/admin/refund" className="small">Urus refund →</Link>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Sejarah status</h3>
        <div className="table-wrap"><table><thead><tr><th>Masa</th><th>Dari</th><th>Ke</th><th>Oleh</th><th>Sebab</th></tr></thead>
          <tbody>{data.events.map((e: any) => <tr key={e.id}><td className="small">{dt(e.created_at)}</td><td className="small">{e.from_status ?? '-'}</td><td className="small">{e.to_status}</td><td className="small mono">{String(e.actor).split(':')[0]}</td><td className="small">{e.reason}</td></tr>)}</tbody></table></div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
export function AdminCustomers() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [path, setPath] = useState('/admin/customers?page=1');
  const { data, error, reload } = useLoad<any>(path);
  useEffect(() => {
    setPath(`/admin/customers?q=${encodeURIComponent(q)}&page=${page}`);
  }, [page]); // eslint-disable-line
  async function update(id: string, body: Record<string, string>, warn: string) {
    if (!confirm(warn)) return;
    try {
      await api(`/admin/customers/${id}`, { method: 'POST', body });
      reload();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Gagal');
    }
  }
  return (
    <Section title="Pelanggan">
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setPage(1); setPath(`/admin/customers?q=${encodeURIComponent(q)}&page=1`); }}>
        <input className="input" placeholder="Cari emel atau nama…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-navy btn-sm">Cari</button>
      </form>
      {error ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Spinner /> : !data.customers.length ? <div className="card"><Empty title="Tiada pelanggan" /></div> : (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Nama</th><th>Emel</th><th>Peranan</th><th>Status</th><th className="num">Pesanan</th><th className="num">Dibayar</th><th>Daftar</th><th></th></tr></thead>
            <tbody>{data.customers.map((u: any) => (
              <tr key={u.id}>
                <td>{u.name}</td><td className="small">{u.email}</td>
                <td><span className={`badge ${u.role === 'admin' ? 'badge-warn' : 'badge-muted'}`}>{u.role}</span></td>
                <td><span className={`badge ${u.status === 'active' ? 'badge-ok' : 'badge-bad'}`}>{u.status === 'active' ? 'aktif' : 'nyahaktif'}</span></td>
                <td className="num">{u.order_count}</td><td className="num">{rm(u.paid_sen)}</td><td className="small">{dt(u.created_at)}</td>
                <td className="row" style={{ flexWrap: 'nowrap' }}>
                  {u.status === 'active'
                    ? <button className="btn btn-ghost btn-sm" onClick={() => update(u.id, { status: 'disabled' }, `Nyahaktifkan ${u.email}?`)}>Nyahaktif</button>
                    : <button className="btn btn-ghost btn-sm" onClick={() => update(u.id, { status: 'active' }, `Aktifkan semula ${u.email}?`)}>Aktifkan</button>}
                </td>
              </tr>))}</tbody>
          </table></div>
          <Pager page={page} hasMore={data.hasMore} setPage={setPage} />
          <p className="small muted" style={{ marginTop: 12 }}>Perubahan peranan admin dibuat melalui API admin atau skrip bootstrap dan direkod dalam audit log.</p>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
const SETTING_FIELDS: { key: string; label: string; hint: string; kind: 'int' | 'text' | 'rm' | 'pct' | 'fx' }[] = [
  { key: 'provider_currency', label: 'Mata wang asas pembekal', hint: 'Mata wang harga pembekal (lalai OnlineSIM: USD). Sahkan dalam profil OnlineSIM.', kind: 'text' },
  { key: 'fx_rate_micros', label: 'Kadar tukaran manual (RM bagi 1 unit mata wang asas)', hint: 'Contoh: 4.70 bermaksud 1 USD = RM4.70.', kind: 'fx' },
  { key: 'markup_bps', label: 'Markup (%)', hint: 'Peratus di atas kos. Contoh: 50 = 50%.', kind: 'pct' },
  { key: 'fixed_fee_sen', label: 'Caj tetap (RM)', hint: 'Ditambah selepas markup.', kind: 'rm' },
  { key: 'min_price_sen', label: 'Harga minimum (RM)', hint: 'Harga jual tidak akan lebih rendah daripada ini.', kind: 'rm' },
  { key: 'rounding_sen', label: 'Bundar ke atas (sen)', hint: 'Contoh: 10 = bundar ke atas ke RM0.10 terdekat.', kind: 'int' },
  { key: 'payment_window_minutes', label: 'Tempoh bayaran (minit)', hint: '', kind: 'int' },
  { key: 'catalog_ttl_seconds', label: 'TTL cache katalog (saat)', hint: 'Jimat request ke pembekal.', kind: 'int' },
  { key: 'sms_retention_days', label: 'Tempoh simpanan SMS (hari)', hint: 'Kandungan SMS dipadam secara automatik selepas tempoh ini.', kind: 'int' },
  { key: 'blocked_service_keywords', label: 'Kata kunci servis disekat', hint: 'Dipisahkan koma. Servis yang sepadan disembunyikan (cth. bank, pay, wallet).', kind: 'text' },
];

function toDisplay(kind: string, v: string) {
  if (kind === 'rm') return (Number(v) / 100).toFixed(2);
  if (kind === 'pct') return (Number(v) / 100).toString();
  if (kind === 'fx') return (Number(v) / 1e6).toString();
  return v;
}
function fromDisplay(kind: string, v: string): string | number {
  const dec = (s: string, places: number) => {
    if (!/^\d+(\.\d+)?$/.test(s.trim())) throw new Error('Nombor tidak sah');
    const [w, f = ''] = s.trim().split('.');
    if (f.length > places) throw new Error(`Maksimum ${places} tempat perpuluhan`);
    return Number(w) * 10 ** places + Number(f.padEnd(places, '0') || 0);
  };
  if (kind === 'rm') return dec(v, 2);
  if (kind === 'pct') return dec(v, 2);
  if (kind === 'fx') return dec(v, 6);
  if (kind === 'int') return Number(v);
  return v;
}

export function AdminPricing() {
  const { data, error, reload } = useLoad<{ settings: Record<string, string> }>('/admin/settings');
  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => {
    if (data) setForm(Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, toDisplay(f.kind, data.settings[f.key] ?? '')])));
  }, [data]);
  async function save() {
    setMsg(null);
    try {
      const body = Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, fromDisplay(f.kind, form[f.key] ?? '')]));
      await api('/admin/settings', { method: 'PUT', body });
      setMsg({ ok: true, t: 'Tetapan disimpan dan direkod dalam audit log.' });
      reload();
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : 'Gagal' });
    }
  }
  return (
    <Section title="Harga & Katalog">
      {error ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Spinner /> : (
        <div className="card stack">
          <h3>Formula harga</h3>
          <p className="small muted" style={{ margin: 0 }}>Harga jual = max( bundar_atas( kos × kadar × (1 + markup) + caj tetap ), harga minimum ). Override per negara/servis menggantikan formula. Semua pengiraan dalam integer (sen / micros).</p>
          <div className="grid grid-2">
            {SETTING_FIELDS.map((f) => (
              <div key={f.key}>
                <label htmlFor={f.key}>{f.label}</label>
                <input id={f.key} className="input" value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                {f.hint && <div className="hint">{f.hint}</div>}
              </div>
            ))}
          </div>
          {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`}>{msg.t}</div>}
          <div><button className="btn btn-navy" onClick={save}>Simpan tetapan</button></div>
        </div>
      )}
      <CatalogAdmin />
    </Section>
  );
}

function CatalogAdmin() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: cdata, error: cerr, reload: creload } = useLoad<{ countries: { code: number; name: string; enabled: boolean; providerEnabled: boolean }[] }>(`/admin/countries?k=${refreshKey}`);
  const [code, setCode] = useState<number>(60);
  const [force, setForce] = useState(0);
  const { data, error, reload } = useLoad<any>(`/admin/catalog/${code}${force ? '?refresh=1&n=' + force : ''}`);
  async function toggleCountry(c: number, enabled: boolean) {
    await api(`/admin/countries/${c}`, { method: 'PUT', body: { enabled } });
    setRefreshKey((k) => k + 1);
  }
  async function toggleService(slug: string, enabled: boolean) {
    await api(`/admin/services/${slug}`, { method: 'PUT', body: { enabled } });
    reload();
  }
  async function override(slug: string, current: number | null) {
    const v = prompt('Harga override dalam RM (kosongkan untuk buang override):', current ? (current / 100).toFixed(2) : '');
    if (v === null) return;
    try {
      const priceSen = v.trim() === '' ? null : (fromDisplay('rm', v) as number);
      await api('/admin/overrides', { method: 'PUT', body: { countryCode: code, serviceSlug: slug, priceSen } });
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Gagal');
    }
  }
  return (
    <div className="card stack" style={{ marginTop: 16 }}>
      <h3>Negara</h3>
      {cerr ? <ErrorBox error={cerr} onRetry={creload} /> : !cdata ? <Spinner /> : (
        <div className="row" style={{ gap: 8 }}>
          {cdata.countries.map((c) => (
            <label key={c.code} className="check small" style={{ border: '1px solid var(--border)', borderRadius: 999, padding: '4px 12px', alignItems: 'center' }}>
              <input type="checkbox" checked={c.enabled} onChange={(e) => toggleCountry(c.code, e.target.checked)} style={{ marginTop: 0 }} />
              {c.name} (+{c.code}){!c.providerEnabled && ' · tiada di pembekal'}
            </label>
          ))}
        </div>
      )}
      <div className="row between">
        <h3 style={{ margin: 0 }}>Servis & harga</h3>
        <div className="row">
          <select className="input" style={{ width: 'auto' }} value={code} onChange={(e) => setCode(Number(e.target.value))}>
            {(cdata?.countries ?? []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => setForce((n) => n + 1)}>Muat semula dari pembekal</button>
        </div>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Spinner /> : (
        <>
          {data.stale && <div className="alert alert-warn small">Data cache lama — pembekal tidak dapat dihubungi.</div>}
          <div className="small muted">Dikemas kini: {dt(data.fetchedAt)}</div>
          <div className="table-wrap"><table>
            <thead><tr><th>Aktif</th><th>Servis</th><th className="num">Stok</th><th className="num">Kos pembekal</th><th className="num">Kos (RM)</th><th className="num">Harga jual</th><th className="num">Margin</th><th></th></tr></thead>
            <tbody>{data.services.map((s: any) => (
              <tr key={s.slug} style={{ opacity: s.enabled && !s.blocked ? 1 : 0.55 }}>
                <td><input type="checkbox" checked={s.enabled} onChange={(e) => toggleService(s.slug, e.target.checked)} aria-label={`Aktifkan ${s.name}`} /></td>
                <td>{s.name} <span className="small muted mono">{s.slug}</span>{s.blocked && <span className="badge badge-bad" style={{ marginLeft: 6 }}>disekat</span>}</td>
                <td className="num">{s.stock}</td>
                <td className="num mono small">{s.cost}</td>
                <td className="num">{rm(s.costSen)}</td>
                <td className="num"><strong>{rm(s.priceSen)}</strong>{s.overrideApplied && <div className="small muted">override</div>}</td>
                <td className="num" style={{ color: s.priceSen < s.costSen ? 'var(--danger)' : undefined }}>{rm(s.priceSen - s.costSen)}</td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => override(s.slug, s.overrideApplied ? s.priceSen : null)}>Override</button></td>
              </tr>))}</tbody>
          </table></div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
const REFUND_MS: Record<string, string> = { requested: 'Dimohon', approved: 'Diluluskan', processed: 'Selesai dipulangkan', rejected: 'Ditolak' };

export function AdminRefunds() {
  const [status, setStatus] = useState('');
  const { data, error, reload } = useLoad<any>(`/admin/refunds${status ? `?status=${status}` : ''}`);
  async function act(id: string, to: string) {
    const note = prompt(`Nota untuk status "${REFUND_MS[to]}":`);
    if (!note) return;
    let externalRef = '';
    if (to === 'processed') {
      externalRef = prompt('Rujukan transaksi pemulangan (wajib):') ?? '';
      if (!externalRef) return;
    }
    try {
      await api(`/admin/refunds/${id}`, { method: 'POST', body: { status: to, note, externalRef } });
      reload();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Gagal');
    }
  }
  return (
    <Section title="Refund">
      <div className="alert alert-info small" style={{ marginBottom: 14 }}>
        Refund direkod sebagai permintaan sehingga wang benar-benar dipulangkan. Tukar ke "Selesai dipulangkan" hanya selepas pemulangan dibuat dan rujukan transaksi tersedia. Pesanan dalam rekonsiliasi tidak boleh diproses.
      </div>
      <div className="toolbar">
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 260 }}>
          <option value="">Semua</option>
          {Object.entries(REFUND_MS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Spinner /> : !data.refunds.length ? <div className="card"><Empty title="Tiada permohonan refund" /></div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Pesanan</th><th>Pelanggan</th><th className="num">Amaun</th><th>Status</th><th>Sebab</th><th>Tarikh</th><th>Tindakan</th></tr></thead>
          <tbody>{data.refunds.map((r: any) => (
            <tr key={r.id}>
              <td><Link to={`/admin/pesanan/${r.order_id}`} className="mono">{r.ref}</Link><div className="small muted">{r.service_name} · {r.country_name}</div></td>
              <td className="small">{r.email}</td>
              <td className="num">{rm(r.amount_sen)}</td>
              <td><span className={`badge ${r.status === 'processed' ? 'badge-ok' : r.status === 'rejected' ? 'badge-muted' : 'badge-warn'}`}>{REFUND_MS[r.status]}</span>{r.external_ref && <div className="small mono muted">{r.external_ref}</div>}</td>
              <td className="small">{r.reason}{r.admin_note && <div className="muted">Nota: {r.admin_note}</div>}</td>
              <td className="small">{dt(r.created_at)}</td>
              <td className="row" style={{ flexWrap: 'nowrap' }}>
                {r.status === 'requested' && <><button className="btn btn-ghost btn-sm" onClick={() => act(r.id, 'approved')}>Lulus</button><button className="btn btn-ghost btn-sm" onClick={() => act(r.id, 'rejected')}>Tolak</button></>}
                {r.status === 'approved' && <><button className="btn btn-navy btn-sm" onClick={() => act(r.id, 'processed')}>Tanda dipulangkan</button><button className="btn btn-ghost btn-sm" onClick={() => act(r.id, 'rejected')}>Tolak</button></>}
              </td>
            </tr>))}</tbody>
        </table></div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
export function AdminReports() {
  const [days, setDays] = useState(30);
  const [mode, setMode] = useState<'live' | 'demo'>('live');
  const [to] = useState(() => Date.now());
  const { data, error, reload } = useLoad<any>(`/admin/reports?mode=${mode}&from=${to - days * 86_400_000}&to=${to + 86_400_000}`);
  return (
    <Section title="Laporan">
      <div className="toolbar">
        <select className="input" style={{ maxWidth: 200 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>7 hari</option><option value={30}>30 hari</option><option value={90}>90 hari</option><option value={365}>365 hari</option>
        </select>
        <select className="input" style={{ maxWidth: 200 }} value={mode} onChange={(e) => setMode(e.target.value as 'live' | 'demo')}>
          <option value="live">Transaksi sebenar</option><option value="demo">Transaksi demo</option>
        </select>
      </div>
      {mode === 'demo' && <div className="alert alert-warn small" style={{ marginBottom: 12 }}><span className="demo-tag">DEMO</span> Angka di bawah adalah daripada transaksi simulasi, bukan hasil sebenar.</div>}
      {error ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Spinner /> : (
        <>
          <div className="grid grid-3">
            <div className="kpi"><div className="k">Hasil jualan (bayaran disahkan)</div><div className="v">{rm(data.revenueSen)}</div><div className="small muted">{data.paidOrders} pesanan dibayar</div></div>
            <div className="kpi"><div className="k">Refund dipulangkan</div><div className="v">{rm(data.refundedSen)}</div><div className="small muted">Belum selesai: {rm(data.pendingRefundSen)}</div></div>
            <div className="kpi"><div className="k">Hasil bersih</div><div className="v">{rm(data.netRevenueSen)}</div></div>
            <div className="kpi"><div className="k">Kos pembekal (anggaran)</div><div className="v">{rm(data.estimatedCostSen)}</div><div className="small muted">{data.issuedOrders} nombor dikeluarkan · berdasarkan snapshot kos × kadar tukaran manual</div></div>
            <div className="kpi"><div className="k">Margin kasar (anggaran)</div><div className="v" style={{ color: data.grossMarginSen < 0 ? 'var(--danger)' : undefined }}>{rm(data.grossMarginSen)}</div><div className="small muted">Hasil bersih − kos anggaran. Tidak termasuk caj gerbang pembayaran & cukai.</div></div>
          </div>
          <div className="table-wrap" style={{ marginTop: 16 }}><table>
            <thead><tr><th>Tarikh (MYT)</th><th className="num">Hasil</th><th className="num">Kos anggaran</th><th className="num">Margin kasar</th></tr></thead>
            <tbody>{data.daily.length ? data.daily.map((d: any) => <tr key={d.day}><td>{d.day}</td><td className="num">{rm(d.revenue_sen)}</td><td className="num">{rm(d.cost_sen)}</td><td className="num">{rm(d.revenue_sen - d.cost_sen)}</td></tr>) : <tr><td colSpan={4} className="center muted">Tiada data</td></tr>}</tbody>
          </table></div>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
export function AdminAudit() {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useLoad<any>(`/admin/audit?page=${page}`);
  return (
    <Section title="Audit Log">
      {error ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Spinner /> : !data.logs.length ? <div className="card"><Empty title="Tiada rekod" /></div> : (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Masa</th><th>Pelaku</th><th>Tindakan</th><th>Sasaran</th><th>Butiran</th></tr></thead>
            <tbody>{data.logs.map((l: any) => (
              <tr key={l.id}><td className="small">{dt(l.created_at)}</td><td className="small">{l.actor_email ?? 'sistem'}</td><td className="mono small">{l.action}</td><td className="small mono">{l.target_type ? `${l.target_type}:${l.target_id ?? ''}` : '-'}</td><td className="small mono" style={{ maxWidth: 380, wordBreak: 'break-word' }}>{l.details}</td></tr>
            ))}</tbody>
          </table></div>
          <Pager page={page} hasMore={data.hasMore} setPage={setPage} />
        </>
      )}
    </Section>
  );
}
