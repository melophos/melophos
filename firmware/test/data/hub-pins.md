# MELOPHOS hub rev A: module pin table

Generated on 22 November 2026 from the rev A schematic. The schematic is the source. If the two disagree, the
schematic wins.

Module: ESP32-S3-WROOM-1. Columns: module pin, GPIO, net, direction, state at reset, power-up glitch.

| Module pin | GPIO | Net | Direction | At reset | Power-up glitch |
| --- | --- | --- | --- | --- | --- |
| 1, 40, 41 | none | GND | supply | | |
| 2 | none | +3V3_MOD | supply | from +3V3 through the link J13 | |
| 3 | none | EN | in | low until R6 charges C8 from +3V3_MOD | |
| 27 | 0 | BOOT | in | weak pull-up inside the module. SW1 and Q3 pull it low | |
| 39 | 1 | SENSE_5V | in, analogue | half of +5V (R4 and R5) | none, the pin is an input |
| 38 | 2 | HOST_CC1 | in, analogue | through R48 from R17 to 3.3 V | reads low for 60 us, ignored |
| 15 | 3 | JTAG_SEL | strapping | low through R67 (10 k). Test pad TP22. Ignored while the JTAG fuse is unburnt | |
| 4 | 4 | LED_KEYS | out | low through R19 | low is the line's idle state |
| 5 | 5 | LED_FRETS | out | low through R20 | low is the line's idle state |
| 6 | 6 | HOST_CC2 | in, analogue | through R49 from R18 to 3.3 V | reads low for 60 us, ignored |
| 7 | 7 | I2S_MCLK | out | low through R34 and R46 | harmless to the ADC |
| 12 | 8 | MIDI_TX | out | high through R43 | a low pulse sinks current through J4 for 60 us. The receiver may see a stray start bit (estimate) |
| 17 | 9 | HOST_EN | out, active high | low through R15, port off | |
| 18 | 10 | HOST_FAULT | in | high through R16 | |
| 19 | 11 | I2C_SDA | both | high through R12 | |
| 20 | 12 | I2C_SCL | out | high through R13 | |
| 21 | 13 | SENSE_VIN | in, logic | from the DC jack through R56, R57, the clamp D12 and R58 | |
| 22 | 14 | ENC_SW | in | high through R70 (10 k) from the switch contact, which R61 (2.7 k) pulls up to +3V3_MOD. C39 (10 nF) on the pin. Low while the knob is pressed | reads as a press for 60 us, ignored before setup |
| 8 | 15 | I2S_BCLK | out | floating, ADC input | |
| 9 | 16 | I2S_WS | out | floating, ADC input | |
| 10 | 17 | I2S_DIN | in | driven by the ADC | |
| 11 | 18 | MIDI_RX | in | high through R22 | |
| 13 | 19 | HOST_DN | both | USB host data | the data sheet's table 2-2 lists glitches on GPIO19 and GPIO20 |
| 14 | 20 | HOST_DP | both | USB host data | |
| 23 | 21 | STATUS_LED | out | LED off | |
| 28 to 30 | 35 to 37 | none | used by the module's PSRAM | | |
| 31 | 38 | LED_AUX | out | low through R62 10 k | new. Reset state unread |
| 32 | 39 | JTAG_TCK | spare | floating. TP18 and J15 pin 3. Not JTAG while the fuse is unburnt | |
| 33 | 40 | BUZZER | out | R64 (1 k) to the base of Q6, which R65 (10 k) holds low, so the buzzer is off. Also TP19. Not driven during boot while the JTAG fuse is unburnt | |
| 34 | 41 | JTAG_TDI | spare | floating. TP20 and J15 pin 4. Not JTAG while the fuse is unburnt | |
| 35 | 42 | JTAG_TMS | spare | floating. TP21 and J15 pin 5. Not JTAG while the fuse is unburnt | |
| 37 | 43 | UART_TX | out | to the bridge U7 and J12 | |
| 36 | 44 | UART_RX | in | from the bridge through R35. An adapter on J12 overrides it | |
| 26 | 45 | none | strapping | weak pull-down inside the module | |
| 16 | 46 | none | strapping | weak pull-down inside the module | |
| 24 | 47 | ENC_A | in | high through R68 (10 k) from the contact, which R59 (2.7 k) pulls up to +3V3_MOD. C37 (10 nF) on the pin. At 3.3 V on the N16R8 | not listed in table 2-2 |
| 25 | 48 | ENC_B | in | high through R69 (10 k) from the contact, which R60 (2.7 k) pulls up to +3V3_MOD. C38 (10 nF) on the pin. At 3.3 V on the N16R8 | not listed in table 2-2 |

## Notes for the firmware

- SENSE_5V is a divided voltage: half of +5V through R4 and R5. The threshold is near 3.5 V on the rail, which
  is 1.75 V on the pin.
- HOST_EN is active high and held low at reset, so the keyboard port is off until the firmware turns it on.
- HOST_FAULT is high when there is no fault.
- The level shifter on the two LED data lines is a 74HCT125 with its enables tied to ground.
- The console is UART0 (GPIO 43 and 44) through the CH340C bridge U7, on its own connector J1. The keyboard
  host port is J2.
- GPIO 13 is SENSE_VIN, a logic input from the DC jack through a divider and a clamp.
- Second issue, 22 November 2026, schematic cd5c8dd8: a rotary encoder (ENC_A 47, ENC_B 48, ENC_SW 14), a third LED
  output (LED_AUX 38, connector J14 in the pin order of J6 and J7), a buzzer (BUZZER 40, through Q6 from +5V_SYS) and a
  spare header J15 (pin 1 ground, pin 2 +3V3, pin 3 GPIO 39, pin 4 GPIO 41, pin 5 GPIO 42) were added. Nothing the
  firmware already named moved. The buzzer adds 5 mA: the budget is now 4.445 A.
- Third issue, 23 November 2026, schematic a9a7e016: each encoder line has a 2.7 k pull-up on the contact to +3V3_MOD, 10 k
  from the contact to the module pin and 10 nF on the pin (about 1.19 mA through a closed contact at worst). R67 holds
  JTAG_SEL low. The board has no JTAG as built: GPIO3 is ignored unless a one-time fuse is burnt and the default JTAG
  source is the USB controller, whose pins the host port uses. GPIO 39, 41 and 42 are spare pins on J15. GPIO 40 is not
  driven during boot, so the buzzer stays silent at power-up. The JTAG reading rests on one reading of Espressif's data
  sheet until a second confirms it. The budget is now 4.449 A.
- The file has no separate pull column. The pulls are in the "at reset" text.
