-- Seed DEMO (tiada secrets, tiada akaun/kata laluan).
-- Katalog demo dijana oleh adapter mock secara automatik.
-- Contoh override harga untuk menunjukkan ciri admin:
INSERT OR REPLACE INTO price_overrides (country_code, service_slug, price_sen, updated_at)
VALUES (60, 'whatsapp', 990, strftime('%s','now') * 1000);
INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, created_at)
VALUES (NULL, 'seed.demo', 'price', '60:whatsapp', '{"to":990,"note":"seed demo"}', strftime('%s','now') * 1000);
