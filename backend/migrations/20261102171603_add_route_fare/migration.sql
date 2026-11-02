-- CreateTable
CREATE TABLE "RouteFare" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "routeId" UUID NOT NULL,
    "category" "SeatCategory" NOT NULL,
    "priceMga" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteFare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RouteFare_routeId_idx" ON "RouteFare"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "RouteFare_routeId_category_key" ON "RouteFare"("routeId", "category");

-- AddForeignKey
ALTER TABLE "RouteFare" ADD CONSTRAINT "RouteFare_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;
