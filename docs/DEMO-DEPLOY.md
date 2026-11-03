# Deploy demo MHM SMS ke Cloudflare (mod SIMULASI)

Tujuan: URL demo yang boleh dibuka dari mana-mana pelayar, dengan nombor, SMS dan pembayaran **simulasi** sahaja.
Tiada API key OnlineSIM/ToyyibPay diperlukan, dan Worker akan menolak konfigurasi selain mock dalam `APP_ENV=demo` jika bercampur.

Hasil: satu Worker `mhm-sms-demo` di `https://mhm-sms-demo.<subdomain-anda>.workers.dev` yang menyajikan frontend dan `/api` pada origin yang sama (cookie `__Host-` HttpOnly + Secure, CSRF, tiada CORS). Pelan percuma mencukupi.

## Langkah (jalankan di laptop anda, dalam folder repo)

1. Pasang dan log masuk:
   ```bash
   npm install
   ```
   ```bash
   npx wrangler login
   ```
2. Ketahui subdomain workers.dev akaun anda (Dashboard → Workers & Pages → kanan atas "Subdomain", atau):
   ```bash
   npx wrangler whoami
   ```
3. Cipta D1 khusus demo, salin `database_id` yang dipaparkan:
   ```bash
   npx wrangler d1 create mhm-sms-demo
   ```
4. Sunting `worker/wrangler.toml` di bahagian `[env.demo]`:
   - `database_id = "REPLACE_WITH_DEMO_D1_ID"` → id daripada langkah 3
   - `APP_BASE_URL = "https://mhm-sms-demo.REPLACE_WITH_WORKERS_SUBDOMAIN.workers.dev"` → ganti subdomain anda
   (APP_BASE_URL mesti tepat; ia digunakan untuk semakan Origin/CSRF dan pautan bayaran demo.)
5. Migrasi dan seed demo:
   ```bash
   npm run db:migrate:demo
   ```
   ```bash
   npm run db:seed:demo
   ```
6. Build frontend dan deploy Worker demo:
   ```bash
   npm run deploy:demo
   ```
7. Semak: buka `https://mhm-sms-demo.<subdomain>.workers.dev/api/health` → mesti `{"ok":true,"mode":"demo","env":"demo"}`.
   Laman mesti memaparkan jalur kuning **DEMO** di bahagian atas.

## Admin pada demo (selamat)

1. Daftar akaun biasa di URL demo dengan emel anda.
2. Naikkan peranan melalui D1 demo (perlu akses Cloudflare anda; tiada kata laluan lalai):
   ```bash
   npm run bootstrap-admin -- --email emel@anda.my --target demo
   ```
3. Log masuk semula → butang **Admin** muncul. Perubahan direkod dalam Audit Log.

Akaun lain yang mendaftar di demo kekal sebagai pelanggan biasa.

## Nota

- Demo menggunakan D1 berasingan; data demo tidak bercampur dengan staging/production.
- Cron setiap minit aktif (memproses tamat tempoh & polling simulasi). Pelan percuma membenarkan 5 cron per akaun.
- Untuk memadam demo kemudian: `npx wrangler delete -c worker/wrangler.toml --env demo` dan `npx wrangler d1 delete mhm-sms-demo`.
- Jangan tetapkan `SMS_PROVIDER`/`PAYMENT_PROVIDER` sebenar dalam `[env.demo]`.
