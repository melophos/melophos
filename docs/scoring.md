# Scoring and tempo tracking

This page describes how the scoring engine in `core/` follows a performance: the rules as they are built, the figures it reports, its bounds, how it was measured and where it falls short. The code is `core/src/follow.rs`. The tests that hold it to this page are in `core/tests/` and `core/src/follow.rs` and each claim below names its test. Why the engine is built this way is in the [design note](scoring-design.md). The first pass, `score`, compares presses with the clock as written and is described in the [core README](../core/README.md).

Every figure on this page comes from synthetic performances. Nothing here has been measured on a real player, a real keyboard or real hardware. What a set of real recordings would need to contain is at the end.

## The problem

A learner who plays a piece steadily at 60 percent speed is not late on every note. A learner who practises the right hand alone has not made a mistake on every left-hand note. A hand that runs a little behind the other has not played wrong notes. A learner who stops and starts again from the top has not played the first notes in the wrong place. The engine answers these questions press by press, while the player is still playing:

1. Where in the piece is the player now?
2. How fast are they playing?
3. Was this press a right note, a wrong one or a repeat? Was it in time? Or can the engine not tell?

The harm it is built to avoid above all is calling a right note wrong. So it has a fifth answer beside hit, late, repeat and wrong: **unsure**.

## The outcomes

| Outcome | Meaning |
| --- | --- |
| `hit` | A note of the piece at the place the player has reached, in time on the player's own clock |
| `late` | The same, outside the timing window. It covers early too: the sign of `error_ms` says which. The note counts as played |
| `repeat` | A note the player had already played and plays again after going back. It is not penalised and not counted twice |
| `wrong` | A press the engine is sure was no note of the piece at that place |
| `unsure` | A press the engine cannot place with confidence. A view shows it neutrally. It counts neither for nor against the player |

### The confidence rule

A press that matches no note is called **wrong** only when both of these hold. Otherwise it is **unsure**.

1. **The engine is sure of the place.** The reading has matched at least three presses since the place was last in doubt, no more than one of the last few presses has failed to fit and no pause has passed since the last match. A start the caller states, a jump the caller states and a place a search has just found count as sure.
2. **No note could have been meant.** One of three things is true of the key pressed:
   - No note of that key is written near the place: within 1.5 seconds of score (three local beats when that is more). Such a press is wrong as soon as it is made.
   - Every note of that key near the place has been played and one of them was played in its place by a later press. The earlier press was a stray.
   - The key was struck again straight after the press that played its note (within two fifths of the step to the next note). Further strikes that follow each other closely carry the verdict on.

A press stays unsure for good when a note of its key near the place was never played (it may have been meant for that note) or when its note was played a while before (the player may have been going back over it). A press is also unsure while the reading has lost the player and while a place under test might yet explain it. A verdict waits until the notes it depends on are behind the place and until both hands have been heard from again in clean matches on two different keys.

**A press once shown as a note.** A press that has been reported as a hit or a late note is called wrong later only when another press now holds that same note as its first playing. A wrong press, a note played again and a move to another place never turn it wrong: at worst it becomes unsure.

Tests: `the_place_is_not_sure_until_three_presses_have_matched` (a stray key after one or two matched presses is unsure, after three it is wrong and with the start stated it is wrong from the first press), `a_note_is_turned_wrong_only_by_a_press_that_is_that_note`, `a_later_double_strike_does_not_turn_a_chord_note_wrong`, `a_wrong_key_in_step_is_wrong_at_once_and_a_skipped_note_is_a_miss`, `a_stray_key_that_could_be_a_note_never_played_is_left_unsure_not_wrong`, `a_key_struck_again_is_wrong_once_its_note_is_played_in_place`, `extra_strikes_of_a_key_the_score_repeats_are_wrong_and_steal_no_note`, `hammering_one_key_counts_against_the_player`.

## The model

### Lines and the place

The piece is cut into chord groups: expected notes within `chord_ms` (50 ms) of the first note of a group, at most 16 notes. The notes of each labelled hand form a **line**. Notes without a label form a line of their own, so a piece with no labels is one line. A reading has one **place**: the written time of the furthest note it has matched. Notes at or after the place are still to come. Notes before it have been passed.

### What a press can be

For each press the reading looks only at the notes of that pitch, in the hands being practised. It takes the nearest in time of these candidates:

