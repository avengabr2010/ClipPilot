set -e
cd /home/user/ClipPilot
export PGPASSWORD=postgres
psql -h localhost -U postgres -q -c "drop database if exists clippilot_test" -c "create database clippilot_test"
psql -h localhost -U postgres -d clippilot_test -q -v ON_ERROR_STOP=1 -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do psql -h localhost -U postgres -d clippilot_test -q -v ON_ERROR_STOP=1 -f $f; done
psql -h localhost -U postgres -d clippilot_test -q -c "grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;"
echo OK
