# The grocery list, by example

The demo app is a grocery list behind a sign-in page. Every ` ```spp ` block in this file is
run with the rest of the demo's features, so these examples can't go stale.

Once you're signed in, the list starts empty, and anything you add shows up in it:

```spp
Feature: The grocery list, as documented

  Background:
    Given I am Signed-in

  Scenario: Adding one thing
    When I Add "Milk" to the list
    Then I should See the Cell "Milk"
```

A block that starts with a scenario carries on the Feature above it. So this one shares the
Background, and you're signed in here too:

```spp
  Scenario: Taking it back
    Given I Add "Kale"
    When I Remove "Kale" from the list
    Then I should Not See the Cell "Kale"
```

`Remove` is written below, in a block of its own. A block with no Feature holds `Define`s,
and every file can use them:

```spp
Define: Remove Text (Item)
  Click the Button "Remove" Within the Row Containing Item
```

A block marked `ignore` is only shown, never run:

```spp ignore
Feature: Not yet
  Scenario: Sharing the list
    When I Share the list with "someone@example.com"
```
