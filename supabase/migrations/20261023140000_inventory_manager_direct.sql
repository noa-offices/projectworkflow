begin;
alter function inventory.submit_product_request(jsonb) rename to submit_product_request_pending;
revoke all on function inventory.submit_product_request_pending(jsonb) from public,anon,authenticated,service_role;
create function inventory.submit_product_request(payload jsonb) returns jsonb language plpgsql security definer set search_path=inventory,public as $$
declare r uuid; p uuid; begin
 r:=inventory.submit_product_request_pending(payload);
 if inventory.can_manage() then p:=inventory.review_product_request(r,'approved','Applied directly by manager'); end if;
 return jsonb_build_object('request_id',r,'product_id',p);
end $$;
revoke all on function inventory.submit_product_request(jsonb) from public,anon;
grant execute on function inventory.submit_product_request(jsonb) to authenticated,service_role;
alter function inventory.submit_movement_request(uuid,text,text,text,text,integer,text) rename to submit_movement_request_pending;
revoke all on function inventory.submit_movement_request_pending(uuid,text,text,text,text,integer,text) from public,anon,authenticated,service_role;
create function inventory.submit_movement_request(product_id uuid,request_type text,action_type text,from_location text,to_location text,quantity integer,note text)
returns jsonb language plpgsql security definer set search_path=inventory,public as $$
declare r uuid; m uuid; begin
 r:=inventory.submit_movement_request_pending(product_id,request_type,action_type,from_location,to_location,quantity,note);
 if inventory.can_manage() then
   perform inventory.review_movement_request(r,'approved','Applied directly by manager');
   select approved_movement_id into m from inventory.movement_requests where id=r;
 end if;
 return jsonb_build_object('request_id',r,'movement_id',m,'reservation_id',null);
end $$;
revoke all on function inventory.submit_movement_request(uuid,text,text,text,text,integer,text) from public,anon;
grant execute on function inventory.submit_movement_request(uuid,text,text,text,text,integer,text) to authenticated,service_role;
commit;
