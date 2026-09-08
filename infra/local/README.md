# Local Development

```bash
npm install
cp .env.example .env
docker compose -f infra/local/docker-compose.yml up -d      # PostgreSQL
npm run db:migrate
npm run db:seed
npm run dev                                                  # http://localhost:3000
```

By default only PostgreSQL runs in Docker, and the web app runs on the host with hot reload. The database port is bound to `127.0.0.1` so the development database is not reachable from the network.

Optional profiles:

```bash
# Run the production image locally, to check the Docker build
docker compose -f infra/local/docker-compose.yml --profile app up --build

# Run the development mock API
docker compose -f infra/local/docker-compose.yml --profile mock-api up
```

Mock auth is enabled, seeded with three personas and one deliberately disabled protocol type. No Imperial SSO secrets are needed. `mock.colleague@ic.ac.uk` has not accepted the agreement, so the first-access gate can be exercised.

Reset the database:

```bash
docker compose -f infra/local/docker-compose.yml down -v
docker compose -f infra/local/docker-compose.yml up -d
npm run db:migrate && npm run db:seed
```
