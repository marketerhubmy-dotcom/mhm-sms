# Production: https://sms.mhmacademy.site

Worker `mhm-sms-prod`, D1 `mhm-sms-prod`, Workers Custom Domain `sms.mhmacademy.site`.
**Jualan OFF** sehingga kedua-dua `LIVE_PURCHASES_ENABLED` dan `LIVE_PAYMENTS_ENABLED` ditukar kepada `"true"` dalam `[env.production.vars]` dan Worker di-deploy semula.

## Prasyarat
- Zon `mhmacademy.site` berada dalam akaun Cloudflare yang sama, dan **tiada rekod DNS sedia ada untuk `sms`** (Custom Domain akan menciptanya).
- Akaun OnlineSIM **khusus untuk production**. Jangan beli nombor secara manual dengan akaun ini, dan jangan kongsi kuncinya dengan staging (rekonsiliasi automatik memadankan operasi aktif pada akaun yang sama).
- Akaun CHIP diluluskan untuk transaksi **live**; gunakan secret key LIVE dan Brand ID.

## Langkah
1. `npx wrangler d1 create mhm-sms-prod --location apac` → isi `database_id` dalam `[env.production]`.
2. `npx wrangler d1 migrations apply DB --remote -c worker/wrangler.toml --env production`
3. `npm run deploy:api:production` (mencipta Custom Domain `sms.mhmacademy.site`).
4. Secrets (input disembunyikan):
   - `npx wrangler secret put ONLINESIM_API_KEY -c worker/wrangler.toml --env production`
   - `npx wrangler secret put CHIP_SECRET_KEY -c worker/wrangler.toml --env production`
   - `npx wrangler secret put CHIP_BRAND_ID -c worker/wrangler.toml --env production`
5. `/api/health` → `ok:true`, `mode:live`, `env:production`; `/api/config` → `salesOpen:false`.
6. Daftar akaun admin di laman, kemudian `npm run bootstrap-admin -- --email <emel> --target production`.
7. Admin → Harga & Katalog: semak mata wang, kadar tukaran, markup, caj tetap, harga minimum, kata kunci sekatan, negara/servis.

## Membuka jualan (selepas semua semakan)
1. Muktamadkan Terma/Privasi/Refund (buang label draf).
2. Pastikan baki OnlineSIM mencukupi.
3. Tukar `LIVE_PURCHASES_ENABLED` dan `LIVE_PAYMENTS_ENABLED` kepada `"true"` dalam `[env.production.vars]`, `npm run deploy:api:production`.
4. Buat satu pesanan sebenar sendiri dahulu dan pantau dengan Admin → Pesanan → Semak status pembekal.

Mematikan jualan semula: tukar kembali kepada `"false"` dan deploy. Pesanan aktif tetap dipantau oleh cron.
