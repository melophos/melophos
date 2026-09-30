# Workflows

| Workflow | Runs on | What it does |
| --- | --- | --- |
| [`ci.yml`](ci.yml) | Push to `main`, every pull request | Formats, lints, type-checks, tests and builds every component: core, firmware, server, client and Studio |
| [`markdownlint.yml`](markdownlint.yml) | Push to `main`, every pull request | Lints every markdown file against [`.markdownlint.json`](../../.markdownlint.json) |
| [`gitleaks-scan.yml`](gitleaks-scan.yml) | Push to `main`, every pull request | Scans the working tree for committed secrets |
| [`split.yml`](split.yml) | Push to `main` | Publishes each component folder to its own repository, see [docs/repositories.md](../../docs/repositories.md) |

`split.yml` needs a `SPLIT_TOKEN` secret: a fine-grained token with contents write access to the component repositories. Without it the workflow succeeds and publishes nothing.

Actions are pinned to full commit SHAs so a moved tag cannot change what runs.
