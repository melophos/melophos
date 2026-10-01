# Repositories

MELOPHOS lives in one monorepo, [melophos/melophos](https://github.com/melophos/melophos). Every component folder is also published to its own repository so it can be browsed, cloned or depended on alone.

| Folder | Published repository | Licence |
| --- | --- | --- |
| `firmware/` | [melophos/firmware](https://github.com/melophos/firmware) | AGPL-3.0-or-later |
| `core/` | [melophos/core](https://github.com/melophos/core) | AGPL-3.0-or-later |
| `hardware/` | [melophos/hardware](https://github.com/melophos/hardware) | CERN-OHL-S-2.0 |
| `server/` | [melophos/server](https://github.com/melophos/server) | AGPL-3.0-or-later |
| `studio/` | [melophos/studio](https://github.com/melophos/studio) | AGPL-3.0-or-later |
| `client/` | [melophos/client](https://github.com/melophos/client) | AGPL-3.0-or-later |
| `profiles/` | [melophos/profiles](https://github.com/melophos/profiles) | AGPL-3.0-or-later |
| `docs/` | [melophos/docs](https://github.com/melophos/docs) | AGPL-3.0-or-later |

The organisation's [`.github`](https://github.com/melophos/.github) repository holds the organisation profile and the default community files.

## How publishing works

On every push to `main` that touches a component folder, the [`split`](../.github/workflows/split.yml) workflow runs `git subtree split` for that folder and pushes the result to the matching repository's `main` branch. The split keeps each commit that touched the folder, with its message and date, so each published repository has a real history rather than one snapshot commit. In the copies, each commit is credited to the project's automation account.

> [!IMPORTANT]
> The published repositories are read-only. Issues are turned off there and pull requests opened there are closed with a pointer back to the monorepo, because anything committed there would be overwritten by the next publish.

## Why a monorepo

A single change often crosses components: a new protocol field touches the hub, the server and the Studio together. One repository means one pull request, one review and one set of checks for that change. See ADR 4 in [decisions.md](decisions.md).
