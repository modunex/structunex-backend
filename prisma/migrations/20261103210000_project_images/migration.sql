-- Biblioteca de imágenes del proyecto: solo añade tablas.
CREATE TABLE "project_images" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "currentVersionId" UUID,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "project_images_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_image_versions" (
    "id" UUID NOT NULL,
    "imageId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "s3Key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "printKey" TEXT NOT NULL,
    "printType" TEXT NOT NULL,
    "printBytes" INTEGER NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "thumbBytes" INTEGER NOT NULL,
    "view" JSONB,
    "modelHash" TEXT,
    "analysisRunId" UUID,
    "designRunId" UUID,
    "connectionRunId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_image_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_images_projectId_deletedAt_createdAt_idx" ON "project_images"("projectId", "deletedAt", "createdAt" DESC);
CREATE UNIQUE INDEX "project_image_versions_imageId_number_key" ON "project_image_versions"("imageId", "number");

ALTER TABLE "project_images" ADD CONSTRAINT "project_images_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_image_versions" ADD CONSTRAINT "project_image_versions_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "project_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;
