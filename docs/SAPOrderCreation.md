# Low-Code Flow: SAP Order Creation

This document describes the design of the low-code integration flow responsible for creating a Sales Order in the SAP ERP system after a customer's online payment is confirmed.

**Flow Name:** `OrderCreatetionInSAP`  
**Tooling:** SAP Cloud Integration (SCI) or Apache Nifi  

---

## 1. Trigger

The flow is triggered by consuming a new message from the following Apache Kafka topic.

- **Topic Name:** `orders-payment-confirmed`

## 2. Input Event Schema

The flow expects to receive a JSON message with the following structure. This event is published by the Checkout-Service once payment is successfully captured.

```json
{
  "orderId": "a7e2b1d0-6fcf-4a37-8b01-3e9a1b2c4d5e",
  "customerId": "c3f8e9a1-5b2c-4d1e-a9f0-1b2c3d4e5f6a",
  "shippingAddress": {
    "street": "123 Integration Lane",
    "city": "Techville",
    "postalCode": "98765",
    "country": "USA"
  },
  "totalAmount": 5950,
  "currency": "USD",
  "items": [
    { 
      "sku": "JMP-STK-TEE-LG", 
      "quantity": 2, 
      "price": 2500 
    },
    { 
      "sku": "STICKER-PACK", 
      "quantity": 1, 
      "price": 950 
    }
  ]
}
```

## 3. Processing Steps

The flow executes the following sequence of steps to process the incoming message.

### Step 1: Consume Message (`ConsumeKafkaRecord`)

- Reads a single message from the `orders-payment-confirmed` topic.
- The consumer group ID should be set to `sap-order-creation-group` to ensure message processing is distributed and resilient in a clustered environment.

### Step 2: Transform Data

This is the core mapping step. The incoming JSON event schema is transformed into the format required by the target SAP Sales Order API.

**Example Transformation Logic:**
- Map `orderId` to SAP's `ExternalOrderNumber` field.
- Map `customerId` to `SoldToParty`.
- Loop through the `items` array and create line items in the SAP structure.
- Map `shippingAddress` fields to the corresponding address fields in the SAP structure.

### Step 3: Invoke SAP Endpoint 

Makes an authenticated POST request to the SAP Sales Order creation endpoint.

- **Endpoint URL:**
- **Method:** `POST`
- **Authentication:** OAuth 2.0 Client Credentials or Basic Authentication over HTTPS.
- **Body:** 

### Step 4: Route on Response

This step evaluates the HTTP status code returned from the SAP endpoint and directs the flow accordingly.

#### Success Path (HTTP Status `201 Created`)

- **Construct Success Event:** Create a new JSON message.
  ```json
  {
    "onlineOrderId": "a7e2b1d0-6fcf-4a37-8b01-3e9a1b2c4d5e",
    "sapSalesOrderNumber": "1000012345",
    "status": "ACKNOWLEDGED",
    "timestamp": "2023-10-27T12:00:00Z"
  }
  ```
- **Publish to Kafka:** Publish this new event to the `orders-sap-acknowledged` topic. This allows downstream systems to know the order has been successfully created in the ERP.

#### Failure Path (HTTP Status `4xx` or `5xx`)

- **Log Error:** Log the entire original message, the HTTP status code, and the error response body from SAP for diagnostic purposes.
- **Publish to Dead Letter Queue (DLQ):** Move the original, unmodified message from Step 1 to a dedicated DLQ topic.
  - **DLQ Topic Name:** `orders-sap-creation-failed`
- **Alerting:** An alert should be configured to fire when a new message enters the DLQ, notifying the on-call engineer for Team 1 to investigate the failure manually. This prevents data loss.
