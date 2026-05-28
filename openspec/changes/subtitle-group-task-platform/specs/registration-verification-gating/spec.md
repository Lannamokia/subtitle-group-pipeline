# Registration Verification Gating

## ADDED Requirements

### Requirement: Administrators control registration availability and verification mode

The system SHALL allow administrators to configure a global registration policy with exactly three modes: registration disabled, registration enabled without verification, and registration enabled with QQ group verification.

#### Scenario: Registration disabled

- **WHEN** the global registration policy is set to disabled and an unauthenticated user attempts to register
- **THEN** the system MUST reject the registration request and indicate that self-service registration is not available

#### Scenario: Registration enabled without verification

- **WHEN** the global registration policy is set to enabled without verification and a user completes registration successfully
- **THEN** the system SHALL create an active account without requiring a verification step

#### Scenario: Registration enabled with verification

- **WHEN** the global registration policy is set to enabled with QQ group verification and a user completes registration successfully
- **THEN** the system SHALL create the account in a pending-verification state and SHALL generate a verification challenge for that account

### Requirement: Pending-verification accounts receive a QQ group verification challenge

The system SHALL generate an account-bound QQ group verification challenge for accounts that require verification.

#### Scenario: Generate a verification command

- **WHEN** an account is created under the QQ group verification mode
- **THEN** the system SHALL generate a random eight-character verification code containing mixed letters and digits and SHALL associate it with that account

#### Scenario: Verification code remains valid until completion

- **WHEN** a pending-verification account has not yet completed QQ group verification
- **THEN** the system SHALL keep the verification code valid without time-based expiration unless an administrator explicitly resets or replaces it

#### Scenario: Show configured group and command

- **WHEN** a pending-verification user views the registration result or attempts to log in
- **THEN** the system SHALL display the administrator-configured QQ group number and the exact `/verify <code>` command for that account

### Requirement: Pending-verification accounts cannot complete normal login

The system SHALL block pending-verification accounts from completing normal login until their verification challenge is satisfied.

#### Scenario: Login is blocked for pending account

- **WHEN** a pending-verification user submits valid login credentials before verification is completed
- **THEN** the system MUST deny normal session creation and SHALL return a pending-approval response instead of a normal login success

#### Scenario: Pending login response is actionable

- **WHEN** the system returns a pending-approval response during login
- **THEN** the response SHALL include the configured QQ group number, the account-specific verification command, and a frontend affordance for one-click copying of that command

### Requirement: QQ group verification is driven by messages from the configured group

The system SHALL accept verification only from NoneBot events received from the administrator-configured QQ group.

#### Scenario: Accept a valid verification command

- **WHEN** the backend receives a NoneBot event from the configured QQ group containing `/verify <code>` for a pending-verification account
- **THEN** the system SHALL mark the matching account as active, SHALL record the verification event in audit history, and SHALL clear the stored verification-code association for that account

#### Scenario: Ignore verification from another group

- **WHEN** the backend receives a matching verification command from a QQ group that is not the configured verification group
- **THEN** the system MUST reject the verification attempt and SHALL keep the target account in the pending-verification state

#### Scenario: Reject unknown or already-used code

- **WHEN** the backend receives a verification command with an unknown, revoked, or already-consumed code
- **THEN** the system MUST reject the verification attempt and SHALL NOT activate any account

### Requirement: Administrators can manage QQ group verification settings from the admin backend

The system SHALL provide administrator controls for the registration policy and QQ group verification settings.

#### Scenario: Configure registration strategy in admin backend

- **WHEN** an administrator updates registration settings
- **THEN** the system SHALL allow configuring the registration mode and the QQ group number used for verification

#### Scenario: Registration policy changes apply to new requests

- **WHEN** an administrator changes the registration mode
- **THEN** the system SHALL apply the new policy to subsequent registration attempts without retroactively activating already pending accounts
