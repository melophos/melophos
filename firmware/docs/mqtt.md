# Publishing practice sessions over MQTT

Finished sessions and live note batches reach the server without the hub calling the HTTP API. Status: builds for the board, packets, queue, pairing and certificate date checks tested on the host and the messages checked against the server's own models. It awaits a board and a broker with a TLS listener.

## Topics and payloads

The topics and the message bodies are the ones in [protocol.md](../../docs/protocol.md). The hub publishes to `melophos/<device_id>/<kind>` with the device id the pairing flow handed out.

| Kind | When | Delivery |
| --- | --- | --- |
| `notes` | Every 250 ms while notes are played, at most 32 events a message | QoS 1 |
| `session` | When a session ends: 2 minutes without a note, 6 hours or 49 000 events | QoS 1 |
| `status` | On connect and every 60 seconds | QoS 0, a lost one is replaced by the next |

`test/data/mqtt_golden.txt` holds one message of each kind. The host test compares the firmware output with it byte for byte and `python test/contract_check.py` feeds the same lines to the server's models. `started_at` is the same in every message of a session. A message with no date is never built: the hub waits for the clock and never invents one.

## Transport: TLS by default

The hub connects with MQTT 3.1.1 over TLS and verifies the broker's certificate. There is no plain path in a release build.

| Property | How |
| --- | --- |
| Certificate authority | Provisioned by the owner into the hub's storage. Never compiled in and never in a tracked file |
| Chain and host name | Checked by mbedTLS against that authority and the broker host name |
| Validity dates | Checked by our own code after the handshake, for every certificate the broker presented (see below) |
| No clock | The hub does not connect. It waits for SNTP, because a certificate cannot be judged without the date |

### The date check

The Arduino core this project pins (4.20017.260907) builds mbedTLS with `CONFIG_MBEDTLS_HAVE_TIME_DATE` switched off. We read `tools/sdk/esp32s3/sdkconfig` and `tools/sdk/esp32/sdkconfig` in that core: both have `# CONFIG_MBEDTLS_HAVE_TIME_DATE is not set` beside `CONFIG_MBEDTLS_HAVE_TIME=y`. So the library checks signatures and the host name and does not check whether a certificate has expired or has started yet. We have not disassembled the library to confirm. The configuration is clear and we treat it as true. `src/tls_transport.cpp` therefore walks the presented chain with `getPeerCertificate()` after the handshake and checks every certificate's dates with `lib/tlscheck`, which is tested at its boundaries (one second before, on and after each end) and refuses an unset clock, a malformed date and a reversed range. The certificate authority the hub holds is part of what it trusts, so its dates are checked too: the glue parses the provisioned authority and adds its validity to the chain (at most ten certificates in all, more are refused). Revisit this when the core is upgraded: if a newer core enables the option the check stays harmless.

### Getting the certificate authority onto the hub

A self-hosted server has its own authority. The owner gives it to the hub over the serial port, as one line of base64:

```bash
base64 < ca.pem | tr -d '\n' | { printf 'provision ca '; cat; echo; } > ca-line.txt
```

Paste the contents of `ca-line.txt` into the serial monitor. The hub validates it is a PEM certificate of at most 3000 characters and stores it in its own flash. The Studio will offer the same step later. The rest of the setup is the same kind of line. A Wi-Fi name or password with spaces goes in double quotes.

```text
provision wifi HomeNet my-wifi-password
provision broker mqtt.home.example 8883
provision supply 5000
provision api studio.home.example 443
provision ca <base64 of the PEM>
provision show
```

`provision show` says which settings are present and never prints a secret. A Wi-Fi name with a space is not supported yet.

### Plain MQTT, for development only

