# Wi-Fi updates and the browser installer

Updates are the most dangerous feature, so the verification and the rollback are built and proved first. Status: the state machine and the checks are tested on the host. The Wi-Fi update is switched off by default. The installer page is written and untried.

## Switched off

The update code is only compiled into the hub when a build defines `MELOPHOS_ENABLE_OTA`. That needs real settings in `include/secrets.h`: `UPDATE_PUBKEY_BYTES`, `UPDATE_MANIFEST_URL`, `UPDATE_IMAGE_URL` and `UPDATE_CA_CERT`. A build with the flag and placeholder values does not compile. No key, real or test, is in the repository. The public key of the signing pair is the only thing that goes into the hub.

## What an image must pass

1. The manifest and the image are fetched over HTTPS with the server's certificate verified against `UPDATE_CA_CERT`. There is no insecure option and redirects are off. An address that is not `https://` or that carries a user name is refused.
2. The manifest is 144 bytes with an Ed25519 signature that must verify against the compiled-in public key. Nothing in it is read as meaningful before that.
3. The version, the board, the image size and the SHA-512 of the image are inside the signed bytes. The version must be above the running version, above the stored floor and not a version that already failed here. An old signed image cannot be replayed.
4. The image is hashed as it streams and written to the idle app slot. More bytes than signed stop the update before the extra byte is written. Fewer or a different hash, refuse it. The slot is only committed after size and hash both match.
5. The new image boots on trial. It is confirmed only after a minute of continuous health (storage up and, if the network is on, the broker reached). A crash, 4 boots without settling, 10 minutes without confirming or a bad pass in the minute rolls back and the version is remembered as failed. The version floor rises only on confirmation.

Every refusal has a test and a message a person can act on, for example `the update is not signed by us` or `the update is not newer than what is installed`. The signing tool and the device agree: `tools/check_signing.sh` signs a random image with a key made for the run and has the host test verify it through the code the hub runs.

## Settings and profiles survive

Profiles, the boot counter, the trial record and the floor live in their own partitions in [`partitions.csv`](../partitions.csv). An update writes only the idle app slot. The host test runs a confirmed and a rolled back update on the same flash as a profile store and reads the profile back unchanged. That proves the code does not touch them. It does not prove the real partition table.

## Signing

```bash
python tools/sign_image.py keygen --secret ~/melophos-update.key --public update.pub
python tools/sign_image.py sign --key ~/melophos-update.key --image .pio/build/esp32-s3/firmware.bin --version 101 --board s3 --out dist/
```

`keygen` refuses to write the secret inside a git work tree. Keep it out of the repository and out of CI logs.

## The installer page

[`installer/index.html`](../installer/index.html) uses ESP Web Tools pinned to version 10.4.0. `installer/make_manifest.py` collects the four flash images of a build and writes the manifest it reads. It checks the app offset against `partitions.csv`. The page is high contrast with a 44 px button and works in Chrome and Edge only, because it needs Web Serial. It has never flashed a board.

## Before `MELOPHOS_ENABLE_OTA` is ever defined in a release

Nobody turns this on until every line below is done and written down in the release notes. A release build that defines the flag with placeholder settings does not compile, but that guard cannot tell a real key from a wrong one.

1. **A production key pair made offline.** Run `tools/sign_image.py keygen` on a machine that is not connected to a network, write the secret to an encrypted drive and keep a second copy somewhere separate. The secret never touches this repository, a CI secret store or a laptop that is online. Decide who may sign and how a lost or leaked key is replaced. A replacement needs a hub update signed by the old key that carries the new public key, which the current code does not support: design that before the first release, because a leaked key cannot be revoked on hubs already in homes.
2. **The public half reaches the build** as `UPDATE_PUBKEY_BYTES` in `include/secrets.h` on the release machine. The 32 bytes are compared with the published fingerprint by two people before every release build.
3. **TLS with the server verified.** The update fetcher now uses the same connection code as the broker (`secureConnect`): the chain against the certificate authority the owner provisioned, the host name, the dates of every certificate in the chain (a chain of more than ten is refused), the clock check and a 10 second handshake limit. That means the update server's certificate must be signed by the provisioned authority and `UPDATE_CA_CERT` in `secrets.h` is no longer used. It compiles for the board and has never run on one. The time still comes from unauthenticated SNTP, see [mqtt.md](mqtt.md).
4. **The secure boot decision and what it costs.** The update signature protects a hub that takes an update over Wi-Fi. It does not protect against someone with a cable, who can flash anything. Secure boot v2 and flash encryption close that and they cannot be undone: eFuses burn once, a hub with the wrong key is bricked, a hub cannot be reflashed by the installer page any more and every board needs its own provisioning. The same flash encryption would protect the Wi-Fi password and device secret that sit in clear today (see [mqtt.md](mqtt.md)). Decide before the first hubs ship, because hubs that shipped without it cannot get it later.
5. **Rollback confirmed only after a healthy run.** Proved on the host. It still needs a board: a pulled cable mid-download, an image that crashes at start and one that hangs must each end on the old image. `verifyRollbackLater()` and the bootloader's rollback setting have to be shown to hold in the shipped binary.
6. **The installer page's own integrity.** The page loads ESP Web Tools from a CDN at a pinned version without a subresource hash and it flashes whatever `manifest.json` lists. Host it ourselves with the script bundled, serve it over HTTPS with a strict content security policy and publish the SHA-256 of each image beside it. Without that, whoever can change the page can flash anything. The installer's images are not signature checked by the hub: a first install trusts the page.
7. **The update trigger.** Today only the serial command `update` starts one. Decide who may start an update and when.
8. **A release checklist run on a real board**, listed in the release notes with the result.

The signature routine is checked at start against the RFC 8032 test vector and a key that is all zero or of small order is refused (a forged manifest verified against the all-zero placeholder key before this). `verifyRollbackLater` is declared `extern "C"` so it replaces the core's weak default, which would mark every image valid before `setup()`. That is checked in the linked image with `nm`, see the report.

## What remains

1. Generate the production signing pair and publish its public half. We have not.
2. Choose where the signed files are hosted and set the URLs and the CA certificate.
3. Prove on a board: that the partition table boots, that `esp_ota_*` stages and rolls back, that a pulled cable mid-download leaves the old image running, that a build which crashes at start rolls back through the bootloader and that the first-time install through the page works in Chrome on macOS and Windows.
4. Decide whether to turn on secure boot and flash encryption. A signed update does not protect a hub from someone with physical access.
5. Decide how the update starts. Today it is the serial command `update`. A button in the Studio and a schedule are not built.
