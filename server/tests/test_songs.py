import psycopg
import pytest

from worker.jobs import fail_stuck, process_next

from . import midi_writer as w
from .helpers import sign_up

MIDI = {"Content-Type": "audio/midi"}


@pytest.fixture()
def person(client):
    return sign_up(client)


def upload(client, person, data, title="Prelude", artist=None, **headers):
    params = {"title": title, **({"artist": artist} if artist else {})}
    return client.post(
        "/api/v1/songs", params=params, content=data, headers={**person.headers, **MIDI, **headers}
    )


def run_worker(client) -> int:
    done = 0
    while process_next(client.app.state.pool):
        done += 1
    return done


def test_upload_import_and_listing(client, person):
    response = upload(client, person, w.two_named_tracks().data, "Minuet", "Anon")
    assert response.status_code == 202
    queued = response.json()
    assert queued["import_state"] == "queued" and queued["length_ms"] is None

    assert run_worker(client) == 1
    listed = client.get("/api/v1/songs", headers=person.headers).json()["items"]
    [song] = listed
    assert song["id"] == queued["id"]
    assert (song["title"], song["artist"], song["import_state"]) == ("Minuet", "Anon", "ready")
    assert song["length_ms"] > 10_000
    assert song["note_count"] == 64
    assert 1.0 <= song["difficulty"] <= 10.0
    assert song["hands_method"] == "track_name"
    assert "named" in song["hands_explanation"]


def test_the_notes_come_back_with_their_hand_in_pages(client, person):
    sid = upload(client, person, w.two_unnamed_tracks().data).json()["id"]
    run_worker(client)
    seen, after = [], -1
    while after is not None:
        page = client.get(
            f"/api/v1/songs/{sid}/notes", params={"limit": 25, "after": after}, headers=person.headers
        ).json()
        seen += page["items"]
        after = page["next_after"]
    assert len(seen) == 64
    assert [n["idx"] for n in seen] == list(range(64))
    assert {n["hand"] for n in seen} == {"left", "right"}
    assert all(n["hand"] == ("right" if n["note"] >= 66 else "left") for n in seen)
    assert [n["t_ms"] for n in seen] == sorted(n["t_ms"] for n in seen)


def test_a_bad_file_fails_with_words_the_uploader_can_act_on(client, person):
    bad = w.smf([w.track([(0, w.tempo(500_000))])])
    sid = upload(client, person, bad).json()["id"]
    run_worker(client)
    song = client.get(f"/api/v1/songs/{sid}", headers=person.headers).json()
    assert song["import_state"] == "failed"
    assert song["import_error"] == "the file has no notes"
    assert client.get(f"/api/v1/songs/{sid}/notes", headers=person.headers).json()["items"] == []


def test_a_parser_bug_is_contained_and_the_message_leaks_nothing(client, person, monkeypatch):
    import worker.jobs as jobs

    monkeypatch.setattr(
        jobs, "parse", lambda data: (_ for _ in ()).throw(RuntimeError("secret internals /srv/app/x.py"))
    )
    sid = upload(client, person, w.two_unnamed_tracks().data).json()["id"]
    run_worker(client)
    song = client.get(f"/api/v1/songs/{sid}", headers=person.headers).json()
    assert song["import_state"] == "failed"
    assert "internals" not in song["import_error"] and "/srv" not in song["import_error"]


def test_the_worker_is_the_only_thing_that_parses(client, person, monkeypatch):
    import app.routers.songs as route

    assert not hasattr(route, "parse")
    upload(client, person, w.two_unnamed_tracks().data)
    state = client.get("/api/v1/songs", headers=person.headers).json()["items"][0]["import_state"]
    assert state == "queued"


def test_a_lost_import_is_failed_not_retried(client, person, database_url):
    upload(client, person, w.two_unnamed_tracks().data)
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute(
            "UPDATE songs SET import_state = 'running', import_started_at = now() - interval '11 minutes'"
        )
    assert fail_stuck(client.app.state.pool) == 1
    assert process_next(client.app.state.pool) is False


def test_the_queue_is_oldest_first(client, person):
    first = upload(client, person, w.two_unnamed_tracks().data, "first").json()["id"]
    second = upload(client, person, w.single_stream().data, "second").json()["id"]
    assert process_next(client.app.state.pool)
    states = {
        s["id"]: s["import_state"]
        for s in client.get("/api/v1/songs", headers=person.headers).json()["items"]
    }
    assert states[first] == "ready" and states[second] == "queued"


