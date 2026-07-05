-- ============================================================================
-- Kempen Cricket Club — run against the MASTER database
-- (connect as the server admin, e.g. kccroot)
--
--   sqlcmd -S <server>.database.windows.net -d master -U kccroot -P '<pwd>' \
--          -i db/01_master_create_login.sql
--
-- Creates the server-level login for the application user "controller".
-- Note: password contains a double quote; it is safely inside single quotes.
-- ============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.sql_logins WHERE name = N'controller')
BEGIN
    CREATE LOGIN [controller] WITH PASSWORD = 'I"c232zxoj#R';
END
GO
