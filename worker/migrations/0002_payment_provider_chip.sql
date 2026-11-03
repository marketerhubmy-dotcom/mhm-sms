-- Tukar gerbang pembayaran kepada CHIP (gantikan ToyyibPay).
-- SQLite tidak boleh mengubah CHECK constraint, jadi jadual payments dibina semula.
-- Tiada jadual lain merujuk payments, jadi DROP/RENAME selamat.
CREATE TABLE payments_new (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  provider TEXT NOT NULL CHECK (provider IN ('mock', 'chip')),
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
INSERT INTO payments_new (id, order_id, provider, bill_code, payment_url, amount_sen, currency, status, provider_ref, verified_amount_sen, verified_at, created_at, updated_at)
  SELECT id, order_id, provider, bill_code, payment_url, amount_sen, currency, status, provider_ref, verified_amount_sen, verified_at, created_at, updated_at
  FROM payments WHERE provider IN ('mock', 'chip');
DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;
