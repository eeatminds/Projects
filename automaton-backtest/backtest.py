"""
Very simple backtest: can a Conway Automaton earn more than it costs to run?

Two tests, both day-by-day, with the agent paying its own running costs
out of its own wallet (that is how Automaton works: if the balance hits
zero, the agent stops).

  Test 1 - "Sell a service" (what the README suggests).
           Revenue = paid requests per day x price per request.
  Test 2 - "Trade ETH" (what users who tried to make it profitable did).
           Real daily ETH/USD prices for the last 365 days.

Running-cost numbers come from the automaton code and Conway's live
pricing endpoint (see COSTS below). They are estimates: real token use
depends on what the agent decides to do.

Run:  python3 backtest.py
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- costs
# Conway VM, cheapest "Small" tier: 500 cents/month (GET /v1/credits/pricing).
SANDBOX_PER_DAY = 5.00 / 30

# Default model gpt-5.2: $1.75 / M input, $14 / M output (src/inference/types.ts).
# One agent turn ~= 20k input tokens (77 tool schemas + system prompt + history)
# and ~1k output tokens.
TURN_COST_DEFAULT = 20_000 * 1.75e-6 + 1_000 * 14e-6     # ~ $0.049
# Cheaper gpt-5-mini used in low_compute tier: $0.80 / M in, $3.20 / M out.
TURN_COST_CHEAP = 20_000 * 0.80e-6 + 1_000 * 3.20e-6     # ~ $0.019

# Heartbeat background checks (triage calls every 15 min at normal tier,
# 4x slower in low-compute). Estimate from src/heartbeat/config.ts.
HEARTBEAT_NORMAL = 1.66
HEARTBEAT_LOW = 0.42

PROFILES = {
    # name: (daily cost, description)
    "bare minimum": (SANDBOX_PER_DAY + HEARTBEAT_LOW + 5 * TURN_COST_CHEAP,
                     "cheap model, 5 turns/day"),
    "default settings": (SANDBOX_PER_DAY + HEARTBEAT_NORMAL + 40 * TURN_COST_DEFAULT,
                         "gpt-5.2, 40 turns/day"),
    "busy agent": (SANDBOX_PER_DAY + HEARTBEAT_NORMAL + 150 * TURN_COST_DEFAULT,
                   "gpt-5.2, 150 turns/day"),
}


def money(x):
    return f"-${-x:,.2f}" if x < 0 else f"${x:,.2f}"


# ------------------------------------------------------- test 1: service
def run_service(start_balance, daily_cost, revenue_per_day, days=365):
    bal = start_balance
    for day in range(1, days + 1):
        bal += revenue_per_day - daily_cost
        if bal <= 0:
            return day, 0.0
    return None, bal


def test_service():
    print("=" * 72)
    print("TEST 1 - Sell a service at $0.10 per paid request (365 days)")
    print("=" * 72)
    print("Starting balance $25 (the common 'practical' top-up).\n")
    price = 0.10
    demand = [
        ("0 paid requests/day  (what public runs actually saw)", 0),
        ("5 paid requests/day", 5),
        ("25 paid requests/day", 25),
        ("100 paid requests/day", 100),
    ]
    for name, (cost, desc) in PROFILES.items():
        breakeven = cost / price
        print(f"{name} ({desc}): costs {money(cost)}/day "
              f"-> needs {breakeven:.0f} paid requests every day to break even")
        for label, reqs in demand:
            died, end = run_service(25.0, cost, reqs * price)
            if died:
                print(f"   {label:52s} runs out of money on day {died}  (lost $25.00)")
            else:
                print(f"   {label:52s} alive after 1 year, balance {money(end)} "
                      f"(net {money(end - 25)})")
        print()


# --------------------------------------------------------- test 2: trading
FEE_PER_SIDE = 0.0025   # ~0.5% round trip, measured on Base with real money (issue #335)
GAS_PER_TRADE = 0.002   # USD, measured on Base (issue #335)


def load_prices():
    with open(os.path.join(HERE, "data", "eth_daily_365d.json")) as f:
        return [p for _, p in json.load(f)["prices"]]


def signal_buy_hold(prices, t):
    return True


def signal_sma20(prices, t):
    if t < 20:
        return False
    return prices[t] > sum(prices[t - 20:t]) / 20


def signal_momentum7(prices, t):
    if t < 7:
        return False
    return prices[t] > prices[t - 7]


STRATEGIES = {
    "buy and hold ETH": signal_buy_hold,
    "20-day trend (in ETH above 20d avg)": signal_sma20,
    "7-day momentum (in ETH if up on week)": signal_momentum7,
}


def run_trading(prices, signal, capital, daily_cost):
    """Returns (final equity, day the agent died or None, number of trades)."""
    usd, eth, trades = capital, 0.0, 0
    for t in range(len(prices) - 1):
        p = prices[t]
        want_eth = signal(prices, t)
        if want_eth and usd > 0:
            eth += usd * (1 - FEE_PER_SIDE) / p
            usd = -GAS_PER_TRADE
            trades += 1
        elif not want_eth and eth > 0:
            usd += eth * p * (1 - FEE_PER_SIDE) - GAS_PER_TRADE
            eth = 0.0
            trades += 1
        # agent pays today's running cost from the wallet
        usd -= daily_cost
        if usd < 0 and eth > 0:          # sell ETH to cover the bill
            need = -usd
            sell = min(eth, need / (p * (1 - FEE_PER_SIDE)))
            eth -= sell
            usd += sell * p * (1 - FEE_PER_SIDE)
        if usd + eth * p <= 0:
            return 0.0, t + 1, trades
    final = usd + eth * prices[-1] * (1 - FEE_PER_SIDE if eth > 0 else 1)
    return final, None, trades


def test_trading():
    prices = load_prices()
    print("=" * 72)
    print(f"TEST 2 - Trade ETH, last 365 days (ETH ${prices[0]:,.0f} -> ${prices[-1]:,.0f}, "
          f"{(prices[-1] / prices[0] - 1) * 100:+.0f}%)")
    print("=" * 72)
    print("0.25% fee per trade + gas. Agent pays its running cost daily from the same wallet.\n")
    costs = [("no AI cost (strategy alone)", 0.0),
             ("bare minimum agent", PROFILES["bare minimum"][0]),
             ("default settings agent", PROFILES["default settings"][0])]
    for capital in (25, 1_000, 10_000):
        print(f"Starting with {money(capital)}:")
        for sname, sig in STRATEGIES.items():
            parts = []
            for cname, c in costs:
                final, died, trades = run_trading(prices, sig, capital, c)
                if died:
                    parts.append(f"{cname}: broke on day {died}")
                else:
                    parts.append(f"{cname}: {money(final - capital)} ({(final / capital - 1) * 100:+.0f}%)")
            print(f"   {sname:40s} " + " | ".join(parts))
        print()


if __name__ == "__main__":
    print("\nDaily running cost estimates:")
    for name, (cost, desc) in PROFILES.items():
        print(f"   {name:17s} {money(cost)}/day  = {money(cost * 365)}/year   ({desc})")
    print()
    test_service()
    test_trading()
