# Run Tests After Every Task

After finishing any implementation, bugfix, refactor, or rule change, the AI agent MUST run the full test suite and verify that all tests pass before declaring the task complete.

- Run `npm run test`.
- If any test fails, fix the root cause and rerun until everything is green.
- Only report completion when tests pass.
- If a test failure is unrelated to the current change, report it to the user before proceeding.

If `rtk` is available, the agent should use it to run tests in parallel for faster feedback.
