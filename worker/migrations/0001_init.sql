-- MHM SMS: skema awal
-- Semua masa dalam milisaat Unix (INTEGER).
-- Semua amaun MYR dalam sen (INTEGER).
-- Kos pembekal dalam "micros" (1/1,000,000 unit mata wang pembekal) (INTEGER).

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,               -- SHA-256 (hex) bagi token sesi; token asal hanya dalam cookie
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE password_resets (
  id TEXT PRIMARY KEY,               -- SHA-256 (hex) bagi token reset
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Katalog cache daripada pembekal
CREATE TABLE catalog_countries (
  code INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  provider_enabled INTEGER NOT NULL DEFAULT 1,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE catalog_services (
  country_code INTEGER NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  stock INTEGER NOT NULL,
  cost_micros INTEGER NOT NULL CHECK (cost_micros >= 0),
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (country_code, slug)
);

-- Kawalan admin
CREATE TABLE country_settings (
  country_code INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE service_settings (
  slug TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE price_overrides (
  country_code INTEGER NOT NULL,
  service_slug TEXT NOT NULL,
  price_sen INTEGER NOT NULL CHECK (price_sen > 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (country_code, service_slug)
);

-- Pesanan
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'activation' CHECK (kind IN ('activation')),
  mode TEXT NOT NULL CHECK (mode IN ('demo', 'live')),
  status TEXT NOT NULL CHECK (status IN (
    'pending_payment', 'payment_failed', 'expired_unpaid', 'cancelled_unpaid',
    'paid', 'purchasing', 'needs_reconciliation', 'purchase_failed',
    'active', 'completed', 'expired', 'cancelled'
  )),
  country_code INTEGER NOT NULL,
  country_name TEXT NOT NULL,
  service_slug TEXT NOT NULL,
  service_name TEXT NOT NULL,
  -- snapshot harga
  cost_micros INTEGER NOT NULL,
  cost_currency TEXT NOT NULL,
  fx_rate_micros INTEGER NOT NULL,     -- MYR bagi 1 unit mata wang pembekal x 1,000,000
  markup_bps INTEGER NOT NULL,
  fixed_fee_sen INTEGER NOT NULL,
  min_price_sen INTEGER NOT NULL,
  rounding_sen INTEGER NOT NULL,
  override_applied INTEGER NOT NULL DEFAULT 0,
  cost_sen INTEGER NOT NULL,           -- kos dalam MYR (dibundarkan ke atas) untuk laporan
  price_sen INTEGER NOT NULL CHECK (price_sen > 0),
  -- pembekal
  provider_tzid TEXT UNIQUE,
  phone_number TEXT,
  provider_status TEXT,
  number_expires_at INTEGER,
  guard_until INTEGER,
  sms_count INTEGER NOT NULL DEFAULT 0,
  late_payment INTEGER NOT NULL DEFAULT 0,
  -- masa
  payment_due_at INTEGER NOT NULL,
  paid_at INTEGER,
  purchase_started_at INTEGER,
  activated_at INTEGER,
  closed_at INTEGER,
  next_poll_at INTEGER,
  poll_interval_s INTEGER NOT NULL DEFAULT 5,
  last_polled_at INTEGER,
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX idx_orders_status ON orders(status, next_poll_at);
CREATE INDEX idx_orders_created ON orders(created_at DESC);

CREATE TABLE order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_order_events_order ON order_events(order_id);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  provider TEXT NOT NULL CHECK (provider IN ('mock', 'toyyibpay')),
  bill_code TEXT UNIQUE,
  payment_url TEXT,
  amount_sen INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'MYR',
  status TEXT NOT NULL CHECK (status IN ('created', 'pending', 'paid', 'failed', 'amount_mismatch')),
  provider_ref TEXT,
  verified_amount_sen INTEGER,
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE payment_callbacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  bill_code TEXT,
  signature_valid INTEGER NOT NULL,
  result TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE TABLE sms_messages (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  seq INTEGER NOT NULL,
  body TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  UNIQUE (order_id, seq)
);
CREATE INDEX idx_sms_received ON sms_messages(received_at);

CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  amount_sen INTEGER NOT NULL CHECK (amount_sen > 0),
  status TEXT NOT NULL CHECK (status IN ('requested', 'approved', 'processed', 'rejected')),
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  admin_note TEXT,
  external_ref TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_by TEXT
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- Simulasi (hanya digunakan oleh adapter mock dalam mod demo/development)
CREATE TABLE mock_operations (
  tzid INTEGER PRIMARY KEY AUTOINCREMENT,
  country_code INTEGER NOT NULL,
  service_slug TEXT NOT NULL,
  number TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE mock_sms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tzid INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE mock_payments (
  bill_code TEXT PRIMARY KEY,
  order_ref TEXT NOT NULL,
  amount_sen INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);

-- Tetapan lalai (tiada secrets). Admin boleh ubah melalui panel.
INSERT INTO settings (key, value, updated_at) VALUES
  ('provider_currency', 'USD', 0),
  ('fx_rate_micros', '4700000', 0),        -- 1 USD = RM4.70 (contoh; admin mesti kemas kini)
  ('markup_bps', '5000', 0),               -- 50%
  ('fixed_fee_sen', '50', 0),              -- RM0.50
  ('min_price_sen', '200', 0),             -- RM2.00
  ('rounding_sen', '10', 0),               -- bundar ke atas ke RM0.10
  ('payment_window_minutes', '30', 0),
  ('catalog_ttl_seconds', '300', 0),
  ('sms_retention_days', '7', 0),
  ('low_balance_threshold_micros', '5000000', 0),
  ('blocked_service_keywords', 'bank,pay,wallet,loan,credit,finance,kredit,pinjaman', 0);
