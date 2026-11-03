import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Field } from '../components/ui';
import { api, ApiError, type User } from '../lib/api';
import { useSession } from '../lib/session';

function safeNext(n: string | null) {
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/akaun';
}

function AuthCard({ title, children, sub }: { title: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="section">
      <div className="container" style={{ maxWidth: 440 }}>
        <div className="card card-lg">
          <h1 style={{ fontSize: '1.6rem' }}>{title}</h1>
          {sub && <p className="muted small">{sub}</p>}
          {children}
        </div>
      </div>
    </section>
  );
}

export function Login() {
  const { setUser } = useSession();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ user: User }>('/auth/login', { method: 'POST', body: { email, password } });
      setUser(r.user);
      nav(safeNext(sp.get('next')), { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Log masuk gagal.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthCard title="Log Masuk" sub={<>Belum ada akaun? <Link to="/daftar">Daftar di sini</Link></>}>
      <form onSubmit={submit} noValidate>
        <Field id="email" label="Emel">
          <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="pw" label="Kata laluan">
          <input id="pw" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {err && <div className="alert alert-error" style={{ marginTop: 14 }} role="alert">{err}</div>}
        <button className="btn btn-navy btn-block" style={{ marginTop: 18 }} disabled={busy}>
          {busy ? 'Sedang log masuk…' : 'Log Masuk'}
        </button>
        <p className="small center" style={{ marginTop: 14 }}>
          <Link to="/lupa-kata-laluan">Lupa kata laluan?</Link>
        </p>
      </form>
    </AuthCard>
  );
}

export function Register() {
  const { setUser } = useSession();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '', acceptTerms: false });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (f.password !== f.confirm) return setErr('Pengesahan kata laluan tidak sepadan.');
    setBusy(true);
    try {
      const r = await api<{ user: User }>('/auth/register', { method: 'POST', body: { name: f.name, email: f.email, password: f.password, acceptTerms: f.acceptTerms } });
      setUser(r.user);
      nav('/akaun', { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Pendaftaran gagal.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthCard title="Daftar Akaun" sub={<>Sudah ada akaun? <Link to="/masuk">Log masuk</Link></>}>
      <form onSubmit={submit} noValidate>
        <Field id="name" label="Nama">
          <input id="name" className="input" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field id="email" label="Emel">
          <input id="email" className="input" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field id="pw" label="Kata laluan" hint="Sekurang-kurangnya 10 aksara.">
          <input id="pw" className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Field id="pw2" label="Sahkan kata laluan">
          <input id="pw2" className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </Field>
        <div className="field">
          <label className="check">
            <input type="checkbox" checked={f.acceptTerms} onChange={(e) => setF({ ...f, acceptTerms: e.target.checked })} />
            <span className="small">
              Saya bersetuju dengan <Link to="/terma" target="_blank">Terma Penggunaan</Link>, <Link to="/privasi" target="_blank">Dasar Privasi</Link> dan{' '}
              <Link to="/polisi-refund" target="_blank">Polisi Refund</Link>.
            </span>
          </label>
        </div>
        {err && <div className="alert alert-error" style={{ marginTop: 14 }} role="alert">{err}</div>}
        <button className="btn btn-navy btn-block" style={{ marginTop: 18 }} disabled={busy}>
          {busy ? 'Sedang mendaftar…' : 'Daftar'}
        </button>
      </form>
    </AuthCard>
  );
}

export function ForgotPassword() {
  const { config } = useSession();
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ message: string }>('/auth/password/forgot', { method: 'POST', body: { email } });
      setMsg({ ok: true, text: r.message });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Permintaan gagal.' });
    } finally {
      setBusy(false);
    }
  }
  if (config && !config.passwordResetAvailable) {
    return (
      <AuthCard title="Lupa Kata Laluan">
        <div className="alert alert-info">
          Reset kata laluan melalui emel belum tersedia. Sila <Link to="/hubungi">hubungi support</Link> menggunakan emel akaun anda untuk bantuan.
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Lupa Kata Laluan" sub="Masukkan emel akaun anda. Jika berdaftar, pautan reset akan dihantar.">
      <form onSubmit={submit}>
        <Field id="email" label="Emel">
          <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`} style={{ marginTop: 14 }}>{msg.text}</div>}
        <button className="btn btn-navy btn-block" style={{ marginTop: 18 }} disabled={busy}>
          Hantar pautan reset
        </button>
      </form>
    </AuthCard>
  );
}

export function ResetPassword() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/auth/password/reset', { method: 'POST', body: { token: sp.get('token'), password: pw } });
      nav('/masuk', { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Reset gagal.');
    }
  }
  return (
    <AuthCard title="Tetapkan Kata Laluan Baharu">
      <form onSubmit={submit}>
        <Field id="pw" label="Kata laluan baharu" hint="Sekurang-kurangnya 10 aksara.">
          <input id="pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        {err && <div className="alert alert-error" style={{ marginTop: 14 }}>{err}</div>}
        <button className="btn btn-navy btn-block" style={{ marginTop: 18 }}>
          Simpan
        </button>
      </form>
    </AuthCard>
  );
}
