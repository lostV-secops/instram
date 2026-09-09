-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('REGISTRATION_VERIFY', 'PASSWORD_RESET');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'OTP_SENT';
ALTER TYPE "AuditAction" ADD VALUE 'OTP_VERIFIED';
ALTER TYPE "AuditAction" ADD VALUE 'OTP_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_RESET';
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_REVOKED';

-- AlterTable
ALTER TABLE "AuthSession" ADD COLUMN     "deviceId" TEXT;

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "target" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpRateLimit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "target" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL DEFAULT 'unknown',
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "sendWindowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifyCount" INTEGER NOT NULL DEFAULT 0,
    "verifyWindowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtpRateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtpCode_target_purpose_idx" ON "OtpCode"("target", "purpose");

-- CreateIndex
CREATE INDEX "OtpCode_expiresAt_idx" ON "OtpCode"("expiresAt");

-- CreateIndex
CREATE INDEX "OtpRateLimit_target_idx" ON "OtpRateLimit"("target");

-- CreateIndex
CREATE UNIQUE INDEX "OtpRateLimit_target_deviceId_key" ON "OtpRateLimit"("target", "deviceId");

-- AddForeignKey
ALTER TABLE "OtpCode" ADD CONSTRAINT "OtpCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
