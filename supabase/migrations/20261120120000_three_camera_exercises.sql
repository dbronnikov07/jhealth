-- The camera demo keeps the three exercises that have public labelled data behind them: chair squat, sit-to-stand
-- and arm raise to the side. Seated knee extension has no labelled camera or lab data, so it becomes self-reported
-- ("Mark done") instead of camera-scored. Plans that already contain it keep working.
update exercises set tracking = 'manual', model_key = null where id = 'seated_knee_extension';
