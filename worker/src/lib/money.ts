/**
 * Pengiraan wang tanpa floating-point.
 * - MYR: integer sen.
 * - Kos pembekal: integer micros (1e-6 unit mata wang pembekal).
 * - Kadar tukaran: integer micros (MYR bagi 1 unit mata wang pembekal x 1e6).
 * - Markup: basis points (1% = 100 bps).
 */

const MICROS = 1_000_000n;

/** Tukar rentetan perpuluhan (cth "0.55", "12", "1.2345678") kepada micros. Pembundaran ke atas selepas 6 tempat perpuluhan. */
export function decimalToMicros(input: string | number): number {
  const s = String(input).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Nilai perpuluhan tidak sah: ${s}`);
  const [whole, frac = ''] = s.split('.');
  const frac6 = frac.slice(0, 6).padEnd(6, '0');
  let micros = BigInt(whole) * MICROS + BigInt(frac6);
  if (frac.length > 6 && /[1-9]/.test(frac.slice(6))) micros += 1n; // bundar ke atas (kos tidak dikurangkan)
  return toSafeNumber(micros);
}

/** Tukar rentetan RM (cth "10.00") kepada sen. Menolak lebih daripada 2 tempat perpuluhan yang bukan sifar. */
export function rmStringToSen(input: string | number): number {
  const s = String(input).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Amaun tidak sah: ${s}`);
  const [whole, frac = ''] = s.split('.');
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) throw new Error(`Amaun melebihi ketepatan sen: ${s}`);
  return toSafeNumber(BigInt(whole) * 100n + BigInt(frac.slice(0, 2).padEnd(2, '0')));
}

export function senToRm(sen: number): string {
  const neg = sen < 0;
  const abs = Math.abs(sen);
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function microsToDecimal(micros: number): string {
  const whole = Math.floor(micros / 1_000_000);
  const frac = String(micros % 1_000_000).padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

function toSafeNumber(v: bigint): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < 0n) throw new Error('Nilai di luar julat selamat');
  return Number(v);
}

export interface PricingSettings {
  fxRateMicros: number;
  markupBps: number;
  fixedFeeSen: number;
  minPriceSen: number;
  roundingSen: number;
}

export interface PriceBreakdown {
  costSen: number; // kos dalam sen, bundar ke atas
  priceSen: number; // harga jual akhir
  overrideApplied: boolean;
}

/**
 * Harga jual = max( bundarAtas( kos_MYR × (1 + markup) + caj_tetap , rounding ), harga_minimum )
 * Override admin (jika ada) menggantikan formula.
 */
export function computePrice(costMicros: number, s: PricingSettings, overrideSen?: number | null): PriceBreakdown {
  if (!Number.isInteger(costMicros) || costMicros < 0) throw new Error('costMicros tidak sah');
  for (const [k, v] of Object.entries(s)) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`Tetapan harga tidak sah: ${k}`);
  }
  if (s.fxRateMicros <= 0) throw new Error('Kadar tukaran mesti positif');
  const cost = BigInt(costMicros);
  const fx = BigInt(s.fxRateMicros);
  // sen = micros_pembekal × fx_micros × 100 / (1e6 × 1e6)
  const denomCost = 10_000_000_000n; // 1e12 / 100
  const costSen = ceilDiv(cost * fx, denomCost);

  if (overrideSen != null) {
    if (!Number.isInteger(overrideSen) || overrideSen <= 0) throw new Error('Override harga tidak sah');
    return { costSen: toSafeNumber(costSen), priceSen: overrideSen, overrideApplied: true };
  }

  const marked = ceilDiv(cost * fx * BigInt(10_000 + s.markupBps), denomCost * 10_000n);
  let price = marked + BigInt(s.fixedFeeSen);
  const r = BigInt(Math.max(1, s.roundingSen));
  price = ceilDiv(price, r) * r;
  if (price < BigInt(s.minPriceSen)) price = BigInt(s.minPriceSen);
  if (price <= 0n) price = 1n;
  return { costSen: toSafeNumber(costSen), priceSen: toSafeNumber(price), overrideApplied: false };
}
