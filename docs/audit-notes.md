# Ouditnotas

## Fase 1 — lewendige kruip (2026-09-28, 08:20–08:30 UTC)

Bron: https://www.kruispadhazeldean.co.za/ — gekruip vanaf 'n GitHub Actions-hardeware met Playwright/Chromium
(Imunify360-botbeskerming blokkeer gewone `curl`), 1,2 s tussen versoeke.

| Uitset | Pad |
|---|---|
| Rou HTML + sigbare teks per roete | `artifacts/kruispad-audit/raw/html/` |
| REST-antwoorde (pages/posts/media/categories) | `artifacts/kruispad-audit/raw/rest/` |
| Sitemaps + robots.txt | `artifacts/kruispad-audit/raw/sitemaps/`, `raw/robots.txt` |
| Media-oorspronklikes `{id}_{lêernaam}` (286 lêers) | `artifacts/kruispad-audit/assets/` |
| Skermskote lessenaar 1440×900 / selfoon 390×844@2x | `artifacts/kruispad-audit/screenshots/{desktop,mobile}/` |
| Bladsy-, skakel-, media-, beeldgebruik-inventaris | `*.csv` in `artifacts/kruispad-audit/` |
| Kontakfeite + bekende-fout-toetse | `artifacts/kruispad-audit/contact-facts.json` |
| Gemete sny-risiko per beeld per skerm | `artifacts/kruispad-audit/image-crop-risk.csv` |

### Getalle (geverifieer)

- REST: **17 bladsye**, **1 pos** (`/droom-vir-kruispad/`), **280 media-items** (198 JPEG, 79 PNG, 2 MP4, 1 AVIF).
- Sitemaps: 20 URL's (17 bladsye, 1 pos, `/category/uncategorized/`, `/author/admin/`).
- 29 roetes gehaal: 24 × 200, 4 × 404, plus 4 aliasse wat 301 → 200 gee.
- Media-alt-teks: **2 van 280** nie leeg nie.
- 3 media-lêers gee 404 by aflaai: `2020/09/rsz_17390621_…-300x100.jpg`, `2021/02/Image-10-1-scaled.jpg`, `2021/02/Image-4-1-scaled.jpg`.
- `html lang="en-US"` en “Proudly powered by WordPress” op **elke** bladsy.

### Herleidings soos lewendig gemeet

| Ou URL | Lewendig | Nuwe werf |
|---|---|---|
| `/preke-en-media/kruispad-erediens/` | 301 → `/home/kruispad-erediens/` | herlei |
| `/preke-en-media/cafe-berea/` | 301 → `/cafe-berea/` | herlei |
| `/home/odos-kidz/` | 301 → `/odos-kidz/` | herlei |
| `/meer-oor-ons/organisasies/` | 301 → `/groepe/organisasies/` | herlei |
| `/droom-vir-kruispad/` | 200 (duplikaat-pos) | herlei → `/meer-oor-ons/droom-van-kruispad/` |
| `/?page_id=485` | **404** (in hoofnavigasie) | herlei → `/home/kruispad-erediens/` |
| `/meer-oor-ons/organisasies/elios/` | **404** | herlei → `/dien/elios/` |
| `/meer-oor-ons/organisasies/kairos/` | **404** | herlei → `/dien/kairos/` |
| `/http-www-boxout-web-za-gebeure-kalender/month/` | **404** (skakel op `/dien/`) | skakel verwyder |
| `/2020/12/` | 200 (ou argief, skakel op `/dien/`) | skakel verwyder |

### Bekende foute — lewendige bevestiging