| Candidate | When it is allowed |
| --- | --- |
| The next unplayed note of that pitch at or after the place | However late it is (a hesitation). Early by at most three fifths of the step from the note before it in its line, at the tempo being played. The earliness is measured from the beat or from where that hand's last onset really fell, whichever is kinder. That allowance is never less than the window. Until the tempo has been measured the allowance is 17 twentieths of the step. Straight after a press that fitted nothing, once the tempo is measured, early by at most the window |
| An unplayed note of the chord already sounded (another voice of it or the other hand's part of it) | Struck within the step of its line after the chord's last press, however late the chord itself was (at least 600 ms, at most the pause). A key of that chord struck within 100 ms of it is that chord's note: no later note of the pitch is weighed against it |
| An unplayed note the reading has passed | The same lateness. The place and the clock stay where they are |
| A note held by an earlier press of the same key, struck within a step of this one | When this press is at least 20 ms nearer to the time the pulse expected the note and both presses came after at least one interval had been measured. Where this press also has a note of its own next in order, one more thing must hold: the two strikes are closer than two fifths of the step between notes or the earlier one was a single finger of a chord struck without the rest. Otherwise the two are the music played quicker and nothing changes hands. The earlier press is then read again and may be the note before, played late |

The order of the notes comes before the clock: of several unplayed notes of one pitch the next one is taken, so a hand that hesitates over repeated notes does not skip them. A key struck again sooner than two fifths of the written gap to the next note of its pitch, at the tempo being played and counted from where the earlier note really fell, is not that next note.

Tests: `a_press_takes_a_note_only_when_it_is_clearly_nearer` (a strike 100 ms early keeps the note against one 10 ms nearer and gives it up to one 40 ms nearer), `a_key_struck_again_in_repeated_chords_does_not_take_the_next_note`, `steady_repeated_chords_are_all_hits_at_any_speed` (40 to 200 percent in steps of 5), `hands_a_little_apart_over_a_repeated_bass_are_all_right` (a left hand 60 to 200 ms behind over a repeated G: no wrong press), `a_held_back_note_whose_pitch_comes_again_does_not_turn_the_next_one_wrong` (held back 300 to 550 ms: late, the next one a hit), `a_note_played_late_after_others_came_between_is_late_not_unsure`, `after_a_press_that_fitted_nothing_a_note_is_taken_only_in_time`.

### Time on the player's clock

A reading's clock is an anchor (a press time paired with a written time), a tempo and an offset for each hand.

- **Tempo.** Each hand measures the stretch between two of its own onsets at least 300 ms of score apart. When a stretch holds several intervals and one of them is more than 1.7 times slower than the rest, that interval holds a hesitation and is left out. Two hands that measure the same stretch count once: the two are averaged and a longer one that swallows it is left out. The tempo is the median of the last three measurements. Until there are three the tempo stays where it was (the written speed at a start), so no single interval ever sets it. The speed is kept between a quarter and four times the written speed.
- **Before the tempo is measured** the order of the notes is trusted over the clock: a note may come early by 17 twentieths of its step, no note is out of time and the beat moves all the way to each press.
- **A tempo that later presses contradict is dropped.** When three presses running are each the next note of their hand and each is refused only for coming too soon, the tempo is dropped, those presses are read again in the order of the notes and the tempo is learnt again from the next three measurements.
- **A hesitation is not a tempo.** An onset outside the window, after onsets that were not leaning the same way, is a hesitation or a slip. The interval that led to it is left out and measuring starts again from it. When the onsets before it leant the same way the tempo is changing and every interval counts.
- **One note out of time or a move.** An onset outside the window moves the anchor to it and keeps the old anchor for one more onset. If the next onset fits the old anchor, that press was one note out of time. If it fits the new one, the beat has moved. Inside the window the anchor moves half way to each press.
- **Hands apart.** How far apart the hands sit is learnt only from notes written together, an eighth of the difference at a time, up to 120 ms each way. Two hands playing the same written moment are one onset and get one judgement.
- **Warm-up.** Timing is not judged for the first 3 onsets after a start, a pause or a jump, nor before the tempo has been measured three times.
- **A pause.** A silence is a pause when it is longer than each of three lengths: `pause_ms` (2.5 s), two and a half of the piece's mean gap over the next 8 groups at the reading's tempo and twice the player's last gap between presses. A pause keeps the tempo and forgets the beat. After it a press may be the next note within 4 onsets of the place. It may also be a note up to where the clock from before the pause says the piece has run on, so a hand counting a long rest is found.

Tests, each on the textures it names and no others:

- `one_hesitation_is_one_late_note_and_does_not_move_the_tempo` (both hands late once together, the tempo within 3 percent throughout).
- `a_hesitation_in_the_first_interval_does_not_set_the_tempo` (400 to 2 000 ms added before the second, third or fourth onset of a two-hand piece: every note credited, at most 2 late, the tempo within 3 percent at the end), `hesitations_in_two_of_the_first_three_stretches_do_not_set_the_tempo` and `a_hesitation_seen_by_both_hands_is_counted_once`.
- `no_single_interval_can_make_the_rest_of_a_session_unsure` (one hesitation of 200 to 2 400 ms before any onset of 20 textures at 50 to 150 percent: no press wrong, unsure or a repeat and at most 5 late).
- `a_steady_run_always_recovers_the_tempo` (five steady tempi, each changed at once to five others between 40 and 200 percent: no press is wrong. From 12 onsets after the change every note is a hit within 10 percent of the new tempo. Where the same chord or key is written over and over the change is kept to 2.2 times quicker. Music of one repeated key with nothing else is left out. Both are limits stated below).
- `tempo_follows_an_instant_change_within_three_intervals` (a tune of single notes: changes between 50 and 200 percent at gaps from 150 to 900 ms are within 10 percent of the new tempo three measured intervals and one onset after the change).
- `a_steady_performance_at_any_speed_is_all_hits_at_that_speed` (a tune of single notes, 40 to 200 percent) and `steady_play_at_any_speed_over_any_texture_is_all_hits` (5 right-hand textures over 4 left-hand ones, repeated chords and one repeated key among them, at 40 to 200 percent, down to notes 120 ms apart as played).
- `a_bar_at_half_speed_and_back_is_followed` (no press wrong or unsure, at most 6 notes late) and `a_slow_piece_is_judged_for_timing_because_its_gaps_are_not_pauses`.

### When a note is in time

Timing is judged against the player's own tempo, not the written clock. A matched note is a **hit** when its error is within the window and **late** when it is outside. The window is

`max(window_ms, a quarter of the local gap at the tempo being played)`

The local gap is the smaller of the gaps from the note's onset to the onsets before and after it, among the notes being practised. `window_ms` is 150 ms. Notes 1 400 ms apart have a window of 350 ms. Notes 400 ms apart have the floor of 150 ms. At half speed every window is twice as wide as at full speed, down to the floor.

The error of a note is its distance from the nearest of three expectations: the beat as it stands, the beat from before one note out of time and the beat carried on at the pace of the last interval a hand played (written intervals of 100 ms or more). A note is in time when it fits the pulse or the last interval, as a listener hears it. Two presses that compete for one note are compared against the pulse alone. So a tempo that moves by up to a quarter from one beat to the next is not a run of late notes, while a single hesitation is one late moment.

A chord in one hand is as early or late as its first note. Its other notes add their spread.

Tests: `the_window_is_a_quarter_of_the_gap_between_notes_with_a_floor`, `rubato_in_slow_practice_is_not_late` (half speed with the tempo stepping 13 percent between beats: no late note).

### Another place

When a press does not fit, the engine looks for other places. It takes the rarest pitch among the last 8 presses that strained the reading and tries each place the piece has it: up to 4 from where the session began, then those nearest the present place, at most 1 028. A cheap check counts how many of the last 8 presses are found around each place, in order and about as far apart in the score as they were in time. The best 3 are replayed. So is the session's start when it fits as well as any. A replay starts from the first press that fits it and, when that reaches back over presses the reading was happy with, also from the first press that strained the reading.

Each replay is a **reading under test**: its own place and clock, starting with the player's tempo and kept between half and four thirds of it. At most 6 are kept, each for at most 24 presses. Each reads every new press. One replaces the reported reading when all of these hold:

- it has a run of at least `relocate_after` (3) presses in order and in time,
- those presses are on at least two different keys,
- it explains more than the reported reading by a press and a half. A match is worth 4, less 1 for each unplayed note of its line that it steps over (2 at most). Timing is left out of the worth, so a change of tempo does not look like a move. A key struck again within 200 ms of its note (or of another such strike) counts for nothing: where the music of two places is the same it fits the other place as well as it fits a slip made in place. A press the reported reading matched cleanly and the new one cannot place counts 8 against the move.

The readings passed over stay under test, so where the music is the same for a while the engine can still change its mind. A reading under test that has reached the same place as the reported one without being far enough ahead to replace it is dropped. A match that steps over unplayed notes of its own line also starts a search now and then, as does one that lands out of time. A jump is reported on the event of the press where the new reading starts: `jumped_from` is the group it left.

Tests: `a_start_from_a_later_bar_is_found_and_never_called_wrong`, `a_skipped_bar_is_found_without_being_told`, `a_restart_from_the_top_reads_the_replayed_notes_as_repeats`, `a_chord_struck_twice_does_not_move_the_reading_to_the_same_music_elsewhere`.

### What the caller can say

The Studio knows things the engine would otherwise guess. Each is optional.

| Input | Effect |
| --- | --- |
| The written time the learner starts from (`start_ms`) | The first press is read there and judged at once. Without it the engine expects the top, is not sure of the place until three presses have matched and searches as soon as a press does not fit |
| The hand or hands practised (`practise`) | With one hand named, the other hand's notes are never matched. A press that fits no note of the hand practised, on a key that the other hand has written near the place, is left **unsure** and takes no further part: it is not credited, it is not called wrong and it does not disturb the reading of the hand practised. The rule is the same whether the learner slips on to one such key or plays the other hand all the way through. A key that neither hand has there is wrong as usual. A key that the hand practised also has coming is read as that hand's note: where the two hands share their keys the engine cannot tell whose press it was. The summary reports the named hand. It needs hand labels |
| A jump the learner asked for (`jump_to` live, `jumps` in a batch) | The next press is read from that written time. Notes played before and played again are repeats |

Tests: `a_start_from_a_later_bar_is_found_and_never_called_wrong`, `the_hand_named_for_practice_is_the_only_one_matched`, `a_stated_jump_is_followed_and_replayed_notes_are_repeats`, `a_stated_jump_in_a_batch_is_the_live_jump`.

### Following a session live

The last 48 presses stay open. Within them the reported reading can change. Each update says which earlier events it now reads differently (`revised`). A view keeps one event for each press, puts the new event at its index and replaces each revised event at its own. The place a view shows may step back only when `revised` is not empty or the new event has `jumped_from` set. Each update also says how many presses are final (`settled`): no later update ever revises a press before it. A batch call is the live session with every revision applied, so the two give the same events and the same summary.

Test: `a_live_session_keeps_its_promises`.

### Hands

When the caller names the hand practised, that is the hand reported. Otherwise a labelled hand counts as played when at least a quarter of its notes, within the stretch of the piece the player covered, were matched. With no labels the summary says `unknown`. Unplayed notes are misses, never wrong presses.

Test: `the_hands_played_are_reported`.

## The figures

Each figure is read from the final reading of the performance.

| Figure | Definition |
| --- | --- |
| `hits` | Expected notes matched in time |
| `late` | Expected notes matched outside the window. Played, not in time |
| `misses` | Expected notes never matched: `expected - hits - late` |
| `wrong` | Presses the engine is sure matched no note |
| `repeats` | Presses that matched a note already matched before the player went back |
| `unsure` | Presses left without a verdict |
| `accuracy` | `hits / (expected + wrong)`. Late notes are not hits and wrong presses count against it. Unsure presses do not enter it |
| `hands` | `unknown` (no labels), `neither`, `left`, `right` or `both` |
| `played_expected` | Expected notes in the hands played: all of them unless one hand only was played or named |
| `played_accuracy` | Hits on those notes over `played_expected + wrong`: what to show for "right hand only" |
| `mean_timing_error_ms` | Mean absolute error of the matched notes whose timing was judged. Warm-up notes and repeats are left out |
| `mean_speed_ppm` | Mean tempo over the same notes, counting only the first note of each chord in a hand |
| `final_speed_ppm` | The tempo of the reported reading at the end |

On each event, `error_ms` is the press time less the expected time (0 for a press that matched no note), `speed_ppm` is the tempo after the press, `position` is the group the reading has reached and `jumped_from` is set on a jump. Tempo is in parts per million of the written speed.

Test: `the_summary_is_what_the_events_say`.

## Bounds

| Quantity | Bound |
| --- | --- |
| Longest piece | 100 000 notes. A longer piece is refused with an error |
| Presses in one session or one call | 216 000 (six hours at ten a second). More are refused |
| Work for one press while following | Up to 16 notes of the press's pitch on each side of the place, in each of at most 7 readings |
| Work for one press that searches | At most 1 028 places, each checked against 8 presses and 16 notes a press, then at most 8 replays of 8 presses |
| Memory per session | The piece (about 60 bytes a note) and at most 7 readings of at most 48 presses |
| Memory per press | Nothing kept: at most 48 events are sent again |

A test counts units of work for every press of two hostile sessions of 30 000 presses, on a 2 000 and a 100 000 note piece in which one pitch comes back every other note. It checks each press against a ceiling of 151 584 units, checks that the second half of the session costs no more than the first and checks that no more than 7 readings are held (`the_work_per_press_has_a_ceiling_that_does_not_grow_with_the_session`).

## The test material

All of it is synthetic and made from fixed seeds. The labels come from how each performance was built, never from the engine.

- **The four review sets.** Each review built its own material. The second has 558 labelled performances of 9 pieces. The third has 644 performances of 14 hand-written pieces in 23 ways of playing. The fourth, a review of the present follower, has 1 116 performances of 12 pieces in 31 ways of playing (43 870 presses). The first has 618 edge inputs without labels. We used the second, third and fourth as development material once they were known: the rules above were shaped on them.
- **The corpus in `core/fixtures/`.** 1 814 performances made for the earlier follower: a training set, a design set and a final set. The present follower was not tuned on them. The corpus test holds it to what it was measured at.
- **Our own check set** (`core/fixtures/check/check_set.py`): 9 small pieces in 21 ways of playing, 1 449 performances and 99 945 presses. It has a hesitation of four lengths before each of the first twelve onsets, steady play at every speed from 40 to 200 percent in steps of 5 over every piece (repeated chords and one repeated key among them), keys struck a second time, a bar at half speed, a tempo that halves or doubles and stays, six-note chords with a finger on the key next door and both hands played with one named. A change is tried here first.
- **The first unseen set.** 20 hand-written pieces in 36 ways of playing, 696 performances and 65 735 presses, written by someone who was given only the public interface and a list of what the other sets cover. It includes stutters, backing up after a slip, fishing for a note, freezing, looping a bar, a hand in the wrong position, sticky keys and smears, with and without the caller's inputs. It was unseen when the follower was first measured on it. It has been development material since.
- **The second unseen set.** 18 hand-written pieces in 51 ways of playing, 815 performances and 89 413 presses, written by someone who was given only the public interface and a list of what the other five sets cover. It has repeated chords at two rates, hands alternating on the same keys, the same notes a beat apart, music of three pitches, chords of five to eight notes, a rondo of 1 500 notes, each chord or bar played twice, pauses of 3 to 10 seconds, a tempo that steps every bar, jumps reported a press early or late and both hands played with one named. It was run once, after the last change to the engine.

## Measured behaviour

**Harm is reported as counts.** A right note is a press that was a note the player meant, whatever its timing. Agreement is the share of presses whose outcome and note match the label. An unsure press never agrees, so agreement falls as verdicts are withheld.

**The accuracy a family sees.** The last two columns are about performances a teacher would call well played: no wrong key, every note of the hands played struck once and at least nine presses in ten that the labels say must be hits. For each set they give how many such performances it has and the lowest accuracy any of them was given (over the hands played). The held-out set C's labels carry no timing, so there the ways of playing are named: steady, slow, hesitant, each hand alone, hands apart, spread chords, drifting tempo and a bar at half speed.

| Set | Performances | Right notes called wrong | Wrong presses called right | Left unsure (right notes) | Mean agreement | Well played | Lowest accuracy among them |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Held-out set B, earlier follower | 644 | 109 of 62 959 | 30 of 924 | 0 | 0.951 | | |
| Held-out set B, now | 644 | 4 of 62 959 | 29 of 924 | 153 (39) | 0.974 | 159 | 0.649 |
| Held-out set A, earlier follower | 558 | 21 of 24 159 | 24 of 1 850 | 0 | 0.960 | | |
| Held-out set A, now | 558 | 2 of 24 159 | 34 of 1 850 | 331 (32) | 0.944 | 170 | 0.789 |
| Held-out set C, the follower it was drawn against | 1 116 | 15 of 43 108 | 51 of 762 | 1 203 (1 013) | 0.950 | | |
| Held-out set C, now | 1 116 | 2 of 43 108 | 37 of 762 | 1 012 (859) | 0.956 | 504 | 0.375 |
| Corpus training, earlier and now | 785 | 44 and 3 of 51 573 | 28 and 61 of 1 420 | 0 and 431 (133) | 0.995 and 0.982 | 326 | 0.869 |
| Corpus design, earlier and now | 785 | 61 and 4 of 51 475 | 37 and 50 of 1 438 | 0 and 441 (88) | 0.993 and 0.982 | 323 | 0.917 |
| Corpus final, earlier and now | 244 | 0 and 0 of 13 488 | 10 and 10 of 508 | 0 and 103 (4) | 0.998 and 0.987 | 136 | 0.917 |
| First unseen set, earlier follower without the caller's inputs | 696 | 328 of 63 928 | 186 of 1 767 | 0 | 0.974 | | |
| First unseen set, when it was unseen | 696 | 14 of 63 928 | 184 of 1 767 | 387 (258) | 0.985 | | |
| First unseen set, now | 696 | 9 of 63 928 | 112 of 1 767 | 386 (60) | 0.984 | 50 | 0.942 |
| Our own check set | 1 449 | 5 of 97 818 | 17 of 1 097 | 239 | | 1 089 | 0.833 |
| Second unseen set, run once | 815 | 33 of 86 197 | 173 of 2 230 | 1 457 (197) | 0.945 | 449 | 0.600 |

In this table a wrong press called right counts presses read as a hit, a late note or a repeat. The corpus test fails when any corpus figure gets worse (`the_corpus_keeps_to_the_harm_it_was_measured_at`). On the corpus final set the wrong presses called right rose from 7 to 10 with the changes that followed the held-out set C.

**The lowest accuracies and their causes.**

- Held-out set C, 0.375: one hand played alone, without the hand named, in a piece whose two hands share their keys (middle C and D). The engine cannot tell which hand is playing and scores against both. With the hand named the same performances score 1.000. The next lowest are a 16-note piece with a bar at half speed (0.688: the notes on each side of the two changes of tempo are out of time) and a hesitant performance (0.750: 5 notes of 20 late, one after each hesitation).
- Held-out set B, 0.649: a presto of scales played with the notes smeared out of order. 59 of 194 right notes are read as notes played again after the reading moves back to the same figure earlier in the piece.
- Held-out set A, 0.789: a trill with 100 ms of timing noise on notes 125 ms apart. 3 notes late, 3 unsure and 1 called wrong of 37.
- Corpus, 0.869: a left hand played alone that rushes. 4 notes of 60 are read as repeats, 2 are unsure and 1 is called wrong.
- First unseen set, 0.942: a slowing down at the end of a piece. 6 of 103 notes are late.
- Our own check set, 0.833: random hesitations of 300 to 900 ms before one onset in twelve. The moment after each one is late, which is the rule.
- Second unseen set, 0.600: a ten-note piece with a pause of several seconds every few notes. 4 of its 10 notes are late. Next come many hesitations in slow music (0.667: 13 of 39 late), one hand alone without the hand named where the two hands play the same keys in turn (0.711), each bar played twice in music of three pitches (0.754: the second playing cannot be told from going on) and a tempo that steps down a fifth every bar (0.764: 25 of 106 late). 20 of the 449 are below 0.9 and 7 are below 0.8.

**The trade.** On held-out set B the engine withholds a verdict on 153 presses in 63 883 (39 of them right notes) and the right notes called wrong fall from 109 to 4. Agreement on the corpus is lower than the earlier follower's, which was tuned on it. The difference is presses now left unsure and more wrong neighbour keys read as the next note. On the held-out set C's set 831 of the 859 right notes left unsure are in one way of playing: the right hand played when the left hand was the one named, which the rule above leaves unjudged.

**The second unseen set.** It was run once on the engine as it is, after the last change. Nothing was tuned on it.

- 33 right notes were called wrong, in 12 performances. 23 of them are in one way of playing that the engine reads badly: every chord struck twice on purpose, as a learner practising does. It takes the second strike of a chord for the next chord played early and slides one chord out. That way of playing also leaves 55 right notes unsure. The others: 3 where only the first note of each bar is played, 2 with each bar played twice, 2 with both hands played and one named, 1 with a held chord pressed again, 1 with a jump reported a press late and 1 in an adult's mixture on the long rondo.
- All 173 wrong presses called right are presses of the other hand with one hand named, in pieces whose hands play the same keys (hands alternating on the same keys, the same notes a beat apart, two chords under a tune on those keys). Such a press fits a note of the hand practised and is read as that note. Of 1 167 presses of the other hand, 985 were left unsure, 173 were credited and 9 were called wrong. On such music the rule for the other hand is not yet consistent.
- No wrong press was credited anywhere else: 0 of 1 084 warm-up keys, added fingers, added octaves and slips in the three mixtures.
- Steady playing at every speed from 40 to 200 percent, exact and with jitter: 3 presses unsure of 14 610 and none wrong. One hesitation before an onset, the first intervals included: none wrong and none unsure in 52 performances.
- Live and batch gave the same events in all 815.

**The first unseen set.** When it was unseen it was run on the engine as it then stood: 14 right notes called wrong, 184 wrong presses called right (160 of them as repeats, not credited as notes) and 387 presses left unsure. Nothing was tuned on it before that run. The right notes called wrong were: 5 with a hand in the wrong position, 3 in a bar taken at half speed, 2 with a sticky key, 2 in a child's mixture of mistakes, 1 while fishing for a note and 1 in a lesson mixture without the caller's inputs. It has since been used as development material, so the row marked "now" is not an unseen result.

**The nine cases found with held-out set B**, each run again with that set's own inputs:

| Finding | Earlier | Now |
| --- | --- | --- |
| One hand 110 ms behind over a repeated-note bass | 8 wrong, 15 misses | 0 wrong, 0 misses. At 150 and 200 ms behind: 0 wrong, 1 note unsure |
| Starting from a later bar | First press wrong in 16 of 19 starts | 0 wrong and 0 unsure in 19 starts. With the start stated, every press a hit as first reported |
| The same pitch again within the beat | The on-time note wrong | Held note late, on-time note a hit (500 and 550 ms). At 580 ms the on-time note is unsure |
| One hand alone, hesitations and rubato at 80 percent | 75 of 6 850 and 32 of 8 170 right notes wrong | 0 wrong in both. 7 and 3 unsure |
| Extra strikes of a key the score repeats | Credited as notes, real notes wrong | Every note credited. 2 extra strikes: 1 wrong and 1 unsure. 4 extra: 4 wrong. 6 extra: 6 wrong, but for 2 of them the engine keeps a strike 30 to 110 ms beside the one the label calls the note |
| A skipped bar | 2 notes wrong in a sparse hand. Four times speed in a fast piece | 0 wrong. Top speed read 1.06 |
| Slow practice with rubato | 43, 39 and 28 percent of notes late | 2 and 1 percent in the hymn and the waltz at half speed. 13 percent in the largo at full speed, none of them within 100 ms of even playing |
| A slip on to the other hand's pitch in one-hand practice | Excused 13 of 13 | With the hand named: 13 unsure, none credited (the rule for the other hand's keys) |
| Random bursts | 30 of 106 chance keys credited. 15 right notes wrong | 29 of 106 credited (each the next note in time). 1 right note wrong |

