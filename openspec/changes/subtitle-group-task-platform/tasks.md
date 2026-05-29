# Tasks

## 1. Foundations and data model

- [x] 1.1 Create the backend and frontend module skeletons for auth, project, template, task, file, notification, subtitle processing, audit, archive-lifecycle, and data-retention domains. Frontend skeleton must be based on the existing `frontend/app` template (React 19 + TypeScript + Vite + Tailwind CSS v3 + shadcn/ui). Establish security baseline: parameterized queries for all database access, HTML escaping for all user-generated content output, file upload validation (MIME type, extension whitelist, size limit, path traversal prevention), and API input validation (length limits, type checking, pagination bounds).
- [x] 1.2 Add relational schema and migrations for registration policies, pending-account verification challenges, QQ group verification settings, audit logs, and user profile fields (`nickname`, `avatar_url`)
- [x] 1.3 Add relational schema and migrations for season-scoped project units (`project_units`, with `episode_length`), projects (with `storage_backend_id`), templates, member slots, tasks, task dependencies, join requests, reviews, files, file versions, upload policies, notification deliveries, translation claims (`translation_claims`, for competitive segment claiming), translation submissions, merge jobs, subtitle conflicts, project wiki documents (`wiki_documents`, with `status` and `pending_content` for approval flow), link-type asset history (`link_history`), review snapshots (`review_snapshots`), delivery checklists (`delivery_checklists`), tag applications (`tag_applications`), project archive and soft-delete states, recycle bin retention records, announcements (`global_announcements`, `project_announcements`), activity timeline events, comments (`comments`, with `file_version_id` and `line_number`), file download temporary links (`download_links`), and storage backend instances (`storage_backends`, with type, configuration, quota, and usage tracking)

## 2. Registration gating and account activation

- [x] 2.1 Implement admin-configurable registration modes for disabled, direct activation, and QQ group verification
- [x] 2.2 Implement registration challenge generation with account-bound random eight-character alphanumeric verification codes that remain valid until successful verification or explicit reset
- [x] 2.3 Implement login gating so pending-verification accounts receive the configured QQ group number, the exact `/verify <code>` command, and copy-ready response metadata instead of a normal session
- [x] 2.4 Implement NoneBot verification-event intake that accepts `/verify <code>` messages only from the configured QQ group, activates the matching pending account, and clears the verification association on success
- [x] 2.5 Implement user profile backend: get and update nickname, upload avatar through the unified storage adapter to the system default storage backend, with user-scoped path isolation

## 3. Project templates and workflow rules

- [x] 3.1 Implement template CRUD services and persistence for workflow blueprints, member slots, upload policies, notification policies, ASS processing settings, delivery checklists, and product configurations (resolution, bitrate, encoder, container format, naming rules). Include per-translator max segment length settings for translation tasks. Include release task type configuration (torrent / torrent+cloud-drive / cloud-drive / other channels) as part of the template workflow blueprint.
- [x] 3.2 Implement project creation from template so new projects inherit task graphs, project rules, delivery checklists, product configurations, and configured defaults while using season-scoped project units as the primary project-unit structure. During project creation the supervisor must select a storage backend from the admin-configured list. Empty member slots default to "pending" and require supervisor manual assignment or open-claim configuration. Template modifications do not affect existing projects.
- [ ] 3.3 Implement task state transition rules, dependency checks, review gates, and supervisory override auditing. Remove task priority field. Non-translation roles execute in strict serial order (source → timing → translation → post-production → encoding → release). Task cancellation freezes downstream tasks that have not yet started; tasks in progress are unaffected but trigger a warning. Assigned members can actively return tasks to the claimable pool without approval, with the return action recorded in audit logs. Overdue tasks are automatically marked "overdue" with escalation notifications but are not auto-reclaimed. When a task is modified or reset to "in-progress", automatically cascade-reset all downstream completed/submitted tasks: non-release roles retain all file version history; release role discards uploaded artifacts (see 3.10). Notify downstream assignees of the reset.
- [ ] 3.4 Implement join-request approval flow, open-task claiming rules, and eligibility validation for role tags. Role tags use an application-and-approval model: users select tags at registration, administrators review and grant or deny, and the system maintains "pending" and "granted" states per user.
- [ ] 3.5 Implement competitive translation segment claiming: translators self-select time ranges from the episode length (provided by source upload), system validates no overlap and per-user max segment limits, and locks claiming when all segments are taken unless someone releases their segment.
- [ ] 3.6 Implement pipeline review gates: translation, post-production, encoding, and release submissions all require supervisor approval before unlocking the next stage.
- [ ] 3.7 Implement project wiki storage and retrieval for Markdown sections and glossary-style table sections, with configurable approval flow (admin global setting, supervisor can override per project). Wiki documents support `status` (draft/pending/approved) and `pending_content`; approved content is assembled for display, pending content shown as diff to supervisors and admins.
- [x] 3.8 Implement activity timeline event generation: automatically emit timeline events on task state changes, reviews, file uploads, member joins, and announcements. Support both project-level event streams and personal global aggregated views.
- [x] 3.9 Implement workload dashboard aggregation queries: personal task dashboard (active and assigned tasks), supervisor project-level view (all members' tasks within supervised projects), and admin global view (all members' tasks across all projects).
- [x] 3.10 Implement release task auto-reset: when a prerequisite task (encoding or earlier) is modified after release submission, automatically reset the release task to pending state and discard previously uploaded release artifacts (torrent files, cloud-drive links, or other content), allowing the release role to re-upload.

