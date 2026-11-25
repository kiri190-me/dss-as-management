ALTER TABLE "procedure_template_nodes" ADD COLUMN "share_doc_relative_path" text;--> statement-breakpoint
ALTER TABLE "repair_case_flowchart_nodes" ADD COLUMN "share_doc_relative_path" text;--> statement-breakpoint
ALTER TABLE "procedure_template_nodes" ADD CONSTRAINT "procedure_template_nodes_share_doc_relative_path_shape" CHECK ("procedure_template_nodes"."share_doc_relative_path" IS NULL OR (
        char_length("procedure_template_nodes"."share_doc_relative_path") BETWEEN 1 AND 400
        AND "procedure_template_nodes"."share_doc_relative_path" = btrim("procedure_template_nodes"."share_doc_relative_path")
        AND strpos("procedure_template_nodes"."share_doc_relative_path", chr(92)) = 0
        AND "procedure_template_nodes"."share_doc_relative_path" !~ '[|<>"?*:]'
        AND "procedure_template_nodes"."share_doc_relative_path" !~ '[[:cntrl:]]'
        AND "procedure_template_nodes"."share_doc_relative_path" !~ '(^/)|(/$)|(//)'
        AND "procedure_template_nodes"."share_doc_relative_path" !~ '(^|/)[.]{1,2}(/|$)'
      ));--> statement-breakpoint
ALTER TABLE "repair_case_flowchart_nodes" ADD CONSTRAINT "repair_case_flowchart_nodes_share_doc_relative_path_shape" CHECK ("repair_case_flowchart_nodes"."share_doc_relative_path" IS NULL OR (
        char_length("repair_case_flowchart_nodes"."share_doc_relative_path") BETWEEN 1 AND 400
        AND "repair_case_flowchart_nodes"."share_doc_relative_path" = btrim("repair_case_flowchart_nodes"."share_doc_relative_path")
        AND strpos("repair_case_flowchart_nodes"."share_doc_relative_path", chr(92)) = 0
        AND "repair_case_flowchart_nodes"."share_doc_relative_path" !~ '[|<>"?*:]'
        AND "repair_case_flowchart_nodes"."share_doc_relative_path" !~ '[[:cntrl:]]'
        AND "repair_case_flowchart_nodes"."share_doc_relative_path" !~ '(^/)|(/$)|(//)'
        AND "repair_case_flowchart_nodes"."share_doc_relative_path" !~ '(^|/)[.]{1,2}(/|$)'
      ));