**The cases found with held-out set C**, each run again with that set's own inputs:

| Finding | The follower it reviewed | Now |
| --- | --- | --- |
| 1 200 ms added before the second onset, the piece played three times through | 91 of 108 notes unsure, accuracy 0.05, speed stuck at 0.25 | 108 hits, accuracy 1.00, speed 1.00. Over 12 pieces, a wait of 400 to 2 000 ms before each of onsets 2 to 9 and two speeds, the lowest accuracy is 0.95 (3 late of 60) |
| Repeated chords played steadily at half speed | Accuracy 0.52. With 12 ms of jitter at 60 percent: 0.47 and 0.57 | Every note a hit at each of 40, 45, 50, 55, 60, 75, 100, 150 and 200 percent. With jitter at 60 percent: 1.00 in three runs |
| A chord note shown as a hit and then changed to wrong by a later double strike | 1 right note wrong | 0 wrong and 0 unsure of 342 |
| A sticky key on repeated chords | 2 right notes wrong, 7 of 10 second strikes credited | 0 right notes wrong, 4 of 10 credited |
| A hard bar at half speed and back | 7 right notes wrong, 44 unsure | 0 wrong and 0 unsure of 252 |
| Keys next door inside large chords | 5 of 33 wrong presses credited | 3 of 33 credited, 0 right notes wrong |
| Both hands played with the right hand named | Left-hand notes wrong in two pieces and unsure in a third | Every left-hand press unsure in all three, every right-hand note a hit |

