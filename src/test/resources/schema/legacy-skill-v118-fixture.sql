CREATE TABLE skill (
  id BIGINT UNSIGNED PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(16) NOT NULL,
  name VARCHAR(128) NOT NULL,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  install_spec JSON,
  UNIQUE KEY uk_type_name (tenant_id,type,name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO skill VALUES
(101,1,'CODEX_SKILL','Build',0,'{"kind":"codex-skill"}'),
(102,1,'SKILL','build',0,NULL),
(103,1,'SKILL','Build (legacy-101)',0,NULL),
(104,1,'CODEX_SKILL','Build (legacy-101-1)',0,NULL),
(105,1,'CODEX_SKILL','old removed skill',1,NULL),
(106,1,'SKILL','#deleted-105',1,NULL),
(107,1,'CODEX_SKILL','#deleted-105-1',1,NULL),
(108,1,'CODEX_SKILL',REPEAT('构',128),0,NULL),
(109,1,'SKILL',REPEAT('构',128),0,NULL),
(110,2,'CODEX_SKILL','Build',0,NULL),
(111,1,'MCP','Other',0,NULL);
