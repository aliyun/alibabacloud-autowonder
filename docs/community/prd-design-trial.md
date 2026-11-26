# PRD and Prototype Design Trial

Use the GitHub branch `feature/prd-design` at an explicit commit for trial
deployments. The work item header opens the prototype and interaction design
workbench. It supports designs based on a repository or the bundled template,
live preview and element selection, review comments, and approved design
handoff to a Git repository and work item.

## Deployment and data

- Use the [Community runtime guide](README.md) for server setup. For a fresh
  database, import the [full schema](../autowonder-schema.sql). For a trial
  environment based on Community 1.4.1, back up the database and apply
  [V131](../migration/V131__workitem_activity_launch.sql) before starting the
  trial server.
- Set `AUTOWONDER_PUBLIC_BASE_URL` to the HTTPS trial endpoint and configure
  HTTP and WebSocket forwarding under [both preview paths](../../deploy/design-preview/nginx.example.conf).
  The platform accepts local loopback HTTP for development. The executor
  requires an HTTPS presigned object-storage URL when downloading the starter.
- Use a Qoder-compatible executor with managed PRD preview and design handoff,
  such as AutoWonder execution runtime `0.3.51`. If the trial server manages
  executor upgrades, set `AUTOWONDER_RUNTIME_RECOMMENDED_VERSION=0.3.51` in that
  deployment. The [executor preview relay guide](../prd-preview-relay.md) covers
  the connection and binding configuration.
- Set `AUTOWONDER_PRD_GIT_HOSTS` to allow any additional Git host where users
  will publish reviewed designs. Executors need permission for the selected
  repository. The default allows `github.com` and `gitlab.com`.
- Live previews run on the trial platform's origin. Use prototypes from
  repositories and authors you trust with access to the trial environment.

## Rollback

Stop trial workloads and redeploy the 1.4.1 application and configuration.
The additive launch table can remain in the database. Reviewed Git refs and
uploaded artifacts have their own retention and cleanup lifecycle.
