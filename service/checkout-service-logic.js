// Assumes 'db' is a configured node-postgres pool client
// and 'kafkaProducer' is a configured Kafka producer instance.
// and 'paymentProvider' is an SDK for Stripe/Adyen etc.

async function initiateCheckout(req, res) {
    const { cartItems, shippingAddress, customerId } = req.body;
    const client = await db.getClient(); // Get a client from the pool for transaction

    try {
        // --- START TRANSACTION ---
        await client.query('BEGIN');

        // 1. Calculate total and validate inventory (not shown for brevity)
        const { totalAmountCents, currency } = calculateTotal(cartItems);

        // 2. Create the order header
        const orderInsertQuery = `
            INSERT INTO orders (customer_id, shipping_address, total_amount_cents, currency, status)
            VALUES ($1, $2, $3, $4, 'PENDING_PAYMENT')
            RETURNING id;
        `;
        const orderResult = await client.query(orderInsertQuery, [customerId, shippingAddress, totalAmountCents, currency]);
        const newOrderId = orderResult.rows[0].id;

        // 3. Insert line items
        for (const item of cartItems) {
            const itemInsertQuery = `
                INSERT INTO order_items (order_id, product_sku, quantity, price_at_purchase_cents)
                VALUES ($1, $2, $3, $4);
            `;
            await client.query(itemInsertQuery, [newOrderId, item.sku, item.quantity, item.priceInCents]);
        }

        // 4. Create payment intent with the provider
        const paymentIntent = await paymentProvider.createIntent({
            amount: totalAmountCents,
            currency: currency,
            metadata: { orderId: newOrderId } // Crucial link!
        });

        // 5. Log the payment attempt
        const paymentLogQuery = `
            INSERT INTO payments (order_id, payment_provider, provider_payment_id, amount_cents, status)
            VALUES ($1, 'Stripe', $2, $3, 'PENDING');
        `;
        await client.query(paymentLogQuery, [newOrderId, paymentIntent.id, totalAmountCents]);

        // --- COMMIT TRANSACTION ---
        await client.query('COMMIT');

        // 6. Publish event for the Notification system
        const customer = await db.query('SELECT email FROM customers WHERE id = $1', [confirmedOrder.customer_id]).rows[0];

        const notificationRequest = {
            eventType: 'ORDER_CONFIRMATION',
            recipientEmail: customer.email,
            customerId: confirmedOrder.customer_id,
            orderId: confirmedOrder.id,
            data: { // Data needed to render the email template
                orderNumber: confirmedOrder.id,
                customerName: customer.name,
                totalAmount: confirmedOrder.total_amount_cents / 100,
                currency: confirmedOrder.currency
            }
        };
        await kafkaProducer.publish('notifications-to-send', notificationRequest);

        // 6. Return the secret to the frontend
        res.status(201).send({
            orderId: newOrderId,
            clientSecret: paymentIntent.clientSecret
        });

    } catch (error) {
        // --- ROLLBACK TRANSACTION ---
        await client.query('ROLLBACK');
        console.error("Checkout initiation failed:", error);
        res.status(500).send({ message: "Could not initiate checkout." });
    } finally {
        client.release(); // Release client back to the pool
    }
}

async function handlePaymentWebhook(req, res) {
    const event = paymentProvider.validateWebhook(req); // Validate signature
    if (event.type !== 'payment_intent.succeeded') {
        return res.status(200).send(); // Acknowledge other events
    }

    const paymentIntent = event.data.object;
    const orderId = paymentIntent.metadata.orderId;
    const client = await db.getClient();

    try {
        // --- START TRANSACTION ---
        await client.query('BEGIN');

        // 1. Update our payment log
        const paymentUpdateQuery = `
            UPDATE payments SET status = 'SUCCEEDED', updated_at = NOW()
            WHERE provider_payment_id = $1;
        `;
        await client.query(paymentUpdateQuery, [paymentIntent.id]);

        // 2. Update the order status
        const orderUpdateQuery = `
            UPDATE orders SET status = 'PAYMENT_CONFIRMED', updated_at = NOW()
            WHERE id = $1 AND status = 'PENDING_PAYMENT'
            RETURNING *; -- Return the confirmed order to publish it
        `;
        const orderResult = await client.query(orderUpdateQuery, [orderId]);
        const confirmedOrder = orderResult.rows[0];

        if (!confirmedOrder) throw new Error("Order not found or already processed.");

        // --- COMMIT TRANSACTION ---
        await client.query('COMMIT');

        // 3. AFTER commit, publish event to Kafka
        await kafkaProducer.publish('orders-payment-confirmed', confirmedOrder);


        // 4. Publish event for the Notification system
        const customer = await db.query('SELECT email FROM customers WHERE id = $1', [confirmedOrder.customer_id]).rows[0];

        const notificationRequest = {
            eventType: 'PAYMENT_CONFIRMATION',
            recipientEmail: customer.email,
            customerId: confirmedOrder.customer_id,
            orderId: confirmedOrder.id,
            data: { // Data needed to render the email template
                orderNumber: confirmedOrder.id,
                customerName: customer.name,
                totalAmount: confirmedOrder.total_amount_cents / 100,
                currency: confirmedOrder.currency
            }
        };
        await kafkaProducer.publish('notifications-to-send', notificationRequest);

        res.status(200).send({ received: true });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Failed to process webhook for order ${orderId}:`, error);
        res.status(500).send({ message: "Error processing webhook." });
    } finally {
        client.release();
    }
}