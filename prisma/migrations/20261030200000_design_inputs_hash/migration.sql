-- AlterTable
ALTER TABLE "design_runs" ADD COLUMN "inputsHash" TEXT;

-- CreateIndex
CREATE INDEX "report_exports_reportId_idx" ON "report_exports"("reportId");
