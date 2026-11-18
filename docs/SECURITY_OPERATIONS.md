# Klierly account and security operations

The public site uses passkeys with user verification required. Accounts are approved manually after a request to gabriel.klier@ufl.edu. Password and shared-invite registration paths are disabled.

## Account approval

Sign in with the administrator passkey, open Admin, and approve the name and email from the received request. Reply to that email with the generated enrollment link. The link expires after 24 hours, is stored only as a hash, and works once. It authorizes account setup, so send it only to the approved address.

Administrative writes, adding passkeys, and account deletion require a passkey sign-in within the last ten minutes. Sign out and sign back in when prompted. Add a backup passkey in Settings.

Disable account revokes sessions, extension tokens, pending challenges and enrollment links. Recovery revokes old passkeys and access, then issues a new enrollment link. Independently verify requests before issuing recovery. Browser access alone does not verify enrollment in a class. Approve class membership manually and enable class sharing only after checking enrollment.

## Migration and owner setup

Set APP_URL=https://klierly.klierapps.tech. Passkeys registered at localhost will not work on the public hostname. The migration revokes all password-era sessions and extension tokens, marks existing password hashes disabled, and turns class sharing off. Existing course data and account IDs are preserved.

After applying migrations, run the owner bootstrap from the trusted server console with the existing owner's UUID and a new private output path:

    docker compose exec -T web npx tsx scripts/bootstrap-owner.ts <owner-uuid> /tmp/owner-enrollment.txt

Read the resulting private file through the trusted console and give the link to the owner. Only the specified existing UUID receives administrator status. The bootstrap refuses to run after a passkey is present. Enroll on the final HTTPS site, then remove the private output file. The owner must complete the device's passkey confirmation personally.

## Public origin

The tunnel overlay removes published web ports and trusts Cloudflare's client address header. Use TRUST_CLOUDFLARE=true only when requests reach the app exclusively through the trusted Cloudflare ingress. Keep PostgreSQL and worker ports unpublished. Keep the app outside any Cache Everything rule. Test extension pairing on the final hostname, including any Cloudflare Access policy.

Hosted AI calls are restricted to exact API origins and base paths for OpenAI, Google AI Studio, and UF NaviGator. Custom endpoints are disabled. Local model servers are allowed only with an explicit ALLOW_PRIVATE_AI_ENDPOINTS=true and an HTTP localhost APP_URL. Treat DNS and network egress controls as additional independent boundaries. Managed AI requires configured prices and a positive budget. Usage is reserved in PostgreSQL before each call, including concurrent calls. Provider invoices remain authoritative.

Uploads are streamed into a bounded request body before parsing. Every import path has a 25 MB source limit. Quotas default to 512 MB per user and 8 GB overall, serialized in the database. Containers have memory, CPU and process limits. The parser runs in a child process with a 45-second timeout. Monitor disk capacity, backups, OOM events and provider failures.

Sessions last seven days. Extension tokens last thirty days and can be revoked individually. Re-pair extensions after migration. Passkey challenges are browser-bound, expire after five minutes, and are consumed once before verification.

## Release validation

Use isolated test databases. The Playwright passkey helper uses a virtual authenticator and writes fixture accounts directly to the dedicated E2E database. Production contains no HTTP bootstrap or test authentication endpoint. Verify rejected enrollment links, passkey login, administrator isolation, disabled sessions, expired tokens, administrator approvals and a second-device passkey before broader use.

Keep dependencies patched, maintain encrypted off-guest backups, test restore procedures, and review access logs. These controls reduce risk and do not constitute a guarantee against all vulnerabilities.
