#!/usr/bin/env bash
# ============================================================================
# Kempen Cricket Club — Azure SQL provisioning
# Creates: SQL logical server + database "KempenCricketClub"
# Run once:  bash db/00_provision_azure.sh
# Requires:  az login  (Azure CLI)
# ============================================================================
set -euo pipefail

RESOURCE_GROUP="rg-kcc"
LOCATION="westeurope"
SQL_SERVER_NAME="kcc-sql-$RANDOM"          # must be globally unique, lowercase

# --- Server admin -----------------------------------------------------------
# NOTE: Azure SQL REJECTS reserved admin login names, including "root", "admin",
# "sa", "administrator", "dbmanager", "loginmanager", "dbo", "guest", "public".
# "kccroot" is used instead; change if you prefer another name.
ADMIN_LOGIN="kccroot"
ADMIN_PASSWORD='1R>vD3a62(aG'

DB_NAME="KempenCricketClub"

az group create --name "$RESOURCE_GROUP" --location "$LOCATION"

az sql server create \
  --name "$SQL_SERVER_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --admin-user "$ADMIN_LOGIN" \
  --admin-password "$ADMIN_PASSWORD"

# Cheapest tier suitable for form traffic; scale up later if needed.
az sql db create \
  --resource-group "$RESOURCE_GROUP" \
  --server "$SQL_SERVER_NAME" \
  --name "$DB_NAME" \
  --service-objective Basic \
  --backup-storage-redundancy Local

# Allow Azure services (Static Web Apps / Functions) to reach the server.
az sql server firewall-rule create \
  --resource-group "$RESOURCE_GROUP" \
  --server "$SQL_SERVER_NAME" \
  --name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0

echo ""
echo "Server:   $SQL_SERVER_NAME.database.windows.net"
echo "Database: $DB_NAME"
echo "Next: run 01_master_create_login.sql against master,"
echo "      then 02_schema_and_user.sql against $DB_NAME."
