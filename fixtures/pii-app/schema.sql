CREATE TABLE users (
  id serial PRIMARY KEY,
  email text NOT NULL,
  phone_number text,
  date_of_birth date,
  ip_address inet
);
