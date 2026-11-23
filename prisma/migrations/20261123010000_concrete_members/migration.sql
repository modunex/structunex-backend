-- Rebar Studio D3: vigas continuas detalladas (propuesta de armado + huella).
CREATE TABLE "concrete_members" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'beam',
    "name" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "elementIds" JSONB NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "layout" JSONB,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "inputsHash" TEXT,
    "engineVersion" TEXT,
    "designRunId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "concrete_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "concrete_members_projectId_lineKey_key" ON "concrete_members"("projectId", "lineKey");
CREATE INDEX "concrete_members_projectId_createdAt_idx" ON "concrete_members"("projectId", "createdAt");
ALTER TABLE "concrete_members" ADD CONSTRAINT "concrete_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
