-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "Lang" AS ENUM ('FR', 'MG');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('ADMIN_SUPER', 'ADMIN_OPS', 'ADMIN_MODERATOR');

-- CreateEnum
CREATE TYPE "CooperativeRole" AS ENUM ('COOP_ADMIN', 'COOP_ASSISTANT', 'COOP_DRIVER', 'COOP_CONTROLLER');

-- CreateEnum
CREATE TYPE "CooperativeStatus" AS ENUM ('PENDING_VALIDATION', 'VALIDATED', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PricingPlanType" AS ENUM ('COMMISSION', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('MANUAL', 'AUTO_BILLED', 'PAID', 'LATE', 'UNPAID');

-- CreateEnum
CREATE TYPE "SeatCategory" AS ENUM ('VIP', 'PREMIUM', 'CLASSIC', 'STANDARD');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('DRAFT', 'OPEN_FOR_BOOKING', 'CLOSED_FOR_BOOKING', 'DEPARTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingChannel" AS ENUM ('ONLINE', 'WALK_IN');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'PAYMENT_EXPIRED', 'PAYMENT_FAILED', 'CANCELLED_AT_COUNTER', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "BoardingStatus" AS ENUM ('NOT_BOARDED', 'BOARDED', 'ABSENT');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MVOLA', 'ORANGE_MONEY', 'AIRTEL_MONEY', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'REFUNDED_AT_COUNTER');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'PUSH', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SCHEDULED', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('TRANSACTIONAL', 'REMINDER', 'MARKETING', 'SYSTEM');

-- CreateEnum
CREATE TYPE "RatingStatus" AS ENUM ('PENDING_REVIEW', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExportType" AS ENUM ('MANIFEST', 'FINANCIAL_REPORT', 'BOOKINGS', 'RATINGS');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'USER_CREATED', 'USER_DELETED', 'COOP_VALIDATED', 'COOP_SUSPENDED', 'COOP_PLAN_CHANGED', 'FARE_CHANGED', 'SCHEDULE_CHANGED', 'BOOKING_CREATED', 'BOOKING_CANCELLED_AT_COUNTER', 'PAYMENT_INITIATED', 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'RATING_MODERATED', 'ADMIN_ACCESS', 'EXPORT_REQUESTED', 'SEAT_HELD', 'SEAT_RELEASED', 'DEPARTURE_SIGNALED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT,
    "phone" TEXT,
    "passwordHash" TEXT,
    "preferredLang" "Lang" NOT NULL DEFAULT 'FR',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "deletionRequestedAt" TIMESTAMP(3),
    "anonymizedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelerProfile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "nationalIdRef" TEXT,
    "mobileMoneyPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminProfile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "cooperativeId" UUID NOT NULL,
    "role" "CooperativeRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperativeId" UUID NOT NULL,
    "role" "CooperativeRole" NOT NULL,
    "email" CITEXT,
    "phone" TEXT,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "senderUserId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "nameFr" TEXT NOT NULL,
    "nameMg" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cooperative" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "CooperativeStatus" NOT NULL DEFAULT 'PENDING_VALIDATION',
    "contactEmail" CITEXT,
    "contactPhone" TEXT,
    "headOfficeCityId" UUID,
    "logoUrl" TEXT,
    "descriptionFr" TEXT,
    "descriptionMg" TEXT,
    "websiteUrl" TEXT,
    "ratingAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cooperative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CooperativePricingPlan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperativeId" UUID NOT NULL,
    "type" "PricingPlanType" NOT NULL,
    "commissionRate" DOUBLE PRECISION,
    "monthlyFeeMga" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CooperativePricingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CooperativeSubscription" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperativeId" UUID NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amountMga" INTEGER NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'MANUAL',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CooperativeSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CooperativePolicy" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperativeId" UUID NOT NULL,
    "titleFr" TEXT NOT NULL,
    "titleMg" TEXT NOT NULL,
    "bodyFr" TEXT NOT NULL,
    "bodyMg" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CooperativePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatMap" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperativeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "layout" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeatMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperativeId" UUID NOT NULL,
    "seatMapId" UUID NOT NULL,
    "registration" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "model" TEXT,
    "capacity" INTEGER NOT NULL,
    "gpsDeviceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatDefinition" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seatMapId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "category" "SeatCategory" NOT NULL,
    "row" INTEGER,
    "column" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Route" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperativeId" UUID NOT NULL,
    "originCityId" UUID NOT NULL,
    "destinationCityId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "distanceKm" INTEGER,
    "estimatedDurationMin" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteStop" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "routeId" UUID NOT NULL,
    "cityId" UUID NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "offsetMin" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperativeId" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "daysOfWeek" INTEGER[],
    "departureTime" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripInstance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperativeId" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "scheduleId" UUID,
    "vehicleId" UUID NOT NULL,
    "departureAt" TIMESTAMP(3) NOT NULL,
    "arrivalEstimatedAt" TIMESTAMP(3),
    "status" "TripStatus" NOT NULL DEFAULT 'DRAFT',
    "openedForBookingAt" TIMESTAMP(3),
    "closedForBookingAt" TIMESTAMP(3),
    "actualDepartedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "notesFr" TEXT,
    "notesMg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fare" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tripInstanceId" UUID NOT NULL,
    "seatDefinitionId" UUID,
    "category" "SeatCategory",
    "priceMga" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatHold" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tripInstanceId" UUID NOT NULL,
    "seatDefinitionId" UUID NOT NULL,
    "heldByUserId" UUID,
    "heldByStaffId" UUID,
    "channel" "BookingChannel" NOT NULL,
    "bookingId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" TEXT NOT NULL,
    "tripInstanceId" UUID NOT NULL,
    "cooperativeId" UUID NOT NULL,
    "buyerUserId" UUID,
    "createdByStaffId" UUID,
    "channel" "BookingChannel" NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "boardingStatus" "BoardingStatus" NOT NULL DEFAULT 'NOT_BOARDED',
    "totalAmountMga" INTEGER NOT NULL,
    "seatSubtotalMga" INTEGER NOT NULL,
    "platformFeeMga" INTEGER NOT NULL DEFAULT 0,
    "qrPayload" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "cancelledByStaffId" UUID,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingSeat" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bookingId" UUID NOT NULL,
    "tripInstanceId" UUID NOT NULL,
    "seatDefinitionId" UUID NOT NULL,
    "seatCode" TEXT NOT NULL,
    "category" "SeatCategory" NOT NULL,
    "priceMga" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingSeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Passenger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bookingId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "nationalIdRef" TEXT,
    "seatCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Passenger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bookingId" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "amountMga" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "providerTransactionId" TEXT,
    "providerRawPayload" JSONB,
    "errorMessage" TEXT,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformFee" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paymentId" UUID NOT NULL,
    "amountMga" INTEGER NOT NULL,
    "policyRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bookingId" UUID NOT NULL,
    "paymentId" UUID,
    "cooperativeId" UUID NOT NULL,
    "amountMga" INTEGER NOT NULL,
    "pricingPlanRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformFeePolicy" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "ratePercent" DOUBLE PRECISION,
    "fixedAmountMga" INTEGER,
    "minAmountMga" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformFeePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardingEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bookingId" UUID NOT NULL,
    "tripInstanceId" UUID NOT NULL,
    "driverMembershipId" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "boardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbsenceEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bookingId" UUID NOT NULL,
    "tripInstanceId" UUID NOT NULL,
    "markedByMembershipId" UUID NOT NULL,
    "reason" TEXT,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbsenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripDepartureEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tripInstanceId" UUID NOT NULL,
    "reportedByMembershipId" UUID NOT NULL,
    "departedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "TripDepartureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "bodyFr" TEXT NOT NULL,
    "bodyMg" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "bookingId" UUID,
    "templateId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "lang" "Lang" NOT NULL,
    "toAddress" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rating" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bookingId" UUID NOT NULL,
    "cooperativeId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "commentFr" TEXT,
    "commentMg" TEXT,
    "status" "RatingStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "moderatedAt" TIMESTAMP(3),
    "moderatedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectoryEntry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperativeId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "descriptionFr" TEXT,
    "descriptionMg" TEXT,
    "logoUrl" TEXT,
    "regionsServed" TEXT[],
    "ratingAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requestedById" UUID NOT NULL,
    "cooperativeId" UUID,
    "type" "ExportType" NOT NULL,
    "filters" JSONB NOT NULL,
    "format" TEXT NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "resultUrl" TEXT,
    "resultBytes" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actorUserId" UUID,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelerSubscription" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "planName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "activeFrom" TIMESTAMP(3),
    "activeUntil" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravelerSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiClient" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "clientIdHash" TEXT NOT NULL,
    "clientSecretHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiClient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_preferredLang_idx" ON "User"("preferredLang");

-- CreateIndex
CREATE UNIQUE INDEX "TravelerProfile_userId_key" ON "TravelerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminProfile_userId_key" ON "AdminProfile"("userId");

-- CreateIndex
CREATE INDEX "AdminProfile_role_idx" ON "AdminProfile"("role");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_refreshTokenHash_key" ON "AuthSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE INDEX "Membership_cooperativeId_role_idx" ON "Membership"("cooperativeId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_cooperativeId_role_key" ON "Membership"("userId", "cooperativeId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_cooperativeId_status_idx" ON "Invitation"("cooperativeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "City_code_key" ON "City"("code");

-- CreateIndex
CREATE INDEX "City_nameFr_idx" ON "City"("nameFr");

-- CreateIndex
CREATE INDEX "City_nameMg_idx" ON "City"("nameMg");

-- CreateIndex
CREATE INDEX "City_region_idx" ON "City"("region");

-- CreateIndex
CREATE UNIQUE INDEX "Cooperative_slug_key" ON "Cooperative"("slug");

-- CreateIndex
CREATE INDEX "Cooperative_status_idx" ON "Cooperative"("status");

-- CreateIndex
CREATE INDEX "Cooperative_displayName_idx" ON "Cooperative"("displayName");

-- CreateIndex
CREATE INDEX "CooperativePricingPlan_cooperativeId_effectiveFrom_idx" ON "CooperativePricingPlan"("cooperativeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "CooperativeSubscription_cooperativeId_periodStart_idx" ON "CooperativeSubscription"("cooperativeId", "periodStart");

-- CreateIndex
CREATE INDEX "CooperativeSubscription_status_idx" ON "CooperativeSubscription"("status");

-- CreateIndex
CREATE INDEX "CooperativePolicy_cooperativeId_isActive_idx" ON "CooperativePolicy"("cooperativeId", "isActive");

-- CreateIndex
CREATE INDEX "SeatMap_cooperativeId_idx" ON "SeatMap"("cooperativeId");

-- CreateIndex
CREATE INDEX "Vehicle_cooperativeId_isActive_idx" ON "Vehicle"("cooperativeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_cooperativeId_registration_key" ON "Vehicle"("cooperativeId", "registration");

-- CreateIndex
CREATE INDEX "SeatDefinition_seatMapId_category_idx" ON "SeatDefinition"("seatMapId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "SeatDefinition_seatMapId_code_key" ON "SeatDefinition"("seatMapId", "code");

-- CreateIndex
CREATE INDEX "Route_cooperativeId_isActive_idx" ON "Route"("cooperativeId", "isActive");

-- CreateIndex
CREATE INDEX "Route_originCityId_destinationCityId_idx" ON "Route"("originCityId", "destinationCityId");

-- CreateIndex
CREATE UNIQUE INDEX "RouteStop_routeId_orderIndex_key" ON "RouteStop"("routeId", "orderIndex");

-- CreateIndex
CREATE INDEX "Schedule_cooperativeId_isActive_idx" ON "Schedule"("cooperativeId", "isActive");

-- CreateIndex
CREATE INDEX "TripInstance_cooperativeId_departureAt_idx" ON "TripInstance"("cooperativeId", "departureAt");

-- CreateIndex
CREATE INDEX "TripInstance_routeId_departureAt_idx" ON "TripInstance"("routeId", "departureAt");

-- CreateIndex
CREATE INDEX "TripInstance_status_departureAt_idx" ON "TripInstance"("status", "departureAt");

-- CreateIndex
CREATE INDEX "TripInstance_departureAt_idx" ON "TripInstance"("departureAt");

-- CreateIndex
CREATE INDEX "Fare_tripInstanceId_category_idx" ON "Fare"("tripInstanceId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Fare_tripInstanceId_seatDefinitionId_key" ON "Fare"("tripInstanceId", "seatDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "SeatHold_bookingId_key" ON "SeatHold"("bookingId");

-- CreateIndex
CREATE INDEX "SeatHold_tripInstanceId_expiresAt_idx" ON "SeatHold"("tripInstanceId", "expiresAt");

-- CreateIndex
CREATE INDEX "SeatHold_expiresAt_idx" ON "SeatHold"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_reference_key" ON "Booking"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_qrPayload_key" ON "Booking"("qrPayload");

-- CreateIndex
CREATE INDEX "Booking_tripInstanceId_status_idx" ON "Booking"("tripInstanceId", "status");

-- CreateIndex
CREATE INDEX "Booking_cooperativeId_createdAt_idx" ON "Booking"("cooperativeId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_buyerUserId_createdAt_idx" ON "Booking"("buyerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_status_idx" ON "Booking"("status");

-- CreateIndex
CREATE INDEX "Booking_channel_idx" ON "Booking"("channel");

-- CreateIndex
CREATE INDEX "BookingSeat_bookingId_idx" ON "BookingSeat"("bookingId");

-- CreateIndex
CREATE INDEX "BookingSeat_tripInstanceId_isActive_idx" ON "BookingSeat"("tripInstanceId", "isActive");

-- CreateIndex
CREATE INDEX "Passenger_bookingId_idx" ON "Passenger"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerTransactionId_key" ON "Payment"("providerTransactionId");

-- CreateIndex
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_provider_status_idx" ON "Payment"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformFee_paymentId_key" ON "PlatformFee"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_paymentId_key" ON "Commission"("paymentId");

-- CreateIndex
CREATE INDEX "Commission_cooperativeId_createdAt_idx" ON "Commission"("cooperativeId", "createdAt");

-- CreateIndex
CREATE INDEX "Commission_bookingId_idx" ON "Commission"("bookingId");

-- CreateIndex
CREATE INDEX "BoardingEvent_tripInstanceId_idx" ON "BoardingEvent"("tripInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardingEvent_bookingId_key" ON "BoardingEvent"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "AbsenceEvent_bookingId_key" ON "AbsenceEvent"("bookingId");

-- CreateIndex
CREATE INDEX "TripDepartureEvent_tripInstanceId_idx" ON "TripDepartureEvent"("tripInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_code_key" ON "NotificationTemplate"("code");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_status_scheduledFor_idx" ON "Notification"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "Notification_bookingId_idx" ON "Notification"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_bookingId_key" ON "Rating"("bookingId");

-- CreateIndex
CREATE INDEX "Rating_cooperativeId_status_idx" ON "Rating"("cooperativeId", "status");

-- CreateIndex
CREATE INDEX "Rating_userId_idx" ON "Rating"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DirectoryEntry_cooperativeId_key" ON "DirectoryEntry"("cooperativeId");

-- CreateIndex
CREATE UNIQUE INDEX "DirectoryEntry_slug_key" ON "DirectoryEntry"("slug");

-- CreateIndex
CREATE INDEX "DirectoryEntry_displayName_idx" ON "DirectoryEntry"("displayName");

-- CreateIndex
CREATE INDEX "ExportJob_requestedById_createdAt_idx" ON "ExportJob"("requestedById", "createdAt");

-- CreateIndex
CREATE INDEX "ExportJob_cooperativeId_createdAt_idx" ON "ExportJob"("cooperativeId", "createdAt");

-- CreateIndex
CREATE INDEX "ExportJob_status_idx" ON "ExportJob"("status");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "TravelerSubscription_userId_idx" ON "TravelerSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiClient_clientIdHash_key" ON "ApiClient"("clientIdHash");

-- AddForeignKey
ALTER TABLE "TravelerProfile" ADD CONSTRAINT "TravelerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminProfile" ADD CONSTRAINT "AdminProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CooperativePricingPlan" ADD CONSTRAINT "CooperativePricingPlan_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CooperativeSubscription" ADD CONSTRAINT "CooperativeSubscription_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CooperativePolicy" ADD CONSTRAINT "CooperativePolicy_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_seatMapId_fkey" FOREIGN KEY ("seatMapId") REFERENCES "SeatMap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatDefinition" ADD CONSTRAINT "SeatDefinition_seatMapId_fkey" FOREIGN KEY ("seatMapId") REFERENCES "SeatMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_originCityId_fkey" FOREIGN KEY ("originCityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_destinationCityId_fkey" FOREIGN KEY ("destinationCityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripInstance" ADD CONSTRAINT "TripInstance_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripInstance" ADD CONSTRAINT "TripInstance_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripInstance" ADD CONSTRAINT "TripInstance_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripInstance" ADD CONSTRAINT "TripInstance_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fare" ADD CONSTRAINT "Fare_tripInstanceId_fkey" FOREIGN KEY ("tripInstanceId") REFERENCES "TripInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fare" ADD CONSTRAINT "Fare_seatDefinitionId_fkey" FOREIGN KEY ("seatDefinitionId") REFERENCES "SeatDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatHold" ADD CONSTRAINT "SeatHold_tripInstanceId_fkey" FOREIGN KEY ("tripInstanceId") REFERENCES "TripInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatHold" ADD CONSTRAINT "SeatHold_seatDefinitionId_fkey" FOREIGN KEY ("seatDefinitionId") REFERENCES "SeatDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatHold" ADD CONSTRAINT "SeatHold_heldByUserId_fkey" FOREIGN KEY ("heldByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatHold" ADD CONSTRAINT "SeatHold_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tripInstanceId_fkey" FOREIGN KEY ("tripInstanceId") REFERENCES "TripInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingSeat" ADD CONSTRAINT "BookingSeat_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingSeat" ADD CONSTRAINT "BookingSeat_tripInstanceId_fkey" FOREIGN KEY ("tripInstanceId") REFERENCES "TripInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingSeat" ADD CONSTRAINT "BookingSeat_seatDefinitionId_fkey" FOREIGN KEY ("seatDefinitionId") REFERENCES "SeatDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passenger" ADD CONSTRAINT "Passenger_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformFee" ADD CONSTRAINT "PlatformFee_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingEvent" ADD CONSTRAINT "BoardingEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingEvent" ADD CONSTRAINT "BoardingEvent_tripInstanceId_fkey" FOREIGN KEY ("tripInstanceId") REFERENCES "TripInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingEvent" ADD CONSTRAINT "BoardingEvent_driverMembershipId_fkey" FOREIGN KEY ("driverMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceEvent" ADD CONSTRAINT "AbsenceEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceEvent" ADD CONSTRAINT "AbsenceEvent_tripInstanceId_fkey" FOREIGN KEY ("tripInstanceId") REFERENCES "TripInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDepartureEvent" ADD CONSTRAINT "TripDepartureEvent_tripInstanceId_fkey" FOREIGN KEY ("tripInstanceId") REFERENCES "TripInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectoryEntry" ADD CONSTRAINT "DirectoryEntry_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