`provision insecure on` lets a development build talk to the broker without TLS. In a release build (`-D MELOPHOS_RELEASE`, the `esp32-s3-release` and `esp32-bringup-release` environments) the handler for the command is not compiled, so the word is not recognised and is refused like any unknown command (the identity store also refuses to set the flag). `pio test -e native-release` checks that the provisioning and identity code refuse the flag and the command. The TLS glue itself is checked only by building the release environments and by `strings` on the linked image, not by a test. While it is on the hub shows it: ten keys, spread evenly along the bar, glow dim white for 2 seconds in every 30 (ten is inside the strip's small-area allowance, so it is one small event and not a bar-wide rise). It is one slow on and off, never a flash and the same with reduced motion. The Studio's device view cannot show it yet.

The server's broker listens in plain text on 1883 today. The server stream has to add a TLS listener (8883) and a certificate before a hub can connect the secure way. Until then a hub can only reach it with the development flag.

## Identity and secrets

Nothing about a hub's identity or the owner's network is compiled in or in any tracked file.

| What | Where it comes from | Where it lives |
| --- | --- | --- |
| Wi-Fi name and password | The owner, `provision wifi` | NVS |
| Broker and server address | The owner, `provision broker` and `provision api` | NVS |
| Certificate authority | The owner, `provision ca` | NVS |
| Device id and secret | The server's pairing flow | NVS |

The pairing flow is the one in protocol.md. The hub asks the server for an identity over HTTPS (`POST /api/v1/pairing`) with the same certificate and date checks as the broker. It writes the id and secret to NVS at once and shows the code (on the serial port today, the display later). It polls `GET /api/v1/device` every 3 seconds until the owner has typed the code into the Studio. It gives up and asks again after `expires_in` seconds, at most 20 requests an hour and obeys a 429. A 401 later or two refused broker logins in a row, a minute apart, means the owner removed the hub, so it forgets the identity and pairs again. Anything the server says that the hub cannot store safely (a bad id, a short secret, a bad code) is dropped. The decisions (when to pair, when to connect, when to give up) are one controller (`lib/netctl`) that the host tests run against a model of the server, including a ten-minute replica of the task. That model is ours: nothing has run against the real server.

`factory-reset` on the serial port clears the Wi-Fi, broker, server address, certificate authority, device id and secret and erases every stored profile. It keeps the boot counter and the update version floor, which must never go backwards. `provision clear device` forgets only the identity and `provision clear all` forgets all provisioning and keeps the profiles.

### What someone holding the hub can read

Everything above sits unencrypted in the flash, because flash encryption and NVS encryption are not turned on. Anyone who can plug in a cable and run `esptool.py read_flash` gets the Wi-Fi password, the device secret, the certificate authority, the profiles and the last session's notes. The device secret is the hub's whole identity on the broker, so a stolen hub should be removed in the Studio. Turning on flash encryption is a decision recorded in [updates.md](updates.md).

## What the server now requires of a hub

These follow the rewritten [protocol.md](../../docs/protocol.md).

- **No broker before the claim.** The server makes the broker login only when the owner has typed the code and the hub then calls `GET /api/v1/device`. The hub does not try the broker until that answer says `paired: true`. After a restart a hub that was waiting carries on polling and a hub that was paired goes straight to the broker. A refused login waits a full minute before the next try, never a tight loop and two refusals in a row mean the hub was removed or un-claimed, so it forgets the identity and pairs again.
- **Client id.** The client id, the user name and the topic id are all the device id (`deviceConfig` in `lib/mqttwire`), which a test checks in the CONNECT packet.
- **Port and TLS.** The broker's TLS port is 8883 and `provision broker <host>` defaults to it. A hub with TLS refuses port 1883, the plain development listener.
- **Message size.** The largest message the hub can build is under 4 kB, far below the broker's 128 KiB limit and the retain flag is never set.
- **Events per message.** `notes` carries at most 32 events and `session` none, so no message comes near the limit of 1000. The outbox keeps at most 1000 events and restores them as 32-event messages. A hub starts at most 120 sessions an hour and refuses the 121st (counted, not lit). A session is closed at 49 000 events.
- **Dates.** `started_at` must be inside the last 366 days and at most a day ahead. A message whose date is outside that is dropped and counted, not sent. Until the clock is set (SNTP) the hub sends no `notes` or `session` message at all: sessions wait in the queue and are dated from how long ago they began once the time arrives. Anything still waiting after 24 hours is dropped and counted.
- **Boot.** The counter is raised only when a boot first connects to the broker, never at power-up, so a hub that restarts again and again offline writes nothing to flash and cannot jump. The server accepts a `boot` at most 1000 above the last it saw and `GET /api/v1/device` now returns it as `last_boot` (null for a hub it has not heard from, which may start anywhere up to 1 000 000). The hub compares at start and, if its number is not above `last_boot` or is more than 1000 above it, says so on serial once a minute with the recovery steps and publishes nothing. The counter is an append-only log (8 byte records, one erase per 511 increments), so even a hub that connected every second would erase a sector once in 1022 seconds, about 1180 days to the 100 000 cycles of the part. Before that change the counter erased a sector on every boot and a 1 Hz restart loop wore it out in about 2.3 days. The hub's counter rises by exactly one. If the hub has an identity and its counter is gone (the partition was erased) or cannot be written, it does not guess a number that could be refused for ever: it says so on serial every minute and does not publish. The owner re-pairs it (`factory-reset`, which gives a new device that may start anywhere up to 1 000 000) or rotates the hub's secret in the Studio, which clears what the server remembers and then enters the new secret with `provision device <id> <secret>` and restarts. A power cut at any step of raising the counter never repeats a number or jumps by more than one.

### Who claimed the hub

The answer to `GET /api/v1/device` names the claiming account with most of its address hidden (`claimed_by`) and `undo_until`. The hub has no screen, so it prints both on serial when it becomes paired and the Studio's device view will show them. The hub cannot tell who the owner is. **Anyone who reads the pairing code off the hub can claim it.** The code is printed on serial and will be on a display later, so the owner must check `claimed_by` after pairing and send `unclaim` on the serial port within 15 minutes if it is not them. That calls `DELETE /api/v1/device/claim`, which removes the identity and its login and the hub pairs again as a new device.

## The broker password

The broker password is not the device secret. It is `hex(HMAC-SHA256(key = device secret, message = "mqtt"))`, 64 lower case characters, so a password seen on the wire or in the broker's files is useless on the HTTP API. `lib/hal` computes it and a host test checks the worked example in [protocol.md](../../docs/protocol.md) and two RFC 4231 test cases for the HMAC. The client id and the user name are the device id.

## What an acknowledgement means

A PUBACK means the broker has the message. The server subscribes with a fixed client id and a persistent session, so a message the broker acknowledged while the server was down is held for it, up to 20 000 messages or 64 MiB for 7 days and the newest are dropped beyond that. Past that point a long server outage loses data, because the hub has already been told the message was taken.

## Session references, the boot and runs that never connect

The boot counter is written only when a boot first reaches the broker, so a run that never connects shares its boot with the next run. A session reference built from the boot alone would then repeat (`b1-s1` twice). The reference is `b<boot>-<8 hex>-s<n>`, where the eight hex digits are a random run id taken at start-up. That keeps the references of different runs apart and stays inside the format [protocol.md](../../docs/protocol.md) gives (1 to 64 characters of letters, digits, dot, underscore and dash). A restored session keeps the reference it was saved with.

A counter of 0 is a fresh start even for a hub that is paired: the boot is committed only when the broker first accepts the hub, so a hub that was paired but could not reach the broker (for instance while the broker's TLS listener does not exist yet) legitimately has none. A restart at every point after the claim, with the broker reachable and unreachable, never ends Lost (tested at 467 points). What stops a counter that was really wiped is the server's range check: boot 1 is not above the `last_boot` the server saw, so the hub says so on serial and does not publish. A counter is lost only when a log sector's header is damaged with records behind it. Each record carries a check value and a record that is not blank and does not check out (a flipped bit or a write cut short) is counted as one number used, so the counter goes forward past anything that could have been handed out and never back (tested for every bit of the newest record, mid sector and at the first record of a new sector). A header torn by a power cut has no records behind it and is not damage.

## Time comes from plain SNTP

The hub gets the time from SNTP over UDP with no authentication (`pool.ntp.org`). An attacker on the same network can answer with a time of their choosing. That can make an expired certificate look valid for as long as the attacker is in the path or make a valid one look expired and keep the hub off the broker. The certificate chain and the host name are still checked, so the attacker needs a stolen certificate as well. The hub accepts only dates from 2026 on. **The server is the authority on time.** Plain SNTP has no authentication, so nothing the hub can do with SNTP replies alone makes it safe: a network that sends the same wrong time three times in a row looks exactly like a real one. So SNTP gives only a rough first time (enough to date certificates against) and the server's clock is the trusted one, because it is the server's clock that decides whether a session's date is accepted and the hub already talks to it over TLS with certificate checks.

- The answer to `GET /api/v1/device` carries `server_time` (UTC seconds). The hub reads it from the first answer after pairing, every 15 minutes while paired and at every reconnect. That is one small request: a TLS handshake and about 1 KB, under 100 a day. A failed check is retried after a minute. An older server that sends no `server_time` leaves the SNTP rules below as the only protection.
- With no time yet the clock is set to it. Within 3 minutes of the hub's clock it snaps to it. Further out the hub's clock is corrected to the server's, SNTP replies are ignored until one agrees with the corrected clock again, the correction is reported once on serial. Every session dated from the wrong clock and not yet sent (and the one being recorded) is re-dated by the same amount. Sessions recorded before the clock was believed carry no date (they are stamped from the uptime) and are dated when a time arrives.
- **The server's own clock.** A server on a Raspberry Pi has no clock battery and can come back from a power cut with a clock that is behind and does not know it. The answer therefore also carries `server_time_synced`. True means the server's clock is synchronised and the server is the authority as above. False means the server does not yet trust its own clock: the hub does NOT correct its clock from it, every session is held (dated by nothing and nothing sent, dated or not), it asks again at its normal interval and says once on serial that the server's clock is not set. When the answer turns true the held sessions are dated and sent. Null or an absent field means the status could not be read and counts as true. Until `docs/protocol.md` names the field the contract check tolerates its absence and once it does the check requires its meaning to match.
- Once the server has been heard, SNTP can no longer move the clock beyond a small allowance, so a run of agreeing forged replies is not enough.

The SNTP rules (`lib/publish/clockguard.*`, fed once per REAL reply from the SNTP notification, never by reading the system clock): a reply older than the firmware's build is ignored. A first reply is taken at once only if it is within 7 days after the build. A forward step is then taken only within an allowance of 10 minutes plus 10 minutes for each hour of the hub's own elapsed time. Any other reply waits for three separate replies at least 30 seconds apart that agree to within 5 seconds. Until a time is believed the hub asks every 35 seconds, afterwards once an hour. A stored session is never dropped because of the clock: one whose start time the server would skip is held at the front of the queue until the time is believed differently or a person sends `queue clear-stale` on serial.

What a network that lies about the time can and cannot do:
- Before the hub has had its first answer from the server (the first minute after it pairs or longer if the server is unreachable) it can still make the hub believe a wrong time after the build date with three agreeing forged replies. Far into the future the certificate date check then fails and the hub refuses to connect, which is safe. Far into the past is bounded by the build time (a time before the build is ignored), so an expired certificate can look valid only if it expired after the build date. That window remains and only an authenticated time source or a battery backed clock would close it.
- It cannot make the hub send sessions with a date from a server whose own clock is not set: they wait.
- It cannot keep a wrong time once one TLS answer from the server arrives: the hub's clock is corrected to within 3 minutes of the server's, SNTP is distrusted until it agrees and dates taken from the wrong clock are put right. It cannot make the hub drop its backlog: stored sessions are held, never dropped, because of a date. A network that blocks the connection to the server altogether stops the hub from publishing at all (it would not publish with an unset clock either) and nothing else.
- It can hold the hub's clock 3 minutes wrong (the tolerance). It can delay or drop the hub's messages, as any network can.

## Delivery

The server drops a message whose `(boot, seq)` is not newer than the last it accepted. The hub uses that.

- A queued message is stamped with `boot` and `seq` the first time it is sent. After that the stamp never changes.
- One message is in flight at a time, so the broker and the server always see them in order.
- A message leaves the queue only when its PUBACK arrives. A PUBACK for any other packet id changes nothing.
- 10 seconds without a PUBACK drops the connection. After the reconnect (back-off 1 s doubling to 60 s) the same message goes again with the same `boot`, `seq` and body, as many times as it takes. The server stores it once.
- Nothing is ever sent twice under a different `seq`. The test checks that `seq` rises by exactly one for each kind and that one resend keeps its number.
- A connect waits 5 s for the CONNACK. A write to a dead socket drops the connection. The ping interval is half the keep-alive of 30 s and a missing PINGRESP drops the link after 10 s.
- After a reconnect the backlog goes out oldest first, one message at a time.
- Status is not queued. The next one replaces a lost one.

## The offline queue and power cuts

| Limit | Value |
| --- | --- |
| Messages | 16 |
| Events | 4096 (32 kB) |
| Age | 24 hours |

When it is full the oldest message goes first. Every loss is counted and the status message reports `dropped_events` as the note bus overflow plus the events lost from the queue.

The queue is in RAM. To keep the last session across a power cut (a learner will switch the hub off at the wall) the hub also writes it to flash. At the end of every session the details and the events not yet acknowledged go into the `outbox` partition, in two slots of two sectors that take turns. After a restart a session that was not delivered is queued again, with the date it had and a new `boot` and `seq` and a flag is cleared in place once no message of that session is left in the queue. That is when every message was acknowledged, but also when one was dropped as stale or by the queue's limits, so the flag means "nothing of it is waiting", not "all of it was delivered".

- At most 1000 events (the newest) are kept. Older ones are dropped and counted.
- A session whose start could not be dated is not saved.
- Flash writes: one two-sector erase per session that ends and none when it is delivered. With 5 sessions a day that is 10 sector erases a day, 2.5 on each of the 4 sectors, so a 100 000 cycle part lasts over 100 years. The host test runs 100 such days and checks every sector ends with exactly 250 erases.
- The write blocks the main loop for about 100 ms at the end of a session.
- A power cut in the middle of delivery can send the last notes of a session twice after the restart, because a restart is a new `boot`. The server cannot tell them apart. A cut at any step of the write itself leaves the previous record or the new one, whole.

## Not tested: needs a board and a broker

1. Wi-Fi joins and reconnects after the router restarts.
2. SNTP sets the clock and `started_at` is right to the second.
3. The broker refuses the hub before it is claimed and accepts it after and a hub un-claimed by its owner stops and pairs again.
4. A TLS connection to a broker with a certificate from an owner's own authority is accepted and one from another authority, one with the wrong name and one that has expired are each refused.
4. The pairing flow against the real server.
5. The broker accepts the device id as its login and refuses another hub's topics.
6. Pull the network mid-session and confirm the backlog arrives in order.
7. Switch the hub off at the wall mid-session and confirm the session arrives after the restart.
8. Check heap use over a long session. The network task has a 10 240 byte stack and a TLS connection needs about 50 kB of heap.
9. Check that the NVS and the outbox partitions are found at boot.
