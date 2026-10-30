-- Sistemas resistentes a cargas laterales: definición en la configuración del modelo y
-- asignación por barra. Proyectos existentes: ninguno definido, todas las barras sin
-- sistema (solo gravedad).
ALTER TABLE "model_configuration" ADD COLUMN "lateralSystems" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "model_elements" ADD COLUMN "lateralSystem" TEXT;