## 4. File bucket and version management

- [x] 4.1 Implement the storage adapter abstraction for local files, S3-compatible objects, and link-type assets. The adapter must support multiple configured backend instances and route file operations to the project's bound backend. Link-type assets (cloud-drive links) use an independent `link_history` table, not the binary file version chain.
- [x] 4.2 Implement built-in asset version chains with automatic current-version resolution (prefer latest-approved, fall back to latest), latest pointer, and latest-approved pointer. Each upload creates a new file entity; same-name files do not auto-merge.
- [x] 4.3 Implement upload policy enforcement so each role can submit only the asset types allowed by project policy
- [x] 4.4 Implement the project file bucket API with project-scoped aggregation, filters, version badges, and asset detail lookup. File bucket queries must merge binary file entities and link-type assets into a unified view.
- [x] 4.5 Implement file download authorization with temporary links: anyone with file view permission can click download to generate a link; reuse existing non-expired links for the same user+file; create a new link if the existing one expires within 30s (60s for video files). Link TTL is globally configurable by admin and overridable per project by supervisor, with a minimum floor of 90s. S3 uses presigned URLs, local storage uses database temporary link records. Support "sensitive" file tags that restrict download to specific roles.
- [x] 4.6 Implement batch operations for supervisor: batch assign multiple tasks in a project unit to the same person, and batch archive all units of a project.
- [x] 4.7 Implement storage backend management backend: admin CRUD for storage backend instances (S3 or local), configuration of endpoint/credentials/bucket or root path, per-backend max quota, and usage tracking. Project file operations must route to the project's bound backend.

## 5. Workflow notifications

- [ ] 5.1 Implement workflow event hooks and recipient resolution for assignments, reviews, join approvals, merge outcomes, dependency unlocks, and downstream cascade-resets. Include task-reassignment notifications sent to the previous assignee.
- [x] 5.2 Implement email and QQ NoneBot notification adapters with shared message templates, QQ group-message delivery, and @ mentions for targeted recipients. Support channel escalation: in-site unread N hours triggers email, email unread N hours triggers QQ.
- [x] 5.3 Implement notification preferences, delivery logs, retry handling, and failure recording for each channel attempt. Task comments do not trigger notifications by default; only @ mentions generate directed notifications.
- [x] 5.4 Implement announcement management backend: global announcements (admin CRUD, visible to all users) and project announcements (supervisor or admin CRUD, visible to project members only). Include read tracking if needed for unread badges.

## 6. Subtitle merge and dedup processing

- [x] 6.1 Implement ASS parsing and normalized subtitle data extraction for uploaded translation submissions
- [x] 6.2 Implement segmented translation task support and submission records with time-range metadata
- [x] 6.3 Implement server-side merge jobs that deduplicate identical overlap, create merged versions as independent file entities (separate from source translation file entities), and emit conflict records for unresolved overlap
- [x] 6.4 Implement version-to-version comparison data for the online dedup page in the first release
- [x] 6.5 Implement resolved-conflict write-back so online review decisions create a new merged subtitle version and audit trail. Online dedup page editing is restricted to supervisors and designated conflict reviewers only.

## 7. Frontend workflows and review surfaces

