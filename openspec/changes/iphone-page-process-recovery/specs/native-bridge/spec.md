# Spec Delta

## ADDED Requirements

### Requirement: The iPhone app recovers its own page when the page's process ends
When iOS ends the page's process, the iPhone app SHALL reload its own start page, never the address the web view last showed. After three automatic reloads within a minute it SHALL stop reloading and show an alert with a Reload button; pressing it SHALL reload the start page and start the count again. While the alert cannot be shown the app SHALL keep trying and SHALL reload only within the same cap.

#### Scenario: The process ends on a used sign-in callback
- **GIVEN** the web view last showed a one-time sign-in callback address
- **WHEN** the page's process ends
- **THEN** the app loads its own start page, and the callback address is not requested again

#### Scenario: The process ends on an ordinary screen
- **GIVEN** a budget is open
- **WHEN** the page's process ends
- **THEN** the app loads its own start page and the page reopens the budget

#### Scenario: The process keeps ending
- **GIVEN** the app reloaded its page three times within a minute
- **WHEN** the process ends again
- **THEN** the app does not reload and shows an alert titled "The app stopped working" with the message "Reload to open it again. A change you made in the last moment may not have been saved. Check it, and make it again if it’s missing."

#### Scenario: The alert cannot be shown
- **GIVEN** the app reached the cap and cannot show the alert, for example because it is not active
- **WHEN** the page's process keeps ending
- **THEN** the app keeps trying the alert, reloads its start page only when the cap allows one, and never makes more than three automatic reloads in a minute

#### Scenario: The person returns to the app
- **GIVEN** the alert could not be shown while the app was not active
- **WHEN** the app becomes active
- **THEN** the alert appears

#### Scenario: The person presses Reload
- **GIVEN** the alert is showing
- **WHEN** the person presses Reload
- **THEN** the app loads its start page, and later ends of the process are counted from zero

### Requirement: The iPhone app tells the person after each automatic reload
Each automatic reload SHALL show a notice in a strip at the top of the screen that moves the content down, takes no focus, has a Dismiss button and is announced to VoiceOver. It SHALL wait until the page has loaded and the app is active, and hide 15 seconds later, but not within 2 seconds of a touch. The alert SHALL remove it, and the person's Reload SHALL NOT show it. It SHALL NOT replace a notice that must stay.

#### Scenario: The page's process ends
- **GIVEN** the app is active
- **WHEN** the page's process ends and the reloaded page finishes loading
- **THEN** the strip says "The app restarted just now, so your last change may not have been saved. Check it, and make it again if it’s missing.", VoiceOver announces it, and it hides 15 seconds later

#### Scenario: The page restarts while the app is in the background
- **GIVEN** the app is not active
- **WHEN** the page's process ends and the page reloads
- **THEN** the notice waits, and when the person returns it shows and is announced, with its full 15 seconds

#### Scenario: The reload made while the alert cannot be shown
- **GIVEN** the app reached the cap and could not show the alert
- **WHEN** the cap allows a reload and the app reloads its start page
- **THEN** the notice shows as for any automatic reload

#### Scenario: The person keeps working
- **GIVEN** the notice is showing
- **WHEN** the person touches the screen below it
- **THEN** the screen gets the touch, and the notice does not hide until 2 seconds after the last touch

#### Scenario: The person dismisses the notice
- **GIVEN** the notice is showing
- **WHEN** the person presses Dismiss
- **THEN** the strip goes at once and the content moves back up

#### Scenario: The alert appears
- **GIVEN** the notice is showing or waiting
- **WHEN** the process ends again and the cap is reached
- **THEN** the notice is removed, and pressing Reload on the alert shows no notice

#### Scenario: A notice that must stay is showing
- **GIVEN** a notice that must stay, such as a storage notice, is showing
- **WHEN** the page restarts, or the person presses Reload on the alert
- **THEN** that notice stays, and the reload notice does not appear over it