# input limits


def test_only_midi_content_types_and_midi_bytes_are_accepted(client, person):
    assert upload(client, person, b"not midi at all").status_code == 422
    assert (
        client.post(
            "/api/v1/songs",
            params={"title": "x"},
            content=w.single_stream().data,
            headers={**person.headers, "Content-Type": "text/html"},
        ).status_code
        == 415
    )
    assert (
        client.post(
            "/api/v1/songs", params={"title": "x"}, content=b"", headers={**person.headers, **MIDI}
        ).status_code
        == 422
    )


def test_a_file_over_one_mebibyte_is_refused_however_it_arrives(client, person):
    big = w.single_stream().data + b"\x00" * (1024 * 1024)
    assert upload(client, person, big).status_code == 413

    def stream():
        yield b"MThd" + b"\x00" * 1000
        for _ in range(1100):
            yield b"\x00" * 1024  # no Content-Length, so only counting stops this

    response = client.post(
        "/api/v1/songs", params={"title": "x"}, content=stream(), headers={**person.headers, **MIDI}
    )
    assert response.status_code == 413


@pytest.mark.parametrize("title", ["", "   ", "x" * 121, "tab\there", "new\nline", "\x00"])
def test_bad_titles_are_refused(client, person, title):
    assert upload(client, person, w.single_stream().data, title).status_code == 422


def test_a_title_that_looks_like_a_path_is_just_text(client, person):
    sid = upload(client, person, w.two_unnamed_tracks().data, "../../etc/passwd").json()["id"]
    run_worker(client)
    assert client.get(f"/api/v1/songs/{sid}", headers=person.headers).json()["title"] == "../../etc/passwd"
    download = client.get(f"/api/v1/songs/{sid}/file", headers=person.headers)
    assert download.headers["content-disposition"] == f'attachment; filename="song-{sid}.mid"'
    assert download.headers["x-content-type-options"] == "nosniff"
    assert download.content == w.two_unnamed_tracks().data


def test_uploads_are_rate_limited_and_the_library_is_bounded(client, person, monkeypatch):
    import app.routers.songs as route
    import app.songs as songs

    monkeypatch.setattr(songs, "MAX_SONGS_PER_ACCOUNT", 3)
    codes = [upload(client, person, w.two_unnamed_tracks().data, f"s{i}").status_code for i in range(4)]
    assert codes == [202, 202, 202, 409]
    assert route.UPLOAD_LIMIT == 20


def test_deleting_a_song_removes_its_notes_and_file(client, person, database_url):
    sid = upload(client, person, w.two_unnamed_tracks().data).json()["id"]
    run_worker(client)
    assert client.delete(f"/api/v1/songs/{sid}", headers=person.headers).status_code == 204
    with psycopg.connect(database_url) as conn:
        assert conn.execute("SELECT count(*) FROM song_notes").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM song_files").fetchone()[0] == 0


def test_song_pages_have_a_maximum_and_a_stable_order(client, person):
    for i in range(5):
        upload(client, person, w.two_unnamed_tracks().data, f"s{i}")
    assert client.get("/api/v1/songs", params={"limit": 201}, headers=person.headers).status_code == 422
    seen, cursor = [], None
    while True:
        extra = {"cursor": cursor} if cursor else {}
        page = client.get("/api/v1/songs", params={"limit": 2, **extra}, headers=person.headers).json()
        seen += [s["title"] for s in page["items"]]
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert seen == ["s4", "s3", "s2", "s1", "s0"]


# ownership


def test_another_account_never_sees_a_song_or_its_file(client, person):
    other = sign_up(client)
    sid = upload(client, person, w.two_unnamed_tracks().data, "private").json()["id"]
    run_worker(client)
    for suffix in ["", "/notes", "/file"]:
        assert client.get(f"/api/v1/songs/{sid}{suffix}", headers=other.headers).status_code == 404, suffix
    assert client.delete(f"/api/v1/songs/{sid}", headers=other.headers).status_code == 404
    assert client.get("/api/v1/songs", headers=other.headers).json()["items"] == []
    assert client.get(f"/api/v1/songs/{sid}", headers=person.headers).status_code == 200
    assert client.get(f"/api/v1/songs/{sid}/file", headers=person.headers).status_code == 200


