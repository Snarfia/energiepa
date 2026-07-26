# Energie & Klimaat — Beleidsradar

Een statisch, automatisch ververst nieuwsoverzicht met officiële berichten over energie en klimaat.

## Bronnen

- Rijksoverheid: nieuws over duurzame energie en klimaatverandering
- Autoriteit Consument & Markt: nieuws binnen het onderwerp energie
- Europese Commissie: DG Energy en DG Climate Action

De bronfeeds worden onafhankelijk verwerkt. Als één feed tijdelijk niet beschikbaar is, blijven de
laatst bekende berichten van die bron zichtbaar en worden de andere bronnen gewoon bijgewerkt.

## Automatische verversing

De GitHub Action `Nieuws verversen` haalt iedere twee uur nieuwe berichten op en schrijft deze naar
`data/nieuws.json`. Een wijziging op `main` publiceert de website automatisch via GitHub Pages.

Handmatig verversen kan via **Actions → Nieuws verversen → Run workflow**.

## Lokaal bekijken

Start een statische webserver in deze map, bijvoorbeeld:

```bash
npx serve .
```

Open daarna het lokale adres dat in de terminal verschijnt.
