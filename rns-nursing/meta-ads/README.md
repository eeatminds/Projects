# RNS College of Nursing: Meta ad creatives

Creatives for the Pan-India Admissions Plan (2027 intake), built from photos and the logo on rnsnursingcollege.com (`../assets/img/`).

- `out/en/`: final PNGs, English. `NN_sq` 1080×1080, `NN_fd` 1080×1350, `NN_st` 1080×1920
- `out/overview_*.jpg`: contact sheets for review
- `copy-en.md`: primary text, headline and description per creative, target states, and a pre-launch claims checklist
- `creatives.html`: the templates. Open `creatives.html?id=03&size=fd` in a browser to preview one
- `render.mjs`: re-renders everything (`node render.mjs`, or `node render.mjs 03 07` for some). Needs Playwright with Chromium. It also flags text overflow and story CTAs that fall in the bottom safe zone

To add a language, copy the `C` object in `creatives.html`, translate the strings, and point the render output at `out/<lang>/`.
