# Boulog

## Fase 0 — repo en ontplooiing

- Leë GitHub-repo `logiagenesis/kruispad` bevestig (geen takke, geen lêers).
- Statiese Astro + TypeScript + Tailwind-projek geskep.
- Rooktoets-tuisblad met geverifieerde Sondag-tye, telefoon en logo.
- GitHub Actions-werkvloei ontplooi `dist/` na GitHub Pages onder `/kruispad/`.
- `html lang` is `af-ZA`.
- Ontplooiing het misluk: `deploy-pages` gee `404 … Ensure GitHub Pages has been enabled`. `configure-pages` met `enablement: true` bygevoeg as poging; indien dit steeds misluk moet die eienaar Settings → Pages → Source: **GitHub Actions** kies.

## Fase 1 — kruip-infrastruktuur

- `scripts/crawl.mjs`: robots, sitemaps, REST (pages/posts/media/categories), HTML van alle roetes + brief-aliasse, skakel-/beeld-/iframe-/vorm-onttrekking, media-aflaai na `assets/{id}_{lêernaam}`, CSV-inventarisse, `contact-facts.json`.
- `scripts/screenshot-live.mjs`: volbladsy-skermskote (lessenaar 1440×900, selfoon 390×844 @2x) plus gemete beeldweergawe (natuurlike vs weergegewe grootte, object-fit, agtergrond-grootte).
- `.github/workflows/audit.yml` loop albei op 'n GitHub-hardeware en commit na `main`.
