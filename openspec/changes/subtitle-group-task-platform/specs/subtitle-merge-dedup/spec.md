# Subtitle Merge Dedup

## ADDED Requirements

### Requirement: ASS submissions are parsed as structured subtitle data

The system SHALL parse ASS subtitle submissions into structured subtitle data before merge or deduplication processing.

#### Scenario: Parse an ASS submission

- **WHEN** a translator uploads an ASS subtitle file
- **THEN** the system SHALL extract script metadata, styles, event timing, layers, comments, and dialogue text into a structured representation

#### Scenario: Reject unsupported subtitle structure

- **WHEN** a submitted subtitle file cannot be parsed into the required structure
- **THEN** the system MUST reject the processing job and report the parse failure to the uploader and designated reviewers

### Requirement: Translation work can be split by time range across multiple contributors

The system SHALL support translation tasks that are scoped to explicit time ranges so multiple translators can submit work for different segments of the same project unit.

#### Scenario: Create segmented translation tasks

- **WHEN** a supervisor configures translation for a project unit
- **THEN** the system SHALL allow the work to be divided into multiple time-ranged translation tasks

#### Scenario: Record submission coverage

- **WHEN** a translator submits a translation for a segmented task
- **THEN** the system SHALL record the submission's covered time range, source task, uploader, and source version metadata

### Requirement: The server merges submissions and deduplicates non-conflicting events

The system SHALL perform server-side normalization, deduplication, and merge processing across subtitle submissions for the same project unit.

#### Scenario: Merge identical overlapping entries

- **WHEN** two submissions contain events with overlapping time ranges and identical subtitle text
- **THEN** the system SHALL deduplicate those events into a single merged result

#### Scenario: Produce a merged version without conflicts

- **WHEN** all submissions can be normalized and merged without unresolved conflicts
- **THEN** the system SHALL create a merged subtitle version and make it available to downstream workflow steps

### Requirement: Conflicting or overlapping subtitle events require reviewable conflict records

The system SHALL create explicit conflict records for subtitle events that overlap in time but cannot be automatically reconciled.

#### Scenario: Create conflict records for incompatible overlap

- **WHEN** two or more subtitle events overlap in time and differ in text or other merge-relevant fields
- **THEN** the system SHALL create conflict records that reference the involved submissions, time ranges, and event content

#### Scenario: Notify reviewers about conflicts

- **WHEN** a merge job finishes with unresolved conflicts
- **THEN** the system SHALL notify the configured reviewers and SHALL NOT mark the translation stage ready for downstream work

### Requirement: Online dedup review visualizes overlap and writes back a resolved version

The system SHALL provide an online dedup review experience that supports version-to-version comparison, overlap visualization, and conflict resolution from the first release, and records the reviewer’s resolution as a new merged version.

#### Scenario: Compare subtitle versions

- **WHEN** a reviewer opens the online dedup page and selects two subtitle versions
- **THEN** the system SHALL render a version-to-version comparison for the selected versions alongside the conflict review context

#### Scenario: Display overlap timeline

- **WHEN** a reviewer opens the online dedup page
- **THEN** the system SHALL show a total timeline where non-overlapping ranges are gray and overlapping ranges are red

#### Scenario: Inspect overlapping entries

- **WHEN** a reviewer selects an overlapping range on the timeline
- **THEN** the system SHALL show the involved submissions, time ranges, text, uploader, source task, and version metadata

#### Scenario: Resolve conflicts into a new merged version

- **WHEN** a reviewer confirms which entries to keep or merge for a conflict set
- **THEN** the system SHALL write the decision back as a new merged subtitle version and record an audit trail for the resolution
