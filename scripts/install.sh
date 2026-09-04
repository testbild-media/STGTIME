#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

root_dir="$(CDPATH= cd -P "$(dirname "$0")/.." && pwd)"
base_dir="/opt/stgtime"
data_dir="/var/lib/stgtime"
matrix_src="/opt/rpi-rgb-led-matrix"
boot_config="/boot/firmware/config.txt"
boot_cmdline="/boot/firmware/cmdline.txt"
version="$(tr -d '\r\n' < "$root_dir/VERSION")"
case "$version" in *[!0-9A-Za-z._-]*|'') echo "Invalid VERSION" >&2; exit 1;; esac
release_dir="$base_dir/releases/$version"
stage_dir="$base_dir/releases/.${version}.new.$$"
update_mode="${STGTIME_UPDATE:-0}"

if [ "$update_mode" != 1 ]; then
  apt-get update
  apt-get install -y nodejs npm git build-essential pkg-config libudev-dev network-manager sudo initramfs-tools util-linux curl
fi

if [ -f "$boot_config" ]; then
  if [ ! -f "${boot_config}.stgtime-backup" ]; then
    cp "$boot_config" "${boot_config}.stgtime-backup"
  fi
  for option in 'dtparam=audio=on' 'camera_auto_detect=1' 'display_auto_detect=1'; do
    sed -i -E "s|^[[:space:]]*${option}[[:space:]]*$|# STGTIME disabled for HUB75 GPIO compatibility: ${option}|" "$boot_config"
  done
else
  echo "Warning: $boot_config was not found; HUB75 boot options were not changed." >&2
fi

if [ -f "$boot_cmdline" ]; then
  if [ ! -f "${boot_cmdline}.stgtime-backup" ]; then
    cp "$boot_cmdline" "${boot_cmdline}.stgtime-backup"
  fi
  if grep -Eq '(^|[[:space:]])isolcpus=' "$boot_cmdline"; then
    echo "Existing CPU isolation in $boot_cmdline was preserved." >&2
  else
    cmdline="$(tr -d '\r\n' < "$boot_cmdline")"
    printf '%s %s\n' "$cmdline" 'isolcpus=domain,managed_irq,3 nohz_full=3 rcu_nocbs=3 irqaffinity=0,1,2' > "$boot_cmdline"
  fi
else
  echo "Warning: $boot_cmdline was not found; HUB75 CPU isolation was not configured." >&2
fi

install -o root -g root -m 0644 "$root_dir/systemd/stgtime-hub75-blacklist.conf" /etc/modprobe.d/stgtime-hub75-blacklist.conf
if [ "$update_mode" != 1 ]; then update-initramfs -u; fi

getent group plugdev >/dev/null || groupadd --system plugdev
id stgtime >/dev/null 2>&1 || useradd --system --home "$data_dir" --shell /usr/sbin/nologin --groups plugdev stgtime
usermod -a -G plugdev stgtime
install -d -o stgtime -g stgtime -m 0750 "$data_dir"
install -d -o root -g root -m 0755 "$base_dir" "$base_dir/releases" /usr/local/libexec
rm -rf "$stage_dir"
install -d -o root -g root -m 0755 "$stage_dir" "$stage_dir/assets" "$stage_dir/config" "$stage_dir/src" "$stage_dir/web" "$stage_dir/web/assets" "$stage_dir/streamdeck" "$stage_dir/native"

cp -a "$root_dir/src/." "$stage_dir/src/"
cp -a "$root_dir/config/." "$stage_dir/config/"
cp -a "$root_dir/web/." "$stage_dir/web/"
cp -a "$root_dir/streamdeck/." "$stage_dir/streamdeck/"
cp -a "$root_dir/assets/." "$stage_dir/assets/"
cp "$root_dir/package.json" "$root_dir/VERSION" "$stage_dir/"
chown -R root:root "$stage_dir"

if [ ! -d "$matrix_src/.git" ]; then
  [ "$update_mode" != 1 ] || { echo "Matrix source is missing; run the full installer once." >&2; exit 1; }
  git clone --depth 1 https://github.com/hzeller/rpi-rgb-led-matrix.git "$matrix_src"
elif [ "$update_mode" != 1 ]; then
  git -C "$matrix_src" pull --ff-only
