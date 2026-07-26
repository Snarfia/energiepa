# Energie & Klimaat — Beleidsradar

Een statische, automatisch ververste beleidsradar met officieel nieuws en komende
overheidsvergaderingen over energie en klimaat.

## Bronnen

- Rijksoverheid: nieuws over duurzame energie en klimaatverandering
- Autoriteit Consument & Markt: nieuws binnen het onderwerp energie
- Europese Commissie: DG Energy en DG Climate Action

De bronfeeds worden onafhankelijk verwerkt. Als één feed tijdelijk niet beschikbaar is, blijven de
laatst bekende berichten van die bron zichtbaar en worden de andere bronnen gewoon bijgewerkt.

## Vergaderagenda

- Nederland: openbare activiteiten uit de officiële Open Data-API van de Tweede Kamer
- Europa: energie-evenementen van het directoraat-generaal Energie van de Europese Commissie

De agenda toont alleen toekomstige activiteiten en wordt inhoudelijk gefilterd op energie en klimaat.

## Automatische verversing

De GitHub Action `Nieuws en agenda verversen` haalt iedere twee uur nieuwe berichten en afspraken op.
Een wijziging op `main` publiceert de website automatisch naar Cloud86. GitHub Pages blijft als
reservepublicatie beschikbaar.

Handmatig verversen kan via **Actions → Nieuws en agenda verversen → Run workflow**.

## Lokaal bekijken

Start een statische webserver in deze map, bijvoorbeeld:

```bash
npx serve .
```

Open daarna het lokale adres dat in de terminal verschijnt.
