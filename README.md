# Sheet2Web

Sheet2Web is a NestJS backend API for turning public Google Sheets into publishable web views. It provides user authentication, Google Sheets data-source syncing, view publishing, public view access, viewer dashboards, permissions, share tokens, and supporting domain modules.

## Table of Contents

- [About The Project](#about-the-project)
- [Tech Stack](#tech-stack)
- [Current Features](#current-features)
- [System Flow](#system-flow)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Running The Project](#running-the-project)
- [Usage](#usage)
- [API Endpoints](#api-endpoints)
- [Project Structure](#project-structure)
- [Scripts](#scripts)
- [Future Updates](#future-updates)
- [Notes](#notes)

## About The Project

This project is a backend API built with NestJS and TypeScript. It lets authenticated users connect Google Sheets as data sources, read sheet metadata and values through the Google Sheets API, create views from full sheets or ranges, publish snapshots, and expose published views by slug with optional owner, permission, or share-token access.

## Tech Stack

- NestJS 11
- TypeScript
- TypeORM
- PostgreSQL (`pg`)
- Passport Local and Passport JWT
- JWT (`@nestjs/jwt`)
- Class Validator and Class Transformer
- Swagger/OpenAPI (`@nestjs/swagger`, `swagger-ui-express`)
- Google Sheets API (`googleapis`)
- Nest Config Module
- Nest Mailer Module with Handlebars templates
- Bcrypt
- Day.js
- UUID
- Jest
- ESLint and Prettier

## Current Features

- User registration, login, activation-code verification, activation-code retry, forgot-password, and reset-password flows.
- Password hashing with `bcrypt`.
- JWT access token generation and validation.
- Global JWT protection with `APP_GUARD`, with selected public routes using `@Public()`.
- Global role checking with `RolesGuard`; admin-only routes currently exist in the users module.
- Swagger UI served at `/api/docs`.
- PostgreSQL persistence through TypeORM entities, repositories, transactions, and query builders.
- Google Sheets data-source creation from a Google Sheet URL.
- Google Sheet metadata sync, including spreadsheet title and sheet/tab metadata.
- Data-source listing with pagination, search, and status filtering.
- Data-source updating, soft deletion, sheet listing, and data preview.
- View creation, owner listing, updating, publishing, automatic republishing, and published snapshot storage.
- Public view access by slug through `/api/v/:slug`.
- Optional authenticated access detection on public views.
- Private published view access by owner, explicit permission, or valid share token.
- Viewer dashboard and viewer listing for views explicitly shared through permissions.
- View permissions by user email.
- Share-token creation, listing, and revocation.
- Mail sending for account activation and password reset.
- Supporting domain modules for themes, source sheets, source tables, sync histories, audit logs, cell change logs, and view snapshots. These modules currently provide entities/services/DTOs but do not expose public CRUD controllers.

## System Flow

### Authentication Flow

1. A user registers with email, password, and full name.
2. The server hashes the password and creates an inactive user.
3. The server sends an activation code by email.
4. The user verifies the activation code.
5. The user logs in with email and password.
6. `LocalAuthGuard` validates the credentials.
7. `AuthService` creates a JWT payload containing `sub`, `email`, and `role`.
8. The client sends the token in the `Authorization` header.
9. `JwtStrategy` validates the token.
10. The validated user payload is attached to `req.user`.
11. `RolesGuard` checks `@Roles(...)` metadata when a route requires a role.

### Sheet-to-Web Flow

1. An authenticated user creates a data source with a Google Sheet URL.
2. The server extracts the Google spreadsheet ID from the URL.
3. `GoogleSheetsService` reads spreadsheet metadata using `GOOGLE_SHEETS_API_KEY`.
4. The server stores the data source and its sheet tabs.
5. The user creates a view from a data source and source sheet.
6. The user publishes the view.
7. The server reads Google Sheet values for the selected full sheet or range.
8. The server stores the published data as a current `ViewSnapshot`.
9. A published view can be opened through `/api/v/:slug`.
10. Private views require ownership, explicit permission, or a valid `shareToken` query parameter.
11. Published views are automatically republished on a short interval by `ViewsService`.

## Getting Started

### Prerequisites

- Node.js compatible with NestJS 11 and TypeScript target `ES2023`
- npm
- PostgreSQL database
- Google Sheets API key
- SMTP credentials for activation and password reset emails

### Installation

```bash
npm install
```

## Environment Variables

The project reads configuration through `ConfigService`. Create a `.env` file in the project root. A blank `.env.example` is included so new developers know which variables must be filled.

```env
PORT=3000
DATABASE_URL=postgresql://username:password@localhost:5432/sheet2web

JWT_SECRET=your_jwt_secret
JWT_ACCESS_TOKEN_EXPIRED=3600

GOOGLE_SHEETS_API_KEY=your_google_sheets_api_key

MAIL_HOST=smtp.example.com
MAIL_PORT=465
MAIL_USER=your_mail_user
MAIL_PASS=your_mail_password
MAIL_FROM="Sheet2Web <no-reply@example.com>"
```

Notes:

- `PORT` is required by `main.ts`.
- `DATABASE_URL` is used by TypeORM with `type: 'postgres'`.
- `JWT_ACCESS_TOKEN_EXPIRED` is converted to a number before being passed to JWT sign options.
- `MAIL_PORT` is read from the environment and passed directly to the mailer config.
- Google Sheets must be publicly readable when using the current API-key based integration.

## Running The Project

```bash
# Development
npm run start:dev

# Standard start
npm run start

# Build
npm run build

# Production
npm run start:prod
```

## Usage

Most API routes use the global prefix:

```txt
http://localhost:3000/api
```

Swagger UI is available at:

```txt
http://localhost:3000/api/docs
```

### Login Example

```http
POST /api/auth/login
Content-Type: application/json
```

```json
{
  "email": "user@example.com",
  "passwordHash": "plain_password"
}
```

Successful login returns an access token:

```json
{
  "access_token": "<jwt_access_token>"
}
```

Send the token to protected routes:

```http
Authorization: Bearer <access_token>
```

### Create Data Source Example

```http
POST /api/data-sources
Authorization: Bearer <access_token>
Content-Type: application/json
```

```json
{
  "sourceUrl": "https://docs.google.com/spreadsheets/d/<spreadsheet_id>/edit",
  "title": "Sales Sheet"
}
```

### Create View Example

```http
POST /api/views
Authorization: Bearer <access_token>
Content-Type: application/json
```

```json
{
  "dataSourceId": "00000000-0000-0000-0000-000000000000",
  "sourceSheetId": "00000000-0000-0000-0000-000000000000",
  "name": "Public Sales View",
  "selectionType": "range",
  "rangeA1Notation": "A1:D20",
  "accessMode": "public",
  "useFirstRowAsHeader": true
}
```

## API Endpoints

All endpoints below include the `/api` global prefix.

### Auth

| Method | Endpoint                    | Description                                  | Auth Required |
| ------ | --------------------------- | -------------------------------------------- | ------------- |
| POST   | `/api/auth/register`        | Register a user and send an activation email | No            |
| POST   | `/api/auth/check-code`      | Verify an activation code                    | No            |
| POST   | `/api/auth/retry-active`    | Send a new activation code                   | No            |
| POST   | `/api/auth/forgot-password` | Send a password reset code                   | No            |
| POST   | `/api/auth/reset-password`  | Reset password with a valid code             | No            |
| POST   | `/api/auth/login`           | Login and receive a JWT access token         | No            |

### Users

| Method | Endpoint            | Description                         | Auth Required |
| ------ | ------------------- | ----------------------------------- | ------------- |
| POST   | `/api/users`        | Create a user                       | Yes, admin    |
| GET    | `/api/users`        | List users                          | Yes, admin    |
| GET    | `/api/users/me`     | Get current user's profile          | Yes           |
| GET    | `/api/users/:id`    | Get a user by ID                    | Yes, admin    |
| PATCH  | `/api/users/:id`    | Update a user                       | Yes, admin    |
| DELETE | `/api/users/:id`    | Soft-delete a user                  | Yes, admin    |

### Data Sources

| Method | Endpoint                        | Description                              | Auth Required |
| ------ | ------------------------------- | ---------------------------------------- | ------------- |
| GET    | `/api/data-sources`             | List current user's data sources         | Yes           |
| POST   | `/api/data-sources`             | Create a Google Sheets data source       | Yes           |
| PATCH  | `/api/data-sources/:id`         | Update a data source                     | Yes           |
| DELETE | `/api/data-sources/:id`         | Soft-delete a data source and archive related active views | Yes |
| GET    | `/api/data-sources/:id/sheets`  | List sheets for a data source            | Yes           |
| POST   | `/api/data-sources/:id/preview` | Preview values from a source sheet/range | Yes           |

`GET /api/data-sources` supports `page`, `limit`, `search`, and `status`.

### Views

| Method | Endpoint                   | Description                          | Auth Required |
| ------ | -------------------------- | ------------------------------------ | ------------- |
| POST   | `/api/views`               | Create a draft view                  | Yes           |
| GET    | `/api/views/my`            | List current user's views            | Yes           |
| GET    | `/api/views/:id`           | Get an owned view by ID              | Yes           |
| PATCH  | `/api/views/:id`           | Update an owned draft view           | Yes           |
| PATCH  | `/api/views/:id/published` | Update an owned published view       | Yes           |
| POST   | `/api/views/:id/publish`   | Publish a view and create a snapshot | Yes           |
| DELETE | `/api/views/:id`           | Soft-delete a view                   | Yes           |
| GET    | `/api/v/:slug`             | Read a published view by slug        | No            |

`GET /api/views/my` supports `page`, `limit`, `search`, `status`, and `accessMode`.

`GET /api/v/:slug` supports optional `Authorization: Bearer <access_token>` and optional `?shareToken=<token>` for private published views.

### View Permissions

| Method | Endpoint                                       | Description                | Auth Required |
| ------ | ---------------------------------------------- | -------------------------- | ------------- |
| POST   | `/api/views/:viewId/permissions`               | Grant view access by email | Yes           |
| GET    | `/api/views/:viewId/permissions`               | List view permissions      | Yes           |
| DELETE | `/api/views/:viewId/permissions/:permissionId` | Remove a permission        | Yes           |

### Share Tokens

| Method | Endpoint                                          | Description          | Auth Required |
| ------ | ------------------------------------------------- | -------------------- | ------------- |
| POST   | `/api/views/:viewId/share-tokens`                 | Create a share token | Yes           |
| GET    | `/api/views/:viewId/share-tokens`                 | List share tokens    | Yes           |
| PATCH  | `/api/views/:viewId/share-tokens/:tokenId/revoke` | Revoke a share token | Yes           |

Share-token creation accepts optional `name` and `expiresAt`. The raw token appears only in the create response URL; list responses show a masked preview.

### Viewer

| Method | Endpoint                | Description                                               | Auth Required |
| ------ | ----------------------- | --------------------------------------------------------- | ------------- |
| GET    | `/api/viewer/dashboard` | Get viewer dashboard data                                 | Yes           |
| GET    | `/api/viewer/views`     | List published views explicitly shared with current viewer | Yes           |

`GET /api/viewer/views` supports `page`, `limit`, `search`, `accessMode`, and `sort`.

### Supporting Domain Modules

The following modules currently provide entities, DTOs, and services for internal/domain use, but do not expose public CRUD controllers:

- `audit-logs`
- `cell-change-logs`
- `source-sheets`
- `source-tables`
- `sync-histories`
- `themes`
- `view-snapshots`

## Project Structure

```txt
src/
|-- auth/                 # Authentication, local strategy, JWT strategy, guards
|-- common/               # Shared enums
|-- decorator/            # Custom decorators such as @Public() and @Roles()
|-- google-sheets/        # Google Sheets API integration
|-- helpers/              # Shared helpers such as password hashing
|-- mail/                 # Mail templates
|-- modules/              # Feature modules and database entities
|-- app.module.ts         # Root module and infrastructure configuration
|-- app.controller.ts     # Root status-style endpoint
`-- main.ts               # Application bootstrap, validation pipe, Swagger setup
```

Key feature modules under `src/modules/`:

- `users`: user persistence, activation code handling, password reset, profile, and admin user management.
- `data-sources`: Google Sheet data-source management, sheet listing, pagination, filtering, and preview.
- `views`: view configuration, publishing, snapshots, auto-publishing, and public view lookup.
- `viewer`: viewer dashboard and explicitly shared published view listing.
- `view-permissions`: user-level view access.
- `share-tokens`: token-based view sharing.
- `themes`, `source-sheets`, `source-tables`, `sync-histories`, `audit-logs`, `cell-change-logs`, `view-snapshots`: supporting domain modules without exposed CRUD controllers.

## Scripts

| Script                | Description                                |
| --------------------- | ------------------------------------------ |
| `npm run build`       | Build the NestJS project                   |
| `npm run format`      | Format source and test files with Prettier |
| `npm run start`       | Start the NestJS app                       |
| `npm run start:dev`   | Start the app in watch mode                |
| `npm run start:debug` | Start the app in debug watch mode          |
| `npm run start:prod`  | Run the built app from `dist/main`         |
| `npm run lint`        | Run ESLint with auto-fix                   |
| `npm run test`        | Run unit tests                             |
| `npm run test:watch`  | Run tests in watch mode                    |
| `npm run test:cov`    | Run tests with coverage                    |
| `npm run test:debug`  | Run tests in debug mode                    |
| `npm run test:e2e`    | Run e2e tests                              |

## Future Updates

- Add Excel file support as an additional data source, allowing users to import and manage data from `.xlsx` files besides Google Sheets.
- Add refresh token support.
- Expand role-based authorization beyond the current admin-only users endpoints.
- Improve automated test coverage for auth, data-source sync, publishing, permissions, and share tokens.
- Add Docker and Docker Compose for local PostgreSQL and app startup.
- Add CI checks for linting, tests, and build.
- Add write-back support from the web app to Google Sheets, enabling users to edit records in the web interface and sync those changes back to the source sheet.
- Integrate the UI/API into existing tools, for example Google Sheets with Apps Script or Microsoft Teams.

## Notes

- Protected routes require `Authorization: Bearer <access_token>`.
- Public routes are marked with the custom `@Public()` decorator.
- Role-protected routes use the custom `@Roles()` decorator and global `RolesGuard`.
- `JWT_SECRET` must match between token signing and validation.
- `GOOGLE_SHEETS_API_KEY` is required for data-source creation, sheet listing, preview, and view publishing.
- The current Google Sheets integration uses an API key, so linked spreadsheets must be publicly readable.
- TypeORM is configured with `synchronize: false`; database schema creation/migration must be handled outside the current runtime configuration.
- `ValidationPipe` is enabled globally with `whitelist` and `forbidNonWhitelisted`.
- Swagger UI is currently available at `/api/docs`.
- The root status endpoint is excluded from the `/api` prefix and is protected unless explicitly made public in code.
