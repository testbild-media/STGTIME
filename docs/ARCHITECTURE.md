# STGTIME architecture

STGTIME uses one source of truth for every controller and output:

```text
Web GUI / Stream Deck / Companion / future integrations
                         |
                    REST API v1
                         |
             Timer engine + configuration
                         |
                 64x32 frame renderer
                    /           \
              PNG preview    HUB75 bridge
```

The timer uses monotonic elapsed time rather than decrementing a counter on every render. A delayed render or NTP clock correction therefore cannot make the displayed time drift.

The renderer owns an exact 64×32 RGB framebuffer. The original v0.0.1 negative glyph PNGs were converted into fixed in-code bitmasks; PNG decoding is not part of text rendering. Color is applied only to set bits, so there is no antialiasing or interpolation. The same frame is sent to the physical matrix and encoded for the web preview, so the preview is authoritative. The vertical layout is fixed at `13 + 1 + 2 + 1 + 7 + 1 + 7 = 32` rows: main timer, gap, progress bar, gap, media/message line, gap, and clock/message line.

The HUB75 adapter is a small native process around `rpi-rgb-led-matrix`. It accepts length-prefixed RGB frames on standard input. The web process can run without GPIO access and invokes only this bridge and the allow-listed network helper through `sudo`.

External media systems should initially write generic video state to `PUT /api/v1/video`, normally from Bitfocus Companion. Native source adapters can later be added without changing the display or timer domains.

The native Stream Deck service is a lightweight device supervisor. It discovers every connected deck and starts one child process per HID path. Each child owns exactly one device, renders labeled LCD keys with the shared pixel font into plain JavaScript RGBA buffers, serializes all HID writes, and only updates tiles whose contents changed. No native canvas library participates in rendering. Classic v2 and XL JPEG key payloads are encoded by the pure JavaScript `jpeg-js` implementation instead of the optional native TurboJPEG path, and previously seen key images are retained in a bounded in-memory JPEG cache. A native-library fault or disconnect on one deck therefore cannot terminate the controller for the other decks; the affected worker is retried independently after five seconds.
