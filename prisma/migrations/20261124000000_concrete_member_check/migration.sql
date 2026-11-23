-- Rebar Studio D4: última comprobación del armado de cada viga detallada.
ALTER TABLE "concrete_members" ADD COLUMN "checkResult" JSONB;
ALTER TABLE "concrete_members" ADD COLUMN "checkStatus" TEXT;
ALTER TABLE "concrete_members" ADD COLUMN "checkHash" TEXT;
ALTER TABLE "concrete_members" ADD COLUMN "checkedAt" TIMESTAMP(3);