**Speed.** Release build on an Apple M5 (arm64, macOS) with Rust 1.99.1, measured while the machine was running other work, so the tails include the scheduler. These figures are from this machine only.

- An exact performance (`cargo run --release --example bench`): a median of 0.5 to 0.6 microseconds a press, p99 under 1 microsecond and a worst press of 31 microseconds, whatever the length of the piece and whatever the `band`. A whole 100 000 note performance in one call took 56 ms. That figure holds for exact playing only.
- A messy session costs far more, because every press that does not fit starts a search. Held-out set C's long session (200 000 presses of a child's mixture of mistakes on a piece of 26 640 notes, timed live from Python) took 6.6 seconds: a mean of 33 microseconds a press, a median of 2, p99 of 361 and a worst press of 0.53 ms. The follower it reviewed took 14.9 seconds for the same session.
- The worst case is a search over a very long piece in which a few pitches come back all the time. Scattered presses over such a piece of 100 000 notes make every press search up to 1 028 places: median 261 microseconds, p99 304, worst 352.

## Limits

- A wrong press whose key is the next note of its hand, struck near that note's time, is read as that note. A slip on to the next note is therefore not seen.
- A first note struck twice is read as the player going back one note: one press is the note and the other a repeat, not a wrong press.
- A key struck a second time is told from the next note of the same key only by how soon it comes. Sooner than two fifths of the way to that note it is a second strike. Later than that, in a line of single notes, it is read as the next note played early and the notes after it are each read one further on until the key stops repeating. In a chord, a single finger struck again gives the note back to the real one. In our own check set 12 of 288 second strikes were credited and 4 right notes were called wrong beside them.
- Where the same chord or key is written over and over, a sudden speed-up of more than about two and a half times cannot be told from keys struck twice: the first quick chord is left unsure or called wrong. Music of one repeated key and nothing else has the same limit at any doubling of speed.
- A sudden change of tempo is followed in order, but the note on each side of the change is out of time and the tempo is right again only after three measurements (up to 12 onsets). In the held-out set C's bar at half speed, 4 to 6 notes of a performance are late for that reason.
- Two hesitations inside three measurements in a row, in notes written 300 ms or more apart, can set the tempo too slow until three clean measurements follow.
- One hand played alone without the hand named, in a piece whose hands share their keys, is scored against both hands. Naming the hand removes this.
- With one hand named, the other hand's presses are never judged. A learner who plays both hands while one is named is told nothing about the other hand. Where the two hands play the same keys, presses of the other hand are credited as notes of the hand practised (173 of 1 167 in the second unseen set, with 9 more called wrong).
- Every chord struck twice on purpose is read badly: the second strike is taken for the next chord played early and the reading slides one chord out (23 right notes called wrong and 55 unsure in 10 such performances of the second unseen set).
- Hammering one key over a passage that has that key coming up can be credited with a few of those notes (3 of 40 in the corpus).
- With a quarter or more of the keys wrong in music of few pitches, the reading can lose the tempo and leave most presses unsure.
- A piece without hand labels is one line: one hand played alone over a busy other hand is followed, but a rush or a jump in it is recognised later, with the presses unsure in between.
- Where the music of two places is the same, a jump is read as the nearer one until the music differs. The engine then moves and revises up to 24 presses. In fast music that repeats a figure, smeared notes can move the reading back to the earlier figure, where right notes are then read as repeats (the held-out set B's presto: 59 of 194).
- A press first shown wrong can be withdrawn when a jump is found (108 times in held-out set B's 63 883 presses).
- Grace notes not in the score are wrong presses or unsure. Written grace notes within `chord_ms` of their main note join its chord.
- Heavy jitter (150 ms on notes 250 ms apart) changes the order of notes. Presses are then left unsure in places.

## Floating point and the three builds

Every decision is made with integers: clocks, tempo, errors and the comparison of readings. Floating point appears only in the final divisions of `finish` (accuracy, played accuracy and mean error). Each is a single division of two values below 2^24 that convert exactly, which is correctly rounded on every target. The first pass sums its errors in 64 bits. Native, WebAssembly and Python builds therefore give the same bits. The Node and Python tests compare a digest of every event and every summary number of all 1 814 corpus cases with the native `golden.json`, in a batch and as a live session.

## What real recordings would need

The material is synthetic. It shows which design choices hold up and which do not, but it cannot show how real learners play. A set of real recordings that could settle the constants and the limits above would need:

- Learners of several levels, on acoustic and digital pianos, with the MIDI as the keyboard sent it (velocity and note-off included).
- The score of each piece with hand labels.
- The same pieces played many ways: as written, each hand alone, slowly, with stops, restarts and repeats.
- Labels for every press from a teacher, not from any engine: right, wrong, late or early, a repeat or a restart, with the note meant. Where a teacher would not commit, that label too.
- Ornaments, rolled and arpeggiated chords, pedalled passages, slow pieces and pieces that repeat exactly.
- Recording latency measured for each setup, so timing labels mean the same on every keyboard.
- Enough of it to keep a held-out part that nobody tunes against.

The research discussion on [datasets for scoring](https://github.com/melophos/melophos/discussions/69) is collecting these.
