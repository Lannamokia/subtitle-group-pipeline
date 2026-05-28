# Project Template Workflow

## ADDED Requirements

### Requirement: Project templates define reusable workflow blueprints

The system SHALL allow authorized administrators and supervisors to create and maintain project templates that define reusable workflow blueprints for subtitle production.

#### Scenario: Create a project template

- **WHEN** an authorized user creates a template
- **THEN** the system stores the template name, enabled roles, member slots, default task nodes, dependency rules, upload policies, notification policies, ASS processing policies, and join or claim settings

#### Scenario: Reuse a project template

- **WHEN** an authorized user selects an existing template during project creation
- **THEN** the system SHALL instantiate the project workflow from the saved template rather than requiring all workflow settings to be entered again

### Requirement: Projects can be instantiated from templates with minimal required input

The system SHALL allow authorized users to create a new project from a template by providing only project-specific values that are not already defined by the template.

#### Scenario: Fast project creation from template

- **WHEN** a supervisor creates a project from a template
- **THEN** the system MUST require the project title, season-scoped project units, member slot assignments, and required schedule fields

#### Scenario: Inherit template defaults

- **WHEN** a project is created from a template
- **THEN** the system SHALL inherit the template's task graph, upload constraints, notification strategy, and ASS processing settings into the new project instance

### Requirement: Project units are modeled by season rather than by episode

The system SHALL use season-scoped project units as the primary production container instead of episode-scoped project units.

#### Scenario: Create a season-scoped project unit

- **WHEN** a supervisor defines project units during project creation
- **THEN** the system SHALL accept season identifiers or season labels as project units and SHALL NOT require per-episode units as the primary project-unit structure

#### Scenario: Track episode-specific work inside a season unit

- **WHEN** episode-specific work needs to be tracked for a season-scoped unit
- **THEN** the system SHALL associate that work to tasks, batches, or metadata within the season unit rather than creating a separate project unit for each episode

### Requirement: Project membership and task acquisition follow project rules

The system SHALL enforce project-level rules for join requests, direct assignment, open claiming, qualification checks, and task reassignment.

#### Scenario: Join request requires approval

- **WHEN** a member requests to join a project that requires approval
- **THEN** the system SHALL create a join request record and SHALL NOT grant project access until the request is approved

#### Scenario: Claim an open task

- **WHEN** a project member claims an open task and satisfies the configured eligibility rules
- **THEN** the system SHALL assign the task to that member and record the claim event in task history

#### Scenario: Claim is rejected when eligibility fails

- **WHEN** a member attempts to claim an open task without the required role tag or while exceeding the allowed concurrent task count
- **THEN** the system MUST reject the claim and explain which rule blocked the action

### Requirement: Workflow state transitions honor dependencies and review gates

The system SHALL enforce dependency-aware task state transitions and SHALL record supervisory overrides.

#### Scenario: Downstream task remains blocked

- **WHEN** a task has unfinished prerequisite tasks
- **THEN** the system SHALL prevent the task from entering claimable or in-progress states

#### Scenario: Review unlocks downstream work

- **WHEN** a task submission is approved
- **THEN** the system SHALL unlock configured downstream tasks whose prerequisites are now satisfied

#### Scenario: Supervisor overrides a task state

- **WHEN** a supervisor manually changes a task state contrary to normal dependency checks
- **THEN** the system SHALL require an override reason and SHALL write an audit log for the action
