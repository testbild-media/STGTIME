# Hardware profile

Target hardware:

- Raspberry Pi 4 running Raspberry Pi OS Lite 64-bit Trixie
- SeenGreat/xicoolee RGB Matrix Adapter Board
- Waveshare RGB-Matrix-P3-64x32, 64×32 pixels, 3 mm pitch, HUB75, 1/16 scan, 5 V / 2.5 A

The adapter uses the standard `regular` mapping expected by `rpi-rgb-led-matrix`:

| HUB75 | BCM | HUB75 | BCM |
|---|---:|---|---:|
| R1 | 11 | G1 | 27 |
| B1 | 7 | R2 | 8 |
| G2 | 9 | B2 | 10 |
| A | 22 | B | 23 |
| C | 24 | D | 25 |
| E | 15 | CLK | 17 |
| LAT | 4 | OE | 18 |

The installed defaults use `gpioSlowdown=5`, progressive scan mode `0`, PWM LSB 64 ns, 8 PWM bitplanes, and a stable 200 Hz refresh-rate limit. Eight PWM bits retain 256 levels per color channel while reducing the timing-sensitive refresh work compared with the library's 11-bit image-oriented default. Existing installations using the former 400 Hz profile are migrated automatically on service start.

On the Raspberry Pi 4, the installer reserves CPU core 3 for the HUB75 refresh thread and moves normal interrupts and Stream Deck processing to cores 0–2. The matrix launcher uses `chrt -f 90` and `taskset -c 3`; this prevents transient JPEG encoding load from producing visible brightness fluctuations.

## GPIO ownership on Raspberry Pi OS Trixie

The regular HUB75 mapping conflicts with the Raspberry Pi onboard audio module when `snd_bcm2835` is loaded. STGTIME therefore disables the following active entries in `/boot/firmware/config.txt` during installation:

```ini
# STGTIME disabled for HUB75 GPIO compatibility: dtparam=audio=on
# STGTIME disabled for HUB75 GPIO compatibility: camera_auto_detect=1
# STGTIME disabled for HUB75 GPIO compatibility: display_auto_detect=1
```

The installer also blacklists `snd_bcm2835` in `/etc/modprobe.d/stgtime-hub75-blacklist.conf`, runs `update-initramfs -u`, and requires a reboot. After reboot, `lsmod | grep snd_bcm2835` must return no output. If the module remains loaded, the native matrix process can exit and the Web GUI will report `HUB75 · unavailable`.

Power the panel only from a correctly polarized 5 V supply. Do not connect or disconnect the panel while powered. The adapter can accept 5 V through USB-C (up to 4 A) or its DC input (up to 8 A), and can power the Pi through its onboard selection link.

References: [SeenGreat adapter documentation](https://seengreat.com/wiki/75/rgb-matrix-adapter-board), [Waveshare panel documentation](https://docs.waveshare.com/RGB-Matrix-Px-64x32), and [rpi-rgb-led-matrix options](https://github.com/hzeller/rpi-rgb-led-matrix/blob/master/README.md).
