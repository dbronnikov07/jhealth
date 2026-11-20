-- An emergency contact per patient (a parent, a partner, a carer). After a possible fall, or when the patient asks
-- for help, the camera session shows a button that calls this person. Optional; the physiotherapist enters it.
-- The patient's own session page (reached only through their private link) shows the name and calls the number.
alter table patients
  add column emergency_name  text check (emergency_name is null or char_length(emergency_name) between 1 and 80),
  add column emergency_phone text check (emergency_phone is null or emergency_phone ~ '^\+[1-9][0-9]{6,14}$');
