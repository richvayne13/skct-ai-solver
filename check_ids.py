import re

with open('index.html', encoding='utf-8') as f:
    html = f.read()
with open('app.js', encoding='utf-8') as f:
    js = f.read()

ids = re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", js)
print('Total getElementById calls:', len(ids))
missing = False
for i in sorted(set(ids)):
    if f'id="{i}"' not in html and f"id='{i}'" not in html:
        print('MISSING ID:', i)
        missing = True
    else:
        print('FOUND:', i)

if not missing:
    print('ALL IDs ARE PERFECT!')
