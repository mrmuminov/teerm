# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

All code lives in `teerm-client/`, the Teerm desktop SSH client (Tauri v2 + Rust core + React frontend). Run every `npm` / `cargo` command from inside it (Rust commands from `teerm-client/src-tauri/`).

The detailed guidance for the client (commands, architecture, security boundary, i18n, dev mock) is in `teerm-client/AGENTS.md`, imported below. Domain vocabulary is in `teerm-client/CONTEXT.md` (use "Host", not "server"/"profile"); the accepted design is in `teerm-client/docs/v1-design.md` and decisions are in `teerm-client/docs/adr/`.

@teerm-client/AGENTS.md
