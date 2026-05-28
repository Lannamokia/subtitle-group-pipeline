# Project Wiki Glossary

## ADDED Requirements

### Requirement: Projects provide a wiki page for shared knowledge

The system SHALL provide a project-scoped wiki page for maintaining project-specific knowledge such as proper nouns, naming rules, glossary entries, and production notes.

#### Scenario: Open the project wiki page

- **WHEN** an authorized project member opens the project wiki
- **THEN** the system SHALL show the wiki content associated with that project

#### Scenario: Wiki is scoped to the project

- **WHEN** a member views a project's wiki page
- **THEN** the system SHALL show only the wiki content belonging to that project and SHALL NOT mix content from other projects

### Requirement: Wiki content supports Markdown and table-based editing

The system SHALL allow authorized users to maintain wiki content in Markdown blocks and structured table blocks within the same project wiki experience.

#### Scenario: Edit Markdown content

- **WHEN** an authorized user edits a Markdown section of the wiki
- **THEN** the system SHALL persist the Markdown content and render it as formatted project documentation

#### Scenario: Edit glossary table content

- **WHEN** an authorized user edits a table section of the wiki for project terminology
- **THEN** the system SHALL persist the structured rows and columns and render them as a project glossary table

### Requirement: Wiki updates are auditable and shareable within the project

The system SHALL record who updated project wiki content and make the latest wiki state available to project members with permission.

#### Scenario: Record wiki update metadata

- **WHEN** a wiki section is created or updated
- **THEN** the system SHALL record the updater identity and update time for that section or document

#### Scenario: View shared project terminology

- **WHEN** a project member with access opens the glossary table
- **THEN** the system SHALL show the latest saved project-specific terminology entries
