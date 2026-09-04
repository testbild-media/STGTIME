# Software updates

STGTIME checks `testbild-media/STGTIME` for the highest published semantic version, including GitHub prereleases, 30 seconds after startup and once every 24 hours. Draft releases are ignored. A failed network check does not affect the timer and the last successful result remains available in the Web GUI. Installation is never automatic.

## Publishing a release

1. Update `VERSION` and the root `package.json` to the same semantic version.
2. Commit and push the release source.
3. Create and push the matching tag, for example `v1.0.0`.
4. The GitHub Actions release workflow validates both versions, creates `stgtime-rpi4-arm64-1.0.0.tar.gz` and its `.sha256` file, and publishes a GitHub release with generated notes. Versions containing a prerelease suffix such as `-beta` are automatically marked as GitHub prereleases.

The online updater accepts only assets matching `stgtime-rpi4-arm64-*.tar.gz` returned by the public GitHub Releases API. It requires GitHub's SHA-256 asset digest and restricts downloads to the `testbild-media/STGTIME` release path over HTTPS.

## Installation and rollback

Application releases live under `/opt/stgtime/releases/<version>`. `/opt/stgtime/current` points to the active version and `/opt/stgtime/previous` points to the version available for rollback. A release is prepared completely before the `current` link changes.

The Web GUI writes a fixed update request under `/var/lib/stgtime/update` and starts `stgtime-update.service`. The privileged updater validates the digest and archive paths, rejects links and special files, extracts into a new staging directory, and invokes the installer in update mode. Configuration and credentials remain in `/var/lib/stgtime`.

After installation, the updater waits up to 30 seconds for `/api/v1/health`. If the new service does not become healthy, it restores the exact release that was active before the attempt and restarts both STGTIME services.

## Offline packages

An administrator can upload the same `.tar.gz` release asset in the Web GUI. Uploads are streamed to disk, limited to 128 MiB, and require the current administrator password even when normal WLAN access does not require Web authentication. The computed SHA-256 protects the queued file from corruption or replacement between upload and installation.

An offline upload is intentionally an administrator-trusted operation; unlike an online update, it cannot prove that the selected local file originated from the official GitHub repository. Download the package from the official release page and compare the accompanying `.sha256` file before uploading it when provenance matters.

Update progress and errors are stored in `/var/lib/stgtime/update/status.json` and shown in the Web GUI. Detailed logs are available with:

```sh
journalctl -u stgtime-update.service
```
