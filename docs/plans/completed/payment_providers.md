● Here's a breakdown of the main options for your use case:

  Recommended: Stripe (fiat) + BTCPay Server (crypto)

  Stripe — Best for cards, bank, and subscriptions

  - Card fees: 2.9% + $0.30 per transaction
  - ACH/bank transfers: 0.8%, capped at $5 per transaction
  - Monthly fee: $0
  - Subscriptions: First-class support — create plans, manage billing cycles, prorate, pause, cancel all via API
  - API quality: Industry-leading. Webhooks, customer portal, excellent docs
  - Payment methods: Cards, ACH, Apple Pay, Google Pay, SEPA, Link
  - No crypto support

  Stripe is the standard for a reason — the subscription billing API (Subscription, Invoice, PaymentIntent) maps directly to your needs. You'd store Stripe customer/subscription IDs in your database and use webhooks to keep state in sync.

  BTCPay Server — Cheapest crypto option (self-hosted)

  - Fees: 0% platform fee (you only pay network mining fees)
  - Monthly fee: $0 (you host it yourself)
  - Coins: Bitcoin, Lightning Network, and optionally other coins via plugins
  - Subscriptions: No native recurring — you'd handle this yourself (send payment links on a schedule)
  - Tradeoff: You run the infrastructure (Docker container, needs a synced Bitcoin node or their lightweight mode)

  Alternatives considered:
  ┌───────────────────┬──────────────────────────────────┬────────────────────────────┬───────────────┬──────────────────────────────────────────────────────────────────┐
  │     Provider      │             Card Fee             │           Crypto           │ Subscriptions │                              Notes                               │
  ├───────────────────┼──────────────────────────────────┼────────────────────────────┼───────────────┼──────────────────────────────────────────────────────────────────┤
  │ Helcim            │ ~1.9-2.5% + $0.08 (interchange+) │ No                         │ Yes           │ Cheaper per-transaction for higher volume, but less polished API │
  ├───────────────────┼──────────────────────────────────┼────────────────────────────┼───────────────┼──────────────────────────────────────────────────────────────────┤
  │ Coinbase Commerce │ 1%                               │ Yes (BTC, ETH, USDC, etc.) │ No            │ Simple hosted checkout, but no recurring billing                 │
  ├───────────────────┼──────────────────────────────────┼────────────────────────────┼───────────────┼──────────────────────────────────────────────────────────────────┤
  │ NOWPayments       │ 0.5-1%                           │ Yes (150+ coins)           │ Yes (basic)   │ Has a recurring payment feature, decent API                      │
  ├───────────────────┼──────────────────────────────────┼────────────────────────────┼───────────────┼──────────────────────────────────────────────────────────────────┤
  │ Square            │ 2.9% + $0.30                     │ No                         │ Basic         │ Weaker subscription API compared to Stripe                       │
  ├───────────────────┼──────────────────────────────────┼────────────────────────────┼───────────────┼──────────────────────────────────────────────────────────────────┤
  │ PayPal/Braintree  │ 2.99% + $0.49                    │ No                         │ Yes           │ Higher fees, clunkier DX                                         │
  └───────────────────┴──────────────────────────────────┴────────────────────────────┴───────────────┴──────────────────────────────────────────────────────────────────┘
  My recommendation for your stack:

  1. Stripe for all fiat payments (cards + ACH bank transfers). ACH at 0.8% capped at $5 is very cheap for larger donations/memberships. Their Billing API handles subscriptions, invoices, cancellations, and payment history out of the box.
  2. BTCPay Server for Bitcoin/crypto if you want zero platform fees and don't mind self-hosting. Alternatively, NOWPayments (0.5%) if you want a hosted solution with more coin options and basic recurring support.

  For your app's UX (users viewing their transactions/subscriptions/cancelling), you'd store all the relevant data in your PostgreSQL database and sync state via webhooks from Stripe. The actual payment flow happens on Stripe's side (checkout sessions or embedded payment elements), then your backend receives webhook events to update subscription status, record transactions, etc.