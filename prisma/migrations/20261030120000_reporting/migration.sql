-- AlterTable
ALTER TABLE "projects" ADD COLUMN "logoKey" TEXT;

-- CreateTable
CREATE TABLE "report_exports" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'es',
    "unitSystemId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'done',
    "runIds" TEXT[],
    "document" JSONB NOT NULL,
    "documentHash" TEXT NOT NULL,
    "s3Key" TEXT,
    "sha256" TEXT,
    "bytes" INTEGER,
    "pages" INTEGER,
    "rendererVersion" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_exports_projectId_createdAt_idx" ON "report_exports"("projectId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
