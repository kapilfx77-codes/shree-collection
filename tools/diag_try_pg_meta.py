"""Attempt to run DDL via Supabase's pg-meta endpoint or other channels."""
import json, urllib.request, urllib.error

SUPABASE_URL = 'https://xztfoauqecnmznszghcj.supabase.co'
KEY = None
for line in open('.env.local'):
    if line.startswith('SUPABASE_SERVICE_ROLE_KEY='):
        KEY = line.split('=', 1)[1].strip()
        break
assert KEY

# Try /pg/query (older Supabase endpoint)
sql = "SELECT grantee, privilege_type FROM information_schema.routine_privileges WHERE routine_schema='public' AND routine_name='decrement_inventory';"

for path in ['/pg/query', '/pg-meta/query', '/rest/v1/_pgrst_reserved', '/pg/query?=' + sql]:
    url = SUPABASE_URL + path
    try:
        req = urllib.request.Request(url, data=sql.encode(), headers={
            'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/x-www-form-urlencoded'
        }, method='POST')
        with urllib.request.urlopen(req, timeout=10) as r:
            print(f"{path}: {r.status} {r.read().decode()[:200]}")
    except urllib.error.HTTPError as e:
        print(f"{path}: HTTP {e.code} {e.read().decode()[:200]}")
    except Exception as ex:
        print(f"{path}: {type(ex).__name__} {ex}")
