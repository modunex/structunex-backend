-- Traducciones bajo demanda de la Comunidad. Solo añade una tabla.

CREATE TABLE "forum_translations" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT,
    "assumptions" TEXT,
    "bodyDoc" JSONB,
    "sourceHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "model" TEXT NOT NULL,
    "glossaryVersion" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "forum_translations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "forum_translations_postId_locale_key" ON "forum_translations"("postId", "locale");
CREATE INDEX "forum_translations_createdAt_idx" ON "forum_translations"("createdAt");

ALTER TABLE "forum_translations" ADD CONSTRAINT "forum_translations_postId_fkey" FOREIGN KEY ("postId") REFERENCES "forum_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
