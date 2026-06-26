# Security Policy

Borderless Pay treats security as a first-class, board-level concern. This
document explains how to report a vulnerability and what to expect.

## Reporting a vulnerability

**Please do not open public GitHub issues for security reports.**

- Email: **security@borderlesspay.app** (PGP key available on request)
- Include: affected component, reproduction steps, impact, and any PoC.
- We support coordinated disclosure and will credit reporters who wish to be named.

### Our commitment (target SLAs)
| Stage | Target |
|---|---|
| Acknowledge receipt | 2 business days |
| Triage + severity (CVSS v3.1) | 5 business days |
| Fix or mitigation for High/Critical | 30 days |
| Public disclosure | Coordinated, after a fix ships |

### Safe harbor
Good-faith research that respects user privacy, avoids service degradation, and
does not access or modify data you don't own will not be pursued legally. Do not
test against production user data. A staging environment is provided to vetted
researchers on request.

## Scope
- `backend/` API and web client (PWA)
- `mobile/` application
- Project infrastructure (once a production environment exists)

Out of scope: third-party services we integrate with (report to them directly),
social engineering, and physical attacks.

## Security documentation
- Engineering threat model & controls: [`backend/SECURITY.md`](./backend/SECURITY.md)
- Internal security audit report: [`docs/SECURITY_AUDIT.md`](./docs/SECURITY_AUDIT.md)
- Regulatory & compliance roadmap: [`docs/COMPLIANCE.md`](./docs/COMPLIANCE.md)
- Production go-live checklist: [`docs/PRODUCTION_READINESS.md`](./docs/PRODUCTION_READINESS.md)
