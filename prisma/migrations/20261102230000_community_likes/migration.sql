-- AlterTable
ALTER TABLE "forum_posts" ADD COLUMN "likeCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "forum_likes" (
    "postId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_likes_pkey" PRIMARY KEY ("postId","profileId")
);

-- CreateIndex
CREATE INDEX "forum_likes_profileId_idx" ON "forum_likes"("profileId");

-- AddForeignKey
ALTER TABLE "forum_likes" ADD CONSTRAINT "forum_likes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "forum_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_likes" ADD CONSTRAINT "forum_likes_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "forum_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
