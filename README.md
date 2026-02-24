# Energie en Klimaat Overheidsupdates (statische site)

Deze website is volledig statisch en kan op GitHub Pages draaien zonder Python-backend.

## Hoe het werkt

- De pagina leest data uit:
  - `data/publicaties.json` (Rijksoverheid laatste 7 dagen inclusief vandaag)
  - `data/debatten.json` (aankomende energie/klimaatdebatten Tweede Kamer)
- Een GitHub Action (`.github/workflows/update-energy-data.yml`) ververst deze JSON elk uur.
- Een deploy Action (`.github/workflows/deploy-to-plesk.yml`) uploadt de site direct naar Plesk bij elke push naar `main`.

## Publiceren op GitHub Pages

1. Maak een nieuwe repository op GitHub.
2. Koppel je lokale project aan GitHub:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<jouw-gebruiker>/<jouw-repo>.git
git push -u origin main
```

3. Zet GitHub Pages aan:
- Ga naar `Settings` -> `Pages`
- Kies `Deploy from a branch`
- Selecteer branch `main` en folder `/ (root)`
- Save

4. Wacht 1-2 minuten. Je site staat dan op:
- `https://<jouw-gebruiker>.github.io/<jouw-repo>/`

## Data handmatig verversen (optioneel)

In GitHub:
- Ga naar `Actions` -> `Update energy data`
- Klik `Run workflow`

## Automatisch deployen naar Plesk via GitHub Actions

Maak in GitHub deze repository secrets aan via `Settings` -> `Secrets and variables` -> `Actions`:

- `PLESK_HOST`: jouw server hostnaam (bijv. `energiepa.snarfia.nl` of server-IP)
- `PLESK_USER`: Plesk/SSH gebruikersnaam
- `PLESK_SSH_KEY`: private SSH key van die gebruiker (hele key inclusief `BEGIN/END`)
- `PLESK_TARGET`: doelmap op server, meestal `/var/www/vhosts/snarfia.nl/httpdocs`

Daarna:
- Push naar `main` -> workflow `Deploy to Plesk` draait automatisch.
- De uur-workflow `Update energy data` deployt na update ook direct naar Plesk.

## Lokaal testen zonder Python

Je kunt een simpele statische server gebruiken, bijvoorbeeld:

```bash
npx serve .
```

Open daarna de URL die `serve` toont.
