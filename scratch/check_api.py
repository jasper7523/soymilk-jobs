import re, json, sys, urllib.request

sys.stdout.reconfigure(encoding='utf-8')

# Read sheet_id from the GAS URL by fetching the spreadsheet ID
# We'll use GAS get_all instead to compare
gas_url = "https://script.google.com/macros/s/AKfycbzmy9L28j0SnaECOBMzzLBB-THahSqEu7b4uF8zU2tU7rSt6OLNZ-effc5idR3BAGY6/exec"

# Method 1: GAS doGet (direct JSON)
print("=== GAS doGet ===")
req = urllib.request.Request(gas_url)
req.add_header('User-Agent', 'Mozilla/5.0')
resp = urllib.request.urlopen(req, timeout=15)
gas_data = json.loads(resp.read().decode('utf-8'))
print(f"Total: {len(gas_data)}")
for j in gas_data:
    if j.get('status') == 'in_progress':
        print(f"  IN_PROGRESS: {j.get('title','')[:30]}")
        print(f"    shoot_date: {repr(j.get('shoot_date',''))}")
        print(f"    created_at: {repr(j.get('created_at',''))}")

# Method 2: GAS POST get_all
print("\n=== GAS POST get_all ===")
payload = json.dumps({"action": "get_all"}).encode('utf-8')
req2 = urllib.request.Request(gas_url, data=payload, method='POST')
req2.add_header('Content-Type', 'application/json')
req2.add_header('User-Agent', 'Mozilla/5.0')
resp2 = urllib.request.urlopen(req2, timeout=15)
post_data = json.loads(resp2.read().decode('utf-8'))
print(f"Total: {len(post_data)}")
for j in post_data:
    if j.get('status') == 'in_progress':
        print(f"  IN_PROGRESS: {j.get('title','')[:30]}")
        print(f"    shoot_date: {repr(j.get('shoot_date',''))}")
        print(f"    created_at: {repr(j.get('created_at',''))}")
