-- CBFEM (Fase 3): las ejecuciones de una conexión pueden ser del procedimiento AISC
-- (como hasta ahora, engine = 'aisc') o de elementos finitos (engine = 'cbfem'), que
-- corren en segundo plano y dejan sus campos en S3. No destructiva: las filas existentes
-- quedan como 'aisc'.
ALTER TABLE "connection_runs" ADD COLUMN "engine" TEXT NOT NULL DEFAULT 'aisc';
ALTER TABLE "connection_runs" ADD COLUMN "analysisType" TEXT;
ALTER TABLE "connection_runs" ADD COLUMN "progress" JSONB;
ALTER TABLE "connection_runs" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "connection_runs" ADD COLUMN "finishedAt" TIMESTAMP(3);
ALTER TABLE "connection_runs" ADD COLUMN "s3Prefix" TEXT;
ALTER TABLE "connection_runs" ADD COLUMN "files" JSONB NOT NULL DEFAULT '{}';
CREATE INDEX "connection_runs_connectionId_engine_createdAt_idx" ON "connection_runs"("connectionId", "engine", "createdAt" DESC);
