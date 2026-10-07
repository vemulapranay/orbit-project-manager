# Orbit — Project Management System

A full stack project and task workspace. The responsive web client and Android app use the same Express API and PostgreSQL database.

## Included

- Account registration, sign in, sign out, JWT authentication, bcrypt password hashing, and revoked session tokens.
- Private project and task CRUD, ownership checks on every protected resource, input validation, search, status and priority filters.
- Live dashboard counts scoped to the signed-in user.
- React + Vite web app; Expo React Native Android app using secure device storage and pull-to-refresh.
- PostgreSQL schema in Prisma and Docker Compose for local database setup.

## Requirements

- Node.js 20 or later and npm 10+
- Docker Desktop (or a PostgreSQL 14+ instance)

## Run locally

1. Copy `apps/api/.env.example` to `apps/api/.env`, `apps/web/.env.example` to `apps/web/.env`, and `apps/mobile/.env.example` to `apps/mobile/.env`. Set `JWT_SECRET` in the API file to a random value of at least 32 characters. The values shown are for local development only.
2. Start the database: `docker compose up -d db`
3. Install dependencies from the repository root: `npm install`
4. Create the schema and Prisma client: `npm run db:migrate` (enter `init` as the migration name if prompted), then `npm run db:generate`.
5. Start API and web together: `npm run dev`.
6. Visit `http://localhost:5173`; the API listens at `http://localhost:4000`.

For Expo, set `EXPO_PUBLIC_API_URL` to an address reachable from the phone. On a physical device, use your computer's LAN IP instead of `localhost` (for example, `http://192.168.1.20:4000/api`). Then run `npm run dev:mobile` and scan the Expo QR code. Android emulator users can normally use `http://10.0.2.2:4000/api`.

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | `apps/api/.env` | PostgreSQL connection string, including database and schema. |
| `JWT_SECRET` | `apps/api/.env` | Secret used to sign seven-day access tokens; use a unique random value of 32+ characters. |
| `PORT` | `apps/api/.env` | API listen port (defaults to `4000`). |
| `WEB_ORIGIN` | `apps/api/.env` | Allowed web origin(s), comma separated. Set this to the deployed web origin in production. |
| `VITE_API_URL` | `apps/web/.env` | Base API URL including `/api`. |
| `EXPO_PUBLIC_API_URL` | `apps/mobile/.env` | Base API URL reachable by the device including `/api`. |

## Database schema

See [Database schema and ER diagram](docs/DATABASE.md) and `apps/api/prisma/schema.prisma`. Schema changes should be committed as Prisma migrations.

## API documentation

See [API reference](docs/API.md). All resources are JSON. Protected requests use `Authorization: Bearer <token>`.

## Render web and API deployment

`render.yaml` defines the API, static web app, and PostgreSQL database in Singapore. Once this repository is on GitHub, create a Render Blueprint from the repository and apply `render.yaml`. The file uses free plans to avoid creating paid services. Render's free Postgres database expires after 30 days, and free web services may sleep when idle; upgrade the database before using it beyond the assessment period. If Render assigns different service hostnames, update `WEB_ORIGIN`, `VITE_API_URL`, and the API URL in `apps/mobile/eas.json` to match.

The API deploy runs `prisma migrate deploy` before startup. The web service builds `apps/web/dist` and uses the deployed API URL. For a manual deploy, build the API with `npm --workspace apps/api run build`, start it with `npm --workspace apps/api run start`, and build the web app with `npm --workspace apps/web run build`.

## Android APK

`apps/mobile/eas.json` contains an internal `preview` APK profile and a production AAB profile. After connecting an Expo account, install EAS CLI with `npm install --global eas-cli`, run `eas login`, then from `apps/mobile` run `eas build --platform android --profile preview`. The APK can be shared through the EAS build page. To demonstrate cross-platform syncing, deploy the API and web app first, build the APK against that API, then record the five-minute scenario from the task brief. This workspace contains the app source and build configuration; actual public URLs, APK, and recording require the connected GitHub, Render, and Expo accounts.

## Security notes

Passwords are hashed with bcrypt (cost 12). Authentication endpoints are rate limited. Protected routes verify JWTs and query project ownership through database relations; tasks inherit authorization from their project. Prisma parameterizes database operations. The API limits request body size and uses Helmet. Logout revokes the current token server side. Use HTTPS, strong secrets, and production database credentials when deploying.
