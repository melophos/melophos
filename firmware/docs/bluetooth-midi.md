# Bluetooth MIDI

The hub appears as a Bluetooth MIDI device through NimBLE, so a host such as Synthesia can light the guide LEDs and the Studio can talk to it. Status: builds for the board, framing and connection logic tested on the host, awaits a board.

## Directions

| Direction | What happens |
| --- | --- |
| In | A host's note on and note off set guide lights. They are guides and never count as played notes, so they do not enter the session. All notes off, a disconnect and a new connection clear them, so a lost note off cannot leave a light stuck |
| Out | The notes the player presses go back to the host as MIDI input. Up to 8 wait in a queue and the oldest is dropped and counted when it is full. A packet holds at most 3 notes (13 bytes) so it fits the default 23 byte payload |

The standard service is `03B80E5A-EDE8-4B33-A751-6CE34EC4C700` with the characteristic `7772E5DB-3868-4112-A1A9-F2669D106BF3`.

## Tested on the host

Packet framing with timestamps and running status, a sysex that spans packets, packets with no header or no timestamp, null and short packets, 20 000 random packets, the connection state machine, a retry when the stack is busy and the round trip of an encoded note.

## Who may write

Pairing is Just Works, so any device nearby could bond inside the pairing window. The Bluetooth stack also stores a bond the moment a device pairs and keeps it across restarts, whatever the owner decides. So the stack's "bonded" is not trusted. The hub keeps its own list of accepted devices (at most four) by identity address, the address a bond resolves to, so a phone that changes its random address is still the same device. The list is stored in flash and a factory reset clears it.

- A device not on the list is never trusted, on any connection. While pairing is open and nobody else is waiting it is WAITING: none of its writes is applied or queued until the owner sends `ble accept` on serial (the button once the board exists). The hub prints its address.
- Writes from a waiting or refused link are dropped. Its disconnect never touches the accepted host's link or lights.
- A bond for a device that is not on the list is deleted by its identity address as soon as that device disconnects, when the window closes without an accept and at start-up for any bond the stack still holds.

The rules are host tested (`test_blemidi`). The NimBLE glue (`src/ble_midi_esp.cpp`) that reads the connection handles and identity addresses and deletes bonds is compile-only.

## Not tested: needs a board

Pairing, range, timing and the real stack. Bring-up checklist:

1. Pair with macOS in Audio MIDI Setup and with Windows 11 and check that both list the hub.
2. Decide on bonding. The characteristic is open today, so no pairing code is asked for. If a host insists on encryption add it to the characteristic properties.
3. Send notes from Synthesia and check that the right guide LEDs light.
4. Check that played notes arrive in Synthesia as MIDI input.
5. Walk away until the link drops and confirm that the lights clear and the hub advertises again.
6. Measure the latency with a logic analyser and compare with the Bluetooth budget (under 23 ms) in [practice-modes.md](practice-modes.md).
7. Check that the radio and Wi-Fi share the antenna without dropping notes.
8. Check a write longer than 64 bytes: the glue cuts it and the parser counts the damage.
