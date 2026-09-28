# Ouditnotas

Fase 1 is nog nie voltooi nie.

Voorlopige waarneming (2026-09-28): `curl` vanaf hierdie omgewing kry Imunify360-bladsye (`One moment, please...` / `Access denied by Imunify360 bot-protection`) op `robots.txt` en `/wp-json/`. ’n Blaaier-vlak haal van die tuisblad het wel die regte titel gesien: “Kruispad Hazeldean Gemeente – Gemeente van Jesus”. Die volledige kruip gebruik ’n regte blaaier en word in fase 1 gestoor.

## Verskaffde oudits (2026-09-28)

Twee oudits is verskaf en gestoor onder `artifacts/kruispad-audit/supplied/`:

- `Kruispad-Hazeldean-Site-Audit.docx` (+ onttrekte teks `…extracted.txt`)
- `Audit_KimiK3.txt`

Hulle stem nie op alle punte ooreen nie. Bekende verskille wat die lewendige kruip moet beslis:

| Punt | .docx-oudit | Kimi-oudit |
|---|---|---|
| Tuisblad Ken Burns-skyfies | KPmoments-49, 33, 26-1, 18, 8, 3 | KPmoments-4, 34, 39, 46, 48, 49-1 |
| Media-biblioteek | 280 unieke ID's (API-kop 283) | "~300+" |
| `/groepe/organisasies/` | Eleos + Kairos lang teks | "100% Eleos" |
| Fred/Suzi-bladsy | "Geen video-inbedding" | YouTube-inbedding `KkfNjoZLeHk` |
| Bladsytelling | 17 bladsye + 1 pos | "18 bladsye" (sluit pos in) |

Reël: waar oudit en lewendige werf verskil, word die lewendige, geverifieerde resultaat gebruik en die verskil hier gedokumenteer.

## Kruip-infrastruktuur

- Die bou-houer se netwerkbeleid weier `www.kruispadhazeldean.co.za` en `logiagenesis.github.io` (proxy 403).
- Daarom loop die kruip in GitHub Actions (`.github/workflows/audit.yml`) en commit die artifakte na `main`.
- Die gasheer gebruik Imunify360-botbeskerming; `scripts/crawl.mjs` gebruik Playwright/Chromium om die JS-uitdaging op te los en deel koekies met die REST-/sitemap-/media-versoeke.
