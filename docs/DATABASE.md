# Database schema

PostgreSQL relational schema is managed with Prisma. `apps/api/prisma/schema.prisma` is the source definition.

```mermaid
erDiagram
    USER ||--o{ PROJECT : owns
    USER ||--o{ REVOKED_TOKEN : revokes
    PROJECT ||--o{ TASK : contains
    USER {
      string id PK
      string fullName
      string email UK
      string passwordHash
      datetime createdAt
    }
    PROJECT {
      string id PK
      string ownerId FK
      string name
      string description
      enum status
      datetime startDate
      datetime endDate
      datetime createdAt
      datetime updatedAt
    }
    TASK {
      string id PK
      string projectId FK
      string name
      string description
      enum priority
      enum status
      datetime dueDate
      datetime createdAt
      datetime updatedAt
    }
    REVOKED_TOKEN {
      string jti PK
      string userId FK
      datetime expiresAt
    }
```

Deleting a user cascades to owned projects and revoked tokens; deleting a project cascades to its tasks. User email is unique. Indexes support owner/status project queries, task filters, and token expiry cleanup.
