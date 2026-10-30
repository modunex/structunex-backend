-- AlterTable
ALTER TABLE "report_exports" ADD COLUMN "reportId" UUID;

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'es',
    "document" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_revisions" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "documentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_projectId_updatedAt_idx" ON "reports"("projectId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "report_revisions_reportId_number_key" ON "report_revisions"("reportId", "number");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_revisions" ADD CONSTRAINT "report_revisions_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
