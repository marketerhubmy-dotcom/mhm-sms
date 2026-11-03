# Staging: nombor SIMULASI + CHIP mod UJIAN

URL: `https://mhm-sms-staging.marketerhubmy.workers.dev` (Worker `mhm-sms-staging`, D1 `mhm-sms-staging`).

Tujuan: menguji integrasi pembayaran CHIP sebenar (halaman bayaran, callback bertandatangan, pengesahan `GET /purchases/{id}/`)
tanpa membeli nombor OnlineSIM sebenar dan tanpa wang sebenar.

Keselamatan yang dikuatkuasakan oleh kod (`chipTestOnly`, hanya apabila `APP_ENV=staging`, `SMS_PROVIDER=mock`, `PAYMENT_PROVIDER=chip`):
- Jika kunci CHIP yang dipasang ialah kunci LIVE (purchase `is_test` bukan `true`), bil dibatalkan serta-merta dan pesanan gagal dicipta.
- Pembayaran yang bukan ujian tidak akan diterima (status `unknown`, perlu semakan admin, tiada nombor diberi).
- Production menolak gabungan ini sepenuhnya.

Secrets (ditetapkan sendiri; jangan kongsi dalam chat atau Git):
- `CHIP_SECRET_KEY` — kunci **ujian** daripada portal CHIP → Developers → API keys.
- `CHIP_BRAND_ID` — UUID daripada portal CHIP → Developers → Brands.

```bash
npx wrangler secret put CHIP_SECRET_KEY -c worker/wrangler.toml --env staging
```

```bash
npx wrangler secret put CHIP_BRAND_ID -c worker/wrangler.toml --env staging
```

Semak: `/api/health` → `{"ok":true,"env":"staging","payment":"chip-test"}`. Jika `ok:false`, medan `configErrors` menamakan apa yang belum ditetapkan.

Kad ujian CHIP (dokumentasi rasmi): `4444 3333 2222 1111` (bukan 3DS) atau `5555 5555 5555 4444` (3DS), CVC `123`, tarikh luput akan datang, sebarang nama. Tukar CVC/tarikh untuk mensimulasikan kegagalan.

## Fasa 2: nombor OnlineSIM SEBENAR di staging

`SMS_PROVIDER = "onlinesim"`, `LIVE_PURCHASES_ENABLED = "true"` dalam `[env.staging.vars]`. Pengawal dalam kod:
- Hanya **admin** boleh membuat pesanan (`STAGING_ADMIN_ONLY`); pelanggan biasa ditolak.
- Maksimum **5 pesanan sehari** di staging (`STAGING_DAILY_LIMIT`).
- Bayaran kekal **CHIP mod ujian** sahaja — tiada wang pelanggan sebenar di staging. Kos nombor ditanggung baki OnlineSIM MHM.

Persediaan akaun OnlineSIM:
1. Profil → API: hidupkan API, kosongkan **Access from IP** (Cloudflare Workers tiada IP tetap; allowlist akan menyebabkan `API_ACCESS_IP`).
2. Semak baki dan mata wang profil; tetapkan `provider_currency` dan kadar tukaran di Admin → Harga & Katalog staging.
3. `npx wrangler secret put ONLINESIM_API_KEY -c worker/wrangler.toml --env staging`
4. Probe: `/api/health/onlinesim` → `{"getBalance":"ok"}`.
