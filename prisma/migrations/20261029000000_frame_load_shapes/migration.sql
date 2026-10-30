-- AlterTable: cargas de barra trapezoidales, parciales y con distancias absolutas
ALTER TABLE "model_frame_loads" ADD COLUMN     "value2" DOUBLE PRECISION,
ADD COLUMN     "dist2" DOUBLE PRECISION,
ADD COLUMN     "distAbsolute" BOOLEAN NOT NULL DEFAULT false;
