-- The camera no longer counts a chair squat or a sit-to-stand that is pushed up with the hands (the hands stay low,
-- on the thighs, the knees or the chair, on the way up). The instructions now say where the arms go, so a patient
-- is told before the first repetition, not after it failed to count.
-- Draft wording for the demo, like the rest: a physiotherapist should review it. A patient who needs their hands
-- (early after surgery) should do this exercise self-reported until the physiotherapist can allow hands per plan.
update exercises
   set instructions = 'Stand in front of a sturdy chair, feet hip-width apart. Cross your arms on your chest, or reach them forward. Bend your knees and sit back as if to sit down, only as far as is comfortable, then stand up tall. Keep your knees in line with your toes, and keep your hands off your legs.'
 where id = 'squat';

update exercises
   set instructions = 'Sit near the front of a sturdy chair, feet flat and hip-width apart. Cross your arms on your chest. Lean forward a little and stand up fully, then sit back down slowly. Stand up with your legs only: a stand pushed up with the hands does not count.'
 where id = 'sit_to_stand';
