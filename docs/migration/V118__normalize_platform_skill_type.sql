-- Normalize the historical CODEX_SKILL record type without changing the execution protocol.
-- Quiesce old writers before migrating, or rerun once all old writers are upgraded.
-- The unique key includes soft-deleted rows and uses the table's name collation.
-- Find a free name in both types before applying names and types atomically.
WITH RECURSIVE rename_targets AS (
    SELECT legacy.id, legacy.tenant_id, legacy.name, legacy.is_deleted
    FROM skill legacy
    LEFT JOIN skill canonical
      ON canonical.tenant_id = legacy.tenant_id
     AND canonical.type = 'SKILL'
     AND canonical.name = legacy.name
    WHERE legacy.type = 'CODEX_SKILL'
      AND (canonical.id IS NOT NULL
           OR (legacy.is_deleted = 1 AND legacy.name NOT LIKE '#deleted-%'))
),
occupied_names AS (
    SELECT DISTINCT tenant_id, name FROM skill WHERE type IN ('SKILL', 'CODEX_SKILL')
),
name_candidates AS (
    SELECT id, tenant_id, 0 AS suffix_no,
           CONCAT(LEFT(name, CASE WHEN is_deleted = 1 THEN 0
                     ELSE 128 - CHAR_LENGTH(CONCAT(' (legacy-', id, ')')) END),
                  CASE WHEN is_deleted = 1 THEN CONCAT('#deleted-', id)
                       ELSE CONCAT(' (legacy-', id, ')') END) AS candidate_name
    FROM rename_targets
    UNION ALL
    SELECT target.id, target.tenant_id, candidate.suffix_no + 1,
           CONCAT(LEFT(target.name, CASE WHEN target.is_deleted = 1 THEN 0
                     ELSE 128 - CHAR_LENGTH(CONCAT(' (legacy-', target.id, '-', candidate.suffix_no + 1, ')')) END),
                  CASE WHEN target.is_deleted = 1
                       THEN CONCAT('#deleted-', target.id, '-', candidate.suffix_no + 1)
                       ELSE CONCAT(' (legacy-', target.id, '-', candidate.suffix_no + 1, ')') END)
    FROM name_candidates candidate
    JOIN occupied_names occupied
      ON occupied.tenant_id = candidate.tenant_id AND occupied.name = candidate.candidate_name
    JOIN rename_targets target ON target.id = candidate.id
),
chosen_names AS (
    SELECT id, candidate_name
    FROM (
        SELECT id, candidate_name,
               ROW_NUMBER() OVER (PARTITION BY id ORDER BY suffix_no DESC) AS choice
        FROM name_candidates
    ) ranked
    WHERE choice = 1
)
UPDATE /*+ SET_VAR(cte_max_recursion_depth=4294967295) */ skill legacy
LEFT JOIN chosen_names chosen ON chosen.id = legacy.id
SET legacy.name = COALESCE(chosen.candidate_name, legacy.name),
    legacy.type = 'SKILL'
WHERE legacy.type = 'CODEX_SKILL';

-- The same statement is a no-op once the legacy type is absent.
-- SELECT id, tenant_id, name FROM skill WHERE type = 'CODEX_SKILL';
