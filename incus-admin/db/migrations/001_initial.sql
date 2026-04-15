-- +goose Up

CREATE TABLE clusters (
    id           SERIAL PRIMARY KEY,
    name         TEXT UNIQUE NOT NULL,
    display_name TEXT,
    api_url      TEXT NOT NULL,
    status       TEXT DEFAULT 'active',
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
    id           SERIAL PRIMARY KEY,
    email        TEXT UNIQUE NOT NULL,
    name         TEXT,
    role         TEXT DEFAULT 'customer',
    logto_sub    TEXT UNIQUE,
    balance      DECIMAL(10,2) DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE quotas (
    id            SERIAL PRIMARY KEY,
    user_id       INT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    max_vms       INT DEFAULT 5,
    max_vcpus     INT DEFAULT 8,
    max_ram_mb    INT DEFAULT 16384,
    max_disk_gb   INT DEFAULT 200,
    max_ips       INT DEFAULT 3,
    max_snapshots INT DEFAULT 10
);

CREATE TABLE ssh_keys (
    id           SERIAL PRIMARY KEY,
    user_id      INT REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    public_key   TEXT NOT NULL,
    fingerprint  TEXT NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE products (
    id             SERIAL PRIMARY KEY,
    name           TEXT NOT NULL,
    slug           TEXT UNIQUE,
    cpu            INT,
    memory_mb      INT,
    disk_gb        INT,
    bandwidth_tb   INT,
    price_monthly  DECIMAL(10,2),
    access         TEXT DEFAULT 'public',
    active         BOOLEAN DEFAULT TRUE,
    sort_order     INT DEFAULT 0,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE product_clusters (
    product_id   INT REFERENCES products(id) ON DELETE CASCADE,
    cluster_id   INT REFERENCES clusters(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, cluster_id)
);

CREATE TABLE orders (
    id           SERIAL PRIMARY KEY,
    user_id      INT REFERENCES users(id),
    product_id   INT REFERENCES products(id),
    cluster_id   INT REFERENCES clusters(id),
    status       TEXT DEFAULT 'pending',
    amount       DECIMAL(10,2),
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE vms (
    id           SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    cluster_id   INT REFERENCES clusters(id),
    user_id      INT REFERENCES users(id),
    order_id     INT REFERENCES orders(id),
    ip           INET,
    status       TEXT DEFAULT 'creating',
    cpu          INT,
    memory_mb    INT,
    disk_gb      INT,
    os_image     TEXT,
    node         TEXT,
    password     TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE snapshots (
    id           SERIAL PRIMARY KEY,
    vm_id        INT REFERENCES vms(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    size_bytes   BIGINT DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ip_pools (
    id           SERIAL PRIMARY KEY,
    cluster_id   INT REFERENCES clusters(id),
    cidr         CIDR NOT NULL,
    gateway      INET NOT NULL,
    vlan_id      INT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ip_addresses (
    id              SERIAL PRIMARY KEY,
    pool_id         INT REFERENCES ip_pools(id),
    ip              INET UNIQUE NOT NULL,
    vm_id           INT REFERENCES vms(id),
    status          TEXT DEFAULT 'available',
    cooldown_until  TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE invoices (
    id           SERIAL PRIMARY KEY,
    order_id     INT REFERENCES orders(id),
    user_id      INT REFERENCES users(id),
    amount       DECIMAL(10,2),
    status       TEXT DEFAULT 'unpaid',
    due_at       TIMESTAMPTZ,
    paid_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE transactions (
    id           SERIAL PRIMARY KEY,
    user_id      INT REFERENCES users(id),
    amount       DECIMAL(10,2) NOT NULL,
    type         TEXT NOT NULL,
    description  TEXT,
    invoice_id   INT REFERENCES invoices(id),
    created_by   INT REFERENCES users(id),
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tickets (
    id           SERIAL PRIMARY KEY,
    user_id      INT REFERENCES users(id),
    subject      TEXT NOT NULL,
    status       TEXT DEFAULT 'open',
    priority     TEXT DEFAULT 'normal',
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ticket_messages (
    id           SERIAL PRIMARY KEY,
    ticket_id    INT REFERENCES tickets(id) ON DELETE CASCADE,
    user_id      INT REFERENCES users(id),
    body         TEXT NOT NULL,
    is_staff     BOOLEAN DEFAULT FALSE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audit_logs (
    id           SERIAL PRIMARY KEY,
    user_id      INT REFERENCES users(id),
    action       TEXT NOT NULL,
    target_type  TEXT,
    target_id    INT,
    details      JSONB,
    ip_address   INET,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE api_tokens (
    id           SERIAL PRIMARY KEY,
    user_id      INT REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    token_hash   TEXT UNIQUE NOT NULL,
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_vms_user_id ON vms(user_id);
CREATE INDEX idx_vms_cluster_id ON vms(cluster_id);
CREATE INDEX idx_vms_status ON vms(status);
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_ip_addresses_status ON ip_addresses(status);
CREATE INDEX idx_ip_addresses_vm_id ON ip_addresses(vm_id);
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- +goose Down
DROP TABLE IF EXISTS api_tokens;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS ticket_messages;
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS ip_addresses;
DROP TABLE IF EXISTS ip_pools;
DROP TABLE IF EXISTS snapshots;
DROP TABLE IF EXISTS vms;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS product_clusters;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS ssh_keys;
DROP TABLE IF EXISTS quotas;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS clusters;
