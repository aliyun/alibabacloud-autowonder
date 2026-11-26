# Community Sync Agent Design

## Goal

Standardize the complete AutoWonder community release path:

1. synchronize the internal `origin/master` into `community`;
2. preserve documented community-only boundaries;
3. version and document the resulting community release;
4. mirror the verified Community tree to the standalone public GitHub repository;
5. submit a GitHub pull request targeting `main`;
6. publish the version tag and GitHub Release after human merge for releases.

The digital employee may analyze, resolve permitted conflicts, test, push
temporary branches, and submit MR/PRs. A human merges each MR/PR. For an
authorized version publication, publish the tag and GitHub Release after merge.

## AutoWonder Resources

Create these resources in organization `Autowonder 自迭代`:

| Resource | Value |
| --- | --- |
| Hosted GitHub repository | `https://github.com/aliyun/alibabacloud-autowonder.git` |
| Public community directory | repository root |
| Digital employee | `社区同步发布工程师` |
| Role code | `COMMUNITY_RELEASE_ENGINEER` |
| Squad | `社区版本同步与发布小队` |
| SDLC | `社区版本同步发布 SDLC` |

The squad has one member. Grant the digital employee only the repository access
needed to create and push temporary synchronization branches. It must not merge
MRs/PRs or change protected branches.

## Digital Employee Contract

The digital employee is a release and synchronization engineer, not a general
feature developer. Its business background is maintaining a reproducible public
community edition from the internal AutoWonder product baseline while preserving
both upstream behavior and the documented external-deployability boundary.

Its SOUL and AGENT instructions must require it to:

- treat exact commits, repository state, test output, and retained policy files
  as facts; distinguish facts, inferences, and decisions requiring confirmation;
- follow `docs/community/upstream-sync-guide.md`,
  `docs/community/upstream-sync-log.md`, and the documentation policy;
- make the smallest community-only adaptation and never use conflict resolution
  as a reason to drop master functionality;
- apply the conflict levels in this design and stop on every high-risk case;
- keep credentials, tokens, internal endpoints, and secret-bearing files out of
  commits, comments, evidence, and command arguments;
- create and push temporary branches but never merge protected branches;
- propose SemVer changes from evidence rather than release cadence or guesswork;
- report actual commands, commits, test results, risks, the MR and GitHub PR, and
  release links using the standard final comment.

The agent must not broaden scope into unrelated refactoring, deploy production,
alter repository permissions, rewrite published history, modify a published
migration, or create a release tag without explicit human authorization.

## Repository Model

### Internal AutoWonder repository

- `origin/master` is the authoritative product baseline.
- `community` is the protected community branch.
- Create a temporary branch from the latest `community` for every synchronization.
- Merge an exact fetched `origin/master` commit into that temporary branch.
- Push the branch and provide an MR link targeting `community`.

Read the previous verified master baseline from the newest completed entry in
`docs/community/upstream-sync-log.md`. Verify that commit is an ancestor of the
current `community`; never infer it from a local `master` branch.

### Public GitHub repository

- `origin` is `https://github.com/aliyun/alibabacloud-autowonder.git`.
- Freeze the exact fetched `origin/main` commit during preflight.
- After the internal Community MR is merged, branch from that frozen base and
  copy the complete accepted Community tree to the public repository root.
- Commit and push as `caihe-ch <caihe.ch@alibaba-inc.com>` using existing
  authorized credentials. Push only the temporary branch.
- Submit or reuse a PR to `main`. If submission is blocked, report the reason and
  the repository's `main...<branch>` compare link as a pending handoff.

## Conflict Policy

| Level | Examples | Required action |
| --- | --- | --- |
| Low | documentation, tests, formatting, or an established mechanical community difference | Resolve automatically, test, and summarize the decision. |
| Medium | shared product code whose correct result is explicit in the sync guide and preserves both master behavior and the community boundary | Resolve automatically, add focused verification, and run the independent sync review. |
| High | uncertain schema/data compatibility, auth or permission semantics, cryptography, public API behavior, destructive migration, internal dependency replacement without a proven equivalent, or inability to preserve both master behavior and the community boundary | Stop before commit/push, report both sides, affected files, risks, and recommended options, then wait for human direction. |

Automatic conflict resolution must never silently discard master behavior.

## Version Contract

The first community release is `0.1.0`. The source of truth consists of:

- repository-root `VERSION`, containing only `X.Y.Z` and a trailing newline;
- `releases/release_vX.Y.Z_YYYYMMDD.md`;
- An annotated `X.Y.Z` Git tag and a GitHub Release on the same tag for every
  authorized version publication after the public PR merges.

The standalone repository keeps `VERSION` at its root and the release note under
`releases/`. Verify the tag
resolves to the PR merge commit and the merged root matches the accepted tree.
Stop on a conflicting tag. A docs-only update with unchanged `VERSION` ends
after public merge.

