# MHM SMS

Website MHM CENTER untuk menjual servis **penerimaan SMS (activation jangka pendek)** melalui OnlineSIM API, dengan harga markup dalam RM dan bayaran per pesanan (CHIP Collect).

> **Status:** versi demo berfungsi sepenuhnya dengan adapter **mock** (nombor, SMS dan pembayaran simulasi, dilabel DEMO).
> Adapter OnlineSIM dan CHIP sebenar sudah ditulis dan diuji dengan respons tiruan, tetapi **belum diuji dengan akaun sebenar**.
> Pembelian dan bayaran sebenar **OFF** secara lalai.

## Kandungan

- [Seni bina](#seni-bina)
- [Mula pantas (tempatan)](#mula-pantas-tempatan)
- [Ujian](#ujian)
- [Konfigurasi](#konfigurasi)
- [Deploy ke Cloudflare](#deploy-ke-cloudflare)
- [Bootstrap admin](#bootstrap-admin)
- [Senarai semak sebelum live](#senarai-semak-sebelum-live)
- [Reka bentuk transaksi](#reka-bentuk-transaksi)
- [Keselamatan & privasi](#keselamatan--privasi)
- [Rujukan dokumentasi pembekal](#rujukan-dokumentasi-pembekal)

## Seni bina

```
Pelayar ──► Cloudflare Pages  (sms.mhmacademy.site)
              ├─ web/dist            React + TypeScript + Vite (SPA)
              └─ web/functions/api/[[path]].ts  ──Service Binding "API"──►  Worker mhm-sms-api
                                                                              ├─ Hono (worker/src)
                                                                              ├─ D1 (DB)
                                                                              ├─ Cron setiap minit
                                                                              ├─ OnlineSIM API
                                                                              └─ CHIP Collect API
```

- `/api/*` dihantar oleh Pages Function ke Worker melalui Service Binding, jadi cookie sesi kekal **same-origin** dan tiada CORS.
- Semua serasi pelan percuma Cloudflare: Pages, Workers (had CPU 10 ms → password hashing guna PBKDF2 asli Web Crypto), D1, 1 Cron Trigger.
- Tiada VPS dan tiada filesystem sebagai pangkalan data.

| Folder | Isi |
|---|---|
| `worker/src` | API: `routes/`, `services/` (pesanan, katalog, cron, tetapan), `providers/` (sms, payment, email), `lib/` (wang, kripto, state machine) |
| `worker/migrations` | Migrasi D1 |
| `web/src` | Frontend: halaman awam, papan pelanggan, panel admin |
| `web/functions` | Pages Function proxy `/api/*` |
| `seed/demo.sql` | Seed demo (tiada secrets/akaun) |
| `scripts/` | `dev.mjs`, `bootstrap-admin.mjs` |
| `tests/` | Ujian unit + integrasi (D1 tempatan sebenar melalui Miniflare) |

## Mula pantas (tempatan)

Keperluan: Node.js 20+.

```bash
npm install
```

```bash
npm run setup
```

```bash
npm run dev
```

Buka http://localhost:5173. API Worker berjalan di http://127.0.0.1:8787 (Vite proxy `/api`).

Aliran demo: Daftar → **Beli Nombor** → pilih servis → **Sahkan & Bayar** → halaman *Pembayaran Simulasi* → **Simulasi Berjaya** → nombor dipaparkan → **Simulasi SMS masuk** → salin kod → **Tandakan Selesai** → **Sejarah**.

Untuk menguji panel admin secara tempatan, daftar satu akaun lain kemudian:

```bash
npm run bootstrap-admin -- --email admin@contoh.my --target local
```

Cron boleh dicetuskan secara manual semasa `npm run dev`:

```bash
curl "http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*"
```

## Ujian

```bash
npm run check
```

(`typecheck` + `test` + `build`). Ujian merangkumi:

- Pengiraan harga & pembundaran wang (integer sen/micros, tiada floating-point, sentiasa bundar ke atas).
- Pengguna A tidak boleh membaca/mengubah pesanan, SMS atau bil demo pengguna B (404, tiada kebocoran kewujudan).
- Callback pembayaran berulang (berturut dan serentak) → **satu** pembelian sahaja.
- 8 request `attemptPurchase` serentak → pembekal dipanggil **sekali**.
- Timeout pembekal → `needs_reconciliation`, tiada retry automatik, tiada refund sehingga admin mengesahkan.
- Pembekal menolak (`NO_NUMBER`) → `purchase_failed` + **satu** permohonan refund (pending).
- CHIP: tandatangan `X-Signature` RSA sebenar disahkan (badan diubah / tandatangan palsu ditolak, kunci diputar diambil semula); payload "paid" tidak dipercayai tanpa `GET /purchases/{id}/`; amaun, rujukan, mata wang, brand atau pembelian ujian dalam production ditolak; callback berulang/serentak → satu pembelian.
- Bayaran lewat, pembatalan sebelum/selepas guard interval, tamat tempoh tanpa SMS.
- Pelanggan biasa ditolak (403) di semua endpoint admin; admin tidak melihat kandungan OTP.
- Production menolak konfigurasi mock; mock + sebenar tidak boleh bercampur; live OFF secara lalai.
- CSRF, cookie HttpOnly, had kadar login, reset kata laluan tanpa penyedia emel → 503 jelas.

## Konfigurasi

Nama sahaja disenaraikan dalam `.env.example` dan `worker/.dev.vars.example`. Pemboleh ubah awam berada dalam `worker/wrangler.toml` (`[vars]` setiap persekitaran).

| Nama | Jenis | Keterangan |
|---|---|---|
| `APP_ENV` | var | `development` \| `demo` \| `staging` \| `production`. Mock hanya dibenarkan dalam `development`/`demo`. |
| `APP_BASE_URL` | var | URL awam, cth. `https://sms.mhmacademy.site` (wajib https dalam production). Digunakan untuk URL return/callback. |
| `SMS_PROVIDER` | var | `mock` \| `onlinesim` |
| `PAYMENT_PROVIDER` | var | `mock` \| `chip` (mesti sepadan: kedua-dua mock atau kedua-dua sebenar) |
| `LIVE_PURCHASES_ENABLED` | var | `true` untuk membenarkan `getNum` sebenar. Lalai `false`. |
| `LIVE_PAYMENTS_ENABLED` | var | `true` untuk membenarkan purchase CHIP sebenar. Lalai `false`. |
| `ONLINESIM_BASE_URL` | var | `https://onlinesim.io` |
| `CHIP_BASE_URL` | var | `https://gate.chip-in.asia/api/v1` (kunci ujian dan live menggunakan URL yang sama; pembelian ujian `is_test` ditolak dalam production). |
| `EMAIL_PROVIDER` | var | `none` \| `resend` |
| `SUPPORT_EMAIL`, `SUPPORT_WHATSAPP` | var | Dipaparkan di laman Hubungi. |
| `ONLINESIM_API_KEY` | **secret** | Kunci API OnlineSIM (Profil → API). Dihantar dalam header `Authorization: Bearer`, tidak dalam URL. |
| `ONLINESIM_WEBHOOK_TOKEN` | **secret** | Token rawak panjang untuk URL webhook `/api/webhooks/onlinesim/<token>`. |
| `CHIP_SECRET_KEY` | **secret** | Secret key CHIP Collect (portal → Developers → API keys). Guna kunci **ujian** untuk staging. |
| `CHIP_BRAND_ID` | **secret** | Brand ID (UUID) daripada portal → Developers → Brands. |
| `RESEND_API_KEY`, `EMAIL_FROM` | **secret** | Untuk reset kata laluan melalui emel (pilihan). Tanpa ini, reset memaparkan mesej "hubungi support" (tiada kejayaan palsu). |

Tetapkan secret (contoh staging):

```bash
npx wrangler secret put ONLINESIM_API_KEY -c worker/wrangler.toml --env staging
```

Tetapan perniagaan (markup, caj tetap, harga minimum, pembundaran, kadar tukaran, tempoh bayaran, TTL katalog, tempoh simpanan SMS, kata kunci servis disekat) disimpan dalam D1 dan diubah melalui **Admin → Harga & Katalog**. Setiap perubahan direkod dalam audit log.

## Deploy ke Cloudflare

> Belum dilaksanakan. Langkah di bawah untuk pemilik akaun Cloudflare.

1. Log masuk: `npx wrangler login`
2. Cipta D1 berasingan untuk setiap persekitaran, kemudian salin `database_id` ke `worker/wrangler.toml` (`REPLACE_WITH_...`):
   ```bash
   npx wrangler d1 create mhm-sms-staging
   ```
   ```bash
   npx wrangler d1 create mhm-sms-prod
   ```
3. Migrasi:
   ```bash
   npm run db:migrate:staging
   ```
   ```bash
   npm run db:migrate:production
   ```
4. Tetapkan secrets (lihat jadual di atas) untuk `--env staging` dan `--env production`.
5. Deploy Worker:
   ```bash
   npm run deploy:api:staging
   ```
   ```bash
   npm run deploy:api:production
   ```
6. Cipta projek Pages `mhm-sms` (sekali sahaja): `npx wrangler pages project create mhm-sms --production-branch production`
7. Deploy frontend:
   ```bash
   npm run deploy:web
   ```
   Service binding `API` dalam `web/wrangler.toml` menghala ke `mhm-sms-api` (production) dan `mhm-sms-api-staging` (preview).
8. **Domain:** Pages → `mhm-sms` → *Custom domains* → tambah `sms.mhmacademy.site` (zon `mhmacademy.site` mesti di Cloudflare). Untuk staging, tambah `staging.sms.mhmacademy.site` pada deployment preview, atau kemas kini `APP_BASE_URL` staging mengikut URL yang digunakan.
9. Semak `https://sms.mhmacademy.site/api/health` → `{"ok":true,"mode":"live",...}`.

Persekitaran demo awam (pilihan): tetapkan `APP_ENV=demo` dengan D1 berasingan; mod mock akan aktif dan semua halaman dilabel DEMO.

## Demo awam di Cloudflare (pilihan)

Persekitaran `demo` dalam `worker/wrangler.toml` ialah **satu Worker** yang menyajikan frontend (`web/dist`) dan `/api` pada URL yang sama (`https://mhm-sms-demo.<subdomain>.workers.dev`). Mock dipaksa (`APP_ENV=demo`), tiada secrets diperlukan, dan D1 `mhm-sms-demo` diasingkan daripada staging/production. Langkah penuh: lihat `docs/DEMO-DEPLOY.md`.

## Bootstrap admin

Tiada kata laluan admin lalai dan pengguna tidak boleh memilih peranan semasa daftar.

1. Daftar akaun biasa di `/daftar` dengan emel admin.
2. Jalankan (perlu akses Cloudflare anda):
   ```bash
   npm run bootstrap-admin -- --email admin@domain.com --target production
   ```
3. Log masuk semula. Peranan disemak pada backend daripada D1 setiap request. Perubahan peranan direkod dalam audit log. Admin tidak boleh menukar peranan sendiri.

## Senarai semak sebelum live

**Konfigurasi & credentials** (tetapkan sendiri melalui `wrangler secret put` — jangan tampal dalam chat atau Git):

- [ ] Akaun OnlineSIM: API diaktifkan (Profil → API), **IP allowlist** dikonfigurasi atau dimatikan. Worker Cloudflare tidak mempunyai IP keluar tetap, jadi allowlist IP mungkin menyebabkan `API_ACCESS_IP`.
- [ ] `ONLINESIM_API_KEY`, `ONLINESIM_WEBHOOK_TOKEN`; tetapkan URL webhook di profil OnlineSIM ke `https://sms.mhmacademy.site/api/webhooks/onlinesim/<token>` (pilihan — polling sudah mencukupi).
- [ ] Sahkan mata wang profil OnlineSIM (harga `getTariffs` diandaikan dalam mata wang ini; lalai USD) dan tetapkan kadar tukaran manual di admin.
- [ ] CHIP: `CHIP_SECRET_KEY` (kunci **ujian** dahulu dalam staging) dan `CHIP_BRAND_ID`. Bayar ujian dengan kad `4444 3333 2222 1111`, CVC `123`, tarikh luput akan datang (dokumentasi CHIP).
- [ ] Sahkan dalam staging bahawa `success_callback` sampai dan tandatangan `X-Signature` disahkan (lihat jadual `payment_callbacks`, `signature_valid = 1`).
- [ ] Pilihan: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` untuk reset kata laluan.
- [ ] `SUPPORT_EMAIL` / `SUPPORT_WHATSAPP`.

**Ujian staging dengan akaun sebenar (amaun kecil):**

- [ ] `LIVE_PAYMENTS_ENABLED=true` dengan kunci ujian CHIP; uji bayar berjaya, gagal, batal, callback berulang.
- [ ] `LIVE_PURCHASES_ENABLED=true`; buat satu pembelian sebenar, sahkan `getState` dan `setOperationOk` (selesai & batal selepas guard interval).
- [ ] Semak katalog sebenar: servis kewangan disembunyikan (kata kunci + toggle servis). Senarai rasmi servis yang tidak disokong ada dalam Lampiran 1 Offer OnlineSIM — semak dan nyahaktifkan servis berkaitan di admin.

**Perniagaan & undang-undang:**

- [ ] Semak dan muktamadkan draf Terma, Privasi dan Polisi Refund (ditanda "draf" di laman).
- [ ] Tetapkan markup, caj tetap, harga minimum.
- [ ] Prosedur refund manual. CHIP ada `POST /purchases/{id}/refund/`, tetapi versi ini **tidak** memanggilnya secara automatik; refund diproses oleh admin (di portal CHIP atau pindahan bank) dan direkod dengan rujukan transaksi.

## Reka bentuk transaksi

**Wang:** MYR disimpan sebagai integer **sen**; kos pembekal sebagai integer **micros** (1e-6); kadar tukaran sebagai micros; markup dalam basis points. Pengiraan guna `BigInt`, dibundar **ke atas**. Snapshot (kos, mata wang, kadar, markup, caj tetap, minimum, pembundaran, override, harga jual) disimpan pada setiap pesanan. Harga sentiasa dikira di server; `expectedPriceSen` daripada klien hanya untuk mengesan perubahan harga (409 `PRICE_CHANGED`).

**State machine pesanan** (`worker/src/lib/orderState.ts`):

```
pending_payment ─► paid ─► purchasing ─► active ─► completed | expired | cancelled
     │                         ├─► purchase_failed          (pembekal menolak dengan jelas → refund "requested")
     │                         └─► needs_reconciliation     (timeout / kod tidak pasti → semakan admin)
     │                                  ├─► active          (admin sahkan tzid aktif di pembekal)
     │                                  └─► purchase_failed (admin sahkan tiada nombor → refund "requested")
     ├─► payment_failed  ─► paid  (berjaya kemudian)
     ├─► expired_unpaid  ─► paid  (bayaran lewat)
     └─► cancelled_unpaid ─► paid (dibayar walaupun dibatalkan)
```

Semua peralihan ialah `UPDATE … WHERE id = ? AND status = ?` (compare-and-set) dan direkod dalam `order_events`.

**Pembayaran (CHIP):** callback/redirect/cron hanyalah *isyarat*. Callback mesti mempunyai `X-Signature` yang sah (RSA PKCS#1 v1.5 + SHA-256 atas badan mentah, kunci daripada `GET /public_key/`). Kemudian server memanggil `GET /purchases/{id}/` dan mengesahkan status `paid`/`cleared`/`settled`, `reference` = rujukan pesanan, `purchase.total` = harga pesanan (sen), mata wang `MYR`, `brand_id`, dan bukan pembelian ujian dalam production. Status `refunded`/`chargeback` memerlukan semakan admin. `payments.status → 'paid'` dibuat secara bersyarat, jadi callback berulang tidak memberi kesan. Redirect pelanggan tidak dianggap bukti bayaran.

**Pembelian:** hanya request yang berjaya menukar `paid → purchasing` memanggil `getNum`. Timeout/ralat tidak pasti → `needs_reconciliation`; **tiada retry automatik** dan **tiada refund** selagi status pembekal tidak diketahui. Cron menukar `purchasing` yang tersekat > 2 minit kepada `needs_reconciliation`. Admin boleh melihat operasi aktif pembekal (`getState`) untuk memadankan tzid.

**Polling SMS:** hanya pesanan `active`, jarak 5 s dengan backoff ×1.5 hingga 30 s; slot polling dituntut secara atomik; berhenti apabila tamat/selesai. Frontend juga menggunakan backoff dan berhenti untuk status akhir. Webhook OnlineSIM tiada tandatangan dalam dokumentasi, jadi ia hanya mencetuskan fetch semula melalui API.

**Refund:** direkod sebagai `requested → approved → processed` (atau `rejected`). `processed` memerlukan rujukan transaksi. Tidak dibenarkan bagi pesanan `needs_reconciliation`/`purchasing`.

## Keselamatan & privasi

- Kata laluan: PBKDF2-HMAC-SHA256 (100k iterasi, salt rawak) melalui Web Crypto platform — algoritma standard, bukan ciptaan sendiri. Dipilih kerana had CPU pelan percuma Workers (scrypt/argon2 dalam JS melebihi 10 ms).
- Sesi server-side dalam D1 (hanya SHA-256 token disimpan), cookie `HttpOnly; SameSite=Lax; Secure` (`__Host-` dalam https), tamat 7 hari bergerak.
- CSRF: semakan Origin + header `X-Requested-With` + token sinkroniser per sesi (`X-CSRF-Token`).
- Had kadar dalam D1: daftar, login (IP & emel), lupa kata laluan, pesanan.
- Semua endpoint pesanan/SMS menapis `user_id` pemilik; pesanan orang lain → 404.
- Kunci API hanya dalam secrets Worker; tidak dihantar ke frontend, URL atau log. Kod tidak log kandungan SMS, kata laluan atau token.
- Admin tidak melihat kandungan SMS/OTP (hanya bilangan).
- Kandungan SMS dipadam automatik selepas `sms_retention_days` (lalai 7) oleh cron.
- Data dev/staging/production diasingkan dengan D1 berasingan dan `APP_ENV`.
- Tiada pengumpulan IC/passport.

## Rujukan dokumentasi pembekal

Dibaca semasa pembangunan (3 Nov 2026):

- OnlineSIM API v1.1 — https://onlinesim.io/openapi_docs/Onlinesim-API-UN/info/ (`getTariffs`, `getNum`, `getState`, `setOperationOk`, `getBalance`, webhook `newSms`, kod ralat)
- OnlineSIM Offer — https://onlinesim.io/documentation/offer (Lampiran 1: penghantar yang tidak disokong termasuk bank/pembayaran; tiada jaminan penghantaran)
- OnlineSIM Refund Policy — https://onlinesim.io/documentation/refund (refund tidak automatik; tiada refund untuk hasil rangkaian seperti SMS tidak sampai)
- CHIP Collect API — https://docs.chip-in.asia/openapi/chip-collect.yaml (`POST /purchases/`, `GET /purchases/{id}/`, `POST /purchases/{id}/cancel/`, `GET /public_key/`, pengesahan `X-Signature`, status Purchase)
- Cloudflare Pages Functions bindings & Workers limits — https://developers.cloudflare.com/pages/functions/bindings/, https://developers.cloudflare.com/workers/platform/limits/

Batasan: OnlineSIM tidak mendokumenkan semakan pesanan mengikut rujukan luaran, jadi pesanan yang timeout memerlukan semakan admin. Sewaan jangka panjang dan sambungan sewaan **belum dibina** (fasa seterusnya) dan tidak dipaparkan kepada pelanggan.
