// This service consumes from the 'notifications-to-send' Kafka topic.
// Assumes 'db' is a configured postgres client and 'emailProvider' is a SendGrid/Mailgun SDK.

async function processNotificationRequest(message) {
    const { eventType, recipientEmail, customerId, orderId, data } = message;

    // 1. Log the notification attempt in the database
    const logQuery = `
        INSERT INTO notifications (customer_id, order_id, type, recipient, template_id, status)
        VALUES ($1, $2, 'EMAIL', $3, $4, 'PENDING')
        RETURNING id;
    `;
    const logResult = await db.query(logQuery, [customerId, orderId, recipientEmail, eventType]);
    const notificationId = logResult.rows[0].id;

    try {
        // 2. Call the external email provider
        const response = await emailProvider.send({
            to: recipientEmail,
            templateId: eventType, // e.g., 'ORDER_CONFIRMATION, PAYMENT_CONFIRMATION'
            templateData: data
        });

        // 3. Update our log with the result
        const successUpdateQuery = `
            UPDATE notifications
            SET status = 'SENT', provider_message_id = $1, updated_at = NOW()
            WHERE id = $2;
        `;
        await db.query(successUpdateQuery, [response.messageId, notificationId]);
        console.log(`Successfully sent notification ${notificationId}`);

    } catch (error) {
        // 4. If sending fails, update our log accordingly
        const failureUpdateQuery = `
            UPDATE notifications
            SET status = 'FAILED', updated_at = NOW()
            WHERE id = $1;
        `;
        await db.query(failureUpdateQuery, [notificationId]);
        console.error(`Failed to send notification ${notificationId}:`, error);
        // This could also trigger an alert for monitoring.
    }
}