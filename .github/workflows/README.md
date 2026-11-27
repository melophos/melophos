# Workflows

| Workflow | Runs on | What it does |
| --- | --- | --- |
| [`ci.yml`](ci.yml) | Push to `main`, every pull request | Formats, lints, type-checks, tests and builds every component: core, firmware, server, client, Studio, the website and the Discord tooling (ruff, pytest, the layout check and the worker's tests and type check). The Studio and the website also get a licence check and browser checks (axe, Lighthouse CI and the specimen screenshots). A last job, `CI alert`, runs only when a job failed on a push to `main` of this repository and tells the staff channel on Discord. It reads the secret `DISCORD_WEBHOOK_CI_ALERTS` from the `community` environment |
| [`markdownlint.yml`](markdownlint.yml) | Push to `main`, every pull request | Lints every markdown file against [`.markdownlint.json`](../../.markdownlint.json) |
| [`gitleaks-scan.yml`](gitleaks-scan.yml) | Push to `main`, every pull request | Scans the working tree for committed secrets |
| [`publish-images.yml`](publish-images.yml) | Push of a version tag `vX.Y.Z` in `melophos/melophos` only | Checks the tag is signed, on main and tested, then builds the server and broker images natively for amd64 and arm64, signs them, attests them and the release files and creates a DRAFT release. Never runs for a branch, a fork or a pull request. See "Releasing" below |
| [`discord-relay.yml`](discord-relay.yml) | Releases, issues, discussions and pushes | Posts a short message to the project's Discord channels through webhook secrets of the `community` environment (announcements, releases, feed, ideas and research) and the two forum tag ids `DISCORD_TAG_IDEAS` and `DISCORD_TAG_RESEARCH`. It asks only to read the repository |
| [`split.yml`](split.yml) | Push to `main` | Publishes each component folder to its own repository, see [docs/repositories.md](../../docs/repositories.md) |

`split.yml` needs a `SPLIT_TOKEN` secret: a fine-grained token with contents write access to the component repositories. Without it the workflow succeeds and publishes nothing.

Every action is pinned to a full commit SHA with its version in a comment, in every workflow, so a moved tag cannot change what runs. A test (`server/tests/test_release.py`) fails when one is not. Every job has a timeout. CI never cancels a run on `main`.

## Releasing

A release is a signed annotated tag on a commit of `main` that CI has passed, named `vX.Y.Z` with the same version as `server/pyproject.toml`. Pushing it starts `publish-images.yml`:

1. **Release gate** (`.github/scripts/verify-release.sh`): the tag is annotated and its signature is verified by GitHub, it points at the commit of the run, that commit is on `main`, CI passed on it and the version matches. Nothing else runs until this passes.
2. **Maintainer approval**: a job in the protected `release` environment. Its required reviewers must approve before any image is built.
3. **Build**: each image and platform is built on a machine of its own architecture (amd64 on `ubuntu-24.04`, arm64 on `ubuntu-24.04-arm`, which is free for a public repository) and pushed by digest. Emulation was not chosen because the Rust scoring engine takes far longer under it.
4. **Merge and sign**: the platforms are joined into one image, signed by digest without a stored key and given build provenance. The software bill of materials and provenance of each platform stay attached.
5. **Release files**: the compose file gets the digests, `install.sh` gets the checksums, the checksums file is signed (a bundle) and every file is attested.
6. **Draft release**: created as a draft. A maintainer reads it and publishes it by hand.

A workflow cannot defend itself against being edited at the tagged commit, so the tag ruleset, the protected `release` environment, the ruleset for `main` and the package visibility are repository settings rather than files.

`publish-images.yml` has not run yet because the repository is not pushed. Its first run is a test of the workflow itself.