fi
make -C "$matrix_src/lib" -j"$(nproc)"
g++ -O3 -std=c++17 "$root_dir/native/matrix_bridge.cc" \
  -I"$matrix_src/include" \
  "$matrix_src/lib/librgbmatrix.a" \
  -lrt -lm -lpthread \
  -o "$stage_dir/native/stgtime-matrix-bin"
chmod 0755 "$stage_dir/native/stgtime-matrix-bin"

if [ "$update_mode" = 1 ] && [ -d "$base_dir/current/streamdeck/node_modules" ]; then
  cp -a "$base_dir/current/streamdeck/node_modules" "$stage_dir/streamdeck/"
fi
cd "$stage_dir/streamdeck"
if [ "$update_mode" = 1 ]; then npm install --omit=dev --prefer-offline; else npm install --omit=dev; fi

previous_target="$(readlink -f "$base_dir/current" 2>/dev/null || true)"
if [ -z "$previous_target" ] && [ -d "$base_dir/src" ] && [ -f "$base_dir/package.json" ]; then
  legacy_dir="$base_dir/releases/.legacy-$(date +%s)"
  install -d -o root -g root -m 0755 "$legacy_dir" "$legacy_dir/native"
  for legacy_item in assets config src streamdeck web package.json; do
    if [ -e "$base_dir/$legacy_item" ]; then mv "$base_dir/$legacy_item" "$legacy_dir/"; fi
  done
  if [ -x /usr/local/libexec/stgtime-matrix-bin ]; then cp /usr/local/libexec/stgtime-matrix-bin "$legacy_dir/native/stgtime-matrix-bin"; fi
  legacy_version="$(/usr/bin/node -p "require('$legacy_dir/package.json').version" 2>/dev/null || echo legacy)"
  printf '%s\n' "$legacy_version" > "$legacy_dir/VERSION"
  previous_target="$legacy_dir"
fi
if [ -e "$release_dir" ]; then
  rollback_dir="$base_dir/releases/.rollback-${version}-$(date +%s)"
  mv "$release_dir" "$rollback_dir"
  if [ "$previous_target" = "$release_dir" ]; then previous_target="$rollback_dir"; fi
fi
mv "$stage_dir" "$release_dir"
if [ -n "$previous_target" ] && [ -d "$previous_target" ]; then ln -sfn "$previous_target" "$base_dir/previous"; fi
ln -sfn "$release_dir" "$base_dir/current.new"
mv -Tf "$base_dir/current.new" "$base_dir/current"

install -o root -g root -m 0755 "$root_dir/scripts/stgtime-network" /usr/local/libexec/stgtime-network
install -o root -g root -m 0755 "$root_dir/scripts/stgtime-system" /usr/local/libexec/stgtime-system
install -o root -g root -m 0755 "$root_dir/scripts/stgtime-matrix" /usr/local/libexec/stgtime-matrix
install -o root -g root -m 0755 "$root_dir/scripts/stgtime-update" /usr/local/libexec/stgtime-update
install -o root -g root -m 0440 "$root_dir/systemd/stgtime-sudoers" /etc/sudoers.d/stgtime
visudo -cf /etc/sudoers.d/stgtime >/dev/null

install -o root -g root -m 0644 "$root_dir/systemd/stgtime.service" /etc/systemd/system/stgtime.service
install -o root -g root -m 0644 "$root_dir/systemd/stgtime-streamdeck.service" /etc/systemd/system/stgtime-streamdeck.service
install -o root -g root -m 0644 "$root_dir/systemd/stgtime-update.service" /etc/systemd/system/stgtime-update.service
install -o root -g root -m 0644 "$root_dir/systemd/60-stgtime-streamdeck.rules" /etc/udev/rules.d/60-stgtime-streamdeck.rules
systemctl daemon-reload
udevadm control --reload-rules
udevadm trigger --subsystem-match=hidraw --action=add
systemctl enable stgtime.service stgtime-streamdeck.service
systemctl restart stgtime.service stgtime-streamdeck.service

if [ "$update_mode" = 1 ]; then
  echo "STGTIME $version updated successfully."
else
  echo "STGTIME installed. Reboot the Pi before testing the HUB75 display."
  echo "After reboot, open http://stgtime.local/ and sign in with password: stagetimer"
fi
