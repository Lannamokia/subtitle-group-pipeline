## ADDED Requirements

### Requirement: Upload policy matrix controls allowed submission types by role
The system SHALL allow administrators to define which asset types each role may submit, and task submission surfaces MUST enforce those allowed types.

#### Scenario: Role-based upload options are shown
- **WHEN** a member opens a task submission form
- **THEN** the system SHALL show only the asset types allowed for that task's role and project policy

#### Scenario: Disallowed asset type is rejected
- **WHEN** a member submits an asset type that is not allowed by the configured upload policy matrix
- **THEN** the system MUST reject the submission and preserve the existing task state

### Requirement: Project file bucket aggregates all project assets
The system SHALL provide a project-scoped file bucket that aggregates every binary asset and link-type asset uploaded for the project.

#### Scenario: View the project file bucket
- **WHEN** an authorized user opens a project's file bucket
- **THEN** the system SHALL list the project's assets with filters for project unit, role, task, uploader, asset type, and upload time

#### Scenario: Inspect a file bucket item
- **WHEN** a user views an asset in the project file bucket
- **THEN** the system SHALL show the asset's current version, version count, latest update time, source task, and uploader

### Requirement: Every asset uses built-in version management
The system SHALL maintain a version chain for every asset, including binary files and link-type deliveries, and SHALL create a new version instead of silently overwriting existing content.

#### Scenario: Upload a new binary version
- **WHEN** a user uploads a replacement binary for an existing asset
- **THEN** the system SHALL create a new file version that records uploader, timestamp, change note, source task, parent version, and review status

#### Scenario: Update a link delivery
- **WHEN** a user changes a submitted drive link or extraction code for an existing asset
- **THEN** the system SHALL create a new version entry for that link asset rather than editing the previous version in place

#### Scenario: Preserve version pointers
- **WHEN** a new version is created or approved
- **THEN** the system SHALL maintain pointers for the current version, latest version, and latest approved version

### Requirement: Multi-version assets are visibly marked and support history access
The system SHALL visually mark assets that have more than one version and SHALL provide direct access to version history from the project file bucket.

#### Scenario: Multi-version marker is shown
- **WHEN** an asset has more than one recorded version
- **THEN** the system SHALL display a visible marker indicating that additional versions are available

#### Scenario: Open history from context menu
- **WHEN** a user opens the context menu for a multi-version asset in the project file bucket
- **THEN** the system SHALL provide an action to open the asset's version history panel

#### Scenario: Review historical versions
- **WHEN** a user opens an asset's version history panel
- **THEN** the system SHALL show version number, change note, uploader, upload time, review status, and actions for downloading, promoting, or rolling back an authorized version