# Flawd Bot

This repository forwards issue, pull request, and comment events to ClawSweeper through `.github/workflows/clawsweeper-dispatch.yml`.

Command comments have their own concurrency group per comment. Issue and pull request updates share a group per event type and item, so edits and new revisions supersede earlier updates without cancelling command dispatch. Bot label events use separate groups even when their dispatch job is skipped, preventing them from replacing pending human-triggered dispatches.

## Checks

With Node.js 24 and npm installed:

```sh
npm ci --ignore-scripts
npm test
```

The tests parse the production workflow and evaluate its concurrency expressions with GitHub's expression evaluator against synthetic events. CI runs the same checks on pull requests and pushes to `main`; it does not dispatch ClawSweeper or use application credentials.
