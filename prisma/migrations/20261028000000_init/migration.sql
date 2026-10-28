-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "clerkId" TEXT NOT NULL,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "imageUrl" TEXT,
    "mailchimpSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_materials" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'steel',
    "E" DOUBLE PRECISION NOT NULL,
    "nu" DOUBLE PRECISION NOT NULL,
    "density" DOUBLE PRECISION,
    "alpha" DOUBLE PRECISION,
    "fc" DOUBLE PRECISION,
    "fcExpected" DOUBLE PRECISION,
    "lightweight" BOOLEAN NOT NULL DEFAULT false,
    "lambda" DOUBLE PRECISION,
    "Fy" DOUBLE PRECISION,
    "Fu" DOUBLE PRECISION,
    "Fye" DOUBLE PRECISION,
    "Fue" DOUBLE PRECISION,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_frame_sections" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "materialId" UUID NOT NULL,
    "propertyType" TEXT NOT NULL DEFAULT 'steel',
    "source" TEXT NOT NULL,
    "catalogLabel" TEXT,
    "shape" TEXT,
    "b" DOUBLE PRECISION,
    "h" DOUBLE PRECISION,
    "d" DOUBLE PRECISION,
    "t" DOUBLE PRECISION,
    "tw" DOUBLE PRECISION,
    "tf" DOUBLE PRECISION,
    "bf" DOUBLE PRECISION,
    "bfTop" DOUBLE PRECISION,
    "tfTop" DOUBLE PRECISION,
    "bfBot" DOUBLE PRECISION,
    "tfBot" DOUBLE PRECISION,
    "A" DOUBLE PRECISION,
    "I33" DOUBLE PRECISION,
    "I22" DOUBLE PRECISION,
    "J" DOUBLE PRECISION,
    "reinforcement" JSONB,
    "props" JSONB NOT NULL,
    "modifiers" JSONB NOT NULL DEFAULT '{}',
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_frame_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_area_sections" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'shell',
    "shellType" TEXT NOT NULL,
    "materialId" UUID NOT NULL,
    "materialAngle" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "thicknessMembrane" DOUBLE PRECISION NOT NULL,
    "thicknessBending" DOUBLE PRECISION NOT NULL,
    "modifiers" JSONB NOT NULL DEFAULT '{}',
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_area_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT 'E.030',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "analysisProgress" JSONB,
    "analysisError" TEXT,
    "designProgress" JSONB,
    "designError" TEXT,
    "templateId" TEXT,
    "analysisType" TEXT,
    "dofPerNode" INTEGER,
    "params" JSONB,
    "units" TEXT,
    "client" TEXT,
    "company" TEXT,
    "engineer" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_configuration" (
    "projectId" UUID NOT NULL,
    "gridSystem" JSONB,
    "loadPatterns" JSONB NOT NULL DEFAULT '[]',
    "loadCombinations" JSONB NOT NULL DEFAULT '[]',
    "massSource" JSONB,
    "modalCases" JSONB NOT NULL DEFAULT '[]',
    "diaphragms" JSONB NOT NULL DEFAULT '[]',
    "spectrumFunctions" JSONB NOT NULL DEFAULT '[]',
    "responseSpectrumCases" JSONB NOT NULL DEFAULT '[]',
    "activeDofs" JSONB,
    "defaultFrameSectionId" TEXT,
    "defaultAreaSectionId" TEXT,
    "designPreferences" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_configuration_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "model_nodes" (
    "pk" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "projectId" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_nodes_pkey" PRIMARY KEY ("pk")
);

-- CreateTable
CREATE TABLE "model_elements" (
    "pk" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "projectId" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "nodeA" TEXT NOT NULL,
    "nodeB" TEXT NOT NULL,
    "frameSectionId" UUID,
    "roll" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "releases" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_elements_pkey" PRIMARY KEY ("pk")
);

-- CreateTable
CREATE TABLE "model_supports" (
    "pk" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "projectId" UUID NOT NULL,
    "nodeId" TEXT NOT NULL,
    "dx" BOOLEAN NOT NULL DEFAULT false,
    "dy" BOOLEAN NOT NULL DEFAULT false,
    "dz" BOOLEAN NOT NULL DEFAULT false,
    "rx" BOOLEAN NOT NULL DEFAULT false,
    "ry" BOOLEAN NOT NULL DEFAULT false,
    "rz" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_supports_pkey" PRIMARY KEY ("pk")
);

-- CreateTable
CREATE TABLE "model_loads" (
    "pk" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "projectId" UUID NOT NULL,
    "nodeId" TEXT NOT NULL,
    "loadPattern" TEXT NOT NULL,
    "fx" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fz" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mx" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "my" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mz" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_loads_pkey" PRIMARY KEY ("pk")
);

-- CreateTable
CREATE TABLE "model_areas" (
    "pk" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "projectId" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "nodeIds" TEXT[],
    "areaSectionId" UUID,
    "mesh" JSONB,
    "localAxisAngle" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "diaphragm" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_areas_pkey" PRIMARY KEY ("pk")
);

-- CreateTable
CREATE TABLE "model_frame_loads" (
    "pk" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "projectId" UUID NOT NULL,
    "elementId" TEXT NOT NULL,
    "loadPattern" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'distributed',
    "dir" TEXT NOT NULL DEFAULT 'gravity',
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dist" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_frame_loads_pkey" PRIMARY KEY ("pk")
);

