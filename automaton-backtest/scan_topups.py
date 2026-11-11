# Scan all USDC transfers into Conway's x402 top-up address on Base.
import json, subprocess, sys, time
URL = "https://base-rpc.publicnode.com"
USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
PAYTO = "0x" + "0"*24 + "21dd37e3e4ea6ccc0a5c98a4944702ede6e7be10"

def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    for i in range(6):
        out = subprocess.run(["curl", "-sS", "-m", "90", "-X", "POST", URL, "-H", "content-type: application/json", "-d", body],
                             capture_output=True, text=True).stdout
        try:
            r = json.loads(out)
            if "result" in r:
                return r["result"], None
            return None, r.get("error")
        except Exception:
            time.sleep(2 ** i)
    return None, {"message": "no response"}

head = int(rpc("eth_blockNumber", [])[0], 16)
blk, _ = rpc("eth_getBlockByNumber", [hex(head), False])
head_ts = int(blk["timestamp"], 16)
start = int(sys.argv[1]) if len(sys.argv) > 1 else 41_000_000
chunk = 500_000
logs = []
skipped_to = start
b = start
while b <= head:
    end = min(b + chunk - 1, head)
    res, err = rpc("eth_getLogs", [{"address": USDC, "fromBlock": hex(b), "toBlock": hex(end), "topics": [TOPIC, None, PAYTO]}])
    if err and "Archive" in str(err.get("message","")):
        skipped_to = end + 1
        b = end + 1
        continue
    if err:
        if chunk > 5000:
            chunk //= 2
            continue
        print("giving up at", b, err, file=sys.stderr); break
    for l in res:
        bn = int(l["blockNumber"], 16)
        logs.append({"block": bn, "ts": head_ts - (head - bn) * 2, "from": "0x" + l["topics"][1][-40:],
                     "usdc": int(l["data"], 16) / 1e6, "tx": l["transactionHash"]})
    print(f"{b}-{end}: {len(res)} (chunk {chunk}, total {len(logs)})", file=sys.stderr)
    b = end + 1
json.dump({"head": head, "head_ts": head_ts, "start": start, "first_scanned_block": skipped_to, "logs": logs}, open(sys.argv[2] if len(sys.argv) > 2 else "data/conway_topups.json", "w"))
print("done", len(logs))
