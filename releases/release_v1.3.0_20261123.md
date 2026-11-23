# AutoWonder Community 1.3.0

Candidate status. Product acceptance and independent reviews are PENDING.

This minor release adds email verification and suffix policies, SSO username mapping and opt-in account matching, and direct status changes for followed workitems. It also updates workitem timelines, clarification history, delivery analytics, workspace deletion handling, MCP schemas, and executor recovery.

The previous verified master is `e7b4c01c2cf3e06df28d75bc0a9a0bfc909f71d2`. The frozen upstream source is `69710f67c1cc6c5be437df1c55df023151c573a1`. The Community starting commit is `c65d54a102f92377cfc78bb023dfc60bf2d48c1e`.

## Community behavior

The workitem detail page continues to hide the PRD design entry. AI clarification remains available according to its existing switch. Community keeps the existing E2E suite, public dependencies and storage integrations, and Qoder CLI executor creation. Aone remains optional and disabled by default.

## Upgrade and data impact

Existing deployments should back up the database and apply the incremental migrations in numeric order before activating the server. Fresh deployments use `docs/autowonder-schema.sql`. The platform recommends executor runtime 0.3.48, resolved from `application.yml` by the deployment and upgrade tooling. Preserve the deployment's SecretCrypto key across upgrades and rollback.

Email verification defaults to disabled. Before enabling it, configure and test an SMTP service the deployment can access. Draft and active SMTP authentication secrets use the same SecretCrypto configuration as existing Community secrets. Review SSO username claims and the existing-account binding option before enabling that option for an identity provider.

## DDL, DML and migration impact

- V114 and V116 add the conversation display projection and its isolation fields and indexes.
- V115 adds system label keys. Existing labels retain their stored names.
- V117 adds email verification fields and policy, SMTP settings, and notification tables.
- V118 normalizes platform skill types to the supported values.
- V119 and V121 add and consolidate tenant-scoped workitem-link lookup indexes.
- V120 adds SSO username mapping and the opt-in existing-account binding field.
- V122 adds PRD runtime preview and review tables.

Validate these migrations against a restored copy of existing data before upgrading. Allow a maintenance window for the workitem-link index changes and verify SMTP ciphertext round-trips after upgrade. V118 changes stored Skill types and may rename conflicting records. Stop legacy Skill writers before running the upgrade and restart them only after upgrading their code. If legacy rows remain after V118 has succeeded, use a separately reviewed data repair. The upgrade runner skips migrations already recorded as successful.

Once migrations are applied, use the reviewed forward-fix or pre-upgrade database restore procedure. The upgrade Skill blocks automated rollback after migrations. Compatibility and rollback verification are PENDING.

## Verification and delivery

Fresh installation, migration against existing data, executor delivery, SLS startup modes and independent release reviews are PENDING. Internal MR and external compare link are NOT_CREATED.