-- CreateTable
CREATE TABLE "model_area_loads" (
    "pk" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "projectId" UUID NOT NULL,
    "areaId" TEXT NOT NULL,
    "loadPattern" TEXT NOT NULL,
    "dir" TEXT NOT NULL DEFAULT 'gravity',
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_area_loads_pkey" PRIMARY KEY ("pk")
);

-- CreateTable
CREATE TABLE "model_area_springs" (
    "pk" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "projectId" UUID NOT NULL,
    "areaId" TEXT NOT NULL,
    "stiffness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "resists" TEXT NOT NULL DEFAULT 'compressionOnly',
    "face" TEXT NOT NULL DEFAULT 'bottom',
    "outward" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_area_springs_pkey" PRIMARY KEY ("pk")
);

-- CreateTable
CREATE TABLE "analysis_runs" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'solving',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "solvedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "error" TEXT,
    "s3Prefix" TEXT,
    "schemaVersion" INTEGER,
    "activeDofs" TEXT[],
    "notes" TEXT[],
    "cases" JSONB NOT NULL DEFAULT '[]',
    "counts" JSONB NOT NULL DEFAULT '{}',
    "modes" JSONB NOT NULL DEFAULT '[]',
    "mesh" JSONB NOT NULL DEFAULT '{}',
    "modeShapes" TEXT,
    "springs" TEXT,
    "bytes" BIGINT NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL DEFAULT '{"perCase":[],"drift":[],"storyForces":[]}',
    "stories" JSONB NOT NULL DEFAULT '[]',
    "modelHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_runs" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "analysisRunId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'designing',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "error" TEXT,
    "code" TEXT,
    "steelCode" TEXT,
    "combos" TEXT[],
    "s3Prefix" TEXT,
    "schemaVersion" INTEGER,
    "files" JSONB NOT NULL DEFAULT '{}',
    "counts" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT[],
    "bytes" BIGINT NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_clerkId_key" ON "users"("clerkId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "catalog_materials_ownerId_createdAt_idx" ON "catalog_materials"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "catalog_frame_sections_ownerId_createdAt_idx" ON "catalog_frame_sections"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "catalog_area_sections_ownerId_createdAt_idx" ON "catalog_area_sections"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "projects_ownerId_createdAt_idx" ON "projects"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "model_nodes_projectId_seq_idx" ON "model_nodes"("projectId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "model_nodes_projectId_id_key" ON "model_nodes"("projectId", "id");

-- CreateIndex
CREATE INDEX "model_elements_projectId_seq_idx" ON "model_elements"("projectId", "seq");

-- CreateIndex
CREATE INDEX "model_elements_frameSectionId_idx" ON "model_elements"("frameSectionId");

-- CreateIndex
CREATE UNIQUE INDEX "model_elements_projectId_id_key" ON "model_elements"("projectId", "id");

-- CreateIndex
CREATE INDEX "model_supports_projectId_seq_idx" ON "model_supports"("projectId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "model_supports_projectId_nodeId_key" ON "model_supports"("projectId", "nodeId");

-- CreateIndex
CREATE INDEX "model_loads_projectId_seq_idx" ON "model_loads"("projectId", "seq");

-- CreateIndex
CREATE INDEX "model_areas_projectId_seq_idx" ON "model_areas"("projectId", "seq");

-- CreateIndex
CREATE INDEX "model_areas_areaSectionId_idx" ON "model_areas"("areaSectionId");

-- CreateIndex
CREATE UNIQUE INDEX "model_areas_projectId_id_key" ON "model_areas"("projectId", "id");

-- CreateIndex
CREATE INDEX "model_frame_loads_projectId_seq_idx" ON "model_frame_loads"("projectId", "seq");

-- CreateIndex
CREATE INDEX "model_area_loads_projectId_seq_idx" ON "model_area_loads"("projectId", "seq");

-- CreateIndex
CREATE INDEX "model_area_springs_projectId_seq_idx" ON "model_area_springs"("projectId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "model_area_springs_projectId_areaId_key" ON "model_area_springs"("projectId", "areaId");

-- CreateIndex
CREATE INDEX "analysis_runs_projectId_startedAt_idx" ON "analysis_runs"("projectId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "design_runs_projectId_startedAt_idx" ON "design_runs"("projectId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "design_runs_analysisRunId_idx" ON "design_runs"("analysisRunId");

-- AddForeignKey
ALTER TABLE "catalog_frame_sections" ADD CONSTRAINT "catalog_frame_sections_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "catalog_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_area_sections" ADD CONSTRAINT "catalog_area_sections_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "catalog_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_configuration" ADD CONSTRAINT "model_configuration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_nodes" ADD CONSTRAINT "model_nodes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_elements" ADD CONSTRAINT "model_elements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_elements" ADD CONSTRAINT "model_elements_frameSectionId_fkey" FOREIGN KEY ("frameSectionId") REFERENCES "catalog_frame_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_supports" ADD CONSTRAINT "model_supports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_loads" ADD CONSTRAINT "model_loads_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_areas" ADD CONSTRAINT "model_areas_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_areas" ADD CONSTRAINT "model_areas_areaSectionId_fkey" FOREIGN KEY ("areaSectionId") REFERENCES "catalog_area_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_frame_loads" ADD CONSTRAINT "model_frame_loads_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_area_loads" ADD CONSTRAINT "model_area_loads_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_area_springs" ADD CONSTRAINT "model_area_springs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_runs" ADD CONSTRAINT "design_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_runs" ADD CONSTRAINT "design_runs_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "analysis_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

