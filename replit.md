# Syncr

## Overview

Syncr is a full-stack web application for musicians and music teams to organize, analyze, and experiment with album track sequencing. Artists upload audio files (MP3/WAV), the app automatically analyzes BPM and Camelot musical key in the browser, and users can create multiple playlist "sequences" to experiment with different track orders. Projects can be shared via a public read-only link.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: Supabase Auth (email + Google)
- **Storage**: Supabase Storage (audio files, cover art)
- **Frontend**: React + Vite + Tailwind CSS
- **Drag and Drop**: @dnd-kit/core, @dnd-kit/sortable
- **Audio Analysis**: Meyda.js (in-browser BPM + key detection)
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Architecture

```
Frontend (React + Vite)     → /
API Server (Express)        → /api
PostgreSQL (Drizzle ORM)    → DATABASE_URL
Supabase Storage            → SUPABASE_STORAGE_BUCKET
Supabase Auth               → VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
```

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Database Schema

- **users** — synced from Supabase Auth on first login (id, supabaseId, email, displayName, avatarUrl)
- **teams** — collaborative team workspaces (id, name, createdBy)
- **team_members** — users in a team with role (owner|admin|member)
- **projects** — album/EP projects with shareToken for public sharing; optional teamId for team-owned projects
- **project_members** — many-to-many users ↔ projects with role (owner|editor)
- **tracks** — uploaded audio files with BPM, camelotKey, durationSeconds, fileUrl (object storage path); nullable `teamId` (team library) + nullable `projectId` (project library)
- **sequences** — named playlist versions within a project
- **sequence_tracks** — ordered tracks within a sequence (orderIndex for drag-and-drop)

## Teams Feature

Syncr uses Figma-style team workspaces:
- Users can create teams (e.g. "Tedd Music") and invite members by email
- Team members have roles: owner, admin, member
- Projects can be personal or team-owned (set teamId on creation)
- Dashboard sidebar switches between Personal and team workspaces
- Profile area shows `{Name} ({Team Name})` when in a team workspace
- Team settings page (`/teams/:teamId/settings`) manages members and team name
- Access: team members can see all projects in their team; project_members check still applies for direct personal project membership
- Team avatar shows uploaded `imageUrl` if available (uploaded via Team Settings page)
- Teams have optional `imageUrl` column; uploaded with the same backend upload flow as cover art

## Audio Analysis

- Runs entirely in the browser using Meyda.js + Web Audio API
- BPM: onset detection + tempo estimation
- Key: chroma features → Camelot notation mapping (e.g. C major → 8B)
- Results are sent to the server after upload and stored in the database

## File Upload Flow

1. Request upload URL from `/api/storage/uploads/request-url`
2. PUT file directly to Supabase Storage via the returned signed upload URL
3. Run Meyda analysis on the audio buffer in the browser (returns bpm, camelotKey, durationSeconds)
4. POST track record to `/api/projects/:projectId/tracks` with analysis results

### Cover Art & Team Image Upload
- Same upload flow: request URL, PUT image, then PATCH project/team with `coverImageUrl`/`imageUrl`
- Workspace header has clickable cover thumbnail for project cover art
- Project title is inline-editable in the workspace header
- `ProjectCover` component shows cover image or a dark music-icon placeholder; accepts `fill` prop for CSS-sized containers

## Track Library Model

Tracks have nullable `teamId` (team library) and nullable `projectId` (project library):
- A track can be team-only (shared but not yet in any project), project-only (personal track), or both (team track currently assigned to a specific project).
- `POST /api/projects/:projectId/tracks` (upload) inherits `teamId` from the parent project automatically.
- `POST /api/projects/:projectId/library/:trackId` assigns an existing team track into a project. Requires team membership; rejects 409 if track already belongs to another project.
- `DELETE /api/projects/:projectId/tracks/:trackId` smart-unlinks (sets `projectId=null`) for team-linked tracks; hard-deletes otherwise.
- `PATCH /api/projects/:projectId/tracks/:trackId` allows metadata edits for any project member, but renaming a team-linked track requires team admin/owner.
- `DELETE /api/teams/:teamId/tracks/:trackId` and renaming via `/teams/:teamId/tracks/:trackId` require team admin/owner.
- Track responses include `uploaderName`, `uploaderAvatarUrl`, and `projectTitle` (joined from users + projects).

## Sharing

- Each project has a UUID `shareToken` generated on creation
- Public route: `/share/:token` — no auth required, read-only
- Audio streamed via `/api/storage/objects/:path` (no download headers)
- `sharedSequenceIds` (JSON array on projects table): null = all sequences visible; array = only those IDs visible on the share page
- Share modal in workspace header lets owners toggle per-sequence visibility

## Artifacts

- **sequence** — React + Vite frontend (preview at `/`)
- **api-server** — Express API server (preview at `/api`)

## Environment Variables

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — Supabase auth
- `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` — PostgreSQL
- `SUPABASE_STORAGE_BUCKET` — private Supabase Storage bucket for uploads
- `PORT`, `BASE_PATH`, `API_PROXY_TARGET` — local dev server configuration
