-- Local development/test credentials only. Production uses separate projects and secrets.
CREATE ROLE holobid LOGIN PASSWORD 'holobid_local';
CREATE ROLE holobid_audit LOGIN PASSWORD 'holobid_audit_local';
CREATE DATABASE holobid OWNER holobid;
CREATE DATABASE holobid_audit OWNER holobid_audit;
REVOKE CONNECT ON DATABASE holobid FROM PUBLIC;
REVOKE CONNECT ON DATABASE holobid_audit FROM PUBLIC;
GRANT CONNECT ON DATABASE holobid TO holobid;
GRANT CONNECT ON DATABASE holobid_audit TO holobid_audit;
