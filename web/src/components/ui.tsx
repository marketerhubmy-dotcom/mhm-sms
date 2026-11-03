import { useEffect, useState, type ReactNode } from 'react';
import { useSession } from '../lib/session';

export function Spinner({ label = 'Memuatkan…' }: { label?: string }) {
  return (
    <div className="row" style={{ justifyContent: 'center', padding: 28 }} role="status">
      <span className="spinner" aria-hidden /> <span className="muted">{label}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="alert alert-error row between" role="alert">
      <span>{msg}</span>
      {onRetry && (
        <button className="btn btn-ghost btn-sm" onClick={onRetry}>
          Cuba lagi
        </button>
      )}
    </div>
  );
}

export function Empty({ icon = '📭', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon" aria-hidden>
        {icon}
      </div>
      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{title}</div>
      {children && <div className="small" style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

export function CopyButton({ text, label = 'Salin', className = 'btn btn-ghost btn-sm' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1600);
  }
  return (
    <button type="button" className={className} onClick={copy} aria-live="polite">
      {done ? '✓ Disalin' : `⧉ ${label}`}
    </button>
  );
}

const STATUS_TONE: Record<string, string> = {
  pending_payment: 'badge-wait',
  paid: 'badge-wait',
  purchasing: 'badge-wait',
  active: 'badge-ok',
  completed: 'badge-ok',
  needs_reconciliation: 'badge-warn',
  payment_failed: 'badge-bad',
  purchase_failed: 'badge-bad',
  expired_unpaid: 'badge-muted',
  cancelled_unpaid: 'badge-muted',
  expired: 'badge-muted',
  cancelled: 'badge-muted',
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`badge ${STATUS_TONE[status] ?? 'badge-muted'}`}>{label}</span>;
}

/** Jam yang diselaraskan dengan masa server (offset dikira daripada serverNow). */
export function useServerClock(serverNow: number | null) {
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (serverNow) setOffset(serverNow - Date.now());
  }, [serverNow]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now + offset;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function DemoRibbon() {
  const { config } = useSession();
  if (config?.stage === 'staging-real') {
    return (
      <div className="demo-ribbon">
        STAGING — nombor OnlineSIM SEBENAR (admin sahaja, kos sebenar kepada MHM). Pembayaran melalui CHIP mod UJIAN; tiada caj kepada pelanggan.
      </div>
    );
  }
  if (config?.mode !== 'demo') return null;
  if (config.paymentMode === 'test') {
    return <div className="demo-ribbon">STAGING — nombor & SMS SIMULASI. Pembayaran melalui CHIP mod UJIAN (guna kad ujian sahaja). Tiada caj sebenar.</div>;
  }
  return <div className="demo-ribbon">DEMO — data, nombor, SMS dan pembayaran di laman ini adalah SIMULASI. Tiada caj sebenar.</div>;
}

export function Field({ label, hint, children, id }: { label: string; hint?: string; children: ReactNode; id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
