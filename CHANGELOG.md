# AutoWonder Community Changelog

This changelog lists Community versions from newest to oldest. Entries for
versions released in the standalone GitHub repository link to their GitHub
releases. Earlier entries link to historical version-note snapshots and use
their recorded dates.

## [1.4.1](releases/release_v1.4.1_20261126.md) (November 26, 2026)

### Bug fixes

- Pre-fill the deployment version and report the Community release version on
  the About page when deployment configuration is missing, blank, or still uses
  the legacy `x.x.x` placeholder.

## [1.4.0](https://github.com/aliyun/alibabacloud-autowonder/releases/tag/1.4.0) (November 26, 2026)

### Features

- Redesigned the interface across workspace navigation, the personal workbench,
  and work item delivery. The new sidebar includes inline workspace settings.
  The workbench shows work that needs attention, followed work items, and
  deliveries in progress.
- Added system and custom tags for digital workers in list, card, and detail views.
- Added workflow duration analysis based on recorded SDLC configurations and
  execution snapshots.
- Added MCP queries for the current user and workspace members.

### Enhancements

- Simplified work item creation and grouped delivery history by digital worker,
  including restart records.
- Improved stage timing, usage accounting, and bilingual IM troubleshooting.
- Added a Simplified Chinese README alongside the English README.

### Upgrade notes

- Use the [Community upgrade Skill](skills/upgrading-autowonder-on-alibaba-cloud/SKILL.md)
  to plan and apply pending migrations before starting the new server. This
  release adds V123–V130. V125 requires a maintenance window with database
  writers stopped. Allow time for V129 to build its index on large
  workspace-member tables.
- Verify a restorable database backup and preserve existing encryption material
  before upgrading. If recovery is needed after migration starts, restore the
  pre-upgrade database snapshot and deploy the previous release with its
  original configuration and encryption material.

## [1.3.0](https://github.com/aliyun/alibabacloud-autowonder/releases/tag/1.3.0) (November 23, 2026)

### Features

- Added email verification, email-domain policies, and SSO username mapping with
  opt-in matching to existing accounts.
- Added direct status updates for followed work items in the personal workbench.

### Enhancements

- Improved work item timelines, clarification history and recovery, and
  delivery analytics.
- Improved cleanup of background tasks after workspace deletion.

### Upgrade notes

- Back up the database and preserve the existing encryption key. Apply
  migrations V114–V122 before starting the new server. Stop legacy Skill
  writers before V118 and allow a maintenance window for the work item link
  index changes.
- Email verification defaults to off. Configure and test SMTP before enabling it.

## [1.2.0](releases/release_v1.2.0_20261110.md) (November 10, 2026)

### Features

- Added guided Harness initialization with resumable batches and readiness checks.
- Added registration review, workspace creation authorization, and optional
  federated provisioning.
- Added real-time notifications and duplicate work item warnings.

### Enhancements

- Added digital worker draft and review diffs, and improved workflow and executor
  management.
- Added durable workflow snapshots and an explicit option to restart with the
  latest workflow.

### Bug fixes

- Improved recovery when frontend routes fail to load and fixed polling,
  timeline, and artifact interactions.

### Upgrade notes

- Verify a restorable database backup and apply V101–V113 in order before
  starting the new server. Run each migration in a single database session.

## [1.1.0](releases/release_v1.1.0_20261028.md) (October 28, 2026)

### Features

- Added shared DingTalk and Feishu group channels, squad workflow graphs, and
  workspace-scoped task data records.
- Added conversation token usage, delivery insights, and cross-workspace dashboards.

### Enhancements

- Improved delivery of questions and answers, continuation after history expires,
  and retention and recovery of paused execution checkpoints.

### Upgrade notes

- New DingTalk and Feishu bindings require a group ID and platform group-chat
  configuration. Update binding automation and remove calls to the former
  plaintext environment variable endpoint.
- Back up the database and encryption key, stop old servers, and apply V089–V100.
  Resolve duplicate or orphan external work item links if V089 blocks the upgrade.

## [1.0.0](releases/release_v1.0.0_20261020.md) (October 20, 2026)

### Features

- Added enterprise OIDC and SAML federation, workspace roles, and executor
  operation controls.
