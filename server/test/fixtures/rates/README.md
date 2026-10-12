# Rate feed fixtures

Real responses of the feeds chosen in spec 01, task 1 ("Trial results"). Fetched on 2026-10-07 at 20:53 UTC from a German IP address, without a key and without special headers. The files are byte-for-byte what the feeds returned; do not reformat them (the folder is in `.prettierignore`).

| File | Request |
|---|---|
| `ecb-eurofxref-daily.xml` | `GET https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` (rates of 2026-10-07) |
| `ecb-eurofxref-hist-90d.xml` | `GET https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml` (64 dates, 2026-07-10 to 2026-10-07, newest first) |
| `cbr-xml-daily-eng-2026-10-06.xml` | `GET https://www.cbr.ru/scripts/XML_daily_eng.asp?date_req=06/10/2026` |
| `cbr-xml-daily-eng-2026-10-04-sunday.xml` | `GET https://www.cbr.ru/scripts/XML_daily_eng.asp?date_req=04/10/2026`. A Sunday: the answer carries `Date="03.10.2026"`, the latest date with a rate. |
| `cbr-xml-dynamic-eur-2026-09-01-2026-10-07.xml` | `GET https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=01/09/2026&date_req2=07/10/2026&VAL_NM_RQ=R01239` (RUB per 1 EUR, 27 dates) |
| `cbr-xml-dynamic-usd-2026-09-01-2026-10-07.xml` | The same with `VAL_NM_RQ=R01235` (RUB per 1 USD) |
| `coinbase-candles-BTC-EUR-2026-09-01-2026-10-06.json` | `GET https://api.exchange.coinbase.com/products/BTC-EUR/candles?granularity=86400&start=2026-09-01T00:00:00Z&end=2026-10-06T00:00:00Z` (36 complete UTC days, newest first) |
| `coinbase-candles-ETH-EUR-2026-09-01-2026-10-06.json` | The same for `ETH-EUR` |
| `coinbase-candles-USDT-EUR-2026-09-01-2026-10-06.json` | The same for `USDT-EUR` |

Things a parser must handle, all visible in these files:

- The Bank of Russia files are declared `windows-1251`, use a decimal comma (`95,3349`) and carry a `Nominal` (the rate is `Value` per `Nominal` units; `VunitRate` is already per one unit). The English version contains only ASCII bytes. Dates are `DD.MM.YYYY`.
- The ECB daily and 90-day files quote attributes with `'`; the full history file (`eurofxref-hist.xml`, 8.2 MB, not stored here) quotes them with `"`.
- A Coinbase candle is `[time, low, high, open, close, volume]`: `time` is the start of the UTC day in seconds, and the prices are JSON numbers, not strings.
