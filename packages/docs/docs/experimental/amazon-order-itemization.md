# Amazon Order Itemization

<ExperimentalFeatureWarning />

An Amazon purchase usually reaches your budget as one card charge, even when it holds several items. This feature reads Amazon's order-history export and splits each matching charge into one line per item, so you can budget what you actually bought.

Turn it on with **Amazon order itemization** under **Settings > Experimental features**.

## Import Your Orders

1. Request your order history from Amazon ("Request your data") and download the order-history CSV file.
2. Open **All accounts**, open the menu next to the account name and choose **Import Amazon orders**.
3. Choose the CSV file.

The file is read on your device. Nothing is sent to Amazon or anywhere else, Actual never asks for your Amazon password, and neither the file nor its rows are kept after the review closes.

## Review the Matches

Actual rebuilds each card charge from the items that shipped together, and looks for a transaction of exactly that amount, dated from one day before to five days after the ship date, in any on-budget account. The review groups the charges:

- **Matched**: checked for you. Each shows the account, date, payee and items. A reconciled transaction is marked **Reconciled**.
- **Ambiguous**: more than one transaction fits. Choose one, or leave it unmatched.
- **Not matched**: no transaction fits, for example because the order was paid with a card that isn't in your budget.
- **Not matched: paid partly by gift card or points**: these orders can't be itemized yet.
- **Already split** and **Already itemized**: the transaction was split before, by you or by an earlier import.

Nothing changes until you choose **Apply selected**. Closing the review writes nothing.

## What Applying Does

- A charge with two or more items becomes a split with one line per item. Tax, shipping and discounts are shared out in proportion to the item prices, so the lines add up to the charge exactly.
- A charge with a single item isn't split. Its notes get the item name instead.
- The transaction's notes get an `#amazon` tag and a link to the order. Its account, date, amount, payee and cleared state don't change.
- Your rules can set each line's category from its note. A line no rule categorizes keeps the transaction's category.
- Applying can be undone like any other change.

## Known Limitations

- Refunds and returns aren't handled.
- Orders paid partly by a gift card or points can't be itemized.
- Off-budget accounts aren't searched.
- The feature is available on desktop only.
