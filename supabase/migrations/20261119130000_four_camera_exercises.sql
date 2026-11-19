-- Four camera-scored exercises: squat, sit-to-stand, seated knee extension, arm raise to the side.
--
-- Knee-bend exercises store their deepest knee bend in knee_bend_deg (as before). Exercises whose progress is a
-- range of motion store it in the new rom_deg: how straight the knee got (seated knee extension) or how high the
-- arm went (arm raise), in degrees.
alter table sessions add column if not exists rom_deg numeric(5,1) check (rom_deg between 0 and 180);
alter table reps     add column if not exists rom_deg numeric(5,1);

-- Instructions are draft wording for the demo. A physiotherapist should review them before real use.
insert into exercises (id, name, body_area, instructions, tracking, model_key, default_sets, default_reps) values
  ('squat', 'Chair squat', 'knee',
   'Stand in front of a sturdy chair, feet hip-width apart. Bend your knees and sit back as if to sit down, only as far as is comfortable, then stand up tall. Keep your knees in line with your toes.',
   'camera', 'squat', 2, 10),
  ('arm_raise', 'Arm raise to the side', 'shoulder',
   'Stand or sit tall. Keep your arm straight and lift it out to the side up to shoulder height, then lower it slowly. Keep your body still.',
   'camera', 'arm_raise', 2, 10)
on conflict (id) do nothing;

-- Seated knee extension is now counted and checked by the camera (rules, until a model is trained on clips).
update exercises
   set tracking = 'camera', model_key = 'seated_knee_extension',
       instructions = 'Sit tall on a chair, side-on to the camera. Slowly straighten one knee until the leg is level with the floor, hold for 2 seconds, then lower it slowly.'
 where id = 'seated_knee_extension';
