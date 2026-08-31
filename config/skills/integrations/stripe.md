---
name: stripe-integration
description: Stripe API integration for payments, subscriptions, and customer management
type: integration
trigger_patterns:
  - "stripe"
  - "payment"
  - "subscription"
  - "invoice"
  - "stripe customer"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: Stripe API
    url: https://stripe.com/docs/api
    license: MIT
  - name: stripe-node
    url: https://github.com/stripe/stripe-node
    license: MIT
integration_config:
  baseUrl: https://api.stripe.com/v1
  auth: bearer
  secretName: stripe-secret-key
  rateLimit: 100
  operations:
    - name: create_customer
      method: POST
      path: /customers
      description: Create a new customer
      parameters:
        email: { type: string, description: "Customer email" }
        name: { type: string, description: "Customer name" }
        metadata: { type: object, description: "Custom key-value metadata" }
    - name: list_customers
      method: GET
      path: /customers
      description: List customers
      parameters:
        email: { type: string, description: "Filter by email" }
        limit: { type: number, description: "Max results (1-100)" }
    - name: create_charge
      method: POST
      path: /charges
      description: Create a charge (legacy — prefer PaymentIntents)
      parameters:
        amount: { type: number, required: true, description: "Amount in smallest currency unit (cents)" }
        currency: { type: string, required: true, description: "Three-letter ISO currency code" }
        customer: { type: string, description: "Customer ID" }
        description: { type: string, description: "Charge description" }
    - name: create_subscription
      method: POST
      path: /subscriptions
      description: Create a subscription for a customer
      parameters:
        customer: { type: string, required: true, description: "Customer ID" }
        items: { type: array, required: true, description: "Subscription items [{price: 'price_xxx'}]" }
        trial_period_days: { type: number, description: "Trial days before billing" }
    - name: list_invoices
      method: GET
      path: /invoices
      description: List invoices
      parameters:
        customer: { type: string, description: "Filter by customer ID" }
        status: { type: string, description: "Filter: draft, open, paid, void, uncollectible" }
        limit: { type: number, description: "Max results (1-100)" }
    - name: create_payment_intent
      method: POST
      path: /payment_intents
      description: Create a PaymentIntent for collecting payment
      parameters:
        amount: { type: number, required: true, description: "Amount in smallest currency unit" }
        currency: { type: string, required: true, description: "ISO currency code" }
        customer: { type: string, description: "Customer ID" }
        payment_method_types: { type: array, description: "Allowed payment methods" }
    - name: list_products
      method: GET
      path: /products
      description: List products
      parameters:
        active: { type: boolean, description: "Filter by active status" }
        limit: { type: number, description: "Max results" }
    - name: create_product
      method: POST
      path: /products
      description: Create a new product
      parameters:
        name: { type: string, required: true, description: "Product name" }
        description: { type: string, description: "Product description" }
        default_price_data: { type: object, description: "Default price {unit_amount, currency}" }
---
# Stripe Integration

Authentication uses the secret key stored as `stripe-secret-key` (starts with `sk_`). Use test mode keys (`sk_test_`) for development. The token is passed as Bearer in the Authorization header.

All monetary amounts are in the smallest currency unit (e.g., cents for USD, so $19.99 = 1999). Use `Stripe-Version` header to pin API version. Rate limit is 100 read operations and 100 write operations per second in live mode (25/25 in test mode).

Use PaymentIntents instead of Charges for new integrations. Webhooks are recommended for tracking async events (payment success, subscription changes).