| Fout (uit opdrag) | Lewendig gevind? | Waar |
|---|---|---|
| `christiaan@kruispadhazelden.co.za` | **Ja** | `/home/kruispad-erediens/` (+ alias) |
| `christiaan@kruispadhazeldea.co.za` | **Ja** | `/meer-oor-ons/span/` |
| `admin@ kruispadhazeldean.co.za` (spasie) | **Nee** — HTML is `admin@</span><span>kruispadhazeldean…`, geen spasie-karakter nie. Die adres is oor twee `<span>`s verdeel; dit mag visueel as 'n breuk vertoon. Word in elk geval uit `siteFacts` herbou. | `/home/kruispad-erediens/` |
| “Kruipad Finansies” | **Ja** | `/meer-oor-ons/span/` |
| Verdubbelde WhatsApp-URL | **Ja** — dit is die **enigste** WhatsApp-`href` op die werf | `/groepe/` (Young Adults) |
| Boxout-kalender-skakel | **Ja** (404) | `/dien/` |
| `lang="en-US"` | **Ja** | alle bladsye |
| WordPress-voetskrif | **Ja** | alle bladsye |

Addisionele lewendige bevindings wat nie in die opdrag was nie:

- **“Senior tee Whatsapp groep”-knoppie het `href=""` (leeg).** Daar is geen gepubliseerde Senior tee-groepskakel nie. Die nuwe werf sal **nie** 'n skakel uitdink nie; dit verwys na die kantoor.
- Geen `tel:`- of `mailto:`-skakels vir die gemeente self nie (net `mailto:admin@odos.co.za`). E-posse en telefoon is net teks.
- Tuisblad se Ken Burns-skyfievertoning laai nie in die skermskoot nie (groot leë donker area op lessenaar).

### Verskille tussen verskafde oudits en lewendige kruip

| Punt | .docx-oudit | Kimi-oudit | **Lewendig (gebruik dit)** |
|---|---|---|---|
| Tuisblad Ken Burns-skyfies | KPmoments-49, 33, 26-1, 18, 8, 3 | KPmoments-4, 34, 39, 46, 48, 49-1 | **KPmoments-49, 33, 26-1, 18, 8, 3** (.docx korrek) |
| Media-biblioteek | 280 | "~300+" | **280** |
| `/groepe/organisasies/` inhoud | Eleos + Kairos | "100% Eleos" | **Eleos + Kairos** (.docx korrek) |
| Fred/Suzi-video | "geen video-inbedding" | `KkfNjoZLeHk` | **Twee YouTube-widgets: `KkfNjoZLeHk` en `06fM-Bb31PM`** |
| Groepe WhatsApp | "een korrek, een verdubbel" | — | **Net die verdubbelde een; Senior tee-knoppie is leeg** |
| `admin@ ` met spasie | Ja | — | **Nee** (sien bo) |
| Bladsy-telling | 17 + 1 pos | "18 bladsye" | **17 bladsye + 1 pos** |

### Beeld-sny-risiko (gemeet, `image-crop-risk.csv`)

- 411 weergawe-rye; **118 HOOG** (≥ 50 % van die beeld versteek).
- Binnebladsy-kopstrook `cropped-KRUISPAD-66` (gemeentefoto, 2000×552-snit) in 'n 1440×183-boks: ~54 % versteek, op elke binnebladsy.
- KPmoments-portrette (1707×2560) as `cover`-agtergrond in 1230×508-bokse op `/home/kruispad-erediens/`: ~72 % versteek.
- `/meer-oor-ons/` selfoon: 31 HOOG-rye (skyfievertoning van 12 beelde).
- Personeelkaarte (`/meer-oor-ons/span/`) gebruik Elementor-voorafgesnyde 300×300-duimnaels; oorspronklikes word in fase 6 herraam.

## Kruip-infrastruktuur

- Die bou-houer se netwerkbeleid weier `www.kruispadhazeldean.co.za` en `logiagenesis.github.io` (proxy 403).
- Daarom loop die kruip in GitHub Actions (`.github/workflows/audit.yml`, slegs handmatig) en commit die artifakte na `main`.
- `scripts/analyse-audit.mjs` herlei feite en sny-risiko vanlyn uit die gestoorde rou HTML.

## Verskaffde oudits

Gestoor onder `artifacts/kruispad-audit/supplied/`: die .docx-oudit (+ onttrekte teks), die Kimi-oudit, die Drive-“Information”-opdrag en 'n opsomming van die mislukte GPT/Opus-pogings.
