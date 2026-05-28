# Workflow Notification Delivery

## ADDED Requirements

### Requirement: Workflow events resolve a targeted recipient set

The system SHALL resolve notification recipients from workflow state, project membership, review assignments, and subscription preferences.

#### Scenario: Notify task assignee and reviewers

- **WHEN** a task is assigned, submitted for review, approved, rejected, or unlocked for work
- **THEN** the system SHALL target the current assignee, relevant reviewers, and configured downstream waiters as recipients for that event

#### Scenario: Notify project join applicant

- **WHEN** a project join request is approved or rejected
- **THEN** the system SHALL notify the applicant and the acting reviewer about the decision

### Requirement: Notifications are delivered through email and QQ NoneBot channels

The system SHALL support email and QQ NoneBot as first-class delivery channels for workflow notifications.

#### Scenario: Deliver an email notification

- **WHEN** a recipient is eligible for email delivery for a workflow event
- **THEN** the system SHALL send a notification message through the configured email provider

#### Scenario: Deliver a QQ notification

- **WHEN** a recipient is eligible for QQ delivery for a workflow event
- **THEN** the system SHALL send a group notification message through the configured NoneBot interface and @ mention the corresponding recipients in that QQ group

### Requirement: Notification messages contain actionable workflow context

The system SHALL include enough workflow context in each notification for recipients to understand and act on the event.

#### Scenario: Compose an actionable message

- **WHEN** the system generates a workflow notification
- **THEN** the message SHALL include the project name, project unit, role or task title, current status, trigger reason, due time when present, and a destination link or reference

### Requirement: Delivery attempts are logged and retried on failure

The system SHALL create delivery records for every notification attempt and SHALL retry failed channel deliveries.

#### Scenario: Record successful delivery

- **WHEN** a channel delivery succeeds
- **THEN** the system SHALL persist the delivery channel, recipient, attempt time, and success status in delivery logs

#### Scenario: Retry failed delivery

- **WHEN** a channel delivery fails
- **THEN** the system SHALL record the failure reason and enqueue the notification for retry according to the configured retry policy

### Requirement: User preferences can suppress non-required reminders without suppressing required system notices

The system SHALL allow user or project-level notification preferences for reminder-style events while preserving required workflow notices.

#### Scenario: Respect muted reminder preference

- **WHEN** a user has muted reminder notifications for a project
- **THEN** the system SHALL suppress reminder-only messages for that project on the muted channel

#### Scenario: Preserve required workflow notice

- **WHEN** an event is classified as a required workflow notice such as approval outcome or task rejection
- **THEN** the system SHALL deliver that notice even if optional reminders are muted for the same project
