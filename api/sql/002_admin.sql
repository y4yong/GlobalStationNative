CREATE TABLE IF NOT EXISTS payout_requests (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  creator_id BIGINT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  status ENUM('PENDING', 'APPROVED', 'REJECTED', 'PAID') NOT NULL DEFAULT 'PENDING',
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  processed_by BIGINT NULL,
  INDEX payout_status_idx (status, requested_at),
  CONSTRAINT payout_creator_fk FOREIGN KEY (creator_id) REFERENCES users(id),
  CONSTRAINT payout_processor_fk FOREIGN KEY (processed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  admin_user_id BIGINT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX audit_entity_idx (entity_type, entity_id, created_at),
  CONSTRAINT audit_admin_fk FOREIGN KEY (admin_user_id) REFERENCES users(id)
);
