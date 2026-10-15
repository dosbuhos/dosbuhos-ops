-- Monthly wine selections belong to a calendar month, not a member's shipment number.
-- No existing recipe or fulfillment is moved or overwritten.
UPDATE clubs SET allocation_mode='month' WHERE id IN (4,5) AND cadence_months=1;
