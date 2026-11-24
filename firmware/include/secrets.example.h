#pragma once

// only for builds that enable Wi-Fi updates. Wi-Fi, the broker and the device
// identity are NOT here: they are provisioned into the hub (firmware/docs/mqtt.md).
// Copy this file to secrets.h (git ignores that name) and fill it in. Never put a
// real value in this file. Set MELOPHOS_SECRETS_ARE_PLACEHOLDER to 0 in your copy
// once the values are real: a build that enables updates refuses to compile while
// it is 1.
#define MELOPHOS_SECRETS_ARE_PLACEHOLDER 1

// Wi-Fi updates, only read when a build defines MELOPHOS_ENABLE_OTA. The key is
// the PUBLIC half of the signing key (tools/sign_image.py keygen writes it).
// The secret half never goes near this repository or the hub
#define UPDATE_PUBKEY_BYTES 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
#define UPDATE_MANIFEST_URL "https://updates.example.invalid/melophos/manifest.bin"
#define UPDATE_IMAGE_URL "https://updates.example.invalid/melophos/firmware.bin"
// the CA certificate (PEM) that signs the update server's TLS certificate
#define UPDATE_CA_CERT "-----BEGIN CERTIFICATE-----\nREPLACE\n-----END CERTIFICATE-----\n"
