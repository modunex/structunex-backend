-- CreateTable
CREATE TABLE "connections" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "nodeId" TEXT NOT NULL,
    "supportedElementId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "typology" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT 'AISC360-16',
    "method" TEXT NOT NULL DEFAULT 'LRFD',
    "paramsVersion" INTEGER NOT NULL DEFAULT 1,
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connection_members" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "elementId" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "connection_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connection_runs" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "analysisRunId" UUID,
    "status" TEXT NOT NULL DEFAULT 'done',
    "engineVersion" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "inputsHash" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "results" JSONB NOT NULL DEFAULT '{}',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connection_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connections_projectId_createdAt_idx" ON "connections"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "connections_projectId_nodeId_supportedElementId_key" ON "connections"("projectId", "nodeId", "supportedElementId");

-- CreateIndex
CREATE UNIQUE INDEX "connection_members_connectionId_elementId_key" ON "connection_members"("connectionId", "elementId");

-- CreateIndex
CREATE INDEX "connection_runs_connectionId_createdAt_idx" ON "connection_runs"("connectionId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "connection_runs_analysisRunId_idx" ON "connection_runs"("analysisRunId");

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_members" ADD CONSTRAINT "connection_members_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_runs" ADD CONSTRAINT "connection_runs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_runs" ADD CONSTRAINT "connection_runs_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "analysis_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
