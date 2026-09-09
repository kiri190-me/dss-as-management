CREATE TABLE "shipment_approval_route_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"approver_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_approval_route_steps_step_order_positive" CHECK (step_order >= 1)
);
--> statement-breakpoint
CREATE TABLE "shipment_approval_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shipment_approval_route_steps" ADD CONSTRAINT "shipment_approval_route_steps_route_id_shipment_approval_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."shipment_approval_routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_approval_route_steps" ADD CONSTRAINT "shipment_approval_route_steps_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_approval_routes" ADD CONSTRAINT "shipment_approval_routes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_approval_route_steps_order_unique" ON "shipment_approval_route_steps" USING btree ("route_id","step_order");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_approval_route_steps_approver_unique" ON "shipment_approval_route_steps" USING btree ("route_id","approver_user_id");--> statement-breakpoint
CREATE INDEX "shipment_approval_route_steps_approver_user_id_idx" ON "shipment_approval_route_steps" USING btree ("approver_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_approval_routes_version_unique" ON "shipment_approval_routes" USING btree ("version");