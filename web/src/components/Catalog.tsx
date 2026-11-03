import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, rm } from '../lib/api';
import { Empty, ErrorBox, Spinner } from './ui';

export interface Country {
  code: number;
  name: string;
}
export interface Service {
  slug: string;
  name: string;
  stock: number;
  priceSen: number;
}

export function useCountries() {
  const [countries, setCountries] = useState<Country[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    setError(null);
    api<{ countries: Country[] }>('/catalog/countries')
      .then((r) => setCountries(r.countries))
      .catch(setError);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return { countries, error, reload: load };
}

export function CatalogBrowser({
  selected,
  onSelect,
  initialCountry = 60,
}: {
  selected?: { country: Country; service: Service } | null;
  onSelect?: (country: Country, service: Service) => void;
  initialCountry?: number;
}) {
  const { countries, error: cErr, reload } = useCountries();
  const [countryCode, setCountryCode] = useState<number | null>(null);
  const [services, setServices] = useState<Service[] | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (countries && countryCode == null && countries.length) {
      setCountryCode(countries.find((c) => c.code === initialCountry)?.code ?? countries[0].code);
    }
  }, [countries, countryCode, initialCountry]);

  const loadServices = useCallback(() => {
    if (countryCode == null) return;
    setServices(null);
    setError(null);
    api<{ services: Service[]; stale: boolean }>(`/catalog/countries/${countryCode}/services`)
      .then((r) => {
        setServices(r.services);
        setStale(r.stale);
      })
      .catch(setError);
  }, [countryCode]);
  useEffect(() => {
    loadServices();
  }, [loadServices]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (services ?? []).filter((x) => !s || x.name.toLowerCase().includes(s) || x.slug.includes(s));
  }, [services, q]);

  const country = countries?.find((c) => c.code === countryCode) ?? null;

  if (cErr) return <ErrorBox error={cErr} onRetry={reload} />;
  if (!countries) return <Spinner label="Memuatkan senarai negara…" />;
  if (!countries.length) return <Empty title="Tiada negara tersedia buat masa ini" />;

  return (
    <div className="stack">
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="country">Negara</label>
          <select id="country" className="input" value={countryCode ?? ''} onChange={(e) => setCountryCode(Number(e.target.value))}>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} (+{c.code})
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginTop: 0 }}>
          <label htmlFor="q">Cari servis</label>
          <input id="q" className="input" placeholder="cth. Telegram, Google…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {stale && <div className="alert alert-warn small">Stok dan harga mungkin tidak terkini. Ia akan disahkan semula sebelum anda membayar.</div>}
      {error ? (
        <ErrorBox error={error} onRetry={loadServices} />
      ) : !services ? (
        <Spinner label="Menyemak stok & harga…" />
      ) : !filtered.length ? (
        <Empty icon="🔎" title={q ? 'Tiada servis sepadan dengan carian' : 'Tiada servis untuk negara ini'} />
      ) : (
        <div className="svc-list" role={onSelect ? 'listbox' : undefined} aria-label="Senarai servis">
          {filtered.map((s) => {
            const out = s.stock <= 0;
            const isSel = selected?.service.slug === s.slug && selected.country.code === countryCode;
            const content = (
              <>
                <div>
                  <div className="svc-name">{s.name}</div>
                  <div className="svc-meta">{out ? 'Stok habis' : s.stock < 20 ? `Stok terhad (${s.stock})` : `Stok: ${s.stock}`}</div>
                </div>
                <div className="row" style={{ gap: 10 }}>
                  <span className="price">{rm(s.priceSen)}</span>
                  {onSelect && <span className={`badge ${out ? 'badge-muted' : isSel ? 'badge-ok' : 'badge-wait'}`}>{out ? 'Habis' : isSel ? 'Dipilih' : 'Pilih'}</span>}
                </div>
              </>
            );
            return onSelect ? (
              <button
                key={s.slug}
                type="button"
                role="option"
                aria-selected={isSel}
                className={`svc-item${isSel ? ' selected' : ''}`}
                disabled={out}
                onClick={() => country && onSelect(country, s)}
              >
                {content}
              </button>
            ) : (
              <div key={s.slug} className="svc-item" style={{ cursor: 'default', opacity: out ? 0.6 : 1 }}>
                {content}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
