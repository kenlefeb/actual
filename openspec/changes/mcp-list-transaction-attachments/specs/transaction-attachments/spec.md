## ADDED Requirements

### Requirement: Attachment metadata over MCP
The MCP server SHALL offer a read-only tool, `list_transaction_attachments`, that takes a transaction id and returns that transaction's attachments, each with its id, name, type, size in bytes and created time. It SHALL NOT return a document's content, hash or encryption data, and SHALL NOT attach, open or remove a document. It SHALL refuse an input that is not a non-empty transaction id. A transaction without attachments SHALL give an empty list. Attachment names SHALL be returned as untrusted text.

#### Scenario: List a transaction's attachments
- **GIVEN** a transaction with a 200 KB PDF attached
- **WHEN** an agent calls `list_transaction_attachments` with the transaction's id
- **THEN** it gets one entry with the file's name, type, size and created time, and no document content

#### Scenario: No attachments
- **WHEN** an agent lists a transaction that has none, or whose attachments were removed
- **THEN** it gets an empty list

#### Scenario: Invalid input
- **WHEN** an agent calls the tool with an empty transaction id
- **THEN** the tool refuses and returns nothing
