import json, datetime, collections, sys
d = json.load(open(sys.argv[1]))
L = [l for l in d["logs"] if abs(l["usdc"] - round(l["usdc"])) < 1e-6 and round(l["usdc"]) in (5,25,100,500,1000,2500)]  # real credit tiers only; drops $0/dust spam
UTC = datetime.timezone.utc
for l in L:
    l["dt"] = datetime.datetime.fromtimestamp(l["ts"], UTC)
print("coverage:", datetime.datetime.fromtimestamp(d["head_ts"] - (d["head"] - d["first_scanned_block"]) * 2, UTC).date(), "->", datetime.datetime.fromtimestamp(d["head_ts"], UTC).date())
print(f"payments: {len(L)}  total USDC: {sum(l['usdc'] for l in L):,.2f}  distinct paying wallets: {len({l['from'] for l in L})}")
print("\nby month: payments / USDC / wallets / tier mix")
bym = collections.defaultdict(list)
for l in L: bym[l["dt"].strftime("%Y-%m")].append(l)
for m in sorted(bym):
    x = bym[m]
    mix = collections.Counter(round(l["usdc"]) if round(l["usdc"]) in (5,25,100,500,1000,2500) else "other" for l in x)
    print(f"  {m}: {len(x):5d}  ${sum(l['usdc'] for l in x):9,.2f}  {len({l['from'] for l in x}):4d}  {dict(sorted(mix.items(), key=lambda kv: str(kv[0])))}")
now = d["head_ts"]
last30 = [l for l in L if l["ts"] > now - 30*86400]
print(f"\nlast 30 days: {len(last30)} payments, ${sum(l['usdc'] for l in last30):,.2f}, {len({l['from'] for l in last30})} wallets")
w = collections.defaultdict(list)
for l in L: w[l["from"]].append(l)
spans = []
for a, x in w.items():
    x.sort(key=lambda l: l["ts"])
    spans.append((a, len(x), sum(l["usdc"] for l in x), (x[-1]["ts"] - x[0]["ts"]) / 86400))
print("\nwallet behaviour:")
print("  paid once only:", sum(1 for s in spans if s[1] == 1), "of", len(spans))
print("  topped up across >= 30 days:", sum(1 for s in spans if s[3] >= 30))
print("  topped up across >= 60 days:", sum(1 for s in spans if s[3] >= 60))
print("  median total paid per wallet: $%.2f" % sorted(s[2] for s in spans)[len(spans)//2])
print("  top 10 wallets by USDC paid (wallet, payments, USDC, days between first/last):")
for s in sorted(spans, key=lambda s: -s[2])[:10]:
    print(f"    {s[0]}  {s[1]:4d}  ${s[2]:8,.2f}  {s[3]:5.1f}d")
top = sorted(spans, key=lambda s: -s[2])
tot = sum(s[2] for s in spans)
print("  share of USDC from top 5 wallets: %.1f%%" % (100 * sum(s[2] for s in top[:5]) / tot))
