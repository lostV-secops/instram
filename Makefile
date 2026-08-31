.PHONY: up down logs db-migrate db-seed test reset

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f backend

db-migrate:
	docker compose exec backend npx prisma migrate dev

db-seed:
	docker compose exec backend npx prisma db seed

test:
	cd backend && npm test

reset:
	docker compose down -v && docker compose up -d
