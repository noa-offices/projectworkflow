-- Rollback for 20261029100000_inventory_activity_log.sql. Manual application only.
-- Removes the 10 triggers and the 8 functions. Existing audit_activity_log rows are NOT deleted.
begin;

drop trigger if exists inventory_log_product_ins on inventory.products;
drop trigger if exists inventory_log_product_upd on inventory.products;
drop trigger if exists inventory_log_product_del on inventory.products;
drop trigger if exists inventory_log_product_request_ins on inventory.product_requests;
drop trigger if exists inventory_log_product_request_upd on inventory.product_requests;
drop trigger if exists inventory_log_movement_ins on inventory.movements;
drop trigger if exists inventory_log_movement_request_ins on inventory.movement_requests;
drop trigger if exists inventory_log_movement_request_upd on inventory.movement_requests;
drop trigger if exists inventory_log_reservation_ins on inventory.reservations;
drop trigger if exists inventory_log_reservation_upd on inventory.reservations;

drop function if exists inventory.trg_log_product();
drop function if exists inventory.trg_log_product_request();
drop function if exists inventory.trg_log_movement();
drop function if exists inventory.trg_log_movement_request();
drop function if exists inventory.trg_log_reservation();
drop function if exists inventory.log_activity(text, uuid, text, uuid, text, text, text);
drop function if exists inventory.activity_product_label(uuid);
drop function if exists inventory.activity_label(text, text);

commit;
