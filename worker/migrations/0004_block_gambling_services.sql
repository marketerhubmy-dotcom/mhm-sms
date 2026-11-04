-- Sekat servis perjudian (perjudian dalam talian menyalahi undang-undang di Malaysia) serta
-- platform kripto/forex yang namanya tidak mengandungi kata kunci umum.
-- Kata kunci DITAMBAH pada senarai sedia ada (termasuk jika admin telah mengubahnya), sekali sahaja.
UPDATE settings
SET value = value || ',bet,casino,poker,slot,gambling,lottery,loto,togel,judi,jackpot,freejackpot,32red,888casino,azino,bcgame,betfair,boylesports,ggpoker,mrgreen,william hill,williamhill,qbet,winbet,linebet,cloudbet,megapari,me88,paxful,localbitcoins,okcoin,swissborg,kcex,weex,toobit,zoomex,noones,blockdag,bitclout,dogedash,exness,xtb,hfm',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    updated_by = 'migration:0004'
WHERE key = 'blocked_service_keywords'
  AND instr(',' || value || ',', ',casino,') = 0;

INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, created_at)
SELECT NULL, 'settings.update', 'settings', 'blocked_service_keywords', '{"via":"migration:0004","note":"tambah kata kunci perjudian & kripto/forex"}', CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'blocked_service_keywords' AND updated_by = 'migration:0004');
