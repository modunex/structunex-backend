-- Design ▸ Preferences con que se hizo cada comprobación (método, límite D/C, torsión,
-- K/Kz/Cb/Lb globales). Las anteriores no las guardaban: {} = las de entonces (defaults).
ALTER TABLE "design_runs" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';
