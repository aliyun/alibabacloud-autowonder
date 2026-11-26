-- The legacy schema used uk_artifact_provider_model before per-step usage existed.
-- V046 then made the dispatch identity per (dispatch, step, provider, model),
-- but the artifact key kept collapsing multi-step usage of one artifact into a
-- single row and let usage-only reports create a second identity for the same
-- credits. Artifact id is an attribute, not an identity: drop the legacy key so
-- every ingest path dedupes on uk_dispatch_step_provider_model.
SET @dispatch_usage_index_ddl = IF(EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'dispatch_ai_usage'
      AND index_name = 'uk_artifact_provider_model'
), 'ALTER TABLE dispatch_ai_usage DROP INDEX `uk_artifact_provider_model`', 'SELECT 1');
PREPARE dispatch_usage_index_stmt FROM @dispatch_usage_index_ddl;
EXECUTE dispatch_usage_index_stmt;
DEALLOCATE PREPARE dispatch_usage_index_stmt;
