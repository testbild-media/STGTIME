# Installation on Raspberry Pi OS Lite 64-bit Trixie

1. Install Raspberry Pi OS Lite 64-bit Trixie and connect the Pi temporarily by Ethernet if possible.
2. Copy this repository to the Pi.
3. Run `sudo sh ./scripts/install.sh` from the repository root.
4. Reboot the Pi with `sudo reboot`. This is required before the HUB75 output can work.
5. Open `http://stgtime.local/` or the IP address shown on the matrix for the first ten seconds.
6. Sign in with the initial admin password `stagetimer` and change it under System.

The installer builds the current `rpi-rgb-led-matrix` library and the STGTIME matrix bridge locally. The installed matrix profile is 64×32, 1/16 scan, regular GPIO mapping, and GPIO slowdown 5. These values match the known-working archived setup and the SeenGreat pinout.

Application versions are installed under `/opt/stgtime/releases/<version>`. The system services run `/opt/stgtime/current`; the installer changes this link only after the new release, Stream Deck dependencies, and native matrix bridge are ready. The first run of the updated installer automatically migrates an existing flat `/opt/stgtime` installation into this versioned layout.

To prevent Raspberry Pi audio and automatic camera/display overlays from claiming GPIO resources required by HUB75, the installer comments out active `dtparam=audio=on`, `camera_auto_detect=1`, and `display_auto_detect=1` entries in `/boot/firmware/config.txt`. Before the first change it creates `/boot/firmware/config.txt.stgtime-backup`. It also installs `/etc/modprobe.d/stgtime-hub75-blacklist.conf`, blacklists `snd_bcm2835`, and rebuilds the initramfs. These changes only take effect after a reboot.

The installer also reserves CPU core 3 for the timing-sensitive HUB75 refresh loop using `isolcpus`, `nohz_full`, `rcu_nocbs`, and IRQ affinity in `/boot/firmware/cmdline.txt`. The original file is retained as `/boot/firmware/cmdline.txt.stgtime-backup`. The matrix bridge is pinned to that core with real-time priority; Stream Deck workers are restricted to cores 0–2 with low CPU and I/O priority. This prevents JPEG key updates from disturbing matrix refresh timing and requires a reboot after installation.

The hotspot starts for five minutes after each boot by default. Its initial SSID is `STGTIME` and its password is `stagetimer`. Both are configurable in the Web GUI.

In DHCP mode the Ethernet address, gateway, and DNS fields show the active NetworkManager lease and are read-only. Switching to Static makes the saved configuration editable. Hotspot operations use NetworkManager's atomic `nmcli device wifi hotspot` command; an operational failure is returned verbatim to the Web GUI instead of a generic internal error.

The clock time zone is configurable in the Web GUI without SSH. STGTIME stores an IANA zone such as `Europe/Berlin` or `America/New_York` and applies it to the Raspberry Pi with `timedatectl`. The configured zone is synchronized again on every STGTIME service start, so the display, system logs, and future integrations use the same local time.

Useful diagnostics:

```sh
systemctl status stgtime stgtime-streamdeck
journalctl -u stgtime -f
journalctl -u stgtime-streamdeck -f
lsmod | grep snd_bcm2835
ls -l /dev/hidraw*
```

If the Web GUI reports `HUB75 · unavailable`, `lsmod | grep snd_bcm2835` should produce no output after reboot. Restore the original boot configuration, if required, from `/boot/firmware/config.txt.stgtime-backup`.

The installer applies headless `hidraw` udev permissions for supported Elgato Stream Deck product IDs and adds the `stgtime` service account to `plugdev`. If an already connected deck still has `root root` permissions after an update, disconnect and reconnect it once, then restart `stgtime-streamdeck.service`.

Stream Deck Classic and Stream Deck XL can be connected at the same time. Every functional key is labeled on the deck itself, including presets, live time values, Start/Stop, Reset, Mode, and the Set Time page. The service starts one isolated worker per physical device and writes key images sequentially. A successful connection produces one of these messages:

```text
Stream Deck Classic connected and labeled
Stream Deck XL connected and labeled
```

If a device worker crashes inside the native HID library, the main service remains active, the other deck remains usable, and the failed device is retried after five seconds. Use `journalctl -u stgtime-streamdeck -f` to identify the affected model.
