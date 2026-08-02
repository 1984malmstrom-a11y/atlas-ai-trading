Autonomous paper-trading — kort driftguide

Starta i utveckling (Windows):

- Kör från repo root:

  `scripts\start-autonomous-dev.bat`

- Skriptet sätter processlokalt `PAPER_TRADER_SCHEDULER_MODE=in_memory` och startar `npm run dev`.

Standardport: 3000

Observationskommando (se två automatiska ticks):

- När dev-servern körs, i separat terminal:

  `node scripts/observe-autonomous-runtime.mjs [PORT]`

- Standardport är 3000. Ange annan port som första argument eller via `PORT` env.
- Scriptet väntar upp till 5 minuter och söker efter 2 separata automatic run timestamps.

Stoppa servern:

- Ctrl+C i terminalen där `npm run dev` körs.

Viktig driftinformation:

- Serverprocessen måste vara igång för att schemaläggaren ska autostarta.
- VS Code eller webbläsaren behöver inte vara öppna.
- Undvik att låta maskinen gå i fullständigt sleep/hibernation.
- När marknaden är stängd kan cycles markeras som `SKIPPED` — detta betyder att systemet försökte men avvaktade p.g.a. tid eller marknadsstatus.
- Scheduler fortsätter till nästa tick även om en cykel är SKIPPED.

Begränsningar & anteckningar:

- Vissa externa analystjänster (t.ex. Finnhub Macro Calendar) kan vara premiumbegränsade och returnera reducerad extradata. Kärnmarknadsdata (quotes, intraday, historical) är inte blockerande för schemaläggningens core-loop.
- Ingen manuell orderexekvering sker under dessa verifierade tester.

Säkerhet & integritet:

- Inga API-nycklar eller provider-payloads loggas av observationsscriptet.
- Diagnostiska filer är skrivna endast av serverprocessen och ligger under `src/data`.
