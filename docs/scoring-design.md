# Design of the score follower

This note says what the follower in `core/src/follow.rs` is for, the model we chose, what we considered and turned down and how the engine comes to say that it is not sure. [Scoring and tempo tracking](scoring.md) states the rules, the figures and the measurements. Every figure in both pages comes from synthetic performances. Nobody has played into this engine.

## What a follower for a learner must get right

A learner plays a keyboard and a practice view lights each press. Four things matter, in this order.

1. **A right note is never called wrong.** A child told "wrong" for a right note stops trusting the lights. This is the harm we design against first.
2. **A wrong press is not praised.** It matters less than the first, because the engine may decline to judge.
3. **Timing is information, not blame.** A learner who plays slowly, hesitates or shapes a phrase is not late on every note.
4. **The answer comes at once, costs little and is the same everywhere.** The Studio scores in the browser and the server scores stored sessions with the same code.

## Why the earlier design did not converge

The earlier follower was a minimum-cost alignment: one reading for each place in the piece, each with its own clock, the cheapest reported. Three reviews each found right notes called wrong in ordinary practice and two rounds of repair did not end that. The failures share one shape. The model had **one place and one tempo** for the whole performance. The same place had to explain two hands that drift apart, a pitch that comes again and a player who jumps. It also had to give every press a verdict.

- One hand 110 ms behind the other read as that hand's next note, because the hands shared a place and the tempo was measured across them.
- A note held back until its pitch came again took the later note. The on-time note was then called wrong.
- A start from a later bar had no reading at the top, so its first press was wrong for good.
- A hesitation and a change of tempo looked the same to a clock that measures between any two notes.

Better weights would not change the shape. We changed the model.

## The model we chose

**Each hand is a line of its own. The lines share one tempo. A small number of readings are kept, each a place with a clock. A press that fits no reading with confidence is left unsure.**

- **Lines.** A press is matched within one hand's notes by pitch. The next unplayed note of that pitch is the default reading, so a hand that hesitates or runs behind stays in order. The other hand's notes never stand in the way.
- **One tempo, measured within a line.** The tempo is the median of the last three measurements, each taken between two onsets of the same hand. Until three have been taken the tempo stays where it was. Hands a little apart do not look like a change of tempo and one hesitation cannot move the median. How far apart the hands sit is learnt from notes written together.
- **A note belongs to the press that fits it best, when the two are one note struck twice.** When two presses of one key fall near one note, the nearer in time takes it and the other is read again. This settles a key struck twice and a held-back note whose pitch comes again. Two presses far enough apart to be two notes, the second with a note of its own next in order, are left in order: they are the music played quicker.
- **Readings.** The reported reading goes on from press to press. When a press does not fit, the engine looks for other places where the last few presses fit, in order and in time. Each becomes a reading under test. It replaces the reported reading only when it explains clearly more, with a run of presses on at least two different keys. Until then the presses it would explain are unsure, not wrong.
- **What the caller knows is taken, not guessed.** The start, the hands being practised and a jump the learner asked for are inputs. The engine works without them and is then slower to be sure.

## How uncertainty becomes "unsure"

A press ends as one of five things: a hit, a late note (early or late), a repeat, wrong or unsure. The engine calls a press **wrong** only when both of these hold.

1. **It is sure of the place.** The reading has matched at least three presses since it was last in doubt, at most one press in the last few has failed to fit and no pause has passed. A start the caller states counts as sure.
2. **No note could have been meant.** No note of that key is written near the place. Failing that, every note of that key near it has been played by another press and this press was the same key struck again or struck before its note came in its place.

Everything else that matches no note is **unsure**. That covers a press whose key belongs to a note near the place that was never played, a press made while the reading has lost the player, a press that could be the player going back and every press that a place under test might yet explain. Unsure counts neither for nor against the player. A press first shown unsure can become a hit, a repeat or wrong as later presses settle it. A press shown wrong can still be withdrawn when a jump is found.

## What held-out set C changed and why

Testing this follower against held-out set C found that its tempo could be set by a hesitation and never recover. We kept the model and changed the tempo estimate and the rule for a note changing hands. Each change is stated with its test in [Scoring](scoring.md).

