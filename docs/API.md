# STGTIME REST API v1

Base URL: `http://stgtime.local/api/v1`

Authenticate with the Web GUI session cookie, `Authorization: Bearer <token>`, or `x-api-token: <token>`. The device token is stored in `/var/lib/stgtime/config.json` and is intentionally not exposed by the API.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Unauthenticated liveness check |
| GET | `/state` | Complete live state |
| PUT | `/timer` | Set mode, duration, jog, or overtime behavior |
| POST | `/timer/action` | Start, stop, toggle, or reset |
| POST | `/presets/{id}` | Load a preset |
| GET | `/display.png` | Exact 64×32 framebuffer |
| GET/PUT | `/config` | Read or merge non-secret configuration |
| PUT | `/message` | Set lower-zone text |
| PUT | `/video` | Set generic external media state |
| GET | `/network` | Read addresses and settings |
| POST | `/network/apply` | Apply an allow-listed network operation |
| GET | `/update` | Check the latest published GitHub release |
| GET | `/update/status` | Read cached release and installation status |
| POST | `/update/install` | Queue the latest verified GitHub release |
| POST | `/update/upload` | Stream and queue an offline update package |
| GET | `/security/api-token` | Reveal the token to an authenticated administrator |
| POST | `/security/api-token/rotate` | Replace the token and invalidate API clients |

All time values are integer milliseconds. See the live documentation at `/api.html` on the device for request examples.

Update installation endpoints always require the current administrator password in addition to normal API authentication. Send `{"password":"..."}` to `/update/install`. For `/update/upload`, send the `.tar.gz` as `application/gzip` and the password in `x-stgtime-admin-password`. Uploads are limited to 128 MiB.

## Timer examples

Set a ten-minute countdown and allow overtime:

```http
PUT /api/v1/timer
Content-Type: application/json

{"mode":"countdown","durationMs":600000,"continueNegative":true}
```

Change only the running value by one minute:

```json
{"jogMs":60000}
```

## Configuration example

`PUT /api/v1/config` performs a deep merge, so omitted values stay unchanged:

```json
{
  "display": {
    "brightness": 60,
    "format": "HH:MM:SS",
    "clockVisible": true,
    "clockColor": "#ff8800",
    "timeZone": "Europe/Berlin"
  },
  "timer": {
    "blinkAtEnd": true,
    "colors": {
      "normal": "#00ff00",
      "warning": "#ffd000",
      "critical": "#ff0000"
    },
    "thresholdsMs": {
      "warning": 420000,
      "critical": 180000
    }
  }
}
```

`display.timeZone` uses an IANA time-zone identifier such as `UTC`, `Europe/Berlin`, `America/New_York`, or `Asia/Tokyo`. On the Raspberry Pi, saving this value also changes the operating-system time zone through `timedatectl`; it is synchronized again whenever STGTIME starts. Invalid identifiers are rejected with HTTP 400.

Replace the preset list with `PUT /api/v1/presets`:

```json
{
  "presets": [
    {
      "id":"keynote",
      "name":"Keynote",
      "durationMs":2700000,
      "thresholdsMs":{"warning":450000,"critical":225000}
    }
  ]
}
```

Loading a preset applies its duration, Warning threshold, and Critical threshold together. Both thresholds are remaining-time values and must satisfy `durationMs >= warning >= critical >= 0`. If thresholds are omitted when creating a preset, STGTIME suggests Warning at one sixth and Critical at one twelfth of its duration; for a two-minute preset this is 20 and 10 seconds.

## Generic media input

Companion can send the state of a running vMix, VLC, or ProPresenter item without a native STGTIME integration:

```http
PUT /api/v1/video
Content-Type: application/json

{"visible":true,"label":"VIDEO","remainingMs":45000,"durationMs":120000}
```

The display uses the values for its middle time field and progress bar. Send `{"visible":false}` to hide it.

## Responses and errors

Successful writes return HTTP 200 and the affected state. Validation errors return HTTP 400 with an `error` string; missing authentication returns HTTP 401; unknown presets and routes return HTTP 404. The API never returns the stored password hash, and the token is revealed only through the dedicated authenticated security endpoint.
