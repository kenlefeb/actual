# Spec Delta

## Purpose

Ensures every fork release's notes reach users through the in-app notifications page and the "What's new" notification, without depending on upstream's feed or showing notes for versions that are not installed.

## ADDED Requirements

### Requirement: Every release has a feed entry
Each fork release note in `fork/release-notes/` SHALL have a matching release entry in the fork's notifications feed, including the release for the current package version. A check SHALL fail when an entry is missing.

#### Scenario: Missing entry
- **WHEN** a release note exists for 26.10.1-alpha.5 but the fork feed has no entry for that version
- **THEN** the check fails and names the missing version

#### Scenario: Current version covered
- **WHEN** the release packages are versioned 26.10.1-alpha.5
- **THEN** the fork feed contains a release entry with version 26.10.1-alpha.5

### Requirement: Entries reflect the release note
A fork feed entry SHALL carry the release note's version, its publication date, a title naming the version and the fork, a body with the note's summary including its unofficial-prerelease statement, the categorized changes as details, and an absolute link to the note.

#### Scenario: Generated entry
- **WHEN** entries are generated from the 26.10.1-alpha.4 release note dated October 27, 2026
- **THEN** the entry has version `26.10.1-alpha.4`, date `2026-10-27`, a body containing "Unofficial fork prerelease", details containing its Features section, and a link to the note on GitHub

### Requirement: Production builds show bundled notes
Fork production builds SHALL read the notifications feed bundled into the build, combining upstream's bundled entries with the fork's entries, newest first. Development and test runs SHALL keep upstream's feed source unless explicitly configured.

#### Scenario: Fork notes on the notifications page
- **WHEN** a user opens `/notifications` in a fork production build of 26.10.1-alpha.5
- **THEN** the page lists the 26.10.1-alpha.5 notes and earlier fork and upstream entries, newest first

#### Scenario: No undeployed notes
- **WHEN** a deployment runs 26.10.1-alpha.4 while notes for 26.10.1-alpha.5 exist on the development branch
- **THEN** that deployment's notifications page does not list 26.10.1-alpha.5

### Requirement: What's new on first run of a release
Running a fork release for the first time after an earlier version SHALL show the existing "What's new in Actual <version>" notification for that release, linking to the notifications page.

#### Scenario: Upgrade notification
- **WHEN** a user who last saw the alpha.4 notes first opens a build of 26.10.1-alpha.5 with notifications enabled
- **THEN** a notification titled "What's new in Actual 26.10.1-alpha.5" is shown
