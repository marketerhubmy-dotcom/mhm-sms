-- Tambah kata kunci servis kripto/kewangan kepada senarai sekatan lalai.
-- Hanya dikemas kini jika admin BELUM mengubah nilai lalai asal (tetapan admin tidak ditimpa).
UPDATE settings
SET value = 'bank,pay,wallet,loan,credit,finance,kredit,pinjaman,crypto,binance,coinbase,bitstamp,kucoin,huobi,bybit,ftx,okx,kraken,mexc,bitget,bitfinex,blockchain,coin,exchange,trading,forex',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    updated_by = 'migration:0003'
WHERE key = 'blocked_service_keywords'
  AND value = 'bank,pay,wallet,loan,credit,finance,kredit,pinjaman';

INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, created_at)
SELECT NULL, 'settings.update', 'settings', 'blocked_service_keywords', '{"via":"migration:0003","note":"tambah kata kunci kripto"}', CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'blocked_service_keywords' AND updated_by = 'migration:0003');
