"""Check who can execute the decrement_inventory RPC."""
import json, urllib.request, urllib.error
SUPABASE_URL = 'https://xztfoauqecnmznszghcj.supabase.co'
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dGZvYXVxZWNubXpuc3pnaGNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MzI4NjUsImV4cCI6MjEwNDEwODg2NX0.PGbr_Tz8pyr-afRtTRBRnTpaxBo756DVbk7xvRi9fzU"

def call(method, path, body=None, key=ANON_KEY):
    h = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}
    url = SUPABASE_URL + '/rest/v1/' + path
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

# Check current stock
s, b = call('GET', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M&select=quantity')
print(f"current Red/M stock: {b}")

# Reset to 100
call('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M', {'quantity': 100})

# Call decrement as anon
s, b = call('POST', 'rpc/decrement_inventory', {'p_product_id': 1, 'p_color': 'Red', 'p_size': 'M', 'p_qty': 1})
print(f"anon decrement: status={s} body={b}")

# Reset
call('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M', {'quantity': 100})
