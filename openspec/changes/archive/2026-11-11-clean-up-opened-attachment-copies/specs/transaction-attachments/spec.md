## ADDED Requirements

### Requirement: Temporary copies are removed
On desktop, opening a document hands the OS viewer a plain copy in the system temp folder. The app SHALL remove every such copy when it quits, and at its next start for any a crashed run left behind. It SHALL NOT remove a copy right after opening it, because the viewer may still be reading it. The copies are removed whether or not the budget is encrypted.

#### Scenario: Quit removes the copies
- **GIVEN** the user opened two attachments of an encrypted budget on desktop
- **WHEN** the user quits the app
- **THEN** no copy of either document remains in the temp folder

#### Scenario: Crash leaves copies, next start removes them
- **GIVEN** the app crashed after the user opened an attachment, leaving a copy in the temp folder
- **WHEN** the app starts again
- **THEN** that copy is removed

#### Scenario: Copy kept while the viewer may read it
- **WHEN** the user opens an attachment
- **THEN** its copy stays in place, and the viewer opens it, until the app quits or restarts
