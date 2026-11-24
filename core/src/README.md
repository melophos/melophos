# Core source

| File | Purpose |
| --- | --- |
| `lib.rs` | Crate root and public exports |
| `follow.rs` | `Follower`, `follow`, `follow_with_hands`, `follow_session`, `FollowConfig`, `Session`, `Practise`, `Event`, `FollowScore` and `Hand`: each hand followed as a line, the shared clock, the search for another place and the rule for leaving a press unsure, with unit tests |
| `score.rs` | `Note`, `ScoreConfig`, `Score` and the `score` function (matching per pitch after sorting), with unit tests |
