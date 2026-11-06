-- Registro del análisis (estilo ETABS "Analysis log"): pasos con hora, avisos y error.
ALTER TABLE "analysis_runs" ADD COLUMN "log" JSONB NOT NULL DEFAULT '[]';
