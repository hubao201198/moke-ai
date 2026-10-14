## Project architecture

- `frontend/` contains only the Next.js user interface and request-level access checks.
- `backend/` is the Go business API. Keep database access, external provider calls, scheduling, and webhooks there.
- `legacy/` is read-only migration reference and must not be deployed.
- Never commit credentials. Production configuration belongs in the deployment environment.

