-- Create an ENUM type for order status to enforce consistency.
CREATE TYPE order_status AS ENUM (
    'PENDING_PAYMENT',
    'PAYMENT_CONFIRMED',
    'AWAITING_FULFILLMENT',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED'
);

-- Create an ENUM type for payment status.
CREATE TYPE payment_status AS ENUM (
    'PENDING',
    'SUCCEEDED',
    'FAILED'
);

-- Create an ENUM type for notification types and statuses 
CREATE TYPE notification_type AS ENUM (
    'EMAIL',
    'SMS',
    'PUSH_NOTIFICATION'
);

CREATE TYPE notification_status AS ENUM (
    'PENDING', 
    'SENT',   
    'DELIVERED', 
    'FAILED'  
);


-- Customers table (assuming it exists, but shown for context)
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The main order header table.
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    status order_status NOT NULL DEFAULT 'PENDING_PAYMENT',
    shipping_address JSONB NOT NULL,
    total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents >= 0),
    currency CHAR(3) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A table for each item within an order.
CREATE TABLE order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_sku VARCHAR(100) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price_at_purchase_cents INTEGER NOT NULL CHECK (price_at_purchase_cents >= 0)
);

-- A table to log payment transactions for auditing.
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id),
    payment_provider VARCHAR(50) NOT NULL,
    provider_payment_id VARCHAR(255) UNIQUE NOT NULL,
    status payment_status NOT NULL DEFAULT 'PENDING',
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A Table to log all customer notifications 
CREATE TABLE notifications (
    id BIGSERIAL PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES customers(id),
    order_id UUID REFERENCES orders(id), 
    type notification_type NOT NULL,
    status notification_status NOT NULL DEFAULT 'PENDING',
    recipient VARCHAR(255) NOT NULL,
    template_id VARCHAR(100) NOT NULL,
    provider_message_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- Create indexes for frequently queried columns.
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_payments_order_id ON payments(order_id);
CREATE INDEX idx_notifications_customer_id ON notifications(customer_id);
CREATE INDEX idx_notifications_order_id ON notifications(order_id);
