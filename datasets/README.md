# Real-world datasets

Real historical readings for New Delhi (28.61 N, 77.21 E) that you can load into the Applications page
(**Add data → Paste CSV → Choose a .csv file**, then **Add & retrain**). Each file holds at most 500 rows,
which is one API batch.

| File | App | Columns | Rows | What it covers |
| --- | --- | --- | --- | --- |
| `delhi-pm25-smog-nov2023.csv` | Air quality | hour, wind (m/s), PM2.5 (µg/m³) | 384 | Every hour from 28 Oct to 12 Nov 2023: the post-Diwali smog episode and the rain that cleared it on 10–11 Nov |
| `delhi-temperature-2023.csv` | Weather | day of year, hour, temperature (°C) | 487 | One reading every 18 hours through 2023, so the hour of day rotates; includes the January cold wave and the May–June heat |

The columns after the third are ignored by the app's model. The fourth, `kind`, is `sensor` (a noisy
field reading). The fifth, `time_ist`, is the local timestamp, so every row can be traced back to its source.

## What the demo shows

The app's reference models are synthetic stand-ins (see `backend/app/core/applications.py`). Real data
doesn't follow them, and that gap is what the demo is for:

- **Air quality:** during the smog episode PM2.5 sat at about double what the reference model expects for
  the same hour and wind. When the CSV goes in, 348 of 384 readings are flagged as surprises, and the
  surface is retrained toward the real levels.
- **Weather:** the reference model describes a milder monsoon city than Delhi. Delhi's winter nights
  (down to 3 °C in January 2023) miss it by up to 17 °C. 384 of 487 readings are flagged.

These counts come from `test_shipped_real_datasets_are_accepted` in `backend/tests/test_applications.py`,
which runs on a freshly trained model.

## Sources and caveats

Data from the [Open-Meteo](https://open-meteo.com/) APIs, used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/):

- PM2.5: Open-Meteo Air Quality API, from the Copernicus Atmosphere Monitoring Service (CAMS) global
  model. This is a gridded model value, not a ground station. Coarse grids smooth out city hotspots, so it
  reads **lower** than Delhi's CPCB stations, which reported several hundred µg/m³ in the same week. For
  station data, download it from the CPCB portal or OpenAQ (needs a free API key) in the same three-column
  format.
- Wind speed and temperature: Open-Meteo Historical Weather API (ERA5 reanalysis, Copernicus Climate
  Change Service), 10 m wind and 2 m temperature.
- Wind speeds below 0.5 m/s are raised to 0.5 m/s, the lower edge of the app's input range.

There is no traffic file. The traffic app predicts congestion as extra travel time (%) by hour and
weekday, and no free, openly licensed dataset publishes that. Hourly vehicle *counts* exist (for example
the UCI "Metro Interstate Traffic Volume" set), but counts are a different quantity, and converting
them would put a made-up model between the data and the app.
