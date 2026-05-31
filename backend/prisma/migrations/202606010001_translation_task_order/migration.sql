ALTER TABLE "Task" ADD COLUMN "translation_order" INTEGER;

CREATE INDEX "Task_project_id_unit_id_role_translation_order_idx" ON "Task"("project_id", "unit_id", "role", "translation_order");
