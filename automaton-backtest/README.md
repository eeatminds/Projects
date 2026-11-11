# Does Conway Automaton make money?

Checked on 2026-11-11 against [Conway-Research/automaton](https://github.com/Conway-Research/automaton) v0.2.1.

**Short answer: no.** No public evidence shows anyone making money with it. The public runs that report numbers all lost money or earned $0, and a simple backtest shows the agent burns through a normal top-up in about 1 to 5 weeks unless paying customers show up every day.

## What it is

Automaton is not a trading bot. It is an AI agent that runs in a loop, pays for its own servers and AI usage from a crypto wallet (USDC on Base), and has to find some way to earn money or it shuts down. The code has no built-in way to earn anything. Earning is left to whatever the AI decides to try (the README suggests selling paid API calls).

## What real users reported

| Source | What happened |
|---|---|
| [Issue #335](https://github.com/Conway-Research/automaton/issues/335), "Is there any verifiable evidence that an Automaton has become self-sustaining?" | Open since July 2026. Nobody has posted a working example. |
| Same issue, user who traded ETH/USDC with real money | 13 trades, **lost $0.30 on $24** (wallet-verified). Their 5.6-year backtest found no edge after fees. |
| Same issue, user who scanned Conway's payment address | Most payments were one-time $5 top-ups, the pattern of people trying it once rather than agents paying their own way. Their own agent marketplace had **0 outside buyers**. |
| [nexus-one](https://github.com/ghiata-maximilian/nexus-one) public ledger | Ran it on a free local GPU and fixed 11 bugs. **$0 revenue.** |
| Viral "earned $10,000 in 7 hours" claim | Never backed by a wallet or ledger. |

## On-chain check (done here)

Every USDC payment into Conway's credit address (`0x21DD37E3…Be10`, confirmed via Conway's own `/pay` endpoint), 18 Jul to 11 Nov 2026. The free node has no older history. Spam and $0 transfers are excluded.

| Month | Top-ups | USDC | Wallets |
|---|---|---|---|
| Jul (from 18th) | 40 | $200 | 22 |
| Aug | 185 | $945 | 31 |
| Sep | 18 | $90 | 8 |
| Oct | 3 | $15 | 2 |
| Nov (to 11th) | 0 | $0 | 0 |

- 63 wallets paid $1,250 in total. The median wallet paid $10.
- **No wallet kept paying for 30 days or more.** An agent that earned its keep would keep topping up over time.
- 245 of the 246 payments were the minimum $5 tier.
- Caveat: this only covers agents running on Conway's servers. Agents running on people's own computers don't show up here.

## Backtest

`python3 backtest.py`. Running costs come from the code's model price table and Conway's live VM pricing.

**Running cost:** about $0.68/day stripped down, **$3.79/day on default settings**, and $9.18/day for a busy agent.

**Test 1: sell a service at $0.10 per paid request, starting with $25**

| Paid requests/day | Bare minimum | Default settings | Busy |
|---|---|---|---|
| 0 (what public runs saw) | broke day 37 | **broke day 7** | broke day 3 |
| 5 | broke day 137 | broke day 8 | broke day 3 |
| 25 | +$663/yr | broke day 20 | broke day 4 |
| 100 | +$3,401/yr | +$2,268/yr | +$301/yr |

On default settings it needs about **38 paying requests every day** just to break even. No public run has shown even one outside customer.

**Test 2: trade ETH, last 365 days (ETH fell 40%)**, with 0.25% fee per trade and the agent paying its running cost from the same wallet

| Start | Strategy | No AI cost | Bare-minimum agent | Default agent |
|---|---|---|---|---|
| $25 | 20-day trend | -13% | broke day 37 | broke day 7 |
| $1,000 | 20-day trend | -12% | -37% | broke day 236 |
| $10,000 | 20-day trend | -12% | -15% | -26% |
| $10,000 | buy and hold | -40% | -42% | -53% |

The AI part only adds cost here. A plain script can make the same trades for free. Even in a good year, default settings cost about $1,380/year, so a 10%-a-year strategy would need about $14k of capital just to cover the agent.

## Caveats

- Running costs are estimates. Real token use depends on what the agent decides to do.
- The trading test covers one bad year for ETH. A rising year would look better before costs, but the running cost doesn't go away.
- On-chain data starts 18 Jul 2026 because older history needs a paid archive node.

## Files

- `backtest.py`: both tests
- `scan_topups.py` / `analyze_topups.py`: on-chain scan of Conway top-ups (`python3 -I analyze_topups.py data/conway_topups.json`)
- `data/`: ETH daily prices (CoinGecko) and the raw top-up scan
