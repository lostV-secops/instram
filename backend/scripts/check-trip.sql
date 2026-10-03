SELECT
  ti.id,
  ti."departureAt",
  ti.status,
  r."originCityId",
  r."destinationCityId",
  co."nameFr" AS origin,
  cd."nameFr" AS destination,
  COUNT(f.id) AS fare_count,
  v.capacity
FROM "TripInstance" ti
JOIN "Route" r ON ti."routeId" = r.id
JOIN "City" co ON r."originCityId" = co.id
JOIN "City" cd ON r."destinationCityId" = cd.id
LEFT JOIN "Fare" f ON f."tripInstanceId" = ti.id
JOIN "Vehicle" v ON ti."vehicleId" = v.id
WHERE ti.id = 'e2e00000-0000-0000-0001-000000000001'
GROUP BY ti.id, ti."departureAt", ti.status, r."originCityId", r."destinationCityId", co."nameFr", cd."nameFr", v.capacity;
