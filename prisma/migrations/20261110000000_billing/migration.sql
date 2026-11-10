-- Facturación con Stripe: plan y créditos de IA por usuario. Solo añade columnas y tablas;
-- todo usuario existente queda en el plan "free" hasta que el webhook diga otra cosa.

ALTER TABLE "users"
    ADD COLUMN "stripeCustomerId" TEXT,
    ADD COLUMN "stripeSubscriptionId" TEXT,
    ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'free',
    ADD COLUMN "planStatus" TEXT,
    ADD COLUMN "planPriceKey" TEXT,
    ADD COLUMN "planPeriodEnd" TIMESTAMP(3),
    ADD COLUMN "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "featuresSyncedAt" TIMESTAMP(3),
    ADD COLUMN "aiCreditsMonthly" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "aiCreditsResetAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_stripeCustomerId_key" ON "users"("stripeCustomerId");
CREATE UNIQUE INDEX "users_stripeSubscriptionId_key" ON "users"("stripeSubscriptionId");

CREATE TABLE "ai_credit_grants" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "credits" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "stripeRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_credit_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_credit_grants_stripeRef_key" ON "ai_credit_grants"("stripeRef");
CREATE INDEX "ai_credit_grants_userId_expiresAt_idx" ON "ai_credit_grants"("userId", "expiresAt");

ALTER TABLE "ai_credit_grants" ADD CONSTRAINT "ai_credit_grants_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ai_credit_entries" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "messageId" UUID,
    "projectId" UUID,
    "model" TEXT,
    "usage" JSONB,
    "stripeRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_credit_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_credit_entries_stripeRef_key" ON "ai_credit_entries"("stripeRef");
CREATE INDEX "ai_credit_entries_userId_createdAt_idx" ON "ai_credit_entries"("userId", "createdAt" DESC);

ALTER TABLE "ai_credit_entries" ADD CONSTRAINT "ai_credit_entries_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "stripe_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);