- Added Chinese and English interface and server messages with per-user locale
  preferences.
- Added durable dispatch results and interaction requests, model selection, and
  live executor restart controls.

### Upgrade notes

- Workspace membership APIs moved from access levels to roles. Update API
  clients that use the previous endpoints. Account deletion takes effect
  immediately as a logical deletion.
- Stop application writes and back up the database and encryption key before
  applying V076–V088.

## [0.10.1](releases/release_v0.10.1_20261010.md) (October 10, 2026)

### Bug fixes

- Fixed service startup with SLS enabled and prevented browser-backed
  clarification replies from being forwarded to an external channel.

## [0.10.0](releases/release_v0.10.0_20260929.md) (September 29, 2026)

### Features

- Added server-backed memory, explicit delivery restart rounds, and anonymous
  artifact sharing.
- Updated workspace navigation and unified work item status categories and
  transitions.

### Upgrade notes

- Stop application writers and back up the database before applying the
  incremental migrations. Review the V075 dry-run report before applying its
  data changes and starting the new server.

## [0.9.0](releases/release_v0.9.0_20260919.md) (September 19, 2026)

### Features

- Added environment variable management, digital worker bindings, platform
  conversations, project backup, and Feishu integration.

## [0.8.0](releases/release_v0.8.0_20260907.md) (September 7, 2026)

### Features

- Added platform administration, workspace recovery, interactive clarification
  through ACP, and server-generated executor launch commands.

### Upgrade notes

- Check which account V050 will promote before upgrading. The migration grants
  platform administrator rights to the first active user.

## [0.7.0](releases/release_v0.7.0_20260902.md) (September 2, 2026)

### Features

- Added scheduled digital worker tasks, workspace discovery and access requests,
  encrypted MCP configuration, and per-step token and credit usage.

## [0.6.0](releases/release_v0.6.0_20260824.md) (August 24, 2026)

### Features

- Added external work item collaboration, executor debug commands, and Qoder CN CLI.

### Upgrade notes

- The public API moved from `/api/orgs` to `/api/workspaces`. The version note
  recorded 0.6.0 while the version file remained at 0.5.0 until 0.7.0.

## [0.5.0](releases/release_v0.5.0_20260811.md) (August 11, 2026)

### Enhancements

- Highlighted work items assigned to people, added automatic cleanup for
  published work item workspaces, and supported Unicode artifact paths.

## [0.4.0](releases/release_v0.4.0_20260809.md) (August 9, 2026)

### Features

- Added optional S3-compatible storage for self-managed deployments, version
  display on the About page, and Markdown and plain-text copy actions.

## [0.3.5](releases/release_v0.3.5_20260809.md) (August 9, 2026)

### Bug fixes

- Added rotation and bounded retention for local application log archives.

## [0.3.4](releases/release_v0.3.4_20260807.md) (August 7, 2026)

### Bug fixes

- Fixed upgrade environment scanning so shell-local variables stay out of the
  application environment requirements.

## [0.3.3](releases/release_v0.3.3_20260807.md) (August 7, 2026)

### Bug fixes

- Made upgrade execution follow the approved plan and stop for confirmation
  when a step fails or the actual state differs from the plan.

## [0.3.2](releases/release_v0.3.2_20260807.md) (August 7, 2026)

### Bug fixes

- Fixed upgrade planning and builds from monorepo subdirectories and accepted
  zero-padded migration versions.

## [0.3.1](releases/release_v0.3.1_20260807.md) (August 7, 2026)

### Bug fixes

- Made the work item comment mention menu scrollable so long candidate lists
  remain accessible.

## [0.3.0](releases/release_v0.3.0_20260807.md) (August 7, 2026)

### Features

- Added human–agent participation insights with duration and ratio trends,
  breakdowns, and details for long-running work items.

## [0.2.0](releases/release_v0.2.0_20260807.md) (August 7, 2026)

### Features

- Added account deactivation with a cooling-off period, repository deletion,
  persistent Qoder startup preferences, and squad creation through MCP.

## [0.1.0](releases/release_v0.1.0_20260806.md) (August 6, 2026)

### Features

- Recorded the first versioned Community distribution, including the application,
  database schema, deployment Skill, and operator documentation.
