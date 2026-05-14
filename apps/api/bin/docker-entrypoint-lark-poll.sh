#!/bin/bash
set -e

# Lark SDK dispatches event handlers from inside an asyncio loop, but our
# Issue lookups are vanilla synchronous Django ORM. Django blocks sync ORM
# from async contexts by default; export the escape hatch BEFORE Python
# starts so the check is disabled at module-import time. Safe here because
# queries are tiny PK lookups (<50ms) that never starve the event loop.
export DJANGO_ALLOW_ASYNC_UNSAFE=1

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
