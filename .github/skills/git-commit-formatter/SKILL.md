---
name: git-commit-formatter
description: Formats git commit messages according to Conventional Commits. Use when the user asks to commit changes or write a commit message.
---

# Git Commit Formatter

## Purpose

Generate commit messages that strictly follow the Conventional Commits specification.

## When to use

Use this skill when the user asks to:

- write a commit message
- suggest a commit title
- commit staged changes
- format or improve an existing commit message

## Output format

`<type>[optional scope]: <description>`

## Allowed types

- feat: A new feature
- fix: A bug fix
- docs: Documentation-only changes
- style: Formatting changes that do not affect behavior
- refactor: Code change that neither fixes a bug nor adds a feature
- perf: Performance improvement
- test: Add or correct tests
- chore: Build/tooling/maintenance changes

## Workflow

1. Analyze changed files and infer the primary change intent.
2. Select the best matching `type`.
3. Determine `scope` when clearly identifiable (module, feature, component, service).
4. Write a short imperative description (e.g., "add", "fix", "refactor").
5. If multiple unrelated changes exist, suggest splitting into multiple commits.
6. If a breaking change is present, add:
   - `!` after type/scope in the subject (when appropriate), and/or
   - footer line: `BREAKING CHANGE: <impact>`

## Quality checks

Before returning the message, ensure:

- subject is concise and specific
- description is imperative and lower-case (unless proper nouns)
- no trailing period in subject
- type and scope reflect the dominant change
- message is unambiguous for future changelog readers

## Examples

- `feat(auth): implement login with google`
- `fix(ingest): handle empty chunk extraction`
- `refactor(pipeline): simplify multi-vector payload mapping`
- `chore(deps): bump fastembed to 2.1.0`
- `feat(api)!: remove legacy query endpoint`

BREAKING CHANGE: remove `/api/query-legacy` and require `/api/query`
