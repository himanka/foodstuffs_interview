# foodstuffs_interview

# Checkout Capability Implementation Plan

This document outlines the design and implementation of the Order Basket Checkout and Payment capability.

## Core Principle

> The checkout process is managed as a state machine within a robust transactional boundary. The order is only confirmed for fulfillment after payment is irrevocably secured. This is achieved using a two-phase process orchestrated by our service.

-   **Database**: `PostgreSQL`
-   **Key Tenet**: An order is never sent to the ERP for fulfillment until its payment is guaranteed.

---

## High-Level Flow

The process is split into two distinct phases to ensure data integrity and transactional safety.

### Phase 1: Initiation & Payment Intent Creation

1.  The frontend sends the user's cart to the new `Checkout-Service`.
2.  The `Checkout-Service` starts a single SQL transaction to:
    -   Create an `Order` in the PostgreSQL database.
    -   Set the initial order status to `PENDING_PAYMENT`.
3.  Upon successful commit, the service communicates with the payment provider (e.g., Stripe) to create a "Payment Intent."
4.  The service returns a `clientSecret` from the payment provider to the frontend. The frontend can now use this to render the payment form.

### Phase 2: Confirmation via Asynchronous Webhook

1.  The frontend uses the `clientSecret` to complete the payment UI. The user's sensitive payment details are sent **directly to the payment provider**, never touching our servers (this is critical for PCI compliance).
2.  Once the payment is successful, the payment provider sends a secure, asynchronous notification (a **webhook**) to a dedicated endpoint on our `Checkout-Service`.
3.  Our service validates the authenticity of the webhook to prevent fraud.
4.  In a second, independent SQL transaction, the service updates the order's status from `PENDING_PAYMENT` to `PAYMENT_CONFIRMED`.
5.  **Only after this database transaction is successfully committed**, the service publishes an `OrderConfirmed` event to a Kafka topic for the SAP integration layer to process for fulfillment.

### Design Rationale

> This design guarantees that we never send an unpaid or pending order to the ERP system. It provides a clear, auditable trail for every state transition and decouples the payment confirmation from the initial user request, leading to a more resilient and reliable system.

---

## Visual Flow (Sequence Diagram)

This diagram illustrates the interaction between the different components during the checkout process.

```mermaid
sequenceDiagram
    participant Frontend
    participant CheckoutService as CheckoutService
    participant PostgreSQL as DB
    participant PaymentProvider as PaymentProvider
    participant Kafka

    title Checkout & Payment Flow

    rect rgb(235, 245, 255)
        note over Frontend, CheckoutService: Phase 1: Initiation
        Frontend->>CheckoutService: POST /checkout (cart details)
        activate CheckoutService
        CheckoutService->>DB: Create Order (status: PENDING_PAYMENT)
        CheckoutService->>PaymentProvider: Create Payment Intent
        PaymentProvider-->>CheckoutService: clientSecret
        CheckoutService-->>Frontend: 200 OK (with clientSecret)
        deactivate CheckoutService
    end

    Note over Frontend: User enters payment info directly into provider's UI.

    rect rgb(255, 250, 235)
        note over PaymentProvider, CheckoutService: Phase 2: Confirmation (Asynchronous)
        Frontend->>PaymentProvider: Submit payment details
        PaymentProvider-->>Frontend: Payment successful
        
        Note over PaymentProvider, Kafka: ...sometime later...

        PaymentProvider->>CheckoutService: POST /webhook (payment.succeeded event)
        activate CheckoutService
        Note right of CheckoutService: Validate webhook signature
        CheckoutService->>DB: Update Order status to 'PAYMENT_CONFIRMED'
        Note right of CheckoutService: Only after DB commit...
        CheckoutService->>Kafka: Publish `OrderConfirmed` event
        CheckoutService-->>PaymentProvider: 200 OK
        deactivate CheckoutService
    end
