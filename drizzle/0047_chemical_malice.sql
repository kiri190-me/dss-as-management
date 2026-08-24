ALTER TYPE "public"."attachment_category" ADD VALUE 'IN_REPAIR' BEFORE 'INSPECTION_REPORT';--> statement-breakpoint
ALTER TYPE "public"."attachment_category" ADD VALUE 'AFTER_REPAIR' BEFORE 'INSPECTION_REPORT';--> statement-breakpoint
ALTER TYPE "public"."attachment_category" ADD VALUE 'SHIPMENT_PHOTO' BEFORE 'INSPECTION_REPORT';