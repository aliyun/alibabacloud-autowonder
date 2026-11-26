# AutoWonder Community 1.4.1

Patch release for the Community deployment version shown on the About page.
The previous release was 1.4.0. This Community patch uses Community commit
`111052250021830446196e63abff298706e31a74` as its base and incorporates no new
upstream changes. The verified upstream baseline remains
`40f5879c5c0bebf2762859ff3b287a86a7121603`.

## Deployment and upgrade

- Fresh deployments use the release version `1.4.1` from the Community
  environment template or the default Spring configuration.
- Upgrading from 1.4.0 uses the standard application upgrade procedure. Set
  `AUTOWONDER_VERSION=1.4.1` if you keep a manually maintained, explicitly
  configured version. The deploy and upgrade Skills manage this value from
  `VERSION`.
- Missing, blank, and legacy `x.x.x` settings resolve to the release version.
  Valid explicit version settings remain supported.
- There are no database migrations, schema changes, or data backfills.
  Use the standard full schema for a fresh installation.

## Rollback

Redeploy the previous application image with the matching version setting.
This patch introduces no database changes.

## Verification and submission

Release acceptance, Community MR, and GitHub PR are pending at candidate freeze.