def test_a_signed_out_caller_gets_nothing(client, person):
    sid = upload(client, person, w.two_unnamed_tracks().data).json()["id"]
    assert client.get(f"/api/v1/songs/{sid}/file").status_code == 401
    assert (
        client.post(
            "/api/v1/songs", params={"title": "x"}, content=w.two_unnamed_tracks().data, headers=MIDI
        ).status_code
        == 401
    )


# correcting the split


def ready_song(client, person):
    sid = upload(client, person, w.two_unnamed_tracks().data).json()["id"]
    run_worker(client)
    return sid


def notes_of(client, person, sid):
    return client.get(f"/api/v1/songs/{sid}/notes", params={"limit": 2000}, headers=person.headers).json()[
        "items"
    ]


def test_the_split_is_described_as_a_first_guess(client, person):
    sid = ready_song(client, person)
    song = client.get(f"/api/v1/songs/{sid}", headers=person.headers).json()
    assert "first guess" in song["hands_explanation"] and song["hands_edited"] is False


def test_a_corrected_split_is_stored_and_the_rest_is_left_alone(client, person):
    sid = ready_song(client, person)
    before = notes_of(client, person, sid)
    flip = {n["idx"]: ("left" if n["hand"] == "right" else "right") for n in before[:5]}
    response = client.put(
        f"/api/v1/songs/{sid}/hands",
        json={"changes": [{"idx": i, "hand": h} for i, h in flip.items()]},
        headers=person.headers,
    )
    assert response.status_code == 200
    song = response.json()
    assert song["hands_edited"] is True and song["hands_explanation"].startswith("You corrected")
    after = notes_of(client, person, sid)
    assert {n["idx"]: n["hand"] for n in after[:5]} == flip
    assert [n["hand"] for n in after[5:]] == [n["hand"] for n in before[5:]]


def test_a_correction_can_be_undone(client, person):
    sid = ready_song(client, person)
    before = notes_of(client, person, sid)
    client.put(
        f"/api/v1/songs/{sid}/hands",
        json={"changes": [{"idx": 0, "hand": "left" if before[0]["hand"] == "right" else "right"}]},
        headers=person.headers,
    )
    reset = client.post(f"/api/v1/songs/{sid}/hands/reset", headers=person.headers).json()
    assert reset["hands_edited"] is False
    assert notes_of(client, person, sid) == before


def test_putting_the_original_hand_back_is_not_an_edit(client, person):
    sid = ready_song(client, person)
    first = notes_of(client, person, sid)[0]
    r = client.put(
        f"/api/v1/songs/{sid}/hands",
        json={"changes": [{"idx": 0, "hand": first["hand"]}]},
        headers=person.headers,
    )
    assert r.json()["hands_edited"] is False


@pytest.mark.parametrize(
    "changes",
    [
        [],
        [{"idx": -1, "hand": "left"}],
        [{"idx": 10_000, "hand": "left"}],
        [{"idx": 0, "hand": "middle"}],
        [{"idx": "a", "hand": "left"}],
    ],
)
def test_bad_corrections_are_refused_and_change_nothing(client, person, changes):
    sid = ready_song(client, person)
    before = notes_of(client, person, sid)
    assert client.put(
        f"/api/v1/songs/{sid}/hands", json={"changes": changes}, headers=person.headers
    ).status_code in (422,)
    assert notes_of(client, person, sid) == before


def test_corrections_are_bounded(client, person):
    sid = ready_song(client, person)
    too_many = [{"idx": 0, "hand": "left"}] * 50_001
    assert (
        client.put(
            f"/api/v1/songs/{sid}/hands", json={"changes": too_many}, headers=person.headers
        ).status_code
        == 422
    )


def test_a_song_that_has_not_finished_importing_cannot_be_corrected(client, person):
    sid = upload(client, person, w.two_unnamed_tracks().data).json()["id"]
    r = client.put(
        f"/api/v1/songs/{sid}/hands", json={"changes": [{"idx": 0, "hand": "left"}]}, headers=person.headers
    )
    assert r.status_code == 409


def test_another_account_cannot_correct_or_reset_a_split(client, person):
    other = sign_up(client)
    sid = ready_song(client, person)
    before = notes_of(client, person, sid)
    assert (
        client.put(
            f"/api/v1/songs/{sid}/hands",
            json={"changes": [{"idx": 0, "hand": "left"}]},
            headers=other.headers,
        ).status_code
        == 404
    )
    assert client.post(f"/api/v1/songs/{sid}/hands/reset", headers=other.headers).status_code == 404
    assert notes_of(client, person, sid) == before
