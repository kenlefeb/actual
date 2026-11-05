## MODIFIED Requirements

### Requirement: The assistant reaches production only through the hosted connector
The assistant SHALL reach production only through the hosted connector (the production slice of `mcp-remote`), which reads and writes. The local `actual-production` entry SHALL be removed from Claude Desktop, and no production credential SHALL be left in a local launcher.

#### Scenario: No local production entry
- **WHEN** a Claude Code session in the repository lists its MCP tools
- **THEN** none is named `actual-production` or reaches a production host
