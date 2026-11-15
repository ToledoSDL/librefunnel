-- Runs once, when the db volume is created: Evolution API keeps its WhatsApp sessions in its own database.
-- With EVOLUTION_DB_PASSWORD set (new installs) it gets its own user, which owns only that database: a flaw in
-- Evolution then reaches neither the store's orders nor the server through the database superuser.
\set evolution_password ''
\getenv evolution_password EVOLUTION_DB_PASSWORD
SELECT :'evolution_password' <> '' AS own_user \gset
\if :own_user
CREATE ROLE evolution LOGIN PASSWORD :'evolution_password';
CREATE DATABASE evolution OWNER evolution;
REVOKE CONNECT ON DATABASE librefunnel FROM PUBLIC;
\else
CREATE DATABASE evolution;
\endif
