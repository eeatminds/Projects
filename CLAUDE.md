# Notes for Claude

This repo holds the user's V-taper fitness plan and logs in `fitness/`.

- Plan, targets and adjustment rules: `fitness/plan.md` (Phase 1 fat loss: 2,000 kcal, 140 g protein per day).
- When the user reports food: estimate kcal and protein using `fitness/foods.md` (add any new food there), add it to that day's section in `fitness/food-log.md` (newest day on top), then reply with the day's total and what's left.
- When the user reports weight, waist, a body scan or strength numbers: add a row to `fitness/progress.md` and apply the weekly adjustment rules in `fitness/plan.md`.
- Commit and push after every update so the history survives between sessions.
- Keep replies short and simple.
