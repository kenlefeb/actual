# Proposal

## Why

Ken wants to use the fork's MCP server from Claude on his phone and the web, and, as far as we know, from Claude Duet, which is reported to run in the cloud and use the account's connectors (Shortcut sc-1950; how Duet connects is unverified, see the design). The server today is local stdio only, with no network listener; that rule was central to the Security Analyst's acceptance of v1 and stays true for the stdio entry.

Anthropic's connectors are called from Anthropic's infrastructure, not from the user's machine ([connector documentation](https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers)), so the earlier tailnet-only plan (sc-1554, now folded into this change) cannot serve them. A hosted server must be reachable from the public internet, so it has to be safe there.

Explore findings, with the options weighed, are on sc-1950 (comments 1955, 1956, 1957): a separate hosted entry over streamable HTTP, staging and read-only first, one identity, our own OAuth provider with a pre-registered client and no open registration, `init({ readOnly: true })` fixed in code, no write tools, and production only later, by Ken's decision. The per-budget identity that gated production (sc-1555) is superseded by the `production-identities` change (sc-2004): a separate assistant user with the BASIC role on the production budget.

## What Changes

- **New capability `mcp-remote`:** a hosted entry of the MCP server (slice 1 is this spec and the threat model; no code). It is read-only in code, serves staging by default and production only under an explicit guard, speaks streamable HTTP, authenticates one identity through OAuth 2.1 with PKCE, and holds its secrets in read-only mounted files.
- **`mcp-server`, "Local stdio only":** reworded to say it applies to the `actual-mcp` stdio entry, so a second entry is not a contradiction.
- **`threat-model.md`:** assets, trust boundaries, threats and mitigations, residual risks, the revocation steps and the LOCKDOWN inventory rows the deployment will need.

The identity provider, the public hostname and Funnel are named configuration, not decisions in this change; Ken's answers are needed before the OAuth slice (identity provider) and the deployment slice (Funnel, hostname, the plaintext staging copy).

Production slice (sc-2215, added 2026-11-02): Ken's priority is the hosted connector on production with his assistant signing in. The staging-only rule is replaced by a guard (a dedicated production flag, a session-token credential, a subject identifier as the account, still read-only in code); the production network, exposure and identity shapes are specified; and the mitigations production requires before go-live are listed. Whether the production lockdown (sc-563) is a precondition is **Ken's open decision**; the spec states the dependency either way and does not choose.

Non-goals: any write tool, per-client access with its own limits, changing the stdio entry, and an edge allowlist of Anthropic's addresses (optional hardening, see the threat model).

## Capabilities

### New Capabilities

- `mcp-remote`: the hosted, read-only, single-identity connector.

### Modified Capabilities

- `mcp-server`: "Local stdio only" is scoped to the stdio entry (the requirement lives in the open `fork-mcp-server` change and is edited there).
