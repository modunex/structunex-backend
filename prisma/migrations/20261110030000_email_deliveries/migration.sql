-- Correos transaccionales (Resend): idioma del usuario y registro de envíos. Solo añade.
ALTER TABLE "users" ADD COLUMN "language" TEXT;

CREATE TABLE "email_deliveries" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_deliveries_key_key" ON "email_deliveries"("key");
CREATE INDEX "email_deliveries_userId_idx" ON "email_deliveries"("userId");

ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
