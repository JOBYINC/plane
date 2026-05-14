#!/bin/bash
set -e

# Wait for DB so the management command can resolve Issue -> Card lookups.
# Migrations are not strictly required (this worker only reads), but waiting
# is cheap and keeps logs aligned with the api/worker startup pattern.
python manage.py wait_for_db
python manage.py wait_for_migrations

# Long-poll worker: holds an outbound WebSocket to Lark, dispatches incoming
# events (URL preview, card actions) back through Plane's helpers. No-op
# (instant exit) if LARK_CLIENT_ID / LARK_CLIENT_SECRET aren't set, so deploys
# that don't use Lark can leave the service running with no env config.
exec python manage.py lark_long_poll
