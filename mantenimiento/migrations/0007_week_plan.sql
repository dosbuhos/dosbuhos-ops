-- The week planner. The day a pendiente is planned for is its due_date; these add how long it should take
-- and the time of day it starts. Both are optional.
ALTER TABLE tasks ADD COLUMN est_min INTEGER;
ALTER TABLE tasks ADD COLUMN plan_min INTEGER;