- **No single interval sets the tempo.** The tempo used to be taken from the first interval and from the mean of the first two. A hesitation before the second onset made it two fifths of the real one, every later note then looked too soon to be a note and the session stayed unsure. The tempo now stays at its last value until three measurements exist. Until then the order of the notes is trusted over the clock.
- **A hesitation is taken out of the measurement it falls in.** A measurement covers at least 300 ms of score, which is often two or three intervals. One interval far slower than the rest of its stretch is left out. A hesitation seen by both hands counts once.
- **A tempo that the presses contradict is dropped.** Three presses running that are each the next note of their hand and each too soon for the clock mean the clock is wrong. The tempo is dropped, those presses are read again in order and the tempo is learnt again. This is what bounds the damage of any wrong estimate: a steady run recovers.
- **A chord's notes belong together.** A key of the chord just sounded, struck within 100 ms of it, is that chord's note however late the chord itself was. At half speed the second note of a repeated chord used to be read as the same key of the next chord, which is why steady half-speed chords scored about half.
- **Earliness is measured from where the last onset fell.** The beat moves only half way to an early onset, so the next onset of a quicker tempo looked earlier still and was refused.
- **A note changes hands only between two strikes of one note.** The earlier rule gave a note to whichever press was nearer its expected time. With the tempo wrong, the next chord took the notes of the one before and the reading slid. Now a press takes a held note only when the two strikes are too close to be two notes, when the earlier one was a single finger of a chord struck without the rest or when the press has no note of its own next in order.
- **A press shown as a note is not turned wrong by a slip.** Only another press that now holds that note as its first playing can do that. A move to another place leaves such a press unsure at worst.
- **A key struck again says nothing about the place.** Where the music of two places is the same, a chord struck twice fitted the other place and the reading moved there. Such a press no longer counts as evidence for a move. Timing no longer counts in that comparison either, so a change of tempo cannot look like a move.
- **The pace of the last interval is the last interval.** A note is in time when it fits the pulse or the pace of the interval that hand just played. After a change of tempo the first note is out of time, as it is after a hesitation. The notes that follow at the new pace are not.
- **The other hand's keys are left unjudged when one hand is named.** They were wrong in some places and unsure in others. One rule now covers a slip on to such a key and a learner who plays both hands: a press that fits no note of the hand practised is unsure and takes no part in the reading. Where the hands share their keys the rule does not reach: such a press is read as a note of the hand practised.

What these cost is in the limits of [Scoring](scoring.md#limits): a second strike of a key between two fifths and three fifths of the way to its next note is now read as that note in a line of single notes. Wrong presses called right rose from 7 to 10 on the corpus final set.

## What we considered and turned down

- **A hidden Markov model over score positions with tempo and hand-offset states.** It is the textbook answer. With 100 000 notes, a usable grid of tempi and offsets needs thousands of states a press even inside a band. A grid of tempi also judges timing coarsely. Pruned to fit the budget it becomes a search over a few readings, which is what we built, without the grid.
- **The earlier minimum-cost alignment with better costs.** Two rounds tried it. One cost has to price a late note, a skipped note, a wrong key and a jump against each other for every texture. Each fix moved a failure elsewhere.
- **Two followers, one for each hand, joined by a tempo.** This is close to what we chose. We kept the idea and not the structure, because pieces without hand labels, notes that pass between the hands and one hand played alone need one place for the piece.
- **A particle filter.** It needs random numbers. The three builds must agree bit for bit and a view must not flicker between runs.
- **Giving every press a verdict.** The earlier follower did. A forced verdict on an ambiguous press is where most of the harm came from.

## What the choice costs

- A wrong press whose key is the next note in time is still read as that note. Nothing in the presses says otherwise.
- More presses are left without a verdict. [Scoring](scoring.md#measured-behaviour) reports how many against the errors that remain.
- A piece without hand labels is followed as one line, so one hand played alone and hands far apart are followed less well than with labels.
- The readings are few. In music that repeats, the place chosen may be one of several that fit and the engine moves when they stop fitting.
