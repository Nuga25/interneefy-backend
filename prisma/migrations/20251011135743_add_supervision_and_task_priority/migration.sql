-- CreateEnum
CREATE TYPE "public"."Priority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."Status" ADD VALUE 'PENDING';
ALTER TYPE "public"."Status" ADD VALUE 'APPROVED';

-- AlterTable
ALTER TABLE "public"."Task" ADD COLUMN     "category" TEXT,
ADD COLUMN     "priority" "public"."Priority" NOT NULL DEFAULT 'MEDIUM';

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "supervisorId" INTEGER;

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
