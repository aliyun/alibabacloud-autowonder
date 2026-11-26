# AutoWonder Community 1.4.0

This minor release adds workflow duration analysis grouped by recorded workflow configuration and execution snapshots. Digital workers support system and custom tags in the list, cards and detail view. The redesigned workspace, workbench and work-item detail include an inline settings panel, updated delivery recovery and restart attribution, and a simplified work-item creation dialog. MCP gains current-user and workspace-member queries. Stage timing, usage accounting and bilingual IM troubleshooting also receive updates.

- Previous verified master: `69710f67c1cc6c5be437df1c55df023151c573a1`.
- Candidate master: `40f5879c5c0bebf2762859ff3b287a86a7121603`.
- Community keeps the work-item detail PRD design entry hidden in the frontend. Qoder CLI remains the supported executor creation path. Aone remains optional and defaults to disabled.

## Upgrade and data impact

Fresh installations use the full schema and the Community deployment Skill. For upgrades, preserve the current encryption material and run the Community upgrade planner. V125 drops an index, so the planner requires a stopped-writer maintenance window. Let active work settle, verify a restorable database backup, and explicitly approve the maintenance plan. Use the upgrade Skill to stop writers, apply V123–V130, verify the migration history, and activate the new server. The release runtime recommendation is resolved from the release's `application.yml`.

- V123 adds the workflow configuration and dispatch snapshot tables. Older dispatches remain unknown until the original package can be verified.
- V124 adds the per-workflow stage timing switch with the default off. The server expects the column even with timing disabled.
- V125 removes the former artifact-level uniqueness index when present. Usage retains its dispatch, step, provider and model identity. The migration preserves rows and the artifact ID.
- V126 adds the PRD review slug, its share reference and unique index. V127 adds the optional repo design base branch. V128 adds the PRD design handoff table.
- V129 adds an online index for active workspace member pagination. Allow time for MySQL to build the index on deployments with large membership tables.
- V130 adds the `asset_tag` table with tenant-scoped uniqueness and lookup indexes. Apply it before starting the candidate because digital worker list and detail endpoints read the table. Existing digital workers start with an empty tag list.

No data backfill is prescribed. Apply migration SQL in version order. Each file uses one SQL session, including any prepared statements and session variables.

## Rollback

The upgrade tool blocks application-only rollback as soon as a migration starts, including when a later step fails. Reconcile the live schema and migration history before retrying after interrupted DDL. If recovery requires restoration, restore the verified pre-upgrade database snapshot and deploy the previous release with its original environment and encryption material. Recreating the obsolete artifact index after new usage has been written can fail if the previous uniqueness rule no longer holds.

## Verification and submission

Candidate readiness, real runtime delivery, storage and SLS checks, and the three independent reviews are pending at candidate freeze. The existing internal release MR is awaiting review. The public PR is pending the internal merge. The final acceptance and submission records provide the tested tree, results and links.
