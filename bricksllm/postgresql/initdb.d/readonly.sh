#!/bin/bash

set -ex

# Check if environment variables are set
if [[ -z "${POSTGRES_RO_USER}" || -z "${POSTGRES_RO_PASSWORD}" || -z "${POSTGRESQL_DATABASE}" ]]; then
    echo "POSTGRES_RO_USER, POSTGRES_RO_PASSWORD, and POSTGRESQL_DATABASE environment variables must be set."
    exit 1
fi

export PGPASSWORD="${POSTGRESQL_POSTGRES_PASSWORD}"

echo "Creating read-only user..."

# Create a read-only user
psql -c "DO \$\$
BEGIN
   IF NOT EXISTS (
      SELECT FROM pg_roles WHERE rolname = '${POSTGRES_RO_USER}'
   ) THEN
      CREATE USER ${POSTGRES_RO_USER} WITH PASSWORD '${POSTGRES_RO_PASSWORD}';
   END IF;
END
\$\$;"
psql --user postgres -c "GRANT CONNECT ON DATABASE ${POSTGRESQL_DATABASE} TO ${POSTGRES_RO_USER};"
psql --user postgres --dbname=$POSTGRESQL_DATABASE -c "GRANT USAGE ON SCHEMA public TO ${POSTGRES_RO_USER};"
psql --user postgres --dbname=$POSTGRESQL_DATABASE -c "GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${POSTGRES_RO_USER};"
psql --user postgres --dbname=$POSTGRESQL_DATABASE -c "GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${POSTGRES_RO_USER};"
psql --user postgres --dbname=$POSTGRESQL_DATABASE -c "GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${POSTGRES_RO_USER};"
psql --user postgres --dbname=$POSTGRESQL_DATABASE -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${POSTGRES_RO_USER};"

echo "Read-only user created."
 