Use Semantic Versioning:

- `MAJOR`: incompatible API, data, deployment, configuration, or runtime change;
- `MINOR`: backward-compatible user-visible feature or substantial platform
  capability;
- `PATCH`: backward-compatible fix, documentation, deployment-process
  improvement, or ordinary upstream synchronization;
- no material release change: do not increment.

The digital employee proposes the version and explains the bump. A human confirms
it before MR/PR merge. One synchronization batch creates exactly one version and
one release file.

Every release file records the version and date, bump rationale, previous and new
master baselines, Community commits, GitHub upstream base and output branch,
feature/fix summary, community adaptations, configuration and deployment impact,
DDL/DML and migration impact, verification results, risks, and MR/PR links.

## SDLC

### 1. Preflight And Context

Verify repository remotes, protected bases, working-tree state, credentials,
previous sync baseline, `VERSION`, newest release file, and existing tags. Reuse
facts already present in context; present them for confirmation rather than asking
again. Request only missing values. Stop on inconsistent version/baseline data.

### 2. Master Change Analysis

Fetch `origin/master` and `community`. Compare the previous verified baseline to
the exact target commit. Classify product, schema, configuration, dependency,
frontend, runtime, deployment, documentation, and community-boundary impact.

### 3. Internal Community Synchronization

Create a temporary branch from the latest `community` and merge the exact target
commit. Apply the conflict policy. High-risk ambiguity stops the SDLC for human
decision.

### 4. Community Adaptation And Versioning

Apply only required external-deployability adaptations. Review deployment Skill,
environment templates, migrations, and retained documentation. Propose the SemVer
bump, update `VERSION`, create the release file, and update
`docs/community/upstream-sync-log.md` without advancing the baseline prematurely.

### 5. Verification And Sync Review

Run the repository's required backend, frontend, build, deployment Skill,
dependency-boundary, and internal-reference gates. Independently compare the
upstream changed-file set with the final tree, review all overlaps, confirm
community boundaries, and account for deployment/documentation impact. Fix low or
medium findings; stop on high-risk findings.

### 6. Internal MR Handoff

Push the temporary internal branch and provide the Markdown-formatted MR link.
Post the standardized summary. Wait for a human to merge the MR; do not continue
from an unmerged branch as if it were the Community baseline.

### 7. Public GitHub Output

Mirror the merged Community tree onto the branch from the frozen public base.
Run the root-mode verifier, independently review the evidence, then push and
read back that exact output commit.

### 8. GitHub PR Handoff

Submit or reuse a PR to `main`. Include version, user-facing changes, upgrade
and rollback notes, and the actual test scope. Record the real PR and wait for
human merge. When submission is blocked, report the compare link and pending
submission status.

### 9. Release Finalization

Verify the merged commit and accepted root. For version publication, create or
verify the annotated tag named by `VERSION` and publish or verify the GitHub
Release on it. Record their URLs and commit IDs. For docs-only updates, record
the merge and leave the existing tag and Release attached to the original version.

## Standard Final Comment

The digital employee must post this structure with real values and Markdown
links. Omit no section; use `None` only when verified as not applicable.

```markdown
## 社区版本同步总结

### 发布信息
- 版本：`<old>` -> `<new>`
- Master 基线：`<previous>` -> `<target>`
- Community Commit：`<commit>`
- GitHub Main Base：`<commit>`
- 发布文件：[release_vX.Y.Z_YYYYMMDD.md](<release-file-url>)

### 功能更新
- <feature or fix>

### 社区适配
- <adaptation or None>

### 验证结果
- 后端：<result>
- 前端：<result>
- 部署 Skill：<result>
- 依赖与内部引用扫描：<result>
- Community/GitHub 根树一致性：<result>

### 风险总结
| 风险 | 等级 | 处理结论 |
| --- | --- | --- |
| <risk or None> | <Low/Medium/High> | <decision> |

### 交付链接
- [内部 Community MR](<mr-url>)
- [GitHub PR](<pr-url>)，创建受阻时记录 [compare 入口](<compare-url>)及原因
- 正式版本记录 [Tag](<tag-url>) 和 [GitHub Release](<release-url>)

### 待真人操作
1. 审核并合并内部 MR。
2. 审核并合并 GitHub PR。
3. 正式版本确认发布授权。执行者回读合并提交后创建并验证 Tag 和 Release。
```

## Acceptance

- The standalone GitHub repository is registered in workspace `Autowonder 自迭代`.
- The digital employee, one-member squad, repository permission, and dedicated
  SDLC exist and are active.
- The SDLC encodes exact baseline sources, both temporary-branch flows, conflict
  tiers, human merge gates, version rules, release-file rules, and the final
  Markdown summary.
- The root verifier checks coverage and identity for the standalone repository.
- Version publication records the verified Tag and GitHub Release.
- No step claims an MR/PR/tag was created when only a link or proposal exists.
