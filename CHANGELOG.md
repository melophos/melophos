# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- melophos.com in every copyright line alongside isaacadjei.me.
- Monorepo scaffold: firmware, hardware, core, server, studio, client, profiles and docs components, each self-contained with its own README and licence.
- Discussion forms for Q&A and General alongside Ideas and Show and tell.
- `assets/` folder for brand files, photos, diagrams, renders and screenshots, with a social preview card.
- Rust scoring engine that matches played notes with expected notes and scores hits, misses, wrong notes and timing.
- Instrument profile schema with profiles for 61, 76 and 88 key keyboards and a six-string guitar in standard tuning.
- Initial database schema for devices, instruments, practice sessions, note events, songs and recordings.
- Hub simulator for developing the server and Studio without hardware.
- Continuous integration for every component, markdown linting, secret scanning and publishing of each component folder to its own repository.

### Changed

- CI tests the server and client on Python 3.12 and 3.14. 3.12 is the minimum they support and 3.14 is what the server image runs.
