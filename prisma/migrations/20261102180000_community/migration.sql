-- Comunidad (/community). Solo añade tablas: no toca el modelo estructural.

CREATE TABLE "forum_topics" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameEs" TEXT NOT NULL,
    "descriptionEn" TEXT NOT NULL,
    "descriptionEs" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "postingRole" TEXT NOT NULL DEFAULT 'member',
    "requiresTechnicalContext" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "forum_topics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forum_tags" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameEs" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "forum_tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forum_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'member',
    "suspendedUntil" TIMESTAMP(3),
    "guidelinesAcceptedAt" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "notifyReplies" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "forum_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forum_threads" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "topicId" UUID NOT NULL,
    "authorId" UUID,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "codeEdition" TEXT,
    "designMethod" TEXT,
    "assumptions" TEXT,
    "units" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "lastPostAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "forum_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forum_thread_tags" (
    "threadId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    CONSTRAINT "forum_thread_tags_pkey" PRIMARY KEY ("threadId","tagId")
);

CREATE TABLE "forum_posts" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "authorId" UUID,
    "isFirst" BOOLEAN NOT NULL DEFAULT false,
    "bodyDoc" JSONB NOT NULL,
    "bodyText" TEXT NOT NULL,
    "bodyVersion" INTEGER NOT NULL DEFAULT 1,
    "editedAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "hiddenById" UUID,
    "hiddenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "forum_posts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forum_attachments" (
    "id" UUID NOT NULL,
    "postId" UUID,
    "uploaderId" UUID,
    "s3Key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "uploaded" BOOLEAN NOT NULL DEFAULT false,
    "scanStatus" TEXT NOT NULL DEFAULT 'pending',
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "forum_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forum_reports" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "forum_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forum_subscriptions" (
    "threadId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "forum_subscriptions_pkey" PRIMARY KEY ("threadId","profileId")
);

CREATE TABLE "forum_email_outbox" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "forum_email_outbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forum_moderation_log" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "forum_moderation_log_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "forum_topics_slug_key" ON "forum_topics"("slug");
CREATE UNIQUE INDEX "forum_tags_slug_key" ON "forum_tags"("slug");
CREATE UNIQUE INDEX "forum_profiles_userId_key" ON "forum_profiles"("userId");
CREATE UNIQUE INDEX "forum_profiles_handle_key" ON "forum_profiles"("handle");
CREATE UNIQUE INDEX "forum_threads_number_key" ON "forum_threads"("number");
CREATE INDEX "forum_threads_hiddenAt_lastPostAt_idx" ON "forum_threads"("hiddenAt", "lastPostAt");
CREATE INDEX "forum_threads_topicId_lastPostAt_idx" ON "forum_threads"("topicId", "lastPostAt");
CREATE INDEX "forum_threads_locale_lastPostAt_idx" ON "forum_threads"("locale", "lastPostAt");
CREATE INDEX "forum_thread_tags_tagId_idx" ON "forum_thread_tags"("tagId");
CREATE INDEX "forum_posts_threadId_createdAt_idx" ON "forum_posts"("threadId", "createdAt");
CREATE UNIQUE INDEX "forum_attachments_s3Key_key" ON "forum_attachments"("s3Key");
CREATE INDEX "forum_attachments_postId_idx" ON "forum_attachments"("postId");
CREATE INDEX "forum_attachments_uploaderId_createdAt_idx" ON "forum_attachments"("uploaderId", "createdAt");
CREATE UNIQUE INDEX "forum_reports_postId_reporterId_key" ON "forum_reports"("postId", "reporterId");
CREATE INDEX "forum_reports_status_createdAt_idx" ON "forum_reports"("status", "createdAt");
CREATE INDEX "forum_subscriptions_profileId_idx" ON "forum_subscriptions"("profileId");
CREATE UNIQUE INDEX "forum_email_outbox_postId_profileId_key" ON "forum_email_outbox"("postId", "profileId");
CREATE INDEX "forum_email_outbox_status_createdAt_idx" ON "forum_email_outbox"("status", "createdAt");
CREATE INDEX "forum_moderation_log_targetType_targetId_idx" ON "forum_moderation_log"("targetType", "targetId");

ALTER TABLE "forum_profiles" ADD CONSTRAINT "forum_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forum_threads" ADD CONSTRAINT "forum_threads_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "forum_topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "forum_threads" ADD CONSTRAINT "forum_threads_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "forum_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "forum_thread_tags" ADD CONSTRAINT "forum_thread_tags_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forum_thread_tags" ADD CONSTRAINT "forum_thread_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "forum_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "forum_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_hiddenById_fkey" FOREIGN KEY ("hiddenById") REFERENCES "forum_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "forum_attachments" ADD CONSTRAINT "forum_attachments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "forum_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "forum_attachments" ADD CONSTRAINT "forum_attachments_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "forum_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "forum_reports" ADD CONSTRAINT "forum_reports_postId_fkey" FOREIGN KEY ("postId") REFERENCES "forum_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forum_reports" ADD CONSTRAINT "forum_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "forum_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forum_reports" ADD CONSTRAINT "forum_reports_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "forum_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "forum_subscriptions" ADD CONSTRAINT "forum_subscriptions_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forum_subscriptions" ADD CONSTRAINT "forum_subscriptions_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "forum_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forum_email_outbox" ADD CONSTRAINT "forum_email_outbox_postId_fkey" FOREIGN KEY ("postId") REFERENCES "forum_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forum_email_outbox" ADD CONSTRAINT "forum_email_outbox_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "forum_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forum_moderation_log" ADD CONSTRAINT "forum_moderation_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "forum_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
