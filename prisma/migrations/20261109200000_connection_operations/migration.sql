-- Operaciones de una conexión (modelado por operaciones, estilo IDEA StatiCa).
-- NULL = la plantilla de la tipología las escribe desde `params` (todas las conexiones
-- existentes siguen así, sin cambios); una lista = conexión personalizada.
ALTER TABLE "connections" ADD COLUMN "operations" JSONB;
