# Backend TODOs

This living list captures longer-running backend improvements we plan to tackle incrementally.

## Queue & Worker Architecture

- [ ] Split the AI processing loop into a separate lightweight worker process (same machine for now) that polls MongoDB for pending jobs. Keep the Nest API focused on HTTP traffic so user-facing latency stays predictable. Document how to start/stop this worker alongside the main server.

