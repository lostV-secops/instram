SELECT ti.id, ti."departureTime", r.origin, r.destination, ti.status, ti."availableSeats"
FROM "TripInstance" ti
JOIN "Trip" t ON ti."tripId" = t.id
JOIN "Route" r ON t."routeId" = r.id
ORDER BY ti."departureTime" ASC
LIMIT 10;
