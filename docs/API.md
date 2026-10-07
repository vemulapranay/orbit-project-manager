# Orbit REST API

Base URL: `http://localhost:4000/api`. JSON request and response bodies. Protected endpoints require `Authorization: Bearer <JWT>`. Dates use ISO 8601. Enumerations are uppercase.

## Authentication

| Method | Endpoint | Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `{ "fullName": "Jamie Morgan", "email": "jamie@example.com", "password": "at-least-8-chars" }` | `201 { user, token }` |
| POST | `/auth/login` | `{ "email": "jamie@example.com", "password": "…" }` | `{ user, token }` |
| POST | `/auth/logout` | none | `204`; revokes the bearer token |
| GET | `/auth/me` | none | `{ user }` |

Registration rejects duplicate email addresses with `409`. Login failures return `401`; repeated authentication attempts are rate limited. The user object never contains password hashes.

## Projects

Allowed status values: `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`.

| Method | Endpoint | Behavior |
|---|---|---|
| GET | `/projects?search=design&status=IN_PROGRESS` | List only the caller's projects; optional case-insensitive name search and status filter. Includes task count. |
| GET | `/projects/:id` | Project with its tasks; `404` when missing or not owned. |
| POST | `/projects` | Create `{ name, description?, status?, startDate?, endDate? }`. |
| PUT | `/projects/:id` | Update provided project fields. |
| DELETE | `/projects/:id` | Delete project and its tasks (`204`). |

Dates are ISO date-time strings or `null`. End date must not precede start date. Names are required and trimmed.

## Tasks

Status values: `PENDING`, `IN_PROGRESS`, `COMPLETED`. Priority values: `LOW`, `MEDIUM`, `HIGH`.

| Method | Endpoint | Behavior |
|---|---|---|
| GET | `/tasks?search=brief&status=PENDING&priority=HIGH&projectId=…` | List tasks belonging to the caller's projects; all filters are optional. Includes project name. |
| GET | `/tasks/:id` | Read a task; `404` when missing or not owned. |
| POST | `/tasks` | Create `{ projectId, name, description?, status?, priority?, dueDate? }`. Project must belong to caller. |
| PUT | `/tasks/:id` | Update provided fields. A new project must also be owned by caller. |
| DELETE | `/tasks/:id` | Delete task (`204`). |

## Dashboard and health

- `GET /dashboard` returns `{ totalProjects, projectsInProgress, totalTasks, completedTasks, pendingTasks }` for the authenticated user.
- `GET /health` returns `{ status: "ok" }`.

## Errors

Errors have `{ "error": "…" }`; validation errors also include a `details` object. Common status codes: `400` invalid input, `401` missing/expired/revoked token, `404` missing or inaccessible resource, `409` duplicate email, `429` rate limit. Internal errors return a generic message; details are logged server-side.
