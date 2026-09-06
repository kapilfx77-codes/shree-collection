import sqlite3
import os

db_path = os.path.expanduser("~/.omniroute/storage.sqlite")
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# List all tables
cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = cur.fetchall()
print("Tables:", [t[0] for t in tables])

# Check combos table
for table in tables:
    name = table[0]
    try:
        cur.execute(f"SELECT * FROM {name} LIMIT 3")
        rows = cur.fetchall()
        col_names = [desc[0] for desc in cur.description]
        print(f"\n--- {name} ---")
        print(f"Columns: {col_names}")
        for row in rows:
            print(row)
    except Exception as e:
        print(f"\n--- {name}: {e} ---")

conn.close()