- [x] 7.1 Build the admin registration settings page for registration mode, QQ verification group configuration, and role-tag application review
- [x] 7.2 Build registration and login flows that surface pending-verification state, configured QQ group number, exact verification command, quick-copy action, and role-tag selection
- [x] 7.3 Build project template management and fast project creation flows in the frontend around season-scoped project units, including delivery checklist templates and storage backend selection during project creation
- [ ] 7.4 Build project task views for assignment, claiming, active return, review submission, approval, rejection, and dependency-aware status presentation
- [ ] 7.5 Build the project file bucket page with project-level filters, multi-version markers, context-menu history access, and version history panels. File upload must allow explicit "replace existing file" selection; same-name uploads create independent entities by default.
- [ ] 7.6 Build the online dedup page with version comparison, gray and red total timeline visualization, overlap detail panels, and conflict resolution actions in the first release. Editing actions are only available to supervisors and designated reviewers.
- [ ] 7.7 Build the project wiki page with Markdown editing, glossary-table editing, and project-scoped viewing. Support wiki approval flow indicator when enabled.
- [ ] 7.8 Build notification preference controls and visible delivery status surfaces for workflow actors
- [ ] 7.9 Build project archive and recycle bin management pages: archive action, unarchive recovery, soft-delete from archive, recycle bin listing with restore, and configurable retention settings in admin panel
- [ ] 7.10 Build project search and filter surfaces: project/task name fuzzy search, file bucket filename and tag filtering
- [ ] 7.11 Build delivery checklist editing page for supervisors to customize project-level delivery requirements
- [x] 7.12 Build member skill profile and role-tag application pages for users to select tags and administrators to review and grant
- [ ] 7.13 Build user profile page: nickname editing, avatar upload, and avatar preview
- [ ] 7.14 Build global and project announcement pages: global announcement admin panel, project announcement editor, and announcement display surfaces
- [x] 7.15 Build admin storage backend management page: add/edit/remove storage backends, configure type/endpoint/credentials/quota, and view usage statistics
- [ ] 7.16 Build project activity timeline pages: project-level timeline (all events within a project) and personal global timeline (aggregated events across participating projects)
- [x] 7.17 Build workload dashboard pages: personal task dashboard, supervisor project-level workload view, and admin global workload view
- [ ] 7.18 Build task comment surfaces with file version reference and ASS line-level commenting support for translation tasks

## 8. Integration and verification

- [x] 8.1 Add backend integration tests for registration-disabled, registration-open, and registration-with-group-verification modes, plus role-tag application and approval flows
- [x] 8.2 Add backend integration tests for non-expiring verification codes, pending-verification login responses, QQ group verification success, verification-association cleanup, and invalid-group or invalid-code rejection
- [ ] 8.3 Add backend integration tests for template instantiation (including delivery checklist and product configuration inheritance), join approval, competitive translation segment claiming, task cancellation and downstream freezing, active task return, dependency gating, pipeline review gates, supervisory overrides, and downstream cascade-reset on task modification (non-release roles retain file history; release role discards artifacts)
- [x] 8.4 Add backend integration tests for upload policy enforcement, file entity creation per upload, same-name independent entities, link-type asset history, file version auto-resolution, temporary download links with TTL and sensitive tag control, project file bucket queries, and review snapshot persistence
- [x] 8.5 Add backend integration tests for notification recipient resolution, QQ group @ payload generation, channel escalation rules, task-reassignment notifications, comment @ mentions, overdue marking and escalation, channel delivery logging, and retry handling
- [ ] 8.6 Add backend integration tests for ASS parsing, merge jobs with independent merge entities, duplicate elimination, version comparison generation, conflict generation, online dedup write-back restricted to supervisors, and file version reference in task comments
- [x] 8.7 Add backend integration tests for project wiki persistence, Markdown rendering data, glossary-table retrieval, and wiki approval flow configuration
- [ ] 8.8 Add backend integration tests for project archive/unarchive, soft-delete and recycle bin, archive retention cleanup (preserving only final versions), restoration bypassing cleanup, and announcement CRUD
- [x] 8.9 Add backend integration tests for activity timeline event generation and retrieval, and workload dashboard aggregation queries
- [x] 8.10 Add backend integration tests for user profile updates, avatar upload to default storage backend, and storage backend CRUD with quota enforcement
- [x] 8.11 Add backend integration tests for project creation with storage backend binding, file upload routing to bound backend, and multi-backend isolation
- [ ] 8.12 Add frontend or end-to-end tests for pending-verification UX, project file bucket history access, multi-version markers, online dedup version comparison, conflict review flows, project wiki editing, project archive/recycle bin flows, search and filter surfaces, delivery checklist editing, announcement display, activity timeline, workload dashboard, task commenting with file reference, user profile editing, and storage backend configuration
- [x] 8.13 Add security-focused tests: SQL injection attempts on all search and filter endpoints, XSS payload injection in comments/wiki/announcements/nicknames, file upload bypass attempts (wrong extension, path traversal in filename, oversized files), path traversal in download requests, and API input boundary violations (oversized strings, invalid IDs, out-of-range pagination params)

## 9. Background jobs and scheduled tasks

- [x] 9.1 Implement overdue task auto-marking: periodically scan active tasks past deadline, mark them "overdue", and send escalation notifications via configured channels
- [ ] 9.2 Implement archive retention cleanup: periodically scan archived projects that are NOT soft-deleted and have passed the configured retention days, remove old file versions and intermediate artifacts, preserving only final approved versions per workflow stage. Projects that were soft-deleted before the retention period are handled entirely by recycle bin cleanup (9.3).
- [x] 9.3 Implement recycle bin physical cleanup: periodically scan soft-deleted projects past the configured recycle-bin retention days, permanently delete all associated data
- [x] 9.4 Implement notification channel escalation: periodically check unread in-site notifications past the escalation threshold, upgrade to email; check unread email past threshold, upgrade to QQ
- [x] 9.5 Implement temporary download link expiration cleanup: run every 30 seconds to scan and delete expired `download_links` records
