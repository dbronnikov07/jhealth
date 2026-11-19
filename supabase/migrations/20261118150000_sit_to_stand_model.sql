-- Sit-to-stand now asks for its own model (trained on UI-PRMD motion capture, calibrated to the camera with
-- ml/calibrate_camera.py). Until a calibrated model exists, the session page falls back to the squat model and says so.
update exercises set model_key = 'sit_to_stand' where id = 'sit_to_stand';
