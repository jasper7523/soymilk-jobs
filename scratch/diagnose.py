import re, json, sys, urllib.request

sys.stdout.reconfigure(encoding='utf-8')

# Get sheet_id - we need to figure it out from the GAS response or ask user
# Let's try to extract from GAS URL redirect
gas_url = "https://script.google.com/macros/s/AKfycbzmy9L28j0SnaECOBMzzLBB-THahSqEu7b4uF8zU2tU7rSt6OLNZ-effc5idR3BAGY6/exec"

# First, get the data via GAS to confirm status
print("=== Step 1: GAS doGet - checking status values ===")
req = urllib.request.Request(gas_url)
req.add_header('User-Agent', 'Mozilla/5.0')
resp = urllib.request.urlopen(req, timeout=15)
gas_data = json.loads(resp.read().decode('utf-8'))

status_counts = {}
for j in gas_data:
    s = j.get('status', '(empty)')
    status_counts[s] = status_counts.get(s, 0) + 1
print(f"Status distribution from GAS: {status_counts}")

# Now check specifically what shoot_date values look like
print("\n=== Step 2: Checking shoot_date formats from GAS ===")
for j in gas_data:
    sd = j.get('shoot_date', '')
    ca = j.get('created_at', '')
    if sd:
        print(f"  shoot_date: {repr(sd)}")
    if ca and ('T' in str(ca) or '-' in str(ca)):
        print(f"  created_at: {repr(ca)} (has hyphen/ISO)")

# Check if GAS returns dates as ISO (meaning Sheet still stores as Date objects)
print("\n=== Step 3: Date format analysis ===")
iso_count = 0
slash_count = 0
other_count = 0
for j in gas_data:
    for field in ['shoot_date', 'created_at']:
        val = str(j.get(field, ''))
        if not val:
            continue
        if 'T' in val:
            iso_count += 1
        elif '/' in val:
            slash_count += 1
        else:
            other_count += 1

print(f"  ISO format (still Date objects in Sheet): {iso_count}")
print(f"  Slash format (correct plain text): {slash_count}")
print(f"  Other: {other_count}")

if iso_count > 0:
    print("\n  ⚠️ GAS still returning ISO dates!")
    print("  This means the GAS script on Apps Script has NOT been updated yet.")
    print("  The user needs to manually update the GAS script in Apps Script editor.")
