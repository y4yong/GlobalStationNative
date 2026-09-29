-- Run this file while connected to the postgres maintenance database.
-- This is intended for psql because \gexec is a psql command.
SELECT 'CREATE DATABASE globalstation'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'globalstation')\gexec

-- After the database is created, connect to it and run complete_globalstation.sql